# SESSION HANDOFF — 2026-06-14 (UPDATED — end of second session)
## Focus: Time-based SMS alert — Bob flow

---

## Status at session end

**PARTIALLY WORKING — confirm speech with phone number: ✅ — alert creation: ❌**

---

## What works

- "Text Bob at 9 AM say hello" → Naavi says:
  **"I'll text Bob at (613) 879-6681 at [time] saying 'hello'. Say yes to confirm, no to cancel."** ✅
- Phone lookup (community first, then Google Contacts) working ✅
- PENDING_INTENT embedded in `display` field ✅
- Step 1.4 runs on Turn 2 ("yes") ✅ (proven by "Done. Alert set. Text Bob at (613) 879-6681." speech)

## What is still broken

After user says "yes" → Naavi says **"I had trouble saving that alert — please try again."**

Alert is NOT created in `action_rules`.

---

## Architecture of the flow

**Turn 1** ("text Bob at 9 AM say hello"):
1. Classifier → `SET_ACTION_RULE trigger_type=time`
2. `buildActionConfirm` → returns `__FALLTHROUGH__`
3. `__FALLTHROUGH__` handler (added this session): calls `lookup-contact` for Bob, gets phone, returns confirm speech + `<!--PENDING_INTENT:{...}-->` in display field
4. Mobile stores display as `assistantSpeech`

**Turn 2** ("yes"):
1. Mobile sends conversation history to naavi-chat
2. Step 1.4 (line ~1819) finds PENDING_INTENT, parses it
3. Re-resolves contact via `lookupWithPhone`
4. Tries to insert directly into `action_rules` — **FAILS**

---

## Current Step 1.4 SET_ACTION_RULE handler (deployed, naavi-chat)

The handler currently does a direct `supabase.from('action_rules').insert({...})`.
This insert fails — exact error unknown (logs not accessible via CLI in this Supabase version).

---

## Fix to apply next session

**Replace the direct DB insert with a call to the manage-rules Edge Function.**

manage-rules already has `op:'create'` (lines 280–306 in `manage-rules/index.ts`) and is proven to work.

In naavi-chat Step 1.4 SET_ACTION_RULE handler, replace the supabase insert block with:

```typescript
// Call manage-rules instead of direct insert (bypasses any client/RLS issue in naavi-chat)
const _mrUrl = `${Deno.env.get('SUPABASE_URL')}/functions/v1/manage-rules`;
const _mrKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';
const _mrRes = await fetch(_mrUrl, {
  method: 'POST',
  headers: {
    'Content-Type': 'application/json',
    'Authorization': `Bearer ${_mrKey}`,
  },
  body: JSON.stringify({
    op: 'create',
    user_id: userId,
    trigger_type: tt || 'time',
    trigger_config: normalizedTC,
    action_type: String(pendingParams.action_type ?? 'sms'),
    action_config: pendingAC ?? {},
    label: String(pendingParams.label ?? 'Action rule'),
    one_shot: pendingParams.one_shot ?? true,
  }),
});
const _mrData = await _mrRes.json().catch(() => ({}));
const insErr = (!_mrRes.ok || _mrData.error) ? (_mrData.error ?? 'manage-rules failed') : null;
```

Keep everything after that the same (speech = insErr ? 'I had trouble...' : `Done. ${desc}`, return jsonResponse).

---

## Files modified (deployed, uncommitted)

| File | What changed |
|------|-------------|
| `supabase/functions/naavi-chat/index.ts` | `__FALLTHROUGH__` handler (Turn 1 phone-in-confirm) + Step 1.4 server-side insert attempt — **DEPLOYED, NOT COMMITTED** |
| `supabase/functions/get-naavi-prompt/index.ts` | Classifier prompt update (PROMPT_VERSION v114) — **DEPLOYED, COMMITTED in v114** |

---

## Test sequence after fix

1. Say: **"Text Bob at 5 PM say hello"**
2. Naavi replies: **"I'll text Bob at (613) 879-6681 at [time] saying 'hello'. Say yes to confirm."**
3. Say: **"yes"**
4. Naavi replies: **"Done. Alert set. Text Bob at (613) 879-6681 at 5 PM."**
5. Open Alerts screen → rule appears ✅
6. At 5 PM → Bob receives SMS ✅

## After Bob test passes

Run Sarah disambiguation test: "Text Sarah at 3 PM say hi"
- Two Sarahs in contacts: Sarah Elgillani (236) 688-2719 and Sarah El-Gillani (613) 769-7957
- Naavi must ask: "Which Sarah? 1. Sarah Elgillani (236) 688-2719  2. Sarah El-Gillani (613) 769-7957"

---

## Broken diagnostic code (remove before next commit)

Lines ~1833–1845 in naavi-chat: `step1.4-pi-check` diagnostic INSERT into `client_diagnostics`.
This INSERT was missing the required `session_id TEXT NOT NULL` column → all writes silently failed → caused the false "zero rows" reading earlier. Remove this block — it is dead and misleading.

---

## PROMPT_VERSION mismatch

`get-naavi-prompt` is now at `2026-06-14-v114-email-count-match`.

Two test files still check for v113:
- `tests/catalogue/session-2026-05-27.ts:95`
- `tests/catalogue/session-2026-05-28.ts:151`

Update both to v114 before running `npm run test:auto`.

---

## Previous handoff context (from earlier today)

The earlier handoff (`SESSION_HANDOFF_2026-06-14_ARCH1_TIME_ALERT_FIX.md`) covered the Sara disambiguation bug (wrong Sarah picked). That bug is separate from the current Bob flow bug. The Sarah flow goes through the same PENDING_INTENT / Step 1.4 path, so fixing the insert will help Sarah too — but disambiguation still needs to be verified separately once inserts work.
