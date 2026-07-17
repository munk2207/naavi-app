# F5c — Phase 1: Problem Definition

Per `docs/AI_DEVELOPMENT_GOVERNANCE.md` Phase 1. No code is written in this document. Touches Protected Core (Action Rules, Notification routing).

**Origin:** discovered live in production 2026-07-16 (voice call, real user), investigated in depth 2026-07-17 (holding-list governance session). Reopened after a 2026-06-15 closure ("confirmed fully shipped and tested") that this incident directly contradicts. This incident demonstrates that previous closure verification did not prevent regression, reinforcing the need for fail-closed recipient resolution and stronger regression protection going forward. Full narrative: `docs/SESSION_HANDOFF_2026-07-16_B10AB_SHIPPED_TASKACTIONS_DEFECT_FOUND.md`, `docs/SESSION_HANDOFF_2026-07-17_HOLDING_LIST_GOVERNED_F5C_NEXT.md`.

---

## 1. What exactly is broken

At alert **fire time**, `evaluate-rules`' resolution of `action_config.task_actions[].to_name` into a phone number automatically selects the first returned contact for that name with no ambiguity check, no confirmation, and no fail-closed handling when the query is genuinely too short to identify one person. For a short or generic `to_name` (a single letter, an initial, a common word), this silently sends a real, unconfirmed SMS to whichever real contact happens to rank first in a loose fuzzy-match result set — a different real person than the one the user meant, or no one they meant at all.

This is proven for the fire-time resolution step specifically. A separate, upstream question — why the triggering utterance produced single-letter `to_name` values in the first place — is evidenced but **not proven** (§2.4, §3).

**Severity: Critical.** This defect can send communications to the wrong real-world recipient without user confirmation. It therefore represents a privacy, trust, and data-protection risk in addition to a functional defect — not merely a misrouted message.

**Architectural principle violated:** recipient resolution is a Protected Core responsibility and must never guess when identity is ambiguous. Ambiguity must resolve to explicit confirmation or fail closed. `evaluate-rules`' F5c block does neither — it guesses.

---

## 2. Evidence

### 2.1 — Real production incident (proven, direct DB evidence)

**`action_rules` row** (pulled live 2026-07-17 via `scripts/diag-taskactions-misfire.js`):
```
id: 2478079b-a286-452c-aa91-d84ce54bc974
user_id: 788fe85c-b6be-4506-87e8-a8736ec8e1d1 (Wael)
trigger_type: time
created_at: 2026-07-16T14:49:28.623996+00:00  (10:49 AM EST)
action_config: {
  "body": "Scheduled sends.",
  "tasks": [],
  "to_phone": "+16137697957",
  "task_actions": [
    {"body":"Good morning","type":"send_sms","to_name":"A"},
    {"body":"Good morning","type":"send_sms","to_name":"B"},
    {"body":"Good morning","type":"send_sms","to_name":"C"}
  ]
}
```

**`sent_messages` rows fired from this rule** (same query, `source: 'alert_task'` — the literal tag `evaluate-rules` stamps on F5c sends, `evaluate-rules/index.ts:1113`):
```
{"to_name":"A","to_phone":"+1 343-575-0023", "sent_at":"2026-07-16T14:51:04.320235+00:00", "delivery_status":"sent", "provider_sid":"SM1cf68227bef46d1f0a8e3e72f5077c4e"}
{"to_name":"B","to_phone":"+13433332567",    "sent_at":"2026-07-16T14:51:04.243904+00:00", "delivery_status":"sent", "provider_sid":"SM17bfdc8cb1301eb95284c4c84dcdfa17"}
{"to_name":"C","to_phone":"(613) 832-4299",  "sent_at":"2026-07-16T14:51:04.029679+00:00", "delivery_status":"sent", "provider_sid":"SM134e3cb90b8283688bcbe5773091fb81"}
```
All three sent at ~10:51 AM EST, Twilio `provider_sid` present on all three — confirmed actually delivered, not just attempted. `+1 343-575-0023` is Hussein El-Aggan's registered number per the multi-user phone map in `CLAUDE.md` ("MULTI-USER ARCHITECTURE" section: `+13435750023` → `heaggan@gmail.com` = Huss). None of the three recipients were named "abc," "A," "B," or "C" by the user — the user said "abc" as one word, intending it as a placeholder/garbled name, not three separate people.

### 2.2 — Fire-time resolution code (proven, direct file:line citation)

`supabase/functions/evaluate-rules/index.ts:1077-1096`:
```ts
const resolvedActions = await Promise.all(taskActions.map(async ta => {
  if ((ta.type === 'send_sms' && !ta.to_phone && ta.to_name) ||
      (ta.type === 'send_email' && !ta.to_email && ta.to_name)) {
    try {
      const res = await fetch(`${supabaseUrl}/functions/v1/lookup-contact`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${interFnKey}` },
        body: JSON.stringify({ name: ta.to_name, user_id: rule.user_id }),
      });
      if (res.ok) {
        const data = await res.json() as { contacts?: Array<{ name?: string; phone?: string; email?: string }> };
        const best = data.contacts?.[0];
        if (best) {
          return {
            ...ta,
            to_phone: ta.to_phone || best.phone || '',
            ...
```
`data.contacts?.[0]` is taken unconditionally. There is no check on `data.contacts.length` (1 = safe, 0 = fail closed, 2+ = ambiguous) anywhere in this block or the surrounding function.

`lookup-contact`'s own documented contract, `supabase/functions/lookup-contact/index.ts:287-289`:
```ts
// Map all matches into Contact shape. Caller picks best (single match) or
// shows a picker (multi). Used by the recipient-resolution chain in
// Session 26 — DraftCard needs every match for the picker UI.
```
`evaluate-rules`' F5c block is a caller of `lookup-contact` that does neither — it always takes index 0, whether `contacts.length` is 1, 5, or 10.

### 2.3 — Why a single letter matches a real contact (proven, re-reproduced live 2026-07-17)

`lookup-contact/index.ts:191-202` — the "exact first-name" safety filter:
```ts
if (results.length > 1) {
  const queryFirst = name.trim().split(/\s+/)[0].toLowerCase();
  const exactMatches = results.filter((r: any) => {
    const displayName = String(r.person?.names?.[0]?.displayName ?? '').toLowerCase();
    const firstName = displayName.split(/\s+/)[0];
    return firstName === queryFirst;
  });
  if (exactMatches.length > 0) {
    results = exactMatches;
    ...
```
This filter only narrows the result set when at least one contact's first name is an *exact* match to the query. No real contact has a first name that is literally one letter, so for a query like `"A"` this filter always finds zero exact matches and leaves `results` as Google's full, unfiltered loose token-match set.

`lookup-contact/index.ts:204-216` — the community sort:
```ts
if (myNaaviGroupResource && results.length > 1) {
  results = results.sort((a: any, b: any) => {
    const aIsMyNaavi = ...
    const bIsMyNaavi = ...
    return (bIsMyNaavi ? 1 : 0) - (aIsMyNaavi ? 1 : 0);
  });
```
This pins any contact in the user's MyNaavi group to the front of an otherwise-unfiltered result list.

**Live re-reproduction, 2026-07-17** (`scripts/diag-lookup-contact-single-letter.js`, real production call against Wael's real contacts):
- Query `"A"` → top result `Hussein El-Aggan`, `"mynaavi_community": true`, 10 total loose matches returned (Ahmed El-Gillani, AbdelMegid EL Mehelmy, Ahmed Darwish, Amro Maher, etc.). Hussein's first name is "Hussein," not "A" — he matches only because "Aggan" (his surname) contains the token, and he ranks first specifically because of the community-sort, not name relevance.
- Query `"C"` → top result `Cottage`, a saved contact whose display name literally is "Cottage" (not a person's first name beginning with C in the exact-match sense — `"cottage" !== "c"` fails the exact filter same as any other candidate), 10 total loose matches.
- Query `"B"` → **zero matches today**, `{"contact": null, "contacts": []}`. On 2026-07-16 the same query, at fire time, resolved to a contact named "Bob" (`+13433332567`, the number that actually received the SMS in §2.1). This confirms the match set for a single-letter query is not stable — Google's `searchContacts` ranking can return a different (or no) top result from one call to the next for the identical input, which makes "index 0, no ambiguity check" not just unsafe for ambiguous names but nondeterministic across separate lookups for the same rule.

### 2.4 — Upstream question: why did "abc" become three single-letter entries? (not proven)

`task_actions` is declared **only in prose**, inside `get-naavi-prompt/index.ts` — not in either tool-use JSON schema. Confirmed by direct grep, 2026-07-17:
- `naavi-voice-server/src/anthropic_tools.js` — zero matches for `task_actions`.
- `supabase/functions/_shared/anthropic_tools.ts` — zero matches for `task_actions`.
- `supabase/functions/get-naavi-prompt/index.ts` — prose only, e.g. line 619: *"FULL NAME RULE: always use the participant's full display name in to_name (e.g. 'Sarah El-Gillani', NOT 'Sarah'). First names alone are ambiguous when the user has multiple contacts with the same first name."* and line 938, same rule restated for the time-trigger case.

The prompt already explicitly instructs against short/ambiguous `to_name` values. The incident (`to_name: "A"/"B"/"C"`) is direct evidence this instruction was not followed for this call, but **why** — a Claude prompt-following miss, a transcription artifact from voice ("abc" heard as three letters and passed through literally), or something else — cannot be determined from static code inspection. No log captures the exact intermediate reasoning that produced the three-entry array.

**Per governance's No Assumptions Rule: root cause not proven for this sub-question.** It does not block fixing §2.2 (the fire-time resolution defect can and should fail closed regardless of how an ambiguous `to_name` was produced), but it must not be presented as solved.

### 2.5 — Voice has zero write-time recipient resolution for `task_actions` (proven, direct grep)

`naavi-voice-server/src/index.js` — zero matches for `task_actions` (confirmed by grep, 2026-07-17). The voice server's own `SET_ACTION_RULE` handler does not inspect, resolve, or validate `task_actions` entries at all before writing the rule — whatever Claude's tool call emits is written to `action_rules` as-is. The only resolution point anywhere in the pipeline for a voice-originated `task_actions` entry is the flawed fire-time code in §2.2. This matches the incident: it originated from a voice call.

By contrast, mobile's `naavi-chat/index.ts:4104-4169` **does** attempt write-time resolution — it calls `lookup-contact`, and correctly branches on `withPhone.length`: 0 matches fails closed with a message to the user (line 4128-4131), 2+ matches returns a numbered disambiguation question before any rule is written (line 4133-4146), and only a single match proceeds silently (line 4148-4163). This is the correct pattern per `lookup-contact`'s own contract (§2.2) — but it has its own gap: `firstUnresolvedName` (line 4113) is singular — `taskActionsT1.find(ta => ta.to_name)`, not a loop over all entries — so only the *first* `task_actions` entry in a multi-recipient rule gets this treatment; a 2nd or 3rd entry in the same rule is left unresolved and still falls through to the flawed fire-time code at evaluate-rules. This is a second, distinct, smaller gap, found incidentally while reading this code for comparison — noted here per Phase 4's "report nearby issues separately, don't fix silently" rule, not in scope for this Phase 1's fix.

---

## 3. Root cause statement

| Finding | Root cause | Confidence |
|---|---|---|
| Real, unconfirmed SMS sent to a wrong real contact for a short/ambiguous `task_actions[].to_name` | `evaluate-rules/index.ts:1077-1096` takes `data.contacts?.[0]` from `lookup-contact` unconditionally — no check on match count, no confirmation, no fail-closed path — violating `lookup-contact`'s own documented contract (`lookup-contact/index.ts:287-289`). Directly reproduced against the real incident's DB rows (§2.1) and the real `lookup-contact` behavior for the same inputs (§2.3). | **Proven** |
| Single-letter queries match unrelated real contacts, with a real, connected person favored | `lookup-contact/index.ts:191-202`'s exact-first-name filter cannot narrow a one-character query (no contact has a one-letter first name), so the full loose token-match set passes through; `lookup-contact/index.ts:204-216`'s community sort then pins any MyNaavi-connected contact to the front regardless of actual name relevance. Live-reproduced 2026-07-17 with the exact real query strings from the incident. | **Proven** |
| Voice-originated `task_actions` reach the fire-time resolver with zero prior validation | `naavi-voice-server/src/index.js` has no `task_actions` handling of any kind (zero grep matches) — nothing between Claude's tool call and the DB write. | **Proven** |
| Mobile-originated `task_actions` are only partially protected | `naavi-chat/index.ts:4104-4169` resolves and disambiguates only the first `task_actions` entry per rule (`.find()`, not a loop); additional entries in the same rule bypass this protection. | **Proven** — separate defect, not this incident's cause (incident was voice-originated), flagged for its own scoping |
| Why "abc" became three single-letter `task_actions` entries | Not established. `task_actions` shape is governed by prose instructions only (`get-naavi-prompt/index.ts`, no schema validation in either tool-use schema file), and those prose instructions (the "FULL NAME RULE") already prohibit short names — the incident contradicts the instruction having been followed, but the mechanism of that departure is not observable from the code or available logs. | **Root cause not proven** |

---

## 4. What alternatives were considered

- **"Maybe this is the same defect as B10a."** Ruled out — B10a (`docs/B10A_PHASE1_PROBLEM_DEFINITION_2026-07-16.md`) is an ordering bug between two blocks in `naavi-voice-server/src/index.js` (B4y vs. F12) that defaults a *single* `to`/`to_phone` field to the user's own number before resolution can run, at *rule-creation* time. F5c is a different file (`evaluate-rules/index.ts`), a different data shape (`task_actions[]`, an array), a different execution point (*fire* time, not creation time), and a different failure mode (wrong third party, not self-redirect). Related family of bugs (recipient resolution), not the same bug.
- **"Maybe mobile's `naavi-chat` resolution logic (§2.5) already covers this and the incident is voice-only, so porting that logic to voice fully fixes it."** Ruled out as a complete fix even in principle — the mobile logic itself only resolves the first `task_actions` entry per rule (§2.5), so porting it as-is to voice would still leave 2nd/3rd+ entries protected by nothing but the broken fire-time code. Any fix must close the fire-time gap in `evaluate-rules` regardless of what write-time protection exists on either surface.
- **"Maybe the prompt's existing FULL NAME RULE is sufficient once Claude follows it correctly."** Ruled out as something Phase 1 can rely on — it is unenforced (prose only, no schema, confirmed by grep), and the incident is direct evidence it was not followed on at least one real call. A fix that depends on prompt compliance alone leaves the same failure mode open the next time a short name is emitted for any reason.
- **"Maybe this is only a voice-server bug and mobile doesn't need any change."** Not fully ruled out, but not assumed either — mobile's partial gap (§2.5, only first entry resolved) is real and evidenced, but was not the mechanism of this specific incident (which originated from voice, which has no resolution at all). Recorded as a separate, smaller finding rather than folded into this defect's scope.

---

## 5. Scope boundary

**In scope (proven, ready for Phase 2):** the fire-time `task_actions[].to_name` → phone/email resolution in `evaluate-rules/index.ts:1077-1103` — the single code path every `task_actions` entry from either surface (voice or mobile) ultimately passes through before a message actually sends, and the only path proven to have caused real production harm.

**Not in scope for this document's fix, tracked separately:**
- The upstream "why did the utterance split into single letters" question (§2.4) — not proven, needs its own investigation (prompt/transcript-level, not a code-read), does not block fixing the fire-time resolver.
- Mobile's first-entry-only resolution gap (§2.5) — real, evidenced, but a distinct defect in a distinct file (`naavi-chat/index.ts`), not the mechanism of this incident.
- B4b (Deepgram leading-word drop) — causally adjacent (dropped names feed malformed recipients into this same class of bug) but a separate root cause, queued as its own item per the holding list.
- Voice server adding its own write-time `task_actions` resolution/disambiguation (mirroring `naavi-chat`'s pattern) — a real hardening option, but a design decision for Phase 2, not assumed necessary if the fire-time fix alone is sufficient to prevent misfires.

---

## 6. Next step

Phase 2 — Change Planning, per governance. This document identifies and proves the fire-time resolution defect only; it does not select a fix. Candidate approaches, not yet designed or chosen, for Phase 2 to evaluate:

1. **Make `evaluate-rules`' F5c block fail closed on anything but exactly one match.** Mirror `lookup-contact`'s own contract: `contacts.length === 0` → skip the send, log it, do not silently drop it. `contacts.length === 1` → proceed (current behavior for the safe case). `contacts.length > 1` → skip the send — there is no confirmation channel available at fire time (the rule already fired unattended), so an ambiguous match cannot be resolved interactively the way mobile's write-time flow can; it must fail closed, not guess. Fail-closed is not a style preference here: fire-time execution has no interactive user present, so ambiguity cannot be resolved safely and automatic selection is architecturally impossible, not merely risky. Phase 2 should not entertain a "pick the best guess" variant of this option — the absence of a user to confirm with is what makes fail-closed mandatory, not optional.
2. **Add a minimum-name-length or token-shape guard** before even calling `lookup-contact` for a `to_name` this short — e.g. reject single-character or clearly-non-name `to_name` values at the fire-time resolver, independent of what `lookup-contact` returns. Phase 2 should decide whether this is redundant with option 1 (a length guard prevents the call; a match-count guard prevents acting on its result) or whether both are warranted as independent layers.
3. **Whether to also fix mobile's first-entry-only gap (§2.5) in the same change or as a separate ticket** — same underlying pattern (recipient resolution needs to cover every entry in an array, not just the first), but a different file and different execution point; Phase 2 should decide whether bundling is appropriate or whether it dilutes this fix's review.
4. **Whether voice should gain its own write-time resolution/disambiguation** (mirroring `naavi-chat`'s pattern, §2.5) as defense-in-depth on top of the fire-time fix, or whether the fire-time fail-closed fix alone is judged sufficient. Not assumed either way — an architectural question for Phase 2, not implied here.

Phase 2 must also explicitly answer the Regression Impact questions for SMS/call alerts and Reminders (both directly touched) per governance §Phase 2, and confirm whether a fail-closed fire-time resolver should notify the user their scheduled send was skipped (silence has its own UX cost) or fail silently (current behavior, but currently silent-wrong rather than silent-safe).

---

## 7. Deferred architectural recommendation (not approved for this fix)

Raised during Phase 1 review: this is not really a `lookup-contact` bug or an `evaluate-rules` bug in isolation — it is an **identity resolution** bug. Recipient resolution currently exists in at least three separate places that can drift independently: mobile (`naavi-chat/index.ts`, itself incomplete per §2.5), fire-time (`evaluate-rules/index.ts`, the defect this document proves), and voice (currently absent entirely, §2.5). Each surface re-implements its own partial version of "find the contact," with no shared contract enforced in code — only `lookup-contact`'s comment-level documentation (§2.2), which callers can and do ignore.

**Recommendation, not approved for the current fix:** treat recipient resolution as a single Protected Core service with one authoritative decision path, called by every surface and every execution point — one match → proceed, zero matches → fail, multiple matches → ambiguity (confirm if a user is present, fail closed if not), never guess. This would eliminate this entire class of defect by construction rather than patching each call site independently.

**Why not approved now:** broader blast radius than this incident requires — it touches every existing caller of `lookup-contact` across both surfaces, not just the one proven-broken call site. Premature to design until Phase 2 has scoped the immediate fail-closed fix and Phase 2/6 review has confirmed it's sufficient to close this incident's risk.

**What would make it worth reconsidering:** if a third independent recipient-resolution call site is found to have drifted the same way (mobile's first-entry-only gap, §2.5, is arguably already the second), or if the fail-closed fix from §6 ships and a subsequent incident shows call-site-by-call-site patching isn't holding up.

---

## 8. Phase 1 review record (2026-07-17)

Reviewer feedback received via Wael (External Technical Reviewer channel). Five editorial recommendations, all adopted:

1. Added an explicit **Severity: Critical** statement immediately after §1, naming the privacy/trust/data-protection risk rather than leaving it implied.
2. Added the **violated architectural principle** statement in §1 (Protected Core recipient resolution must never guess; ambiguity resolves to confirmation or fail-closed) — gives reviewers a principle to validate, not only code.
3. Added an explicit **why fail-closed is mandatory** sentence to §6 option 1 — fire-time execution has no interactive user present, so automatic selection is architecturally impossible, not just risky, closing off a "pick the best guess" counter-proposal at Phase 2.
4. Strengthened the **regression history** statement in the Origin line — this incident demonstrates prior closure verification did not prevent regression, tying directly into the holding list's governance overhaul (2026-07-17 session).
5. Reworded §1 — "takes the first result Google returns" → "automatically selects the first returned contact" — keeps responsibility on the architectural decision in the code, not on Google's ranking behavior.

One architectural observation recorded as a deferred recommendation, not adopted into this fix's scope — §7.

**Verdict: Approved.** Satisfies Phase 1's purpose: clearly defines the defect, proves it with production evidence, separates proven facts from hypotheses, identifies the actual failure point, controls scope, does not prematurely design the fix, and leaves Phase 2 with enough evidence to evaluate implementation options. None of the five editorial recommendations changed the technical conclusions in §1-§6. Phase 2 is authorized to evaluate implementation alternatives only within the approved scope defined in §5.

This document is ready for Phase 2 — Change Planning.
