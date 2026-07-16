# Mobile vs Voice Parity Audit — 2026-06-12 (Build 246)

Sources: `hooks/useOrchestrator.ts`, `naavi-voice-server/src/index.js`, `app/index.tsx`

Legend: ✅ = fully working · ⚠️ = partial · ❌ = not implemented

Last updated: 2026-07-16 — B9z. Confirm-then-execute behavior for time-trigger `SET_ACTION_RULE` is now voice-only; mobile's equivalent path unverified against the same defect class. See row below and Voice-gaps table.

---

## Full Capability Table

| Capability | Mobile | Voice | Gap notes |
|---|---|---|---|
| **MESSAGING** | | | |
| Send SMS | ✅ | ✅ | Parity |
| Send WhatsApp | ✅ | ✅ | Parity |
| Send email (draft) | ✅ | ✅ | Parity |
| **CALENDAR** | | | |
| Read calendar events | ✅ | ✅ | Parity |
| Create calendar event | ✅ | ✅ | Parity |
| Delete calendar event | ✅ | ✅ | Parity |
| Schedule medication (recurring) | ✅ | ✅ | Parity |
| **CONTACTS** | | | |
| Lookup contact by name | ✅ | ✅ | Parity |
| Lookup contact by phone | ✅ | ⚠️ | Voice gap: phone-number lookup not enriched into Claude context |
| Save contact | ✅ | ✅ | Parity |
| **LISTS** | | | |
| Create / Add / Remove / Read / Delete list | ✅ | ✅ | Parity |
| Connect / Disconnect list to alert | ✅ | ✅ | Parity |
| Query list connections | ✅ | ✅ | Parity |
| **ALERTS / RULES** | | | |
| Create location alert | ✅ | ✅ | Parity — both have picker, 3-attempt cap, permission check |
| Re-arm expired location alert | ✅ | ✅ | **FIXED 2026-06-15** — all 4 commitLocationRule paths offer inline re-arm |
| Create email / time / calendar / weather / contact-silence alert | ✅ | ✅ | Parity on *whether* the alert gets created. **NOT parity on *how confirmation and result-reporting work*** — see confirm-gate row below, new 2026-07-16. |
| Time-trigger confirm-then-execute (single attempt, truthful success/failure) | ⚠️ unverified | ✅ | **Voice gap, new 2026-07-16 (B9z).** Voice: `action_rule_confirm_gate.js` — proposal is stored pending, executed exactly once on explicit "yes," real result (success/fail) spoken back. Mobile: `useOrchestrator.ts` has its own, separate `SET_ACTION_RULE` creation code (direct insert ~line 810, and via `manage-rules` ~line 4096) — never touched by B9z, never checked for the same "fire before confirm / discard result" defect class B9z fixed on voice. Architecturally different (mobile's chat UI naturally gates on a tap before this code runs, unlike voice's single-turn phone call), so not proven vulnerable — but genuinely unverified, not confirmed-safe. See `docs/B9Z_PHASE1_PROBLEM_DEFINITION_2026-07-16.md` for the voice-side root cause this fixed. |
| List rules | ✅ | ✅ | Parity |
| Delete rule (single + bulk) | ✅ | ✅ | Parity |
| **MEMORY / KNOWLEDGE** | | | |
| Remember (save fact) | ✅ | ✅ | Parity |
| Recall / search memory | ✅ | ✅ | Parity |
| Delete memory | ✅ | ✅ | Parity |
| LOG_CONCERN / UPDATE_PROFILE | ✅ | ✅ | **FIXED 2026-06-15** — voice now writes to topics table via REST API |
| **REMINDERS** | | | |
| Set reminder | ✅ | ✅ | Parity |
| Read reminders | ✅ | ✅ | Parity |
| **GOOGLE DRIVE / NOTES** | | | |
| Save note to Drive | ✅ | ✅ | Parity |
| Search Drive files | ✅ | ✅ | Parity |
| **NAVIGATION / TRAVEL TIME** | | | |
| Fetch travel time | ✅ | ✅ | Parity |
| Verified-address gate before travel time | ✅ | ⚠️ | **Voice gap**: mobile pre-verifies via resolve-place; voice calls Edge Function directly |
| **SEARCH** | | | |
| Global search (10 adapters) | ✅ | ✅ | Parity |
| Source-hint filtering ("find in contacts") | ✅ | ⚠️ | **Accepted — no action** (2026-06-15): answer is correct regardless; voice fans all 10 adapters, fractions-of-a-cent cost difference, not worth complexity |
| **BRIEFINGS** | | | |
| Brief delivery (all windows) | ✅ | ✅ | Voice is primary; mobile renders brief cards |
| Configure briefing time | ✅ | ✅ | **B2m CLOSED** — both surfaces patch brief_windows via timeToWindow(); legacy columns also written as fallback. Zero-pad bug fixed (build 255). |
| Call recording | ❌ | ✅ | By design — voice-only feature |
| **SPEND SUMMARY** | | | |
| Spend summary | ✅ | ✅ | **Confirmed parity 2026-06-15** — SPEND_SUMMARY handler exists in voice server (line 10082); prior audit entry was stale |
| **VOICE / AUDIO** | | | |
| TTS playback | ✅ | ✅ | Parity (both Deepgram Hera) |
| Hands-free mode | ❌ | ✅ | By design — phone call IS hands-free |
| Stop-word interrupt ("Naavi stop") | ❌ | ⚠️ | Known voice regression — holding list item 7 |
| Caller PIN | ❌ | ⚠️ | Voice gap — designed, not yet shipped |

---

## Open Gaps — Priority Ranked

### Mobile gaps (voice has it, mobile does not)
| Priority | Gap | Notes |
|---|---|---|
| Medium | Configure briefing time via chat | Both surfaces write to wrong/legacy column; needs brief_windows upgrade — next session |

### Voice gaps (mobile has it, voice does not)
| Priority | Gap | Notes |
|---|---|---|
| Low | Verified-address gate before `FETCH_TRAVEL_TIME` | Mobile pre-verifies; voice calls Edge Function directly. Answer is correct either way. |

### Mobile gaps, inverted — mobile *unverified* against a defect voice now has a fix for
| Priority | Gap | Notes |
|---|---|---|
| Medium | Confirm-then-execute for time-trigger `SET_ACTION_RULE` | See "Time-trigger confirm-then-execute" row in the capability table above. Not confirmed as a mobile bug — confirmed as an *unchecked* code path. Recommend a dedicated investigation before assuming it's fine or assuming it's broken. |

---

## Closed / Accepted (2026-06-15 B2m session)

| Gap | Resolution |
|---|---|
| Re-arm expired location alert (High) | Fixed — voice server 4 paths now offer inline re-arm (commit `0a42ffa`) |
| `LOG_CONCERN` / `UPDATE_PROFILE` missing in voice (Medium) | Fixed — voice writes to topics table (commit `fe82638`) |
| `SPEND_SUMMARY` listed as voice gap (Medium) | Closed — was already implemented; audit entry was stale |
| Source-hint filtering in global search (Low) | Accepted, no action — answer identical either way; cost difference negligible |
| Configure briefing time (Medium) | **B2m CLOSED 2026-06-15** — brief_windows patched on both surfaces; timeToWindow zero-pad fix; tested and confirmed build 255 |

---

## What's intentionally different (not gaps)

- Hands-free continuous listening — phone IS hands-free by design; mobile removed press-and-hold
- Call recording — voice-only feature, no mobile equivalent needed
- Email address reconstruction from spoken "@" — voice STT only, not needed on typed mobile
- Caller PIN — voice-only (mobile uses Google auth)
- Mute — phone keypad handles mute; no mobile equivalent needed
