# YouTube Demo — Seed Dataset (Robert Sinclair, Ottawa)

**Purpose:** the full fictional-but-internally-consistent dataset for the dedicated demo Google/Naavi account used to film the 5 YouTube demos in `docs/YOUTUBE_TOP5_DEMOS_2026-07-20.md`.

**Status:** draft content, not yet pushed anywhere. Reconciled 2026-07-23 against a target spec: 15 contacts / 20 events / 30 emails / 8–10 conversations / 8 PDF attachments / 5 invoices / 5 lists / 6 locations. Contacts settled at **13** (confirmed OK, not padding back to 15) after Bob/Hussein were removed and folded into two existing contacts (Linda, James).

**Heads up — separate doc needs updating before filming:** `docs/YOUTUBE_TOP5_DEMOS_2026-07-20.md` has "Bob" hardcoded in Demo 1 and Demo 3's on-camera lines, and "Hussein" as the Demo 2 example. Swap those to Linda/James when you're ready to film — I haven't touched that file yet.

**Persona:** Robert Sinclair, Ottawa, ON. Project manager at a mid-size engineering firm (Kellert & Fife Engineering). Married to Elena, two kids (Maya, away at university; Ethan, in high school), one dog (Biscuit).

**Dates:** written as relative offsets (`Day 0` = the day the seed script runs, i.e. shortly before filming). The seed script converts these to real dates so "recent" emails land in the last few days and "upcoming" events land in the next 1-2 weeks — filming should happen within a few days of seeding so nothing looks stale.

**Real accounts now live (2026-07-23):**
- **Robert** — robert.esm.2207@gmail.com, (343) 326-0166 (Twilio), signed into MyNaavi staging via Google OAuth. Name + phone confirmed in `user_settings`.
- **Linda Fournier** — plays Bob's role (Demo 1 live SMS + Demo 3 live email trigger). Real info: whwh2207@gmail.com, (343) 655-3227 (Twilio).
- **James Okafor** — plays Hussein's role (Demo 2 layered lookup — calendar event + recent email + contact info). This one is **backfilled only**, no live trigger in any of the 5 demos, so reverted to a fictional-but-well-formed phone/email — no real account needed for him.

---

## 1. Household

| Field | Value |
|---|---|
| Name | Robert Sinclair |
| Home address | 500 Bayview Dr, Woodlawn, ON K0A 3M0 — real street, confirmed 2026-07-23 (west end, near Fitzroy Harbour/Constance Bay, Ottawa River) |
| Work address | 340 Albert St, Ottawa, ON (downtown — Kellert & Fife Engineering) |
| Work role | Senior Project Manager |
| Ex-wife, co-parent of Maya & Ethan | Elena Sinclair |
| **Wife** | **Linda Fournier** — established 2026-08-01 via backfilled memory fact ("My wife's name is Linda Fournier"), not a contact-record field. Chosen over Elena because Linda has a real, controllable phone/email needed for Demo 2's live proof shot. |
| Daughter | Maya Sinclair (2nd-year, Carleton University, still Ottawa-based) |
| Son | Ethan Sinclair (Grade 10, Glebe Collegiate) |
| Dog | Biscuit (golden retriever) |

---

## 2. Locations (6)

A small, reused set of real, geocodable addresses — everything else (events, alerts, invoices) points back to these instead of inventing a one-off address every time, same as a real person's actual routine.

| # | Location | Address | Used for |
|---|---|---|---|
| 1 | **Home** | 500 Bayview Dr, Woodlawn, ON K0A 3M0 | Demo 1 arrival alert; base for leave-by calculations — genuinely far from downtown, real traffic gap guaranteed |
| 2 | **Work** (Kellert & Fife Engineering) | 340 Albert St, Ottawa, ON | Team standup, 1:1s, everyday work events |
| 3 | **Client site — Riverside Development** | 900 Riverside Dr, Ottawa, ON | Demo 4 leave-by anchor — Riverside Dr confirmed real (runs through south-central Ottawa near the hospital) |
| 4 | **Costco Merivale** | 1900 Merivale Rd, Ottawa, ON | Demo 5 arrival alert + grocery list |
| 5 | **Ottawa Athletic Club** | 1660 Merivale Rd, Ottawa, ON | Recurring gym class |
| 6 | **Westboro Medical & Dental Clinic** | 254 Richmond Rd, Ottawa, ON | Dr. Lévesque (family doctor) and Dr. Osei (dentist) — same building |

Other addresses mentioned in event/email text (Glebe Collegiate, Linda's house, a restaurant, the vet) are flavor only — not verified alert locations, just plain text like a real calendar entry would have.

---

## 3. Contacts (13)

| # | Name | Relationship | Phone | Email | Notes |
|---|---|---|---|---|---|
| 1 | Elena Sinclair | Wife | +1 613 555 0142 | elena.sinclair@gmail.com | Teacher at Elmdale Public School. |
| 2 | Maya Sinclair | Daughter | +1 613 555 0198 | maya.sinclair22@cmail.carleton.ca | 2nd year, Carleton. |
| 3 | Ethan Sinclair | Son | +1 613 555 0173 | (no personal email on file) | Grade 10. |
| 4 | Nadia Farah | Sister | +1 514 555 0110 | nadia.farah@gmail.com | Lives in Montreal. |
| 5 | Priya Nair | Robert's manager | +1 613 555 0166 | priya.nair@kellertfife.com | VP Engineering. |
| 6 | Dr. Sarah Osei | Dentist | +1 613 555 0121 | frontdesk@oseidental.ca | At Westboro Medical & Dental Clinic. |
| 7 | Dr. Aaron Lévesque | Family doctor | +1 613 555 0134 | reception@westboroclinic.ca | At Westboro Medical & Dental Clinic. |
| 8 | Tom Reyes | Contractor | +1 613 555 0187 | tom@reyesbuild.ca | Doing the basement reno. |
| 9 | Grace Lindqvist | Work coordinator/EA | +1 613 555 0129 | grace.lindqvist@kellertfife.com | Books Robert's meetings. |
| 10 | Marcus Webb | Financial advisor | +1 613 555 0145 | marcus.webb@rbcwealth.com | Annual review + RESP for Maya/Ethan. |
| 11 | **Linda Fournier** | Neighbour, book club | **(343) 655-3227** ✓ real | **whwh2207@gmail.com** ✓ real | Plays Bob's role — the Demo 1/3 SMS + email-alert recipient. Hosts book club monthly. |
| 12 | James Okafor | College friend | +1 416 555 0177 | jamesokafor@gmail.com | Plays Hussein's role — Demo 2 layered-lookup contact (calendar event + recent email + contact info). Backfilled only, no live trigger, so no real account needed. Lives in Toronto, visiting Day 10. |
| 13 | Dr. Chloe Bennett | Vet | +1 613 555 0139 | info@westendvet.ca | Biscuit's vet. |

---

## 4. Calendar events (20)

Items marked **[LEAVE-BY]** are the Demo 4 anchor. Events tagged with a `Location #` reuse one of the 6 canonical addresses above; others are plain text, same as a real calendar.

| # | Title | When | Where | Notes |
|---|---|---|---|---|
| 1 | Team standup | Day 1, 9:00 AM (recurring weekdays) | Location #2 — Work | Recurring. |
| 2 | Dentist — Dr. Osei | Day 2, 10:00 AM | Location #6 — Westboro Medical & Dental | Recall cleaning. |
| 3 | Home reno walkthrough — Tom Reyes | Day 2, 5:30 PM | Location #1 — Home | Basement framing check. |
| 4 | 1:1 with Priya | Day 3, 2:00 PM | Location #2 — Work | Quarterly check-in. |
| 5 | **[LEAVE-BY]** Client site walkthrough — Riverside Development | Day 4, 1:30 PM | Location #3 — Client site | The Demo 4 event. |
| 6 | Coffee with James | Day 10, 3:00 PM | Bridgehead, Elgin St | During his visit — the Demo 2 recent-contact touch. |
| 7 | Ethan's soccer game | Day 5, 6:00 PM | Brewer Park, Ottawa | |
| 8 | Annual physical — Robert | Day 11, 9:30 AM | Location #6 — Westboro Medical & Dental | Dr. Lévesque. |
| 9 | Book club at Linda's | Day 8, 7:00 PM | Linda Fournier's house | |
| 10 | Financial review — Marcus Webb | Day 9, 11:00 AM | Location #2 — Work | Marcus comes to Robert's office. |
| 11 | Dinner with Elena — co-parenting check-in | Day 7, 7:00 PM | The Whalesbone, Kent St | Renamed 2026-08-01 (was "Anniversary dinner") after Elena was repositioned as ex-wife, to remove the conflict with Linda now being "wife." |
| 12 | Trip to Montreal — visit Nadia | Day 12–13 (multi-day) | Montreal, QC | All-day, spans two days — display as a range, never split. |
| 13 | James visiting Ottawa | Day 10, all day | — | All-day, no fixed time. |
| 14 | Parent-teacher conference — Ethan | Day 6, 4:30 PM | Glebe Collegiate | |
| 15 | Gym class (recurring) | Day 1, 3, 5 — 6:00 AM | Location #5 — Ottawa Athletic Club | Recurring MWF. |
| 16 | Car service — winter tires | Day 9, 8:00 AM | Minute Muffler, Merivale Rd | |
| 17 | Maya home for the weekend | Day 8, all day | — | All-day. |
| 18 | Ethan's dance/music recital | Day 13, 6:30 PM | Glebe Collegiate auditorium | |
| 19 | Vet checkup — Biscuit | Day 6, 11:00 AM | West End Vet, 1275 Carling Ave | Dr. Bennett. |
| 20 | Family dinner — planning Nadia's visit | Day 14, 6:00 PM | Location #1 — Home | |

---

## 5. Email threads (30) — 9 conversations + 21 single messages

**9 conversations** (18 messages) — each is an inbound message plus Robert's reply, giving real back-and-forth to show off thread summarization:

| # | Subject | Between | When | Gist |
|---|---|---|---|---|
| 1a/1b | Re: Basement reno — framing photos | Tom Reyes ↔ Robert | Day 1 | Tom: framing's done, photos attached (described inline), confirm outlet placement before drywall. Robert replies confirming placement. |
| 2a/2b | RE: budget review numbers | Priya Nair ↔ Robert | Day 1 | Priya asks for Q3 numbers before their 1:1. Robert confirms he'll have it ready. |
| 3a/3b | Re: Montreal trip — dates | Nadia Farah ↔ Robert | Day 2 | Nadia confirms Day 12–13 works, asks if he's driving. Robert replies: driving, arriving ~2pm. |
| 4a/4b | One more coffee before you head back? | James Okafor ↔ Robert | Day 11 | James: heading back this afternoon, one more coffee first? Robert: yes, 9am, usual place. |
| 5a/5b | Re: book club — this month's pick | Linda Fournier ↔ Robert | Day 5 | Linda confirms the book + hosting Day 8. Robert replies he'll bring wine. |
| 6a/6b | RBC Wealth — annual review reminder | Marcus Webb ↔ Robert | Day 7 | Marcus reminds him of the Day 9 review, asks for updated RESP numbers. Robert confirms he'll bring them. |
| 7a/7b | Can you grab Ethan Thursday? | Elena Sinclair ↔ Robert | Day 3 | Elena asks Robert to pick up Ethan from practice Thursday. Robert: got it, no problem. |
| 8a/8b | Coming into Ottawa next week | James Okafor ↔ Robert | Day 6 | James confirms his VIA Rail arrival time Day 10, asks for a pickup. Robert confirms he'll be there. |
| 9a/9b | Holding 30 min — budget prep | Grace Lindqvist ↔ Robert | Day 2 | Grace holds time before the 1:1 with Priya. Robert confirms the slot works. |

**21 single messages** — 8 carry a PDF (5 invoices + 3 other document types), 13 are plain notices/confirmations:

| # | Subject | From | When | Attachment | Gist |
|---|---|---|---|---|---|
| 10 | Invoice #4471 — Reyes Build | Tom Reyes | Day 2 | **invoice** | Progress invoice, $4,200.00, due Day 17. → Invoice 1 |
| 11 | Reyes Build — signed contract copy | Tom Reyes | Day 0 | **contract** | Signed basement reno agreement, scope + $18,500 total. |
| 12 | Hydro Ottawa — your bill is ready | billing@hydroottawa.com | Day 1 | **invoice** | $187.42, due Day 16. → Invoice 2 |
| 13 | Warranty registration confirmed — Bosch dishwasher | warranty@bosch-home.ca | Day 5 | **warranty** | 2-year warranty on the dishwasher bought for the reno, expiry noted. |
| 14 | Invoice — AutoCAD licenses renewal | billing@autodesk.com | Day 3 | **invoice** | Kellert & Fife's Q3 software renewal, $1,860.00, due Day 20, forwarded for Robert's approval. → Invoice 3 |
| 15 | Amazon.ca: Your order has shipped | auto-confirm@amazon.ca | Day 1 | — | Ethan's soccer cleats, arriving Day 4. |
| 16 | Amazon.ca: order receipt | auto-confirm@amazon.ca | Day 4 | **receipt** | Basement reno paint + supplies, $312.55 itemized. |
| 17 | Ottawa Athletic Club — membership renewal | billing@oac.ca | Day 4 | **invoice** | Annual renewal, $840.00, due Day 19. → Invoice 4 |
| 18 | City of Ottawa — property tax installment due | tax@ottawa.ca | Day 10 | **invoice** | Quarterly installment, $1,140.00, due Day 25. → Invoice 5 |
| 19 | Osei Dental — appointment confirmation | frontdesk@oseidental.ca | Day 1 | — | Confirms Day 2, 10 AM cleaning. |
| 20 | Your Rogers bill for July | myaccount@rogers.com | Day 2 | — | $214.99, due Day 18 — "view online," no PDF (realistic — Rogers rarely attaches one). |
| 21 | Enbridge Gas — your bill is ready | billing@enbridgegas.com | Day 9 | — | $96.30, due Day 24 — view online. |
| 22 | Your RBC Wealth statement is ready | statements@rbcwealth.com | Day 2 | — | Monthly statement notice, no dollar figure in the email body. |
| 23 | West End Vet — Biscuit's checkup reminder | info@westendvet.ca | Day 3 | — | Reminder for Day 6, mentions due vaccinations. |
| 24 | Your CRA Notice of Assessment is available | noreply@cra-arc.gc.ca | Day 6 | — | Portal notice, NOA ready to view online. |
| 25 | Your recent bloodwork results are ready | Westboro Medical & Dental Clinic | Day 7 | — | Portal notice, routine annual physical follow-up, nothing alarming. |
| 26 | Glebe Collegiate — parent-teacher booking confirmed | noreply@ocdsb.ca | Day 3 | — | Confirms Day 6, 4:30 PM slot for Ethan. |
| 27 | VIA Rail — your booking confirmation | etickets@viarail.ca | Day 8 | — | James's ticket confirmation, Robert CC'd. |
| 28 | Costco Ottawa — your recent receipt | receipts@costco.ca | Day 3 | — | Itemized grocery receipt in the email body — ties thematically to the Demo 5 list. |
| 29 | Wag N' Wash — grooming appointment confirmed | Wag N' Wash | Day 8 | — | Confirms Day 10, 2 PM slot for Biscuit. |
| 30 | Re: Ethan's recital — parking notes | Glebe Collegiate front office | Day 11 | — | Street parking logistics for Day 13. |

---

## 6. Invoices (5) — subset of the 8 PDF attachments

1. **Reyes Build** — Invoice #4471, basement reno progress billing, $4,200.00, due Day 17.
2. **Hydro Ottawa** — $187.42, due Day 16.
3. **Autodesk** — AutoCAD renewal, $1,860.00, due Day 20, billed to Kellert & Fife.
4. **Ottawa Athletic Club** — Annual membership renewal, $840.00, due Day 19.
5. **City of Ottawa** — Property tax installment, $1,140.00, due Day 25.

## 7. Other PDF attachments (3 — rounds out the 8 total)

1. **Contract** — Reyes Build signed basement renovation agreement, scope + total contract value $18,500.
2. **Warranty** — Bosch dishwasher, 2-year warranty, purchase Day 0, expires ~Day 730.
3. **Receipt** — Amazon.ca order receipt, reno supplies, $312.55 itemized.

---

## 8. Shopping lists (5)

1. **Costco run** — the Demo 5 list. Real, non-empty items: paper towels, rotisserie chicken, Biscuit's dog food (large bag), AA batteries, olive oil, frozen berries, printer paper.
2. **Weekly groceries** — milk, eggs, bread, spinach, chicken breast, pasta, coffee.
3. **Basement reno supplies** — outlet covers, caulking, paint tray liners, drywall screws, sandpaper.
4. **Ethan's back-to-school** — binders, graphing calculator, gym shoes, backpack.
5. **Nadia's visit — things to prep** — extra towels, air mattress pump, groceries for dinner, book to lend her.

---

## 9. Pre-existing alerts & reminders (2 — new, added 2026-07-23)

These are **backfilled, already-configured** rules — they exist in the account *before* filming starts, unlike Demo 1's and Demo 3's asks, which must be created live on camera. Deliberately different triggers/subject matter from those two so nothing collides with the duplicate-prevention guard.

1. **Alert (phone/SMS channel) — self + third party (Linda):** *"When I leave work, text Linda I'm on my way."* Location trigger, Location #2 (Work), direction = depart. Self-reminder ("leaving work") + a third-party SMS to Linda. Distinct from Demo 1's Home-arrival trigger (different place, different direction).
2. **Alert (email channel) — third party (Linda):** *"Every Sunday evening, email Linda the week's grocery list."* Time-based trigger, action_type = email, recipient = Linda, list-attached (reuses the "Weekly groceries" list from section 8 — same list-injection mechanism as Demo 5). Distinct from Demo 3's email-*from*-Linda trigger (this one sends *to* Linda, not from her).

If this isn't the pairing you meant by "one with phone and emails," say so and I'll adjust — this was my read of "add alert/reminder content for the active contacts without stepping on the two live demos."

---

## Open items before this becomes seed-able

All content decisions are now resolved. Twilio per-account sender number is **done** (2026-07-23 — `user_settings.twilio_from_number` added, `evaluate-rules`/`check-reminders` extended to use it, Robert's row set to +13433260166, deployed to staging). What's left is:

1. Add the `gmail.insert` OAuth scope, bump `REQUIRED_OAUTH_SCOPE_VERSION`, deploy, re-consent on Robert's account.
2. Write the seed script (contacts + calendar via Google APIs, 30 emails via Gmail insert, lists via `manage-list`, plus the 2 pre-existing alerts/reminders in section 9).
3. Generate the 8 PDF files (5 invoices + 3 other types).
