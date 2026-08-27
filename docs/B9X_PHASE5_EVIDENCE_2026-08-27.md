# B9x — Phase 5: Evidence Package

| | |
|---|---|
| **Item** | B9x — an alert meant for another person silently fires to the user instead |
| **Date** | 2026-08-27 |
| **Governance** | v4.2, §3 Phase 5 |
| **Commit** | **`fc71146`** — 4 files, 383 insertions, 1 deletion |
| **Deployed** | **Nowhere.** Not staging, not production. |
| **Status** | Submitted for Phase 6 review. |

---

## 1. Summary

`naavi-chat` now resolves a location alert's named recipient **before the action leaves the server**.

The prompt has always told Claude to pass a bare name in `action_config.to` because *"the server
resolves the contact"* (`get-naavi-prompt:1215`). **No server did.** `naavi-chat` passed
`action_config` through unexamined and left resolution to the mobile client, where two of three
location-creation paths skip it. At fire time `report-location-event:765` read "no addresses" as
"this is a self-alert" and delivered the message to the user.

Rule `bb48e478` did exactly that on **2026-07-19 at 7:58 PM EST** — SMS, WhatsApp and a voice call,
all to the user's own number, body *"You've arrived at Office."* The intended recipient got nothing.

---

## 2. Files changed

| File | Lines | What |
|---|---|---|
| `supabase/functions/naavi-chat/index.ts` | +114 | the location branch (≈50 lines code, ≈64 comment) |
| `supabase/functions/get-naavi-prompt/index.ts` | +4 / −1 | annotation + `PROMPT_VERSION` bump |
| `tests/catalogue/session-2026-08-27-b9x-location-recipient.ts` | +264 | new suite, 11 cases |
| `tests/runner.ts` | +2 | registration |

**Nothing removed. No mobile file, no voice file, no migration, no cron, no dependency.**

---

## 3. Git diff — the code, comments stripped

Inserted in `naavi-chat/index.ts` immediately before the existing
*"Time-trigger contact resolution (Turn 1 confirm)"* block.

```ts
if (userId) {
  const locRule = actions.find((a: any) =>
    a.type === 'SET_ACTION_RULE' && String(a.trigger_type ?? '') === 'location'
  );
  if (locRule) {
    const _locAC = (locRule.action_config ?? {}) as Record<string, any>;
    const hasSelfOverrideLoc = Boolean(
      _locAC.self_override_email || _locAC.self_override_sms ||
      _locAC.self_override_whatsapp || _locAC.self_override_voice,
    );
    const locToName = String(_locAC?.to ?? _locAC?.to_name ?? '').trim();

    if (!hasSelfOverrideLoc && locToName && !_locAC.to_phone && !_locAC.to_email) {
      const _locUrl  = Deno.env.get('SUPABASE_URL') ?? '';
      const _locKey  = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';
      const actTypeLoc = String(locRule.action_type ?? 'sms');
      let locFailure: string | null = null;

      try {
        const rr = await fetch(`${_locUrl}/functions/v1/resolve-recipient`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${_locKey}` },
          body: JSON.stringify({ mode: 'create', to: locToName, user_id: userId }),
        });
        const resolved = rr.ok ? await rr.json() : { kind: 'invalid' };

        switch (resolved?.kind) {
          case 'literal_email':
            _locAC.to_email = resolved.value;
            break;
          case 'literal_phone':
            _locAC.to_phone = resolved.value;
            break;
          case 'resolved_contact':
            if (actTypeLoc === 'email') {
              if (resolved.email) _locAC.to_email = resolved.email;
            } else if (resolved.phone) {
              _locAC.to_phone = resolved.phone;
            }
            if (_locAC.to_phone || _locAC.to_email) {
              _locAC.to_name = resolved.name ?? locToName;
              if (resolved.contact_id) _locAC.contact_id = resolved.contact_id;
            } else {
              locFailure = actTypeLoc === 'email'
                ? `I found ${resolved.name ?? locToName}, but there's no email address saved for them. Tell me their email, or add it to your contacts.`
                : `I found ${resolved.name ?? locToName}, but there's no phone number saved for them. Tell me their number, or add it to your contacts.`;
            }
            break;
          case 'ambiguous':
            locFailure = `You have more than one contact named ${locToName} — say their full name and I'll try again.`;
            break;
          default:
            locFailure = `I don't have a contact named ${locToName}. Tell me their phone number or email directly, or save them to your contacts first.`;
        }
      } catch (e) {
        console.error(`[naavi-chat] B9x: resolve-recipient failed for "${locToName}":`,
          e instanceof Error ? e.message : String(e));
        locFailure = `I couldn't verify that contact right now — please try again.`;
      }

      if (locFailure) {
        console.warn(`[naavi-chat] B9x: dropping location rule — unresolved recipient "${locToName}" (action_type=${actTypeLoc})`);
        return jsonResponse({ rawText: JSON.stringify({ speech: locFailure, display: locFailure, actions: [], pendingThreads: [] }) });
      }

      console.log(`[naavi-chat] B9x: resolved location recipient "${locToName}" → ${_locAC.to_phone ?? _locAC.to_email}`);
    }
  }
}
```

**Prompt change** — one annotation added after `:1215`, and `PROMPT_VERSION`
`'2026-08-20-s1-pin-six-digits'` → `'2026-08-27-b9x-location-recipient-resolved-server-side'`.
The annotation states that the server resolves the name, that a single match saves in the **same
turn with no confirmation**, that an unresolvable or ambiguous name produces a question instead of a
saved alert, and that Claude must **never substitute the user's own contact details for a third
party**. **The RULE 23 location exemption is not touched.**

---

## 4. Tests executed

**11 of 11 pass.**

```
PASS  b9x.location-branch-exists-and-resolves-server-side
PASS  b9x.uses-resolve-recipient-not-lookup-contact
PASS  b9x.fails-closed-on-every-non-resolving-outcome
PASS  b9x.contact-found-but-wrong-channel-fails-closed
PASS  b9x.ambiguous-asks-for-full-name-and-embeds-no-pending-intent
PASS  b9x.does-not-resolve-task-actions
PASS  b9x.self-override-checked-first
PASS  b9x.only-engages-when-a-name-is-present-and-unresolved
PASS  b9x.time-branch-left-unchanged
PASS  b9x.rule23-location-exemption-untouched
PASS  b9x.prompt-describes-what-the-server-actually-does

11 passed, 0 failed, 11 total
```

**Run standalone, deliberately.** `npm run test:auto`'s `SUPABASE_URL` defaults to **production**, and
its fixtures perform live DELETEs regardless of `--grep`. These are pure source-assertion tests
touching no database, so they were executed directly rather than through the runner. **Gate 1 has
therefore not been run and is not claimed.**

**Type check.** `deno check supabase/functions/naavi-chat/index.ts`: **57 errors on HEAD before the
change, 57 after.** All pre-existing `SupabaseClient` generic mismatches elsewhere in the file and in
`intentHandlers.ts`; **none inside the new block**. Measured by checking out the HEAD version and
re-running, not assumed.

**One test failed first and was fixed properly.** `does-not-resolve-task-actions` asserted the string
`task_actions` appears nowhere in the branch — but the branch's own comments name it to record *why*
it is excluded. The test now strips comment lines and asserts over code, and additionally checks that
fire-time resolution still lives in `_shared/task_actions.ts`. **The assertion was tightened, not
loosened.**

### Non-Determinism Rule — not yet satisfied

This change touches the Claude system prompt. Governance Phase 3 requires **3 independent trials per
behaviour-changing case**, with the full distribution reported. **No live trial has been run.** All
evidence above is static. **The Non-Determinism requirement falls to Phase 7 and is explicitly not
claimed here.**

---

## 5. Manual tests required (Phase 7)

| # | Test | Expected |
|---|---|---|
| 1 | *"Text Abdyn when I arrive at the office"*, Abdyn not in contacts | **no rule saved**; Naavi asks for a number or email |
| 2 | *"Alert me at Costco"* | saves, **one turn**, no extra question |
| 3 | *"Text my wife when I leave the office"*, wife in contacts | saves, **one turn**, `to_phone` populated |
| 4 | *"Email me at jane@x.com when I arrive at Costco"* | self-override honoured, resolution never runs |
| 5 | Two contacts share the name | no rule saved; asks for the full name |
| 6 | Email alert to a contact who has an email and no phone | **saves** — the case `lookup-contact` would have rejected |
| 7 | Location alert with `task_actions` | extras still resolve at **fire** time, not creation |

**Tests 1, 2, 3, 5 run 3 trials each** (Non-Determinism Rule). **Test 1 is also the live staging
creation test required by Wael's Rule 17 ruling.**

---

## 6. Rollback

**Nothing is deployed, so there is nothing to roll back in any environment.** The change exists only
in git.

- Revert the code: `git revert fc71146`
- If already deployed to staging when a rollback is needed: redeploy both functions from the reverted
  commit —
  `npx supabase functions deploy naavi-chat --no-verify-jwt --project-ref xugvnfudofuskxoknhve` and
  the same for `get-naavi-prompt`.
- **No database change, no migration, no cron.** Nothing to undo outside the two function bodies.
- Rolling back restores the prior behaviour exactly, including the defect.

---

## 7. Known risks

1. **⭐ No timeout on the `resolve-recipient` call.** A hang there hangs the whole `naavi-chat` turn.
   **This matches the existing time-trigger intercept**, which calls `lookup-contact` with a bare
   `fetch` in the same way — so the change adds a second instance of an existing pattern rather than
   introducing a new one. The mobile orchestrator uses `fetchWithTimeout` for the same call. **Named
   here rather than fixed, because adding a timeout is outside the authorized boundaries.**
2. **New latency on two mobile paths.** The compound and place-picker paths never resolved a
   recipient before, so they now pay one server-side call they did not pay. The main path is
   unaffected or faster — its client-side lookup now short-circuits.
3. **A `resolve-recipient` outage now blocks alert creation** that previously succeeded — wrongly, by
   misdelivering. Failing closed is the intent, but it converts a dependency outage into a visible
   refusal.
4. **A behaviour change users may notice:** a contact with neither a phone nor an email on the needed
   channel now refuses instead of saving. Previously the alert saved and misdelivered silently.
5. **The prompt annotation is untested against live Claude.** Prompt edits are non-deterministic;
   nothing yet shows Claude still emits `action_config.to` as reliably as before.
6. **Reproduction 2 is not fixed and is not claimed to be.** Its rule stored no recipient of any
   kind. Cause unproven — Phase 1 v2 §5.

---

## 7a. Review outcome — **APPROVED FOR PHASE 6**, external reviewer, 2026-08-27

The reviewer confirmed the implementation matches the Phase 3 authorization: `resolve-recipient` on
the location branch, self-overrides preserved, primary recipient only, `task_actions` untouched, time
branch and the RULE 23 exemption unchanged.

**Three points explicitly ruled on:**

1. **Not claiming Gate 1 was correct.** The runner was rightly avoided — its current configuration
   points at production and its fixtures are destructive.
2. **The Non-Determinism requirement is correctly left open.** No live Claude trials have run.
3. **⭐ The missing timeout (Risk 1) does NOT block B9x.** *"That would exceed the approved
   implementation boundary. Fail-closed behavior during a resolver outage is intentional and
   preferable to silently saving a potentially misdirected alert."* **Recorded so a later session
   does not reopen it as an oversight — it was seen, weighed, and left deliberately.**

**The reviewer's own procedural caveat, kept verbatim because it is the thing most easily
misremembered:** *"nothing has been deployed yet, so this is approval of the implementation/evidence
package, not evidence that B9x works in staging."*

**Staging deployment and live validation remain Phase 7 gates and are not satisfied.**

---

## 8. Improvement noted, not implemented

Per Phase 4's No Extra Changes Rule, reported rather than done: **the time-trigger intercept's
phone-only filter** (`naavi-chat:4276`, `allC.filter(c => c.phone)`) rejects an email-only contact on
an email alert and answers with a message about phone numbers. The Phase 3 reviewer explicitly
scoped its repair out of B9x. **No tracked item has been created — under Rule 1b that is Wael's
decision.**
