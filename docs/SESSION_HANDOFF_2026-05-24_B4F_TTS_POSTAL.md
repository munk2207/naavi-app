# Session Handoff — 2026-05-24 — B4f Mobile TTS Postal-Code Fix (mid-flight)

**READ FIRST before anything else:**
1. `CLAUDE.md` (project root) — all standing rules, especially the Five Levers, Rule 1 (no action without approval), Rule 10 (multi-user safety), Rule 15 (auto-tester gate before any build), Rule 18 (don't reformat facts to fit DB).
2. This handoff (the file you're reading).
3. `docs/HOLDING_LIST_CLASSIFICATION_2026-05-08.md` — every open bug / feature / tooling item not covered below.

**Scope:** ONE open work item carried into next session. Everything else from the 2026-05-23 session is either shipped, closed, or queued on the holding list — see `docs/HOLDING_LIST_CLASSIFICATION_2026-05-08.md` for the rest.

---

## The bug (B4f)

Mobile TTS reads Canadian postal-code middle letters as their units-of-measure homonym instead of the letter:

- `K1C 5M3` → heard as **"K one C five meters three"** (`M` → "meters")
- `M5V 1A1` → would say "em five vee one ay one" only if read as letters; instead `5V` is at risk of being read as "five volts" or similar
- `K1C 5N3` → `N` could be heard as "newtons"

User reproduction (mobile chat, 2026-05-23): asked *"list me my contacts with postal code 5M3"*, Naavi replied verbally with **"5 meters 3"**.

---

## What shipped this session

### 1. Cloud TTS path (server-side) — `supabase/functions/text-to-speech/index.ts`

Added two normalizers wired into the pipeline before Deepgram receives the text:

- **`normalizePostalCodeForTTS`** — handles full Canadian postal codes (`L-D-L D-L-D`) AND partial fragments (`D-L-D`) where L ∈ {M, N, S, W} is the units-confusable letter. Replaces the letter with its phonetic spelling (`M` → "em", `N` → "en", `S` → "ess", `W` → "double u"). Other letters stay as-is (Deepgram pronounces them correctly when surrounded by digits).
- **`expandProvinceCodesForTTS`** — `ON` → "Ontario", `BC` → "British Columbia", etc., so addresses stop being read as raw 2-letter codes.

Wired into the pipeline at line ~226. Deployed and verified via Edge Function deploy log (no errors).

### 2. Expo-speech fallback path (mobile-side) — `hooks/useOrchestrator.ts` line 3703-3734

The mobile app has TWO TTS paths:

- **Primary:** `speakCloudNative` at line 3610 → calls `text-to-speech` Edge Function → plays MP3
- **Fallback:** `expo-speech` at line 3703 → triggered when cloud TTS fails (network error, audio-focus race, etc.)

The server-side fix above only covers the primary path. So I added inline normalization to the fallback path:

```typescript
const fixPostalLetter = (l: string) => {
  if (l === 'M') return 'em';
  if (l === 'N') return 'en';
  if (l === 'S') return 'ess';
  if (l === 'W') return 'double u';
  return l;
};
const speakText = text
  .replace(/\b([A-Z])(\d)([A-Z])\s?(\d)([A-Z])(\d)\b/g, /* full postal code */)
  .replace(/\b(\d)([MNSW])(\d)\b/g, /* partial D-L-D */)
  .replace(/,\s*ON\b/g, ', Ontario')
  /* ...other province expansions... */
```

**Not yet shipped in an APK.** Code is committed but no new APK has been built post-fix.

---

## What's still wrong

After both fixes deployed, user retested on mobile and **still heard "K1C5 meters 3"** — i.e. the fix did not take effect. The audio transcript was clear that the cloud-TTS normalization did NOT run on this utterance.

### Diagnostic check (incomplete)

I asked the user to share `text-to-speech` Edge Function logs for the failing call. Reply: **"No Log"** — no entry for that timestamp.

**Inference (not yet verified):** if `text-to-speech` has no log row for the utterance, the mobile app didn't call it. Which means **mobile fell back to expo-speech directly**, bypassing cloud TTS entirely — and the user's APK is OLD enough that it doesn't have the inline expo-speech normalization either.

So we have two open questions stacked:

**Q1: Why did cloud TTS get bypassed at all?**

The user has a current APK with cloud TTS wired up; under normal conditions speakCloudNative runs first. Something pushed this utterance down the fallback path. Possibilities to investigate:
- Network failure mid-call (Edge Function timeout, SSL error)
- Supabase JWT expired silently → `functions.invoke` 401 → caught → fallback fires
- `Audio.setAudioModeAsync` race condition / audio-focus loss → cloud TTS plays-but-silent → app re-tries with expo
- Some Android-version-specific bug where Expo's Audio.Sound fails to play the MP3

`useOrchestrator.ts` should be logging a `remoteLog` event named something like `tts-fallback-expo` (or similar) whenever this happens. Grep the code first to confirm the exact event name.

**Q2: Even with a new APK, will the inline expo-normalization actually fire?**

Yes if the mobile build includes the line-3703 changes. But that requires shipping a new APK. The cleaner fix is to make Q1 not happen in the first place — keep mobile on cloud TTS.

---

## Investigation done before context ran out

Queried `client_diagnostics` for Wael's `user_id = 788fe85c-b6be-4506-87e8-a8736ec8e1d1`:

```sql
SELECT * FROM client_diagnostics
WHERE user_id = '788fe85c-b6be-4506-87e8-a8736ec8e1d1'
  AND step LIKE 'tts%'
  AND created_at > '2026-05-23T20:00:00Z'
```

Returned `[]` (empty).

**Don't conclude "no fallback events"** — possible reasons for empty result:
1. The step name isn't `tts-fallback-expo` — could be `cloud-tts-failed`, `speakCloudNative-error`, `audio-fallback`, anything. **Grep `useOrchestrator.ts` for the exact `remoteLog` step name used in the fallback path** before re-querying.
2. The time window was too narrow — broaden to last 7 days.
3. The `remoteLog` call itself is gated behind a condition that wasn't met (e.g. only logs on certain error types). Read line 3703-3760 carefully.
4. `client_diagnostics` writes are async fire-and-forget — possible they were dropped. Lower-confidence theory; check first that step name is right.

---

## Next-session next step

In this order:

1. **Grep `useOrchestrator.ts`** for every `remoteLog(` call inside the TTS path (lines ~3600-3760). Catalogue the exact step names used.
2. **Re-query `client_diagnostics`** with those step names, last 7 days, Wael's user_id. If any fallback events fire, we have the trigger reason in the payload.
3. **If no fallback events ever logged** → either (a) the fallback isn't actually firing (mobile IS calling cloud TTS but Edge Function isn't logging the request for some reason), or (b) the fallback is firing without `remoteLog`. Read the code path to determine which.
4. **Once root cause is known**, decide:
   - If cloud-TTS failure is reproducible → fix the cloud path (highest leverage; one fix covers all dynamic content forever)
   - If fallback is rare/transient → ship the new APK with inline expo normalization as a belt-and-braces safety
   - Likely answer: **both**, because (a) is a real bug worth fixing and (b) is cheap insurance

5. **APK build (NOT yet started).** Once root cause known, build a fresh APK with the inline expo-speech normalization. **Per CLAUDE.md Rule 15**, run `npm run test:auto` and confirm 123/123 green before any build.

---

## Hard prerequisites before any new build (CLAUDE.md Rule 15)

- `npm run test:auto` → must be fully green (last known: 123/123)
- AAB and APK both require the same green gate — no APK-only bypass
- Auto-tester is currently ENABLED (not suspended)

---

## Files touched this session for B4f

- `supabase/functions/text-to-speech/index.ts` — added `normalizePostalCodeForTTS`, `expandProvinceCodesForTTS`, wired at line ~226
- `hooks/useOrchestrator.ts` line 3703-3734 — inline fallback-path normalization

Both committed to main. Edge Function deployed. APK not yet built.

---

## Holding-list status for B4f

Status: **OPEN — investigating**. Do not close until:
1. Root cause of fallback documented
2. Either (a) cloud TTS reliably handles the utterance OR (b) APK with inline expo-normalization shipped AND user-tested green
3. User confirms `5M3` reads as "em" not "meters" on their phone end-to-end

Don't trust my fix-from-here. Verify at the user's end (per `feedback_test_passes_user_end.md`).
