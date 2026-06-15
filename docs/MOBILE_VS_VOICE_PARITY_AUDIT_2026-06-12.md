# Mobile vs Voice Parity Audit — 2026-06-12 (Build 246)

Sources: `hooks/useOrchestrator.ts`, `naavi-voice-server/src/index.js`, `app/index.tsx`

Legend: ✅ = fully working · ⚠️ = partial · ❌ = not implemented

Last updated: 2026-06-15 (Build 254) — B2m session closed 3 voice gaps + 1 accepted-no-action.

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
| Create email / time / calendar / weather / contact-silence alert | ✅ | ✅ | Parity |
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
| Configure briefing time | ❌ | ⚠️ | **Open**: voice UPDATE_MORNING_CALL writes to legacy morning_call_time only; brief_windows (new multi-window system) not yet written by either surface via chat. Dedicated session needed — see next-session focus. |
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

---

## Closed / Accepted (2026-06-15 B2m session)

| Gap | Resolution |
|---|---|
| Re-arm expired location alert (High) | Fixed — voice server 4 paths now offer inline re-arm (commit `0a42ffa`) |
| `LOG_CONCERN` / `UPDATE_PROFILE` missing in voice (Medium) | Fixed — voice writes to topics table (commit `fe82638`) |
| `SPEND_SUMMARY` listed as voice gap (Medium) | Closed — was already implemented; audit entry was stale |
| Source-hint filtering in global search (Low) | Accepted, no action — answer identical either way; cost difference negligible |

---

## What's intentionally different (not gaps)

- Hands-free continuous listening — phone IS hands-free by design; mobile removed press-and-hold
- Call recording — voice-only feature, no mobile equivalent needed
- Email address reconstruction from spoken "@" — voice STT only, not needed on typed mobile
- Caller PIN — voice-only (mobile uses Google auth)
- Mute — phone keypad handles mute; no mobile equivalent needed
