# F5c — Phase 2: Change Planning

Per `docs/AI_DEVELOPMENT_GOVERNANCE.md` Phase 2. Builds on `docs/F5C_PHASE1_PROBLEM_DEFINITION_2026-07-17.md` (Approved). Touches Protected Core (Action Rules, Notification routing) — automatically requires Phase 3 technical review before coding, per governance §4.

Scope is bounded by Phase 1 §5: **only** the fire-time `task_actions[].to_name` resolution in `evaluate-rules/index.ts`. The three items Phase 1 §6 left open (bundling mobile's first-entry-only gap, adding voice write-time resolution, the upstream letter-split question) are addressed in §5 below as explicit deferrals, not folded into this fix — consistent with Phase 1 §7's "not approved for the current fix" framing for the broader identity-resolution-service idea.

---

## 1. Files that will change

| File | Classification | Change | Risk |
|---|---|---|---|
| `supabase/functions/evaluate-rules/index.ts` | Backend (Protected Core — Edge Function, Action Rules + Notification routing) | Inside the existing F5c block (current lines 1074-1145, the `task_actions.length > 0` branch): (1) add a name-shape guard, defense-in-depth, before the `lookup-contact` fetch — skip the call and log `name_too_short` for any `to_name` under 2 characters; (2) replace the unconditional `data.contacts?.[0]` with an exact-count check (the actual correctness guarantee) — resolve only when `data.contacts.length === 1`, otherwise leave the entry unresolved and log `zero_matches` or `ambiguous_multiple_matches`; (3) add a `no_resolved_destination` log line to the existing `taskSends` filter step (currently line 1131 `return null`, silent) so an unresolved entry that gets dropped is visible in Railway/Supabase logs instead of vanishing without a trace. Four distinct, named log reasons, not one generic warning. | **High** |

No other files. Single function, single block, no schema change, no new table, no new Edge Function.

---

## 2. Proposed change (for Phase 3 review — not yet applied)

**Implementation philosophy:** this change intentionally touches only the *caller's* decision logic in `evaluate-rules` — whether to accept a match and whether to attempt a lookup at all. It does not modify `lookup-contact`'s matching/search/sort algorithm (the exact-first-name filter, the community sort, or Google's `searchContacts` call — all described in Phase 1 §2.3) in any way. The defect proven in Phase 1 is that the caller trusted an unchecked result, not that the underlying lookup itself is wrong — so the fix is entirely caller-side.

**Correctness guarantee vs. defense-in-depth — not equally load-bearing.** The exact-match-count rule in (b) below is the actual correctness guarantee: it is what Phase 1 proved necessary (ambiguity is unsafe, guessing is unsafe, per `lookup-contact`'s own documented contract) and it alone is sufficient to prevent the proven incident (both "A" and "C" had 10 loose matches — 2+ matches, which (b) alone already blocks). The name-shape guard in (a) is **defense-in-depth, not the primary fix** — Phase 1 proved ambiguity/guessing are unsafe; it did not prove that names under 2 characters are always invalid, and a blanket length cutoff could reject a legitimate future case (an imported contact, an initial, a nickname, an organization name, a localization the current data doesn't yet contain). (a) is included because it is cheap and closes the same failure shape one step earlier, but Phase 3/6 should not treat it as required for correctness — (b) alone already is.

**(a) Name-shape guard — defense-in-depth, added before the existing `lookup-contact` fetch call** (current line ~1080, inside the `taskActions.map` callback):

```ts
const nameTooShort = (ta.to_name ?? '').trim().length < 2;
if (nameTooShort) {
  console.warn(`[evaluate-rules] F5c: SKIPPED (name_too_short) to_name="${ta.to_name}" — too short to safely identify a contact`);
  return ta; // unresolved — falls through to the existing taskSends filter, which already drops entries with no to_phone/to_email
}
```
Threshold proposed as `< 2` characters (blocks single letters/initials, the exact shape of the proven incident) — Phase 3 should confirm this doesn't reject any legitimate real-world name shape currently in use (e.g. no evidence of any real saved contact identified by a 1-character name). If future data ever contradicts this threshold, (a) can be loosened or removed without weakening correctness, because (b) is the rule actually holding the guarantee.

**(b) Exact-match-count check — the correctness guarantee, replacing the current unconditional `data.contacts?.[0]`** (current lines 1086-1096):

```ts
if (res.ok) {
  const data = await res.json() as { contacts?: Array<{ name?: string; phone?: string; email?: string }> };
  const matches = data.contacts ?? [];
  if (matches.length === 1) {
    const best = matches[0];
    return { ...ta, to_phone: ta.to_phone || best.phone || '', to_email: ta.to_email || best.email || '', to_name: ta.to_name || best.name || ta.to_name };
  }
  if (matches.length === 0) {
    console.warn(`[evaluate-rules] F5c: SKIPPED (zero_matches) to_name="${ta.to_name}"`);
  } else {
    console.warn(`[evaluate-rules] F5c: SKIPPED (ambiguous_multiple_matches) to_name="${ta.to_name}" match_count=${matches.length}`);
  }
}
```
Mirrors `lookup-contact`'s own documented contract (Phase 1 §2.2): single match → proceed, zero or multiple matches → do not guess. No confirmation path is added here — per Phase 1 §6 option 1's rationale, fire time has no interactive user to confirm with, so ambiguity must fail closed, not prompt.

**(c) Visibility for dropped entries, added to the existing `taskSends` build step** (current lines 1105-1132, specifically the `.filter()` at line 1132):

```ts
const taskSends = resolvedActions.map(ta => {
  if (ta.type === 'send_sms' && ta.to_phone) { /* unchanged */ }
  if (ta.type === 'send_email' && ta.to_email) { /* unchanged */ }
  console.warn(`[evaluate-rules] F5c: SKIPPED (no_resolved_destination) to_name="${ta.to_name}" type="${ta.type}"`);
  return null;
}).filter((p): p is Promise<{ ok: boolean; label: string }> => p !== null);
```
This closes an existing gap noted in Phase 1 §2.2 but not previously logged as its own finding: today, an unresolved `task_action` is dropped with **zero log output** anywhere — a silent failure per `CLAUDE.md`'s Rule 21 ("NO SILENT FAILURES... anywhere Naavi could silently stop working for a user — log it"). This is the same F5c block already being touched for (a)/(b), not a separate change — included here rather than opened as its own ticket.

**Distinct log reasons, not one generic warning (per Phase 3 review, §2 below):** (a), (b), and (c) each log a different, named reason — `name_too_short`, `zero_matches`, `ambiguous_multiple_matches`, `no_resolved_destination` — rather than one shared message text. These four represent genuinely different operational situations (a rejected-before-lookup case vs. two different lookup outcomes vs. a final catch-all), and distinguishing them lets future incident analysis grep/filter by reason instead of parsing free text. `(c)`'s `no_resolved_destination` case is a catch-all that should in practice never fire once (a)/(b) are in place — its own log line still names the situation distinctly in case a future code path reaches it that (a)/(b) didn't anticipate.

### Acceptance criteria — what Phase 5 must verify

1. Re-running the exact incident shape (`task_actions: [{to_name:"A"}, {to_name:"B"}, {to_name:"C"}]`) against a rule with task_actions matching the proven-ambiguous case (§2.3 of Phase 1: "A" and "C" each matched 10 loose candidates) does **not** send any SMS for those entries, and the Railway/Supabase log shows an `ambiguous_multiple_matches` line naming the entry and match count.
2. A `task_actions` entry with a `to_name` that resolves to **exactly one** real contact (the existing working case, e.g. the "Call Natalie" / "message Wael" rows found live in production per Phase 1 §2.1's diagnostic pull) continues to resolve and send exactly as before — no regression on the safe path.
3. A `to_name` under 2 characters is rejected before any `lookup-contact` call is made, logged as `name_too_short` (verify via log line, not just absence of a send).
4. An entry that ends up unresolved for any reason now produces a log line naming which of the four reasons applied — verify no more silent, unlabeled drops.
5. The primary self/third-party alert fan-out (the code above the F5c block, ~lines 950-1063) is unaffected — same rule fired with both a primary alert and a task_action still delivers the primary alert regardless of the task_action's outcome (this ordering — primary alert always fires first — is existing, documented behavior per the code's own comment at line 1067, not changed by this fix).

---

## 3. Regression impact

| Area | Impact | Why |
|---|---|---|
| Voice commands | **Affected — this is the incident's origin surface.** Voice-originated `task_actions` get zero write-time resolution (Phase 1 §2.5) and rely entirely on this fire-time code — the fix changes whether/how those sends occur. No `naavi-voice-server` code is touched. | Downstream of the file touched, not a direct change |
| Geofencing | Not directly affected. Arrival/dwell detection (`useGeofencing.ts`, OS-level geofence registration) is untouched. Location-triggered rules that also carry `task_actions` (confirmed live in production, e.g. rule `b2fab571` "Call Natalie") pass through this same F5c block, so their task-action resolution becomes stricter — but the geofence firing mechanism itself does not change. | Same block services both trigger types; only the recipient-resolution sub-path changes |
| Gmail integration | Not affected. | No overlap |
| Calendar integration | Not affected. | No overlap |
| Reminders | Not affected. The `reminders` table and `check-reminders` Edge Function are separate from `action_rules`/`evaluate-rules` (per `CLAUDE.md`'s Rule Store section) — this fix does not touch that code path. | No overlap |
| SMS / call alerts | **Affected — this is the fix's purpose.** `task_actions`-originated SMS/email sends now fail closed instead of guessing; the primary self/third-party alert fan-out in the same function (outer scope, ~lines 950-1063) is untouched. | Direct purpose |
| Onboarding | Not affected. | No overlap |
| Staging build | N/A in the app-build sense (Edge Function, not an app build) — but per `CLAUDE.md`'s STAGING-FIRST rule, deploy to the staging Supabase project (`xugvnfudofuskxoknhve`) first, verify there, and only promote to production (`hhgyppbxgmjrwdpdubcx`) after Wael explicitly confirms. | Staging-first is mandatory for all Edge Function changes |

---

## 4. Risk classification

**High.** Protected Core (Action Rules + Notification routing), changes actual send behavior on a live, currently-firing automated path. Per governance §4 this automatically requires Phase 3 technical review before coding and Phase 6 review after. The change is a strict tightening (fewer sends, never more), which bounds the downside to "a legitimate task_action that used to send now doesn't" rather than any new way to send to the wrong person. That downside is not evenly distributed across the two mechanisms: (b), the correctness guarantee, only withholds a send when a name was genuinely ambiguous (0 or 2+ real matches) — by definition not a case where the old code was getting it right either, only a case where it was guessing. (a), the defense-in-depth length guard, is the only piece that could reject a currently-legitimate short name outright — this is the risk Phase 3 should specifically confirm against current data (no evidence today of any real saved contact identified by a 1-character name), and it is the one piece Phase 6 could remove later without reopening the proven incident, since (b) alone already closes it.

---

## 5. Explicitly deferred (per Phase 1 §6/§7 — not part of this Phase 2's implementation)

- **Mobile's first-entry-only resolution gap** (`naavi-chat/index.ts:4104-4169`, Phase 1 §2.5) — a real, separate defect in a different file. Not bundled here because it is write-time (not fire-time) and mobile-only; this fix already closes the fire-time gap that entry would otherwise fall through to regardless. Recommend its own Phase 1.
- **Voice gaining its own write-time resolution/disambiguation** (mirroring `naavi-chat`'s pattern) — real hardening option, but this Phase 2's fix already makes the fire-time path safe on its own; adding write-time resolution to voice is additional defense-in-depth, not required to close the proven incident. Deferred per Phase 1 §6 item 4.
- **Why "abc" became three single-letter entries** (Phase 1 §2.4) — unproven, prompt/transcript-level question, does not block this fix (which fails closed regardless of how the ambiguous name was produced).
- **The identity-resolution-service architectural recommendation** (Phase 1 §7) — explicitly not approved for this fix; broader blast radius than this incident requires.

---

## 6. Next step

Once this document itself carries a full approval verdict (§7 below), it moves to Phase 3 — Technical Review (Before Coding), mandatory per governance §4 (Protected Core) and §3 (High Risk). No code has been written. The eventual Phase 3 authorization should name exactly: `supabase/functions/evaluate-rules/index.ts`, the three changes in §2(a)/(b)/(c), and nothing else — no opportunistic changes to the primary alert fan-out logic in the same function, no schema changes, no other file.

---

## 7. Phase 2 review record (2026-07-17)

Reviewer: ChatGPT (External Technical Reviewer), via Wael.

**Round 1 feedback, received on the original draft:**

**Technical concern #1 (most important) — the `< 2` length guard was presented as load-bearing, but Phase 1 didn't prove it.** Phase 1 proved ambiguity is unsafe and guessing is unsafe — it did not prove that names under 2 characters are always invalid. A blanket length cutoff risks rejecting a legitimate future case (imported contacts, initials, nicknames, organization names, future localization). The exact-count rule (§2(b)) already prevents the production incident on its own. The length guard is defense-in-depth, not the primary fix, and the original draft didn't say so explicitly.

**Technical concern #2 — the logging proposal should distinguish three (now four) different operational situations, not use one generic warning.** Skipped-because-too-short, skipped-because-zero-matches, and skipped-because-multiple-matches are three different situations; conflating them into one message text makes future incident analysis harder than it needs to be. Recommended separate log messages or structured fields.

**Minor observations, no changes required:** Risk section's "fewer sends, never more" framing — praised directly, kept as-is. Acceptance criterion #5 (primary alert fan-out regression guard) — praised as "exactly the right safeguard." §6/Next-step framing — "Excellent... I wouldn't change it."

**One architectural suggestion:** add an explicit statement that the implementation changes only decision logic in the caller (`evaluate-rules`), not `lookup-contact`'s matching/search/sort algorithm itself.

**Changes made in response, all applied directly to this document (§1-§4 above):**
1. Added an "Implementation philosophy" paragraph at the top of §2 stating plainly that (b) — the exact-match-count rule — is the correctness guarantee proven by Phase 1, and (a) — the length guard — is defense-in-depth only, removable later without reopening the incident.
2. §2(a) rewritten to be explicit it is "defense-in-depth," not co-equal with (b).
3. §2(b) relabeled "the correctness guarantee," its logging split into two distinct named branches: `zero_matches` vs. `ambiguous_multiple_matches`.
4. §2(a)'s log line renamed to `name_too_short`.
5. §2(c)'s log line renamed to `no_resolved_destination`, with a closing paragraph naming all four distinct log reasons so future incident analysis can filter by reason instead of parsing free text.
6. §1's file-change summary row updated to carry the same distinctions.
7. Acceptance criteria #1, #3, #4 updated to reference the actual named log reasons.
8. §4 (Risk classification) rewritten to explain the downside is not evenly distributed across (a) and (b) — (b) only withholds a send on genuine ambiguity (not a case the old code was getting right either); (a) is the only piece that could reject a currently-legitimate short name, and the only piece removable later without reopening the incident.
9. Architectural suggestion adopted into the same "Implementation philosophy" paragraph.

**Round 2 — review of the revised text.** Confirmed: complete alignment with the approved Phase 1, clear implementation boundaries, no scope creep, proper distinction between correctness (§2(b)) and defense-in-depth (§2(a)), measurable acceptance criteria, thorough regression analysis, and a clear audit trail of the review process itself.

**Verdict: Approved (Round 2).** The concerns identified during Round 1 have been addressed. Phase 2 is approved and the document is authorized to proceed to Phase 3 (Technical Review Before Coding) within the implementation boundaries defined in §6.
