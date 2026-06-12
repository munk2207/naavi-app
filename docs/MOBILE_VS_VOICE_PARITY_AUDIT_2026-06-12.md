# Mobile vs Voice Parity Audit — 2026-06-12 (Build 246)

Sources: `hooks/useOrchestrator.ts`, `naavi-voice-server/src/index.js`, `app/index.tsx`

Legend: ✅ = fully working · ⚠️ = partial · ❌ = not implemented

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
| Re-arm expired location alert | ✅ | ⚠️ | **Voice gap**: voice returns error telling user to tap mobile app; mobile auto-re-arms inline |
| Create email / time / calendar / weather / contact-silence alert | ✅ | ✅ | Parity |
| List rules | ✅ | ✅ | Parity |
| Delete rule (single + bulk) | ✅ | ✅ | Parity |
| **MEMORY / KNOWLEDGE** | | | |
| Remember (save fact) | ✅ | ✅ | Parity |
| Recall / search memory | ✅ | ✅ | Parity |
| Delete memory | ✅ | ✅ | Parity |
| LOG_CONCERN / UPDATE_PROFILE | ✅ | ⚠️ | **Voice gap**: no executeAction case found in voice server switch block |
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
| Source-hint filtering ("find in contacts") | ✅ | ⚠️ | **Voice gap**: voice pre-search always fans out to all adapters; source_hint not passed |
| **MORNING BRIEF** | | | |
| Morning brief delivery | ✅ | ✅ | Voice is primary; mobile renders brief cards |
| Configure morning call time | ❌ | ✅ | **Mobile gap**: UPDATE_MORNING_CALL has no handler in useOrchestrator |
| Call recording | ❌ | ✅ | By design — voice-only feature |
| **SPEND SUMMARY** | | | |
| Spend summary | ✅ | ⚠️ | **Voice gap**: SPEND_SUMMARY in voice prompt but no executeAction case in voice server |
| **VOICE / AUDIO** | | | |
| TTS playback | ✅ | ✅ | Parity (both Deepgram Hera) |
| Hands-free mode | ❌ | ✅ | By design — phone call IS hands-free |
| Stop-word interrupt ("Naavi stop") | ❌ | ⚠️ | Known voice regression — holding list item 7 |
| Caller PIN | ❌ | ⚠️ | Voice gap — designed, not yet shipped |

---

## Confirmed Gaps — Priority Ranked

### Mobile gaps (voice has it, mobile does not)
| Priority | Gap | Notes |
|---|---|---|
| Medium | `UPDATE_MORNING_CALL` not wired in mobile chat | Users must configure morning call via voice only |

### Voice gaps (mobile has it, voice does not)
| Priority | Gap | Notes |
|---|---|---|
| High | Re-arm expired location alert | Voice tells user to tap mobile app; should auto-re-arm in call |
| Medium | `SPEND_SUMMARY` not in voice executeAction | Listed in prompt but falls through to Claude without a handler |
| Medium | `LOG_CONCERN` / `UPDATE_PROFILE` not in voice executeAction | Falls through to Claude |
| Low | Verified-address gate before `FETCH_TRAVEL_TIME` | Mobile pre-verifies; voice calls Edge Function directly |
| Low | Source-hint filtering in global search | Voice always fans out to all 10 adapters regardless of user intent |

---

## What's intentionally different (not gaps)

- Hands-free continuous listening — phone IS hands-free by design; mobile removed press-and-hold
- Call recording — voice-only feature, no mobile equivalent needed
- Email address reconstruction from spoken "@" — voice STT only, not needed on typed mobile
- Caller PIN — voice-only (mobile uses Google auth)
- Mute — phone keypad handles mute; no mobile equivalent needed
