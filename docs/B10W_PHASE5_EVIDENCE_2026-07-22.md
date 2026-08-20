# B10w — Phase 5: Evidence Package

**Date:** 2026-07-22
**Governance:** `docs/AI_DEVELOPMENT_GOVERNANCE.md` v3.7, Phase 5

---

## 0. Evidence status summary (per external review's recommendation)

| Evidence Item | Status |
|---|---|
| Code implemented | ✅ |
| Design reviewed (Phases 1-3) | ✅ |
| Automated tests | Written and registered, **not yet executed** (§4) |
| Manual voice validation | **Not yet executed** (§5) |
| Committed to git | **Not yet done** (§7) |
| Deployment (Supabase + Railway) | **Not yet performed** (§7) |

---

## 1. Summary

Voice's "what do we have about bob"/"tell me about X" answer was capped at name + phone/email only — B10r's birthday/anniversary fix never reached voice callers, because `arch1HandlePersonLookup` short-circuits on any `lookup-contact` match and never reaches `fetchGlobalSearch`, the function B10r's fix lives behind (proven by direct code read + full commit-history trace, Phase 1). Root cause was confirmed deliberate voice-UX design, not legacy drift (`af98f214` → `26b325ce` → `cd67f6e1`, all 2026-06-06) — the fix therefore had to preserve that intent (no combined calendar/gmail/rules dump) rather than reverse it.

Fix, across three reviewed design iterations (Phase 2): a second `global-search` lookup keyed by name text → eliminated in favor of enriching `lookup-contact`'s own already-resolved response (using its existing `contact_id`/`resourceName`, no second identity resolution) → further refined to extract the birthday/anniversary formatting logic into a new `_shared/contact_date_facts.ts` module, avoiding duplicated business logic between `contacts.ts` and `lookup-contact/index.ts`.

---

## 2. Files changed

| File | What changed |
|---|---|
| `supabase/functions/_shared/contact_date_facts.ts` (**new**) | `PersonDate`/`PersonBirthday`/`PersonEvent` types, `formatDateFact` (never fabricates a year, Rule 18), `contactDateFacts` — extracted from `contacts.ts`, now the sole authoritative implementation per this item's own ownership rule. |
| `supabase/functions/global-search/adapters/contacts.ts` | Pure extraction — inline type/helper definitions replaced with an import from the new shared module. No call site's behavior changed (`fetchPersonDateFacts`, the community-hit branch, the main scored loop all unchanged). |
| `supabase/functions/lookup-contact/index.ts` | Added `birthdays,events` to all four `personFields`/`readMask` sites (`:122, :181, :258, :287`). Imported `contactDateFacts`; added `birthday`/`anniversary` fields to both contact-building sites (direct `contact_id` fetch and the name-search/`batchGet` path). |
| `naavi-voice-server/src/index.js` | `arch1HandleLookupContact`'s single-match branch (`:2203-2214`) now appends `Birthday:`/`Anniversary:` to the spoken detail when present. No change to the multi-match branch or to `arch1HandlePersonLookup`'s control flow. |
| `tests/catalogue/session-2026-07-22-b10r-contact-birthdays.ts` | 2 new test cases added to the existing B10r suite (same file, per Phase 2's stated preference — same underlying feature): `b10w.lookup-contact-additive-birthday-anniversary` (positive control, "Bob") and `b10w.lookup-contact-date-fact-format-never-fabricated` (format-safety net). |
| `docs/HOLDING_LIST_CLASSIFICATION_2026-06-11.md` | New B10w entry recording the full design evolution and current status. |

**Diff stat (exact, via `git diff --numstat`):** `contacts.ts` +92/-5, `lookup-contact/index.ts` +23/-4, `naavi-voice-server/src/index.js` +8/-1, `docs/HOLDING_LIST_CLASSIFICATION_2026-06-11.md` +5/-1. `_shared/contact_date_facts.ts` is a new, untracked file (41 lines). Test file: 2 new cases appended.

---

## 3. Git Diff

Key excerpt — `lookup-contact/index.ts`'s name-search contact-building site (the one that matters for the common multi-result case, via `batchGet`):

```ts
const { birthday, anniversary } = contactDateFacts(person);
return {
  name:             person.names?.[0]?.displayName ?? name,
  email:            person.emailAddresses?.[0]?.value ?? null,
  phone:            person.phoneNumbers?.[0]?.value ?? null,
  contact_id:       resourceName ?? null,
  mynaavi_community: isMyNaavi,
  addresses: addrs.map(...).filter(...),
  birthday,
  anniversary,
};
```

Voice's enrichment (`naavi-voice-server/src/index.js`):

```js
if (contacts.length === 1) {
  const c = contacts[0];
  const detailParts = [c.phone || c.email || null];
  if (c.birthday) detailParts.push(`Birthday: ${c.birthday}`);
  if (c.anniversary) detailParts.push(`Anniversary: ${c.anniversary}`);
  const detail = detailParts.filter(Boolean).join(' · ');
  return { speech: detail ? `${c.name} — ${detail}` : c.name };
}
```

Full diffs available via `git diff` against each file listed in §2 — all four code files are **currently uncommitted, untracked, or modified working-tree changes**, not yet in any commit (see §7, Known Risks).

---

## 4. Tests executed

**Honest status: not yet executed against the new code, and deliberately not run this session — stated plainly rather than glossed over.**

The existing test harness (`tests/lib/adapters.ts`) calls Edge Functions over HTTP against whatever Supabase project is configured (staging, per CLAUDE.md's default) — it does not import `contacts.ts`/`lookup-contact/index.ts` directly. **Nothing has been deployed yet** (§7). Running the new `b10w.*` tests right now would only exercise the *currently-deployed, pre-B10w* `lookup-contact` function — which has no `birthday`/`anniversary` fields at all — producing a `TestSkippedError` ("neither birthday nor anniversary is present") that would be indistinguishable from a genuine coverage gap. Running them now and reporting a "skip" would misrepresent the fix as untested-but-fine when it is actually simply not-yet-live. Per `feedback_wait_for_done_no_partial_action`, this is not reported as a passing or even a skipped run — it is reported as **not executed**.

**What must happen before these tests produce a real signal:** `lookup-contact` and `global-search` (for the `contacts.ts` extraction) deployed to a target Supabase project, and `naavi-voice-server` pushed to `main`. Only after that should `b10w.lookup-contact-additive-birthday-anniversary` and `b10w.lookup-contact-date-fact-format-never-fabricated` be run for a genuine result.

**Two new tests written and registered** (`tests/runner.ts` already includes this file's export from B10r; no runner change needed):
1. `b10w.lookup-contact-additive-birthday-anniversary` — positive control against "Bob" (confirmed MyNaavi-labelled with a real birthday/anniversary on the staging test account this same session, via direct mobile test, screenshot evidence). Skips cleanly if Bob isn't found or has neither field — same coverage-gap-acknowledgment pattern as B10r's own Fatma test.
2. `b10w.lookup-contact-date-fact-format-never-fabricated` — format-safety net across `['a', 'e', 'bob']`, asserting any birthday/anniversary field returned matches `DATE_FACT_RE` ("Mon Day" / "Mon Day, Year"), regardless of which contact it hits.

**Extraction regression check, also not yet run:** Phase 2 committed to re-running B10r's original two `contacts.ts`-side tests (`b10r.contacts-birthday-real-year-not-calendar-computed`, `b10r.contacts-date-fact-format-never-fabricated`) after the extraction, to confirm it didn't silently change behavior. Same blocker — requires a deploy first.

---

## 5. Manual tests required — outstanding, not optional (per B10r's own precedent for this exact class of change)

1. **Call and ask "what do we have about bob" / "tell me about bob."** Expect `Bob — [phone] · Birthday: Jan 1, 1950 · Anniversary: Jul 22, 2000` (or equivalent spoken phrasing) — both facts now spoken, no calendar/gmail/rules dump.
2. **Call and ask about a contact with no birthday/anniversary on file.** Expect today's unchanged `"Name — phone"` sentence — confirms no regression to the common case.
3. **Call and ask about a name matching multiple contacts.** Expect today's unchanged multi-contact list (unenriched) — confirms the multi-match branch is untouched.
4. **Call and ask about a name `lookup-contact` cannot resolve.** Expect today's unchanged "spell it" prompt.
5. **Two contacts sharing a display name, each with a different birthday on file.** Verify each spoken card carries its own birthday — validates `lookup-contact`'s pre-existing `resourceName`-keyed `batchGet` map still associates correctly with one more field added.
6. **A message-send flow using `lookup-contact`** (e.g., "text Bob I'm running late") still resolves and sends correctly — spot-checks that the additive fields don't disturb the six traced message-recipient-resolution callers.

**Precondition specific to this file:** `naavi-voice-server` has no staging tier (confirmed, `docs/B10A_PHASE3_TECHNICAL_REVIEW_2026-07-16.md`'s Deployment note) — any push goes straight to the one production Railway instance. These six manual tests are therefore not a post-merge nicety; they are the only verification mechanism this change gets before real callers are affected.

---

## 6. Rollback instructions

- **Edge Functions:** redeploy the pre-B10w versions of `global-search` and `lookup-contact` via `npx supabase functions deploy <name> --no-verify-jwt --project-ref <target>`, using `git show <commit-before-this-work>:supabase/functions/...` — **caveat:** since these files are currently uncommitted (§7), there is no prior commit to roll back to yet; rollback today would mean reverting the working-tree edit, not a git operation.
- **`_shared/contact_date_facts.ts`:** delete the file; `contacts.ts` and `lookup-contact/index.ts` would need their inline definitions restored (available in this document's git history once committed).
- **`naavi-voice-server`:** revert the `arch1HandleLookupContact` enrichment lines — isolated, 8-line change, no dependency on any other voice-server change.
- **No database/schema change** — no migration to roll back.
- **Tests:** remove the 2 new `b10w.*` cases from the shared test file if fully rolling back.

---

## 7. Known risks

1. **All four code files are uncommitted.** `contact_date_facts.ts` is untracked (new); `contacts.ts`, `lookup-contact/index.ts` are modified working-tree changes; `naavi-voice-server/src/index.js` is also uncommitted. Same pattern already flagged for B10r's own files — worth committing before or alongside deployment, not left indefinitely uncommitted.
2. **No test has actually exercised this code yet** (§4) — the only verification so far is direct code inspection (mine) and reviewer approval of the design (ChatGPT's, across Phases 1-3). Neither substitutes for an executed test or a live call.
3. **`lookup-contact` is called by six real consumers beyond voice** (`naavi-chat` ×8 sites, `resolve-recipient`, `task_actions.ts`, `useOrchestrator.ts`, `lib/contacts.ts`, `lib/recipientLookup.ts`) — all traced and confirmed to read only pre-existing fields (Phase 2), but that trace has not been re-verified against a live deploy; a live message-send regression test (§5, item 6) is the real confirmation.
4. **`naavi-voice-server` has no staging tier** — the six manual tests in §5 are the only pre-production verification this change gets, not a formality.
5. **B10v** (community/MyNaavi status never spoken) remains unaddressed, deliberately — this fix does not touch it.
6. **[[B10t]]** (voice's ARCH-1/Layer-2 duplication) remains unaddressed, deliberately — this fix closes one information gap within it, not the underlying duplication itself.

---

## 8. Status

**Phase 5 reviewed and Approved (2026-07-22)** — reviewer's verdict across all seven areas (evidence completeness, change traceability, implementation traceability, testing honesty, rollback documentation, risk disclosure, governance quality): PASS. Particular endorsement of §4's testing-honesty framing (*"reporting 'not executed' is considerably more accurate than reporting a meaningless skipped result"*) and the separation of design-review approval from implementation validation (*"reviewer approval of the design... neither substitutes for an executed test or a live call"*). One recommendation (§0's evidence-status table) applied directly above.

Per the Phase-Gate Approval Rule, this reviewer verdict is a recommendation, not authorization — **Wael's own separate, explicit go-ahead is required before Phase 6 (Technical Review After Coding) begins.** Separately, deployment itself (staging and/or production) requires its own explicit go-ahead per CLAUDE.md's STAGING-FIRST rule and has not happened yet.
