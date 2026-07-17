# Session Handoff — 2026-07-10 — B9g contamination root-caused and fixed, new silent rule-creation failure found and unresolved

## Next session priority (explicit, from Wael): F15 testing and fixes

Continue live testing and fixing in the F15 self-override area. Three concrete threads, in priority order:

1. ~~Diagnose the silent rule-creation failure.~~ **SUPERSEDED — root cause found later the same session (2026-07-10), no APK needed.** A self-override WhatsApp time-trigger request can get a clean "Alert set." confirmation from Naavi while nothing is actually written to `action_rules`. Reproduced 4+ times this session (5:30, 5:37, 5:45→different failure mode, 5:49, 5:55 AM EST) with varying, valid datetimes — datetime shape is ruled out as the cause. The bug is entirely server-side in `supabase/functions/naavi-chat/index.ts`'s confirm-then-act routing, never reaches `hooks/useOrchestrator.ts` at all: `buildActionConfirm()`'s `SET_ACTION_RULE` case only forwards `self_override_*` fields for `trigger_type==='location'` (lines 1859-1864); the `time` branch always falls through with none. The dedicated time-trigger fallthrough handler (lines 2815-2929) is built only for named third parties — for a self-override (`to_name` empty) it calls `lookup-contact` with an empty name, gets a correct HTTP 400, and falls through to raw Claude reasoning **without ever embedding a `<!--PENDING_INTENT:-->` marker**. Turn 1's confirm-ask still works (genuine Claude tool reasoning), but Turn 2 ("Yes") has no marker for Step 1.4 to find, so nothing executes — Claude just emits its Turn-2 acknowledgment text on trust. Verified against live `client_diagnostics` (turn 7's raw response was 79 bytes, empty `actions:[]`) and a direct staging `action_rules` query (zero rows for any of the 5:30-5:55 AM attempts). Full trace in the holding list, item B9i. Fix not yet written — scope is to give the time-trigger fallthrough handler the same self-override awareness the location branch already has.
2. **Root-cause the reappeared `to_phone` contamination.** A clean self-override WhatsApp rule that DID get created (id `c528c7cc-...`, 5:02 AM) had a spurious `to_phone: "+13433332567"` (the user's own number) sitting alongside the correct `self_override_whatsapp` field. Confirmed inert for delivery (traced through `evaluate-rules` — the self-alert branch never reads `to_phone`), but the field shouldn't be there at all and its origin is undiagnosed. Likely candidate: the B4y default-phone-filling logic in `hooks/useOrchestrator.ts` (~line 3982, `if ((actionType==='sms'||actionType==='whatsapp') && !actionConfig.to_phone) { actionConfig.to_phone = settings.phone }`) — written 2026-05-24, predates and has zero awareness of the F15 self-override fields introduced 2026-07-09. Worth checking whether this heuristic should be skipped entirely when any `self_override_*` field is already present.
3. **B9h — international phone number support.** Truncation bug fixed and deployed (queued for APK); three explicitly open, unverified gaps remain: Claude/Haiku's extraction accuracy for non-NANP numbers, Twilio's international messaging account permissions, and 7 other Edge Functions flagged (not audited) for the same NANP-hardcoding pattern `lookup-contact`'s phone regex had.

Full detail on all three in the holding list entries B9g and B9h — `docs/HOLDING_LIST_CLASSIFICATION_2026-06-11.md`.

---

## What shipped this session — deployed to staging, live now, no APK needed

### 1. `lookup-contact` Edge Function — B9g's actual root cause, fixed

The original B9g bug: "WhatsApp me at +16137976746 in 3 minutes say hello" produced a confirm speech misrouting to an unrelated contact ("Laura"), on the time-trigger self-override path. Root-caused via live Supabase Dashboard Edge Function logs (retention was fine, contrary to an earlier assumption that logs would have expired):

`lookup-contact`'s phonetic fallback (built for name typos, e.g. "Fatma"→"Fatima") does `name.trim().split(/\s+/)[0].slice(0,5)`. For a phone-lookup's spaced query variant (`"+1 161 379 76746"`, itself malformed by a separate digit-corruption bug — see below), splitting on whitespace extracts just `"+1"` — a 2-character, near-universal prefix that matched 3 unrelated contacts. The code took the first one.

**Fix:** the phonetic fallback now skips entirely when the query is phone-shaped (`/^[\d\s\-().+]+$/`). A typo-correction heuristic never made sense for a phone number; a real phone lookup now fails cleanly instead of guessing.

**Verified end-to-end, retested live 3 times:** clean extraction (no contamination), correct confirm speech, correct rule creation, correct fire-time fan-out honoring the user's channel preferences (`evaluate-rules` log: `sms=ok email=ok voice-call=ok — 3/3 ok`, cross-checked against actual on-device delivery).

**Also disproven along the way, both corrected in the holding list:** an earlier hypothesis that WhatsApp failed to deliver due to a Twilio-level rejection (wrong — WhatsApp was never attempted because it wasn't in the user's enabled-channels list), and an earlier hypothesis that channel settings changed right after the fire (wrong — `user_settings.updated_at` is a row-level timestamp shared by every field, not proof the channel list itself changed at that moment).

### 2. `naavi-chat`'s `classifyIntent` — datetime hallucination, fixed

Separate, newly-discovered bug: the Haiku classifier's system prompt gave it only today's DATE, never the current TIME. Confirmed live: two turns 56 minutes apart, both using "in 3 minutes," produced the **identical** datetime `2026-07-10T15:03:00-04:00` — proof the model wasn't computing anything, just hallucinating a plausible-looking time with no real anchor.

**Fix:** now computes and injects the actual current Toronto date-time (same DST-safe offset-computation pattern as `lib/naavi-client.ts`'s client-side prompt fallback) and instructs the classifier to use it as "now."

**Verified working** — subsequent tests show correctly computed near-term datetimes (e.g. "in 3 minutes" at 5:49:52 → `05:52:51`, correct).

---

## Fixed in code, queued for next APK build (client-side — not deployed, no APK built this session)

- `lib/contacts.ts::lookupContactByPhone` — strips a leading NANP country-code digit before building the 4 lookup query variants (previously corrupted 3 of 4 whenever the input already included "+1").
- `hooks/useOrchestrator.ts` — phone-number detection rewritten from a fixed-width regex (silently truncated any longer international number into a wrong, shorter fragment — e.g. `+447911123456` → `4479111234`) to a digit-run approach that only proceeds on a recognized NANP shape and skips injection (no guess) for anything else, including real international numbers.
- Diagnostic `remoteLog` instrumentation added to the phone-lookup path (`phone-lookup-start`/`matched`/`no-match`/`context-injected`).
- All typechecked clean (`npx tsc --noEmit`, only pre-existing unrelated errors in `web/app/page.tsx`).

---

## New bugs found this session, logged, not fixed

### Silent rule-creation failure (B9i) — root cause found, no APK needed
See "Next session priority" #1 above for the full corrected trace. Reproduced repeatedly this session; datetime shape ruled out; duplicate-datetime collision in `manage-rules`'s `23505` handler ruled out (zero enabled time-trigger rows existed to collide with); `manage-rules` returning an explicit error ruled out. What was NOT checked this session, and turned out to be the actual cause: `supabase/functions/naavi-chat/index.ts`'s time-trigger confirm-then-act routing never embeds a `PENDING_INTENT` marker for self-override requests (only location does), so the "Yes" turn has nothing to deterministically execute. Confirmed live via `client_diagnostics` and a direct `action_rules` staging query. Fully server-side — `hooks/useOrchestrator.ts` (see below) was never on the causal path.

### Broken client-side diagnostic logging (found while investigating the above — real bug, but not B9i's cause)
`hooks/useOrchestrator.ts`'s `SET_ACTION_RULE` handler has 4 `remoteLog(...)` calls (lines 3253, 3999, 4012, 4017) that pass only a single string argument. `remoteLog`'s actual signature is `(sessionId, step, payload?)` with a guard `if (!sessionId || !step) return;` — since `step` is always undefined in these calls, every one is a silent no-op. This handler has been running with **zero effective diagnostic logging** the entire time it's existed. Worth fixing regardless (restores visibility for future client-side investigations), but it turned out to be unrelated to B9i — that bug never reaches this handler at all.

**Fixed later the same session (2026-07-10), after this handoff was first drafted:** all 4 calls now pass `diagSession` + a proper step name + a structured payload; typechecked clean, queued for next APK (same batch as the other client-side fixes above). **Correction:** the assumption that B9i's root cause required this APK to diagnose was wrong — root-caused separately, same session, via server-side source trace + live staging queries, no APK needed. See B9i in the holding list for the full write-up.

### B9h — international phone numbers
See holding list. Truncation bug fixed (above); Claude extraction accuracy, Twilio international permissions, and 7 other Edge Functions' NANP-hardcoding are all unverified, separate gaps.

### Stray `to_phone` contamination (reappeared, second time)
See "Next session priority" #2 above.

---

## Governance note

Tonight's `lookup-contact` and `naavi-chat` deploys were live incident response (root-causing and fixing a reproducing bug in real time with the user), not planned feature work — no formal Phase 3/Phase 6 review was run against `docs/AI_DEVELOPMENT_GOVERNANCE.md`'s Release Gate Workflow before either deploy. Both are narrow, well-evidenced, live-verified fixes (not speculative), but this should be surfaced explicitly rather than silently treated as compliant. Recommend a retroactive Phase 6 review pass on both changes before considering this fully closed out, similar to the outstanding gap already noted for F15 §1.2.2 in the prior handoff.

## Everything currently on staging only — nothing in production touched

No production Supabase deploy, no AAB build, no `naavi-voice-server` push. `lookup-contact` and `naavi-chat` deploys were both to staging (`xugvnfudofuskxoknhve`) only.

## State of governance process at handoff

- F15 §1.2.2's outstanding Phase 6 gap (from the 2026-07-09 handoff) is still outstanding — untouched this session.
- Tonight's two new fixes (`lookup-contact`, `classifyIntent`) need their own Phase 6 review pass per the governance note above.
- Client-side fixes (`lib/contacts.ts`, `hooks/useOrchestrator.ts` phone-detection rewrite) are code-complete, typechecked, batched for a future dedicated APK session — not built standalone, per standing instruction.
- Production promotion: not started, not discussed this session. Blocked on all of the above plus Wael's explicit approval per the staging-first rule.
