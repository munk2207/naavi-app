# MyNaavi — Client Quick Reference

**Who this is for:** a client (Robert, or any user) calling MyNaavi at +1 249 523 5394. Print it, put it by the phone.

**Legend:**
- 🔗 **Orchestrated** — one command, Naavi chains multiple services together behind the scenes. These are the most valuable commands.
- • **Single service** — one simple service lookup.

---

## 📅 Schedule & Calendar
- • *"What's on my schedule today?"*
- • *"What do I have this week?"*
- • *"Am I free Tuesday afternoon?"*
- 🔗 *"Add a doctor appointment with Dr. Smith on Friday at two."* (parses time + date + person → looks up the doctor in contacts → creates calendar event → can set a reminder)
- 🔗 *"When should I leave for my three pm meeting?"* (reads calendar → looks up location → checks travel time via Maps → accounts for traffic)
- • *"Move my dentist visit to next Monday."*

## 👥 Contacts & People
- 🔗 *"Tell me about Fatma."* (searches contacts + calendar history + recorded-conversation memory all at once)
- 🔗 *"Who is John?"* (same multi-source lookup)
- • *"What's Sarah's phone number?"*

If Naavi mishears a name, spell it NATO-style:
- *"Tell me about F like Frank, A like Apple, T like Tom, M like Mary, A like Apple."*

## 📧 Email
- • *"Do I have any important emails?"*
- • *"What's my most recent email?"*
- 🔗 *"Email Sarah about tomorrow's lunch."* (looks up Sarah's email → drafts the message → confirms with you → sends)
- 🔗 *"Reply to John saying I'll call him tonight."*

## 💬 Messages (SMS & WhatsApp)
- 🔗 *"Text my wife that I'm running late."* (resolves "wife" from contacts → picks SMS → sends)
- 🔗 *"Send a WhatsApp to John saying I'll be there in thirty minutes."* (resolves John → picks WhatsApp → formats template → sends)

## 🎙️ Conversation Recording — flagship orchestration
- *"Record my visit."* (starts recording)
- Have the conversation naturally — Naavi stays silent.
- *"Naavi stop."* (ends recording)
- Naavi asks title + participants. If a name is hard, say *"no, spell it"*.

After ending, ONE command triggers **all of this automatically**:
1. 🔗 Audio downloaded from phone carrier
2. 🔗 Full transcription via AssemblyAI
3. 🔗 Claude extracts appointments, prescriptions, tasks, tests
4. 🔗 Every prescription becomes daily calendar reminders
5. 🔗 Every appointment becomes a calendar event
6. 🔗 Summary saved to Google Drive (in your `MyNaavi` folder)
7. 🔗 Email with title, participants, summary, action counts, Drive link
8. 🔗 SMS + WhatsApp + push notification to let you know it's ready
9. 🔗 Participants indexed to memory — you can ask about them later

**This is the strongest demonstration of Naavi's orchestration.**

## 🧠 Memory & Knowledge
- 🔗 *"Tell me about my last visit with Dr. Smith."* (searches recorded conversations + calendar + notes)
- 🔗 *"What did Fatma say about my knee?"* (searches indexed conversation content)
- • *"Remember I prefer afternoon appointments."*
- • *"Forget that I drink coffee — I switched to tea."*

## 🛒 Lists (shopping, todos)
- • *"Add milk to my shopping list."*
- • *"What's on my grocery list?"*
- • *"Read me my shopping list."*
- • *"Remove bread from the list."*

## 💊 Medications
- 🔗 When a recorded doctor visit mentions a prescription, Naavi automatically:
  - Parses dosage and schedule
  - Creates daily calendar reminders for the full duration
  - Stores the medication plan in memory
- • *"When do I need to take my next pill?"*
- • *"What medications am I on?"*

## 🌤️ Weather
- • *"What's the weather today?"*
- • *"Will it rain tomorrow?"*

## 🚗 Travel Time
- • *"How long to drive to the clinic?"*
- 🔗 *"When should I leave for my next appointment?"* (calendar + location + Maps traffic)

## 📝 Notes (Google Drive)
- • *"Save a note called medication schedule..."*
- 🔗 *"Find my note about the house."* (searches memory AND your `MyNaavi` Drive folder)
- All notes saved in the **MyNaavi** folder — searchable from any device's Drive app.

## 🌅 Morning Brief — scheduled orchestration
Auto-delivered by phone at your set morning-call time. One call combines:
1. 🔗 Calendar for today
2. 🔗 Weather
3. 🔗 Important overnight emails
4. 🔗 Medication reminders
5. 🔗 Action-item follow-ups

Interrupt anytime: *"stop"*, *"skip ahead"*, *"tell me more"*.

---

## Summary — where orchestration shines

The 🔗 commands are where Naavi is doing something no single app can do alone:

| Command | Services chained |
|---|---|
| Conversation recording | Audio → Transcription → Claude → Calendar + Drive + Email + SMS + WhatsApp + Memory |
| "When should I leave for…" | Calendar + Maps + Traffic |
| "Add appointment with Dr. X" | Parse + Contacts + Calendar |
| "Tell me about X" | Contacts + Calendar + Memory + Drive |
| "Text my wife…" | Contacts (alias resolution) + SMS |
| Morning brief | Calendar + Weather + Email + Reminders |
| Medication from visit | Transcription + Claude + Calendar recurring events |

Single-service commands (• in the list) are convenience; orchestration (🔗) is the product.

---

*Document created April 17, 2026. Keep this printed beside the phone.*
