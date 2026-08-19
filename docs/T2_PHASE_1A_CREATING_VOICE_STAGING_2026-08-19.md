# Phase 1A — Architecture Completeness Review — T2 — Creating Voice Staging

**Date:** 2026-08-19
**Governance version:** v4.0
**Phase 0:** `docs/T2_PHASE_0_CREATING_VOICE_STAGING_2026-08-19.md` — APPROVED 2026-08-19.
**Phase 1:** `docs/T2_PHASE_1_CREATING_VOICE_STAGING_2026-08-19.md` — APPROVED 2026-08-19 (Technical Investigation Review).
**Status:** DRAFT — awaiting review.

**Architecture Reference version used:** `docs/MYNAAVI_CURRENT_HIGH_LEVEL_ARCHITECTURE_2026-07-18.md`, dated **2026-07-18**. Per the Version Verification requirement, this must be re-confirmed as unsuperseded before Phase 8 merge.

**Provenance convention:** **[FRESH]** = grep/read performed this session to produce this specific claim, with `file:line`. **[CITED]** = resting on the Architecture Reference's existing classification without a fresh check.

---

## ⭐ HEADLINE FINDING — Phase 1's outbound trace was INCOMPLETE

Phase 1 identified two outbound dispatchers. A full inventory finds **six functions that call Twilio directly** and **eight call sites that invoke the shared senders**. Phase 1 covered two of each.

This is the failure mode Phase 1A exists to catch, and it is reported as a finding rather than silently corrected. **Phase 2 must plan against the inventory in §3 below, not against Phase 1 §3.**

Phase 1's *conclusion* is unaffected — enforcement still belongs in Shared Core, not the voice server. The finding widens the enforcement surface; it does not reverse the direction.

---

## 1. The six mandatory Phase 1A questions

**Q1 — What is the architectural owner of the affected capability?**
Three distinct capabilities are affected, with different owners:
- *Outbound notification sending* → `send-sms`, `send-email`/`send-user-email`, `send-push-notification` (Shared Core) **[CITED — Reference line 62]**, plus six functions that bypass them for voice calls **[FRESH — §3]**.
- *Phone→identity resolution* → `getUserIdByPhone` in `naavi-voice-server/src/index.js` **and** a second implementation in Shared Core **[FRESH — §4]**.
- *Voice deployment topology* → not currently described by the Reference **[FRESH]**.

**Q2 — Is the capability Shared Core, Duplicated, or Platform-specific?**
- Outbound sending: **Shared Core**, with the qualification that six functions bypass the shared senders for the voice-call channel **[FRESH]**.
- Phone→identity resolution: **Duplicated** — two independent implementations **[FRESH]**. Phase 1 treated this as Voice-only. That classification was wrong.
- Voice deployment topology: **Platform-specific (Voice)**.

**Q3 — If duplicated, were all documented implementations investigated?**
Not by Phase 1. Both are investigated here — see §4.

**Q4 — Which implementations were investigated and which were not?**
See the full matrix in §3 and §4. Every surface is given an explicit verdict; none is left silent.

**Q5 — Does the documented problem scope match the Architecture Reference?**
Partially. The Reference states *"every alert-firing function funnels through these"* for `send-sms`/`send-email` (line 62) **[CITED]**. That is accurate for SMS, email, and push, but **not** for the outbound voice-call channel, which six functions perform by calling Twilio directly **[FRESH — §3]**. The Reference's wording is broader than the code supports. Flagged for the Phase 8 Reference update.

**Q6 — Is any documented implementation excluded from the investigation?**
No. Exclusions are stated explicitly with justification in §5.

---

## 2. Cross-Repository Verification — Mobile / Voice / Shared Core

Required for each affected capability. Silence is not acceptable in either direction, so every cell carries a verdict.

### Capability: outbound sending (SMS / WhatsApp / email / push / voice call)

| Surface | Verdict | Evidence |
|---|---|---|
| **Mobile** | **No implementation. Clean negative.** Mobile creates rows; Shared Core sends. | **[FRESH]** — `grep -rn "functions/v1/send-\|api.twilio.com" app/ lib/ hooks/` returned zero matches; `invoke('send-…')` likewise zero. |
| **Voice** | **One implementation** — direct Twilio SMS from the voice server itself. | **[FRESH]** — `naavi-voice-server/src/index.js:7224` → `api.twilio.com/…/Messages.json`. Call-control endpoints at `:5433`, `:5456`, `:5484` manage recordings on an existing call and are **not** third-party outbound. |
| **Shared Core** | **Primary implementation, plus six direct-Twilio bypasses.** | **[FRESH]** — full inventory in §3. |

**Consequence:** a Railway-level allowlist covers exactly one outbound path — `index.js:7224`. It is necessary, and it is roughly one-fourteenth of the surface.

### Capability: phone→identity resolution

| Surface | Verdict | Evidence |
|---|---|---|
| **Mobile** | **No implementation.** Identity is the signed-in session. | **[FRESH]** — `lib/supabase.ts:260`, JWT-based; no phone lookup found. |
| **Voice** | **Implementation present.** | **[FRESH]** — `naavi-voice-server/src/index.js:994`, `or=(phone.eq.X,phone_numbers.cs.{X})&limit=1`. |
| **Shared Core** | **Second, independent implementation — same query shape.** | **[FRESH]** — `supabase/functions/ingest-ticket/index.ts:175`, `.or(\`phone.eq.${reporterPhone},phone_numbers.cs.{${reporterPhone}}\`)`. |

**Consequence:** the uniqueness gap proven in Phase 1 §4 affects **both** implementations, because both query the legacy `phone` column that the uniqueness trigger does not cover. A fix applied to one does not fix the other.

### Capability: background scheduling (cron)

| Surface | Verdict |
|---|---|
| **Mobile** | No implementation — cron is server-side. **[FRESH]** — no cron definitions outside `supabase/migrations/`. |
| **Voice** | No implementation — the voice server holds no schedulers relevant to this item. **[FRESH]**. |
| **Shared Core** | Sole owner. Thirteen cron migrations; four run every minute and can act on voice-created records. **[FRESH — Phase 1 §5]** |

---

## 3. Corrected outbound inventory — supersedes Phase 1 §3

All rows **[FRESH]**, from `grep -rln` across `supabase/functions/`.

### Class B — calls Twilio directly (bypasses the shared senders entirely)

| # | Function | In Phase 1? |
|---|---|---|
| 1 | `evaluate-rules` | ✅ traced |
| 2 | `check-reminders` | ✅ traced |
| 3 | `report-location-event` | ❌ **missed** — `index.ts:834` |
| 4 | `outbound-call` | ❌ **missed** |
| 5 | `trigger-morning-call` | ❌ **missed** |
| 6 | `send-sms` | ✅ traced (this is the shared sender itself, `index.ts:142`) |

### Class A — invokes the shared senders

| # | Call site | In Phase 1? |
|---|---|---|
| 1 | `evaluate-rules` | ✅ traced |
| 2 | `check-reminders` | ✅ traced |
| 3 | `report-location-event` | ❌ **missed** — `index.ts:774`, `:787`, `:794` |
| 4 | `_shared/task_actions.ts` | ❌ **missed** |
| 5 | `geofence-health-check` | ❌ **missed** |
| 6 | `ingest-ticket` | ❌ **missed** |
| 7 | `send-ticket-reply` | ❌ **missed** |
| 8 | `global-search/adapters/contacts.ts` | ❌ **missed** — a search adapter appearing in a send inventory is unexpected; **not yet explained**, must be resolved in Phase 2 rather than assumed benign |

**`report-location-event` is a third full dispatcher** — it implements *both* classes, exactly like `evaluate-rules`. This is consistent with `docs/ARCHITECTURE_NAAVI_CHAT_ACTION_SYSTEMS.md`, which names it alongside `evaluate-rules` as one of two dispatchers implementing the self-override fallback pattern. Phase 1 did not carry that forward.

**Why this matters for T2 specifically:** `report-location-event` fires **location-trigger** alerts — geofence arrivals. Voice can create location alerts (`naavi-voice-server/src/index.js:586` writes to `action_rules`). So a voice-staging test call can create a geofence alert that later fires a real SMS, email, push, *and* an outbound voice call through a dispatcher Phase 1 never examined.

---

## 4. Impact on Phase 1's conclusions

| Phase 1 claim | Status after Phase 1A |
|---|---|
| Enforcement must sit in Shared Core, not the voice server | **Upheld and strengthened** — the bypass surface is three times larger than traced. |
| Two outbound classes exist | **Upheld** — the taxonomy is correct; the membership was incomplete. |
| Phone-uniqueness gap is real | **Upheld**, and **widened** — it affects a Shared Core implementation too, not only Voice. |
| Phone→identity resolution is Voice-only | **Corrected — it is Duplicated.** |
| Option 1 stands | **Upheld** — Option 2 duplicates every one of these dispatchers into a third project; it does not reduce this surface. |
| Hardcoded production caller ID (`+12495235394`) | **Upheld**; Phase 2 should check whether `report-location-event`, `outbound-call`, and `trigger-morning-call` carry the same literal. **Not yet checked.** |

---

## 5. Explicit exclusions, with justification

- **Mobile app code** — excluded by Phase 0's approved scope. Verified above to hold no outbound implementation **[FRESH]**, so the exclusion costs no coverage.
- **`mynaavi-website`** — no backend, no send paths, out of scope by CLAUDE.md's repo-hygiene rule. Not investigated.
- **Voice call-control endpoints** (`index.js:5433`, `:5456`, `:5484`) — recording management on an already-connected call; not third-party outbound. Excluded with reason.
- **The open phone-registration bug** — excluded by Phase 0. Phase 1A's §4 finding is adjacent to it and should inform that separate item, but is not acted on here.

## 6. Possible Architecture Audit Trigger — flagged, not claimed

Governance §5 fires an Architecture Integrity Audit on *"a fourth confirmed instance of the same 'feature added to one of two independently-maintained implementations, never mirrored to the other' pattern."* The Reference's Appendix already records three.

The duplicated phone→identity resolution found in §2 is **duplication**, but I have **not** established that it arose from the specific pattern §5 describes (a feature added to one side and never mirrored). Claiming the trigger fires would be an inference, not an observation. **Flagged for Wael's determination; not asserted.**

## 7. Independent Review Rule — status

Governance requires two independent reviews of Phase 1:
1. **Technical Investigation Review** — APPROVED by Wael, 2026-08-19.
2. **Architecture Completeness Review** — this document. **Verdict below.**

## 8. Phase 1A verdict

**PASS WITH CORRECTIONS.**

The problem definition, its root cause, and its architectural direction are sound and survive the completeness check unchanged. Two corrections are required and are made here rather than by returning to Phase 1:

1. The outbound inventory is replaced by §3 (14 call sites across 6 + 8, versus Phase 1's 4).
2. Phone→identity resolution is reclassified **Voice-only → Duplicated**, with the second implementation named.

Three items must be resolved in Phase 2 and are not answered here: the `global-search/adapters/contacts.ts` appearance in the send inventory; whether the three newly-found direct-Twilio functions carry the same hardcoded production caller ID; and the six live-staging checks still open from Phase 1 §7.

**Recommendation:** proceed to Phase 2, planning against §3 of this document.

---

**Awaiting review and Wael's own explicit go-ahead before Phase 2 begins** (governance §3, Phase-Gate Approval Rule).
