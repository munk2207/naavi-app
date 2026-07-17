# What Naavi Can Do, and Where That Work Actually Happens

**Plain-language version, written for Wael.** This is the starting inventory for the "make Mobile and Voice into two entry points to one shared core" project. Every technical detail behind this document lives in `docs/MOBILE_VS_VOICE_PARITY_AUDIT_2026-06-12.md` — this is the same information, translated, with two new questions added that matter for deciding how to fix this: *have we actually checked these two match*, and *how big a job would it be to combine them*.

---

## How to read this

For everything Naavi can do, there are really only three possible setups today:

- 🟢 **Shared** — there's genuinely one piece of code both the phone and the app call. If it's fixed, it's fixed everywhere.
- 🟡 **Two copies** — the phone and the app each have their own separate code that does the same job. If one is fixed, the other might still be broken. This is the risky category.
- 🔴 **Only one platform has it** — usually on purpose (e.g. hands-free mode only makes sense on a phone call), but sometimes it's just a genuine gap.

And for anything in the 🟡 "two copies" category, two more questions matter:
- **Checked?** — did we actually test both copies side-by-side and confirm they behave the same, or are we just hoping they do?
- **How big to combine?** — rough gut-feel: Small / Medium / Large job to make it one shared piece of code instead of two.

**Important honesty note:** most rows below marked 🟢 "Shared" have not been personally re-verified by me this session — they're carried over from the existing technical audit, which itself is a point-in-time snapshot, not a live guarantee. The one thing we know for certain, because we found it by accident today, is that a row can say "both platforms do this the same way" and be wrong (that's exactly what happened with the reminder-confirmation bug). Treat 🟢 as "believed shared," not "proven shared," until this inventory gets a real verification pass.

---

## What Naavi Can Do

### Sending messages (text, WhatsApp, email)
| What it does | Setup | Checked? | How big to combine? |
|---|---|---|---|
| Actually sending the message once Naavi decides to | 🟢 Shared — one piece of code both platforms call | Not re-checked this session | — already shared |
| Deciding *when* to send / getting your confirmation first | 🟡 Two copies — phone and app each have their own logic for this | Not checked | Medium — this is the same kind of "confirm before doing it" logic we just fixed for one case (B9z) |

### Calendar
| What it does | Setup | Checked? | How big to combine? |
|---|---|---|---|
| Reading, creating, deleting calendar events | 🟢 Shared — one piece of code both platforms call to actually touch your calendar | Not re-checked this session | — already shared |
| Deciding what event to create from what you said | 🟡 Two copies | Not checked | Medium |

### Contacts
| What it does | Setup | Checked? | How big to combine? |
|---|---|---|---|
| Looking up a contact by name | 🟢 Shared | Not re-checked this session | — already shared |
| Looking up a contact by phone number | 🟡 Two copies, and **already known to behave differently** — the phone doesn't get as much detail back as the app does | Checked — confirmed different | Small — narrow, already understood gap |

### Lists
| What it does | Setup | Checked? | How big to combine? |
|---|---|---|---|
| Creating, adding to, removing from, reading, deleting a list | 🟢 Shared | Not re-checked this session | — already shared |

### Alerts (the "remind me" / "alert me when..." feature)
| What it does | Setup | Checked? | How big to combine? |
|---|---|---|---|
| Creating a "when I arrive somewhere" alert | 🟡 Two copies — **already found a real bug here today** (Track B-1c, earlier this session): the phone version didn't know to save who you wanted texted, the app version did | Checked — confirmed different, now fixed on phone | Medium — this specific bug is fixed, but the underlying "two separate copies" problem isn't |
| Creating a "remind me at a certain time" alert, and confirming it worked | 🟡 Two copies — **this is today's whole B9z investigation.** Phone: just fixed, now double-checks before creating and tells you the truth about whether it worked. App: has its own, completely separate way of doing this, never checked | Phone: checked, working. App: not checked at all | Medium |
| Seeing your list of alerts, deleting one | 🟢 Shared | Not re-checked this session | — already shared |

### Remembering things / recalling them later
| What it does | Setup | Checked? | How big to combine? |
|---|---|---|---|
| Saving a fact, searching your memory, deleting a memory | 🟢 Shared | Not re-checked this session | — already shared |

### Reminders (separate from alerts — one-off "remind me to...")
| What it does | Setup | Checked? | How big to combine? |
|---|---|---|---|
| Setting and reading reminders | 🟢 Shared | Not re-checked this session | — already shared |

### Google Drive / Notes
| What it does | Setup | Checked? | How big to combine? |
|---|---|---|---|
| Saving a note, searching your Drive files | 🟢 Shared | Not re-checked this session | — already shared |

### Directions / travel time
| What it does | Setup | Checked? | How big to combine? |
|---|---|---|---|
| Telling you how long it'll take to get somewhere | 🟡 Two copies — app double-checks the address is real before answering, phone doesn't bother | Checked — confirmed different, low-impact (answer is still correct either way) | Small — already understood, low priority |

### Searching everything (contacts, calendar, email, notes, lists, alerts — all at once)
| What it does | Setup | Checked? | How big to combine? |
|---|---|---|---|
| "Find anything about Dr. Smith" style search across everything | 🟢 Shared — **this is the best example in the whole app of what "one core" should look like.** One piece of code, both platforms call it the same way | Confirmed shared | — already shared, use as the template |

### Morning briefings
| What it does | Setup | Checked? | How big to combine? |
|---|---|---|---|
| Delivering your morning brief | 🟡 Partially shared — the phone call is the main way it's delivered; the app mostly just displays what already happened | Mostly checked, one small fix already confirmed working | Small |
| Changing what time your brief happens | 🟢 Shared, fixed and confirmed working recently | Checked | — already shared |

### Money / spend summary
| What it does | Setup | Checked? | How big to combine? |
|---|---|---|---|
| "How much did I spend on X" | 🟢 Shared | Confirmed shared (re-checked recently) | — already shared |

### Things that are ONLY on the phone, on purpose
Hands-free listening, call recording, muting with the keypad, spelling out an email address letter-by-letter — none of these make sense on the app, so they're not gaps, they're just phone-only features. Not part of this exercise.

### Things that are ONLY on the phone, but shouldn't be (real gaps, not by design)
- Naavi doesn't reliably stop talking when you say "Naavi, stop" on a phone call — known issue, not yet fixed.
- Caller PIN (verifying who's calling from an unknown number) — designed, not built yet.

---

## What this tells us, in plain terms

Out of everything Naavi does, **most of it is already built once and shared** — that's good news, it means the "one core" idea isn't starting from zero. The genuinely risky category — 🟡 two separate copies — is smaller than it might feel after today's session, but it's concentrated in exactly the place that matters most: **deciding what to do and confirming it with you before doing it.** That's the "brain" of Naavi, and right now the phone and the app each have their own brain for that part, not one shared brain.

Everything in the 🟢 "shared" column hasn't been personally re-verified by me — it's carried over from an existing audit. Before deciding between your three options (fully centralize / auto-sync duplicates / split by complexity), I'd want to spend real time confirming the 🟢 rows are actually still true, not just assumed true, since that assumption is exactly what quietly broke in the alert-confirmation case.

---

## Suggested next step

Pick ONE of the 🟡 "two copies" rows — I'd suggest the alert-confirmation one, since we already understand it the deepest after today — and use it as the test case for whichever of your three options (centralize / auto-sync / split-by-complexity) you want to try first. Prove the approach works on one real example before deciding how to handle everything else.
