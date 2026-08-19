# Phase 1A — Architecture Completeness Review — S1 — Voice PIN Authentication

**Date:** 2026-08-19
**Governance version:** v4.0
**Phase 1:** APPROVED 2026-08-19 (reviewer) + Wael's own go-ahead.
**Product decision recorded:** Wael, 2026-08-19 — *"Yes we need the borrowed-phone path."* Phase 1 §6 Q1 is answered; removal is off the table and the Phase 0 design stands.
**Status:** DRAFT — awaiting review.

**Architecture Reference version used:** `2026.07.18.4`. Must be re-confirmed unsuperseded before Phase 8 merge.

**Provenance convention:** **[FRESH]** = grep/read performed this session with `file:line`. **[CITED]** = resting on the Architecture Reference without a fresh check.

---

## ⭐ HEADLINE FINDING — Phase 1 missed a PIN surface, and it changes the impact

Phase 1 described two PIN surfaces: mobile *sets*, voice *verifies*. **There are three.** The voice server can also **set** a PIN, over the phone.

`naavi-voice-server/src/index.js:10403-10440` **[FRESH]** — a deterministic "set my PIN" intercept. Its own comment states the gate:

> *"Only fires when userId is set (user calling from their registered phone **OR after PIN verification**)."*

**That is a privilege-escalation path.** Someone who guesses a PIN (Defect A) is not limited to reading data — they can say *"change my PIN to 4-4-4-4"* and take **persistent** control of the account. The legitimate owner's PIN stops working, with no notification, and they cannot tell the difference between "I misremembered" and "someone took it."

**This materially raises S1's impact.** Phase 1 framed the risk as unauthorised *access*. It is unauthorised *account takeover*.

**Two smaller findings from the same code:**

- **The PIN is spoken back aloud** on success: `` `Done. Your PIN is ${spacedPin}.` `` (`:10441`) **[FRESH]**. On a borrowed or speakerphone that is an eavesdropping exposure — the same concern that drove Wael's last-4 refinement in Phase 0.
- **PIN length is hardcoded in at least four places** **[FRESH]**: `extractPinFromTwilioGather` (`:6718` `/^\d{4}$/`, `:6727` `out.length === 4`), `extractPinFromSentence` (`:6751` `(\d{4})`), and the spoken prompts (`:6630`, `:6821`, `:6823` — *"four digit PIN"*), plus `manage-voice-pin`'s own validation. The 4→6 change is not a single-constant edit.

---

## 1. The six mandatory Phase 1A questions

**Q1 — Architectural owner?**
Three components, three owners:
- *PIN verification and the caller flow* → `naavi-voice-server/src/index.js` (`/voice/pin`, `/voice/pin-result`, `getUsersWithVoicePin`, `verifyVoicePinForUser`) **[FRESH]**
- *PIN storage, hashing, set/remove/verify operations* → `manage-voice-pin` Edge Function (Shared Core) **[FRESH]**
- *PIN-setting UI* → `app/settings.tsx:605,:642` (mobile) **and** `naavi-voice-server/src/index.js:10431` (voice) **[FRESH]**

**Q2 — Shared Core, Duplicated, or Platform-specific?**
- *Verification*: **Voice-only.** Mobile never verifies — `app/settings.tsx` reads only `voice_pin_set_at`, a timestamp, and never a hash **[FRESH]**.
- *Storage*: **Shared Core**, but with only voice and mobile as callers, no third consumer **[FRESH]**.
- *Setting*: **Duplicated** — two independent call sites, mobile and voice. Phase 1 recorded this as Mobile-only. **That was wrong** and is corrected here.

**Q3 — If duplicated, were all implementations investigated?**
Not by Phase 1 — it missed the voice set-PIN path entirely. Both are investigated here (§2).

**Q4 — Which were investigated, which not?**
All three surfaces investigated. Full matrix in §2; no surface left silent.

**Q5 — Does the documented problem scope match the Architecture Reference?**
**No — the Reference does not describe voice PIN authentication at all.** Searched: no section covers the PIN, `manage-voice-pin`, or caller authentication. §4 lists *Authentication* as Protected Core but does not say what implements it for voice **[FRESH]**. **This is a Reference gap S1 must close at Phase 8**, in the same work item, per the Phase 8 precondition.

**Q6 — Any documented implementation excluded?**
No. Exclusions with justification in §4.

## 2. Cross-Repository Verification

Every surface carries a verdict; silence is not acceptable in either direction.

| Capability | Mobile | Voice | Shared Core |
|---|---|---|---|
| **Verify a PIN** | **None.** Reads `voice_pin_set_at` only — a timestamp, never a hash. **[FRESH]** `app/settings.tsx:266` | **Sole implementation.** `verifyVoicePinForUser` → `manage-voice-pin` op:verify **[FRESH]** `:6785` | Executes the check; does not decide *whose* PIN. **[FRESH]** |
| **Set a PIN** | `supabase.functions.invoke('manage-voice-pin')` op:set/remove **[FRESH]** `settings.tsx:605,:642` | **Second implementation** — deterministic intercept **[FRESH]** `:10431` | Single storage path for both **[FRESH]** |
| **Resolve caller identity** | JWT **[FRESH]** `lib/supabase.ts:260` | Caller phone → `user_settings`, else PIN search **[FRESH]** `:994`, `:6880` | n/a |
| **Rate limiting / lockout** | **None anywhere** | Per-call only (`PIN_MAX_ATTEMPTS = 3`, `:6707`) **[FRESH]** | **None** |
| **Failure alerting** | **None anywhere** | **None** | **None** |

**Consequence for Phase 2:** the fix touches **two** repositories. A change to PIN length or to identity-scoping must be made in the voice server *and* in `manage-voice-pin` *and* in the mobile settings screen. Changing one leaves a working path at the old rules — the classic duplication failure this project has hit repeatedly (B9g/B9n, B10w).

## 3. Impact on Phase 1's conclusions

| Phase 1 claim | Status after 1A |
|---|---|
| Root cause is a single design inversion — credential before identity | **Upheld.** The escalation path is a consequence of it, not a separate cause. |
| Three defects (A/B/C) | **Upheld**, and a fourth surface added: PIN *setting* over voice, reachable after PIN verification |
| Impact = unauthorised access | **Corrected — unauthorised account takeover.** A guessed PIN can be changed, locking out the real owner. |
| PIN-setting is Mobile-only | **Corrected — Duplicated** (mobile + voice) |
| Severity: 1 in 5,000 today | **Upheld** — 2 PIN holders, unchanged |
| Priority P0 | **Upheld and strengthened** by the escalation finding |

## 4. Explicit exclusions, with justification

- **Mobile authentication (Google OAuth)** — out of scope by Phase 0. Verified above to hold no PIN-verification path, so the exclusion costs no coverage **[FRESH]**.
- **`mynaavi-website`** — no backend, no auth surface. Not investigated.
- **Voice biometric** — retired in favour of the PIN (`project_naavi_caller_pin_chosen_over_biometric`); not reopened.
- **Stale worktrees** under `.claude/worktrees/` — six of them returned matches during the cross-repo grep and were excluded as non-authoritative copies. **Flagged separately:** CLAUDE.md names only two stale worktrees; there are at least six, and they pollute every repo-wide search. Not part of S1.

## 5. Phase 1A verdict

**PASS WITH CORRECTIONS.**

Phase 1's root cause survives unchanged. Two corrections are made here rather than by returning to Phase 1:

1. **A third PIN surface exists** — the voice-server set-PIN intercept — and it converts the risk from unauthorised access into **persistent account takeover**.
2. **PIN-setting is Duplicated, not Mobile-only.** Phase 2 must change both implementations or explicitly justify changing one.

**Carried into Phase 2:**
- PIN length is hardcoded in **at least four** places, not one.
- The success path **speaks the PIN aloud** — inconsistent with the eavesdropping reasoning behind last-4.
- **The Architecture Reference documents none of this.** Closing that gap is a Phase 8 merge precondition.

**Recommendation:** proceed to Phase 2, planning against §2's matrix rather than Phase 1's two-surface picture.

---

**Awaiting review and Wael's own explicit go-ahead before Phase 2** (governance §3, Phase-Gate Approval Rule).
