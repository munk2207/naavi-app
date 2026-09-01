# B11l — Phase 3: Technical Review (Before Coding)

| | |
|---|---|
| **Item** | B11l — *"text me"* resolves to a stranger, and the confirmation card labels him *"me"* |
| **Date** | 2026-09-01 |
| **Governance** | `AI_DEVELOPMENT_GOVERNANCE.md` v4.3, §3 Phase 3 |
| **Plan under review** | `B11L_PHASE2_CHANGE_PLAN_2026-09-01.md` **v3** |
| **Resubmission** | **v2 of this document.** The first submission found two wrong assumptions in Phase 2 v2 and corrected them *inside Phase 3*. The reviewer rejected that — *"we should not allow Phase 3 to silently rewrite an approved Phase 2 design"* — and the corrections were moved into **Phase 2 v3**. This document now reviews that corrected plan. |
| **Architecture Reference** | 2026.07.18.15, supplemented by Phase 1A findings |
| **Risk** | **HIGH** — Phase 3 review is mandatory, not optional |
| **Status** | **Submitted for external technical review. No code written.** The verdict below is the reviewer's to issue — it is not filled in here. |

---

## 0. Two Phase 2 assumptions were wrong — **now corrected in Phase 2 v3, not here**

Phase 3 evaluates assumptions, so they were checked rather than submitted on trust. Both are recorded
below as the findings that produced Phase 2 v3.

> **⚠️ Process correction, 2026-09-01.** The first submission of this document presented these as
> Phase 3 corrections and proceeded. **That was wrong**: v2 of Phase 2 explicitly built its contract
> on `user_settings.phone / .email`, so disproving half of that source **changed an approved design**,
> and a Phase 3 document is not where an approved plan gets rewritten. The reviewer's ruling stands
> as the general rule: **a Phase 3 finding that invalidates the approved plan sends the plan back to
> Phase 2 — it does not get absorbed into the review.** Both corrections now live in Phase 2 v3 §1.1
> and §1.2, and this document reviews that.

### 0.1 — ❌ `user_settings` has no `email` column

Phase 2 §1 said the self-resolution source was *"`user_settings.phone` / `.email`"*. **The `.email`
half does not exist.** Enumerated across every Edge Function, `user_settings` is referenced only for:
`name`, `phone`, `phone_numbers`, `home_address`, `work_address`, `voice_pin_hash`.

**The correct source, and the project already has one canonical pattern for it:**

| Destination | Source | Established at |
|---|---|---|
| Phone | `user_settings.phone` | `naavi-chat:3978` (time-trigger self-default) |
| **Email** | **`auth.admin.getUserById(userId).user.email`** | `evaluate-rules:787-788`, and again at `:264-265` |

**This matters beyond a field name.** Email self-resolution requires a **service-role admin client**,
not the ordinary request client. That is a different call, a different privilege, and a different
failure mode — and Phase 4 would have discovered it while writing code, which is exactly what Phase 3
exists to prevent.

### 0.2 — ⚠️ `phone` vs `phone_numbers`

`user_settings` has **both**. `phone_numbers` is an **array** used for *identifying* a caller by any
of their numbers (`ingest-ticket:199` uses `phone_numbers.cs.{…}`; `manage-voice-pin` uses it for PIN
eligibility). `phone` is the single primary number used for *sending*.

**Decision: use `phone`**, matching `naavi-chat:3978`. Sending to an arbitrary element of an
identification array would be a new behaviour nobody asked for.

---

## 1. Assumptions this plan rests on

| # | Assumption | Status |
|---|---|---|
| 1 | `naavi-chat` builds `DRAFT_MESSAGE` at exactly two sites | **Verified** — `:2092`, `:3925-3958`; exhaustive grep for `type: 'DRAFT_MESSAGE'` returns one literal plus the mapper |
| 2 | `DraftCard.handleSend` ignores `to_phone` and re-resolves from `to` | **Verified** — `app/index.tsx:523-539` |
| 3 | The card resolves twice, independently | **Verified** — `:497` at mount, `:534` at send |
| 4 | `DRAFT_MESSAGE` does **not** use the `PENDING_INTENT` marker | **Verified** — `naavi-chat:1960`: *"For DRAFT_MESSAGE, returns the action immediately (DraftCard is the confirm UI)."* So Step 1.4's executor is not involved and is not at risk |
| 5 | Voice cannot reach any changed file | **Verified** — voice never calls `naavi-chat` (Arch Ref §2a); has its own `executeDraft` and its own tool copy |
| 6 | Draft actions are never persisted | **❌ DISPROVEN — they ARE persisted. Resolved 2026-09-01; see §1.1** |
| 7 | `user_settings.phone` is populated for the affected user | **Not assumed** — the design falls through to the existing `missingParam` question when it is null |

---

### 1.1 — ⭐ Assumption 6 resolved: drafts ARE persisted, and nothing reads them back

**Blocked on by the Phase 3 review, and correctly so — it was the one unverified contract assumption
under a HIGH-risk Protected Core change. Searched exhaustively 2026-09-01.**

**They are written.** `hooks/useOrchestrator.ts:4493` builds the turn with `drafts: turnDrafts` — the
raw `DRAFT_MESSAGE` actions pushed at `:3252` — and `:4510` calls `saveConversationTurn(newTurn)`,
which writes to the **`conversations`** table's `turns` JSONB array (`lib/supabase.ts:453-492`).

**So `to_display` does become stored data. The assumption was wrong.**

**But nothing consumes it, and that is what settles the impact:**

| Reader | Result |
|---|---|
| `loadTodayConversation()` — `lib/supabase.ts:495` | **Imported at `app/index.tsx:133` and never invoked.** Exhaustive grep across `app/`, `hooks/`, `lib/` returns the import line and the definition, nothing else |
| Any Edge Function | **None** — `grep "from('conversations')"` across `supabase/` returns nothing |
| Voice server | **None** — same grep across `naavi-voice-server/src/` returns nothing |
| Tests | **None** — same grep across `tests/` returns nothing |

**`conversations` is written on every turn and read by nobody.**

**Impact on this change — assessed, and it does not send the plan back to Phase 2:**

1. **No migration needed.** `turns` is JSONB; an additive field lands without a schema change, so the
   §0d ordering hazard (code arriving before columns exist) does not arise.
2. **No backward-compatibility requirement.** Turns written before this change will lack
   `to_display`, but nothing reads them, so no consumer must tolerate its absence.
3. **No stale-display risk.** A pre-fix draft naming a stranger cannot be restored and re-sent,
   because no restoration path exists.
4. **Cost:** marginally larger rows. Nothing else.

**The claim being retracted is "never persisted," not the conclusion drawn from it.** The conclusion
— that `to_display` is safe as an additive field — survives, but it now rests on *nothing reads the
table* rather than on *nothing writes it*. **Those are different guarantees, and the second is the
weaker one:** if a reader is ever added, `to_display` becomes a live stored contract at that moment.

> **📌 Reported, not acted on (Rule 1b, No Extra Changes Rule):** `conversations` is a write-only
> table, and `loadTodayConversation()` is a dead read path. Whether that is intended, and whether the
> table should keep growing unread, is **not B11l's business** and no item has been created.

---

## 2. Architecture

**Direction of movement: toward Shared Core.** Resolution of a self-reference moves from *nowhere*
(it never happened) into `naavi-chat`; and §3.5 of Phase 2 removes a resolution decision the client
was making independently. **No business logic is added to an entry point.** Architecture Principle §1
is satisfied in the favourable direction.

**Duplication:** none introduced. One helper, two existing call sites — the
`resolveLocationRecipient()` pattern, with a test asserting both sites are covered, because
Architecture Reference §2e records B9x fixing one site while eleven passing tests guarded the other.

**Ownership:** unchanged. No capability moves between components, so §4's Ownership Change Rule does
not apply and no separate architectural approval is required.

---

## 3. Isolation

**The self path is gated by exact whole-value match on a six-token list.** For every other recipient
— every real contact name, every phone number, every email address, every relationship word — the
helper returns the action untouched and the existing code runs byte-identically.

**Blast radius if the helper is wrong:**

| Failure | Consequence |
|---|---|
| Helper matches too narrowly | `"text me"` keeps failing. **Status quo** — no regression |
| Helper matches too broadly | A real recipient is replaced by the user themselves. **The user receives their own message; no stranger is contacted.** Wrong, visible, and not outbound to a third party |
| Helper throws | Must not break the turn — **wrap and fall through to existing behaviour** (AI Coding Discipline #21: log with context, never silent) |

**The asymmetry is deliberate and worth the reviewer's attention:** every failure mode of this change
sends *fewer* messages to strangers, not more. That is the opposite of the defect being fixed.

---

## 4. Hidden coupling — the section most likely to contain the problem

1. **⭐⭐ Compound auto-send: the recipient is resolved AFTER consent, and the thing consented to
   could not have contained it.** `useOrchestrator.ts:3230` — `isAutoSend` requires
   `dedupedActions.length > 1` and an SMS/WhatsApp channel. A single self-draft renders a card; **a
   compound one sends with no card at all**, calling `lookupContact(to)` at `:3235` and sending
   whatever returns.

   **The missing card is not the whole problem.** `useOrchestrator.ts:4352` states the compound
   flow's shape directly:

   > *"Naavi's proposal turn (before the user says 'yes') has **NO actions yet** — they're only
   > created on the confirm turn."*

   So the sequence is: **(1)** Naavi proposes in prose — *"1. Text me saying hello"* — with **no
   action object, no lookup, and no resolved recipient in existence**; **(2)** the user says yes;
   **(3)** the actions are built, the lookup runs, and the message sends.

   **The user therefore consents to a sentence that cannot name the recipient, because the recipient
   has not been resolved at the moment consent is given.** There is no number to read, no name to
   check, and no card to decline. **The single defence that actually caught this defect — Wael
   reading the digits on the card and not pressing Send — does not exist on this path.**

   This is the same ordering as voice's `executeDraft` (Phase 1 §4), which Phase 1 called out as
   worse than the mobile card because resolution follows consent. **Mobile has the identical
   ordering in its compound path**, and Phase 1 did not find it because Phase 1 never examined the
   orchestrator's compound branch.

   Covered by Phase 2 §3.1. **Named here as the highest-consequence coupling in the change, and the
   reviewer is asked in §9.4 whether it belongs in B11l at all or deserves its own item.**

   *(Strengthened 2026-09-01 on Wael's instruction. This entry previously read only "a compound one
   sends with no card at all. Same defect, no chance to read it," which understated it: it described
   a missing display surface rather than consent being taken before the recipient exists.)*
2. **Two different send paths, one fix each.** `DraftCard.handleSend` (`app/index.tsx:517`) and the
   compound path (`useOrchestrator.ts:3231-3250`) both send SMS and share no code. Fixing one does
   not fix the other — the same shape as Architecture Reference §2b's three `lookup-contact` sites.
3. **Voice-confirm-to-send routes through the card**, `_voiceConfirmed` → `handleSend`, so it
   inherits the fix. **Verify at Phase 4** rather than assume.
4. **A contact genuinely named "Me" or "Myself" would be hijacked** by the whitelist. Accepted: the
   card will display `To: you`, which makes the interpretation visible and correctable. Named rather
   than discovered.
5. **⭐ The vocabulary is English-only, and Naavi is global-first.** `feedback_global_first` says
   build every feature global from day one. A French or Arabic speaker saying the equivalent of
   "text me" gets today's behaviour — the stranger. **This is a real, deliberate gap.** Options:
   accept and record it, or make the token list locale-aware now. **Reviewer's call; it is not
   assumed away.**

---

## 5. Implementation strategy — order is load-bearing

Per Architecture Reference §0d: backend before client, and never infer a deployment.

1. **Shared Core first** — helper + both call sites + the B9x comment update.
2. **Tests, written against the server behaviour**, registered in `tests/runner.ts` (Rule 15a).
3. **Deploy to staging** `xugvnfudofuskxoknhve`; confirm from the deploy, not the push.
4. **Verify server-side emission** — that `to_phone` / `to_display` appear and `to` is unchanged —
   **before touching any client file.**
5. **Then the four mobile consumers**, in one pass.
6. **Staging APK.** No AAB, no production.
7. **Live verification against a contact list carrying a deliberate collision** — staging's own list
   cannot demonstrate the defect (Phase 0).

**Why the client waits for step 4:** if Shared Core does not emit the fields, every client change is
inert and will look like a client bug. That is the B11h shape — a client half shipped against a
server half that was not there.

---

## 6. Non-Determinism Rule — applicability

**The fix is deterministic. The path to reach it is not.**

`resolveSelfRecipient()` is a string comparison — no model call, no variance, and the Non-Determinism
Rule does not apply to it.

**But whether Claude emits `draft_message` with `to: "me"` at all is a classifier decision.** Voice
demonstrated the range live: three trials produced three different routings. **So every
behaviour-changing test case that goes through Claude requires ≥3 independent trials with the full
distribution reported**, per the rule. Pure-function tests of the helper do not.

**No prompt or classifier file is being changed**, so the rule's usual trigger is absent — it applies
here only to end-to-end verification.

---

## 7. Proposed Implementation Boundaries — **for the reviewer to confirm or amend**

Submitted as a proposal. Phase 4 implements what the reviewer authorises, not what is written here.

**Authorised files and the specific change in each:**

| File | Authorised change |
|---|---|
| `supabase/functions/naavi-chat/index.ts` | Add `resolveSelfRecipient()`; call at `:2067-2093` and `:3925-3958`; set `to_phone`/`to_email`/`to_display`; update the B9x comment at `:3480-3484` |
| `app/index.tsx` | `DraftCard` display prefers `to_display`; `handleSend` prefers `to_phone`/`to_email`, then the mount-time resolution |
| `hooks/useOrchestrator.ts` | Two call sites only — `:3225-3251` and `:743-762` — prefer the resolved fields |
| `lib/voice-confirm.ts` | `buildActionSummary` prefers `to_display` |
| `lib/naavi-client.ts` | `NaaviAction` gains `to_display` — type only |
| `tests/catalogue/b11l-self-recipient.ts` | New suite |
| `tests/runner.ts` | Registration line |

- **No additional files are approved.**
- **No opportunistic refactoring is approved.**
- **No architectural change beyond what Phase 2 v3 describes is approved.**

**Explicitly excluded from this authorisation:**

- `_shared/anthropic_tools.ts`, `get-naavi-prompt`, `lookup-contact` — all rejected alternatives.
- Merging the two `naavi-chat` construction sites.
- The `my` / `us` / `her` collisions — evidence, not scope.
- `src/orchestration/*` — reported as not-imported; **not touched.**
- Any production deploy or AAB.

---

## 8. Deferred Architectural Decisions

Recorded separately so a later session recognises them as considered and set aside, not fresh ideas.

| Idea | Not approved for this implementation, because | Reconsider when |
|---|---|---|
| **Merge the two `DRAFT_MESSAGE` construction sites** | Blast radius far beyond B11l; every draft on mobile routes through them | A third construction site appears, or a second drift incident between them |
| **A general recipient resolver in Shared Core for all draft messages** | This is what `naavi-chat:3480-3484` deliberately refused during B9x. Reversing it wholesale is a much larger decision than fixing self-reference | A second recipient defect appears on this path that self-resolution does not cover |
| **Locale-aware self-reference vocabulary** | See §4.5 — genuinely open, may be pulled into scope by the reviewer rather than deferred | The first non-English user, whichever comes first |
| **A minimum-confidence guard on short contact queries** | Would address `my`/`us`/`her`, but is a different defect with different semantics | Those collisions are reported as user-visible by someone |

---

## 9. What the reviewer is specifically asked to attack

### Settled on the first review, 2026-09-01 — not reopened

| Question | Ruling |
|---|---|
| **§4.5 — English-only vocabulary** | **Stays English-only for B11l.** Locale-aware recognition is a legitimate separate finding; folding multilingual semantics into a high-risk fix would materially expand scope. Recorded as a finding, not scope. |
| **§4.1 — is the compound auto-send fix in scope?** | **Yes, it stays in.** Another consumer of the same defective `"me"` recipient, and it can send after a consent given when no resolved recipient existed. Leaving it would leave a **more dangerous** version of the same defect running. |
| **`to_display`, and binding send to the displayed resolution** | **Both retained.** The reviewer's reasoning: this *removes competing resolution* rather than introducing another resolver — which also answers the B9x question below. |

### Still open for this review

1. **Is `to_display` the right shape** now that it is confirmed — three fields where two existed —
   or does the action object become harder to reason about than the defect it fixes?
2. ~~**Assumption 6** — is a draft action persisted anywhere?~~ **RESOLVED 2026-09-01 — see §1.1.
   They are persisted, into `conversations.turns[].drafts[]`, and nothing anywhere reads that table.
   No migration, no backward-compatibility requirement, no stale-display risk. Every assumption in
   this document is now verified; none carries "believed, not proven."**
3. **Phase 2 v3 §1.2's failure table** — is *"fall through and ask"* correct in every row, or is
   there a case where silently proceeding with the phone destination would serve the user better
   than a question?
4. **The email path's extra failure surface** — `auth.admin.getUserById` is a network call to a
   different service from the phone read. Is gating it behind `channel === 'email'` sufficient, or
   should the helper resolve both destinations up front for predictability?
