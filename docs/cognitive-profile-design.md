# Naavi — Cognitive Profile: Data Model Design

> Version 0.1 — March 2026
> This document defines what Naavi remembers about Robert, how it is structured, and why each piece matters.

---

## What is the Cognitive Profile?

The Cognitive Profile is Naavi's persistent memory of Robert. It is not a database of facts — it is a living map of who Robert is, how he lives, what he cares about, and how his patterns change over time.

Every conversation Robert has with Naavi reads from and writes to this profile. When Naavi notices that Robert always skips his Tuesday medication reminder but never misses Wednesday, that observation lives here. When Robert tells Naavi that his daughter calls every Sunday, that relationship lives here. When Naavi learns that Robert prefers short answers in the morning and longer conversations after dinner, that preference lives here.

The profile has **seven layers**, each answering a different question about Robert.

---

## Layer 1 — Identity

*Who is Robert, at the most stable level?*

```
identity:
  full_name:         "Robert Tremblay"
  preferred_name:    "Robert"           ← What he likes to be called
  date_of_birth:     1957-08-14
  age:               68
  location:
    city:            "Ottawa"
    province:        "ON"
    timezone:        "America/Toronto"
  language:
    primary:         "en"               ← English first
    secondary:       "fr"               ← French available anytime
    preference_note: "Switches to French for medical conversations"
  communication_style:
    formality:       "casual"           ← "Robert" not "Mr. Tremblay"
    verbosity:       "concise"          ← He wants answers, not essays
    tone:            "peer"             ← Talk to him as an equal
```

**Why this matters:** Naavi never forgets who it is talking to. It will never greet Robert in French if he started in English, unless he asks. It will not over-explain things to a sharp 68-year-old who dislikes being patronised.

---

## Layer 2 — Temporal Rhythms

*When does Robert do things? What are his daily and weekly patterns?*

```
rhythms:
  daily:
    wake_time:          "07:00"           ← Observed, not declared
    morning_routine:
      - "07:15 — coffee, news review"
      - "08:00 — medication (metformin)"
      - "08:30 — walk (weather permitting)"
    cognitive_peak:     "09:00–12:00"     ← When he is sharpest
    lunch_window:       "12:30–13:15"
    rest_period:        "14:00–14:45"     ← Do not schedule calls here
    evening_wind_down:  "21:00"
    sleep_time:         "22:30"

  weekly:
    monday:    ["gym 09:00"]
    tuesday:   ["doctor appointment (recurring, bi-monthly)"]
    wednesday: ["grocery run"]
    thursday:  []
    friday:    ["golf (weather permitting, May–October)"]
    saturday:  ["call with daughter Sophie, ~10:00"]
    sunday:    ["family dinner, variable time"]

  seasonal:
    - "Active outdoors May–October"
    - "Prefers indoor activities November–April"
    - "Travels south in February (check calendar)"

  medication_schedule:
    - name:      "Metformin 500mg"
      times:     ["08:00", "20:00"]
      with_food: true
      adherence: 0.92               ← 92% on time — observed over 90 days
```

**Why this matters:** Naavi uses rhythms to decide *when* to interrupt Robert and *when* to stay quiet. It will not push a reminder during his rest period. It will not schedule a complex task for 14:30. It will notice if he misses his morning walk three days in a row.

---

## Layer 3 — Health Context

*What does Naavi need to know about Robert's health to be useful — without replacing his doctors?*

```
health:
  conditions:
    - name:      "Type 2 Diabetes"
      status:    "managed"
      diagnosed: 2019
      notes:     "Well controlled. Diet and metformin."

    - name:      "Hypertension"
      status:    "managed"
      diagnosed: 2021
      notes:     "Lisinopril. Monitoring BP weekly."

  medications:
    - name:        "Metformin 500mg"
      purpose:     "Blood sugar"
      schedule:    "twice daily with meals"
      prescriber:  "Dr. Patel"
      refill_due:  2026-04-10        ← Naavi will remind him March 28

    - name:        "Lisinopril 10mg"
      purpose:     "Blood pressure"
      schedule:    "once daily morning"
      prescriber:  "Dr. Patel"
      refill_due:  2026-05-01

  care_team:
    - name:     "Dr. Anita Patel"
      role:     "Family Physician"
      clinic:   "Centretown Medical"
      phone:    "613-555-0192"
      next_apt: 2026-04-08

    - name:     "Dr. Marc Leblanc"
      role:     "Cardiologist"
      clinic:   "Ottawa Heart Institute"
      next_apt: 2026-06-14

  vitals_trends:                     ← Patterns, not raw numbers
    blood_pressure:  "stable, slightly elevated when stressed"
    blood_sugar:     "well controlled, spikes after pasta"
    sleep_quality:   "good, 6.5–7.5 hrs average"
    activity_level:  "moderate, 6,500 steps average"

  health_goals:
    - "Maintain A1C below 7.0"
    - "Walk 7,500 steps daily"
    - "Reduce sodium intake"

  portal_integration:
    provider:    "MyChart / Ottawa Health"
    connected:   true
    last_synced: 2026-03-14T08:30:00Z
```

**Why this matters:** Naavi does not diagnose. It orchestrates. It reminds Robert about refills before he runs out. It notices when his logged blood pressure is trending up before his next appointment. It surfaces the right information when he talks to his doctor.

---

## Layer 4 — Relationships

*Who matters to Robert? How does he stay connected to them?*

```
relationships:
  - person_id:    "rel_001"
    name:         "Sophie Tremblay"
    relation:     "daughter"
    priority:     "high"
    contact:
      phone:      "613-555-0441"
      preferred:  "phone call"
    patterns:
      typical_contact: "Saturday mornings ~10:00"
      last_contact:    2026-03-14
      frequency:       "weekly"
    notes:
      - "Lives in Montreal with husband Marc and kids Lola (8) and Theo (5)"
      - "Robert's primary emergency contact"

  - person_id:    "rel_002"
    name:         "Claude Tremblay"
    relation:     "brother"
    priority:     "medium"
    contact:
      phone:      "819-555-0872"
      preferred:  "phone call"
    patterns:
      typical_contact: "every 2–3 weeks"
      last_contact:    2026-02-28
    notes:
      - "Lives in Gatineau. They golf together in summer."

  - person_id:    "rel_003"
    name:         "Jim Kowalski"
    relation:     "friend"
    priority:     "medium"
    contact:
      preferred:  "text"
    patterns:
      typical_contact: "weekly, Monday gym"
      last_contact:    2026-03-10

  - person_id:    "rel_004"
    name:         "Dr. Anita Patel"
    relation:     "family physician"
    priority:     "high"
    contact:
      phone:      "613-555-0192"
      preferred:  "phone"
    notes:
      - "Schedule through clinic portal. Book 2 weeks ahead."

relationship_alerts:
  - "Claude hasn't been contacted in 15 days — above usual pattern"
  - "Sophie's birthday: June 3 (80 days away)"
```

**Why this matters:** Naavi notices when Robert has not spoken to someone in longer than usual. It remembers that Lola is 8 so when Sophie mentions a school play, Naavi connects the dots. It knows not to call Dr. Patel directly — to book through the portal.

---

## Layer 5 — Environment & Integrations

*Where does Robert live and what tools does he use?*

```
environment:
  home:
    address:      "Ottawa, ON"          ← No full address stored
    smart_devices:
      - type:     "thermostat"
        brand:    "Ecobee"
        id:       "ecobee_main"
        preference: "21°C daytime, 19°C night"

      - type:     "door_lock"
        brand:    "Schlage"
        id:       "schlage_front"

      - type:     "lighting"
        brand:    "Philips Hue"
        zones:    ["kitchen", "bedroom", "office"]

  frequent_locations:
    - name:     "Centretown Medical"
      type:     "medical"
      address:  "340 MacLaren St, Ottawa"
    - name:     "Loblaws Rideau"
      type:     "grocery"
    - name:     "Carleton Golf Club"
      type:     "leisure"
      season:   "May–October"

integrations:
  calendar:
    provider:   "Google Calendar"
    connected:  true
    calendars:  ["Personal", "Medical", "Family"]

  notes:
    provider:   "Apple Notes"
    connected:  true

  voice_memos:
    provider:   "native iOS"
    connected:  true

  health_portal:
    provider:   "MyChart"
    connected:  true

  email:
    provider:   "Gmail"
    connected:  false           ← Not yet connected, low priority

  banking:
    connected:  false           ← Robert chose not to connect
```

**Why this matters:** Naavi knows what tools exist and what Robert chose not to connect. It respects his banking decision — it will never ask again. When he says "turn the heat up," Naavi knows which thermostat brand to talk to.

---

## Layer 6 — Preferences & Boundaries

*How does Robert want Naavi to behave?*

```
preferences:
  interaction:
    proactive_check_ins:  true          ← Naavi can initiate, briefly
    max_daily_prompts:    3             ← No more than 3 unsolicited messages
    quiet_hours:          "22:00–07:30"
    preferred_channel:    "voice"
    fallback_channel:     "push notification"

  response_style:
    morning:    "brief, actionable"     ← "You have 2 things today."
    evening:    "reflective, warmer"    ← Can be conversational
    urgency:    "direct"               ← If something matters, say so plainly

  reminders:
    medication:   true
    appointments: true
    refills:      true
    birthdays:    true
    follow_ups:   true                  ← Things Robert said he would do

  privacy:
    share_health_data_with_family:  false   ← His data stays with him
    voice_recordings_stored:        false   ← Transcripts only, no audio
    location_tracking:              false

  language_triggers:
    switch_to_french: ["parle français", "en français"]
    switch_to_english: ["switch to English", "in English"]

boundaries:
  - "Never suggest Robert needs help he did not ask for"
  - "Never treat him as fragile or incapable"
  - "Never share health data without explicit permission"
  - "Banking and financial data: off limits, not connected"
```

**Why this matters:** Robert is sharp and independent. Naavi being condescending or over-protective is not a feature — it is a fatal flaw. These rules are enforced, not aspirational. Every AI response is filtered through them.

---

## Layer 7 — Behavioural Signals & Learned Context

*What has Naavi observed over time? What is currently in motion?*

```
signals:
  routine_deviations:
    - date:     2026-03-12
      signal:   "Morning walk skipped. Weather: clear. No explanation given."
      type:     "observation"
      followup: false

  engagement_patterns:
    most_active_hours:  ["08:30–10:00", "19:00–20:30"]
    avg_session_length: "4 minutes"
    topics_initiated_by_robert: ["weather", "appointments", "health news"]

  voice_tone_signals:
    - date:     2026-03-10
      note:     "Slightly clipped responses. Possibly fatigued or distracted."

  memory_aid_patterns:
    frequently_asked:
      - "When is my next doctor appointment?"
      - "Did I take my evening medication?"
      - "What day is it?"

pending_threads:
  - id:         "thread_001"
    created:    2026-03-10
    source:     "Robert said: 'I should call the clinic about my referral'"
    status:     "unresolved"
    followup:   "Ask Robert on March 17 if he made the call"

  - id:         "thread_002"
    created:    2026-03-13
    source:     "Medication refill due April 10"
    status:     "reminder_scheduled"
    remind_on:  2026-03-28

interests:
  - "Current events (Canadian politics, Ottawa Senators)"
  - "Golf — equipment, courses, technique"
  - "Family history research (genealogy)"
  - "French language maintenance"

profile_confidence:
  identity:   1.0     ← Fully established
  rhythms:    0.82    ← 90 days of observation
  health:     0.75    ← Partially connected to portal
  relationships: 0.68 ← Some manually entered, some observed
  environment: 0.90   ← Smart home + calendar connected
  preferences: 0.70   ← Still learning edge cases
  signals:    0.55    ← Builds over time
```

**Why this matters:** The `pending_threads` section is what makes Naavi feel like it is paying attention. When Robert mentions something in passing — "I should call the clinic" — Naavi does not let it disappear. It surfaces it gently a week later. This is orchestration.

---

## How the Profile Grows Over Time

The Cognitive Profile starts with whatever Robert chooses to share and a blank signals layer. Over the first 90 days, Naavi observes patterns without commenting on them. After 90 days, the profile has enough signal to begin anticipating rather than just responding.

| Day | Profile State |
|-----|---------------|
| 1   | Identity set. Integrations connected. Preferences declared. |
| 7   | First weekly patterns emerging. Relationship map partially filled. |
| 30  | Daily rhythms reliable. Medication adherence tracked. |
| 90  | Full rhythm model. Behavioural baselines established. Proactive mode begins. |
| 365 | Seasonal patterns complete. Anomaly detection meaningful. |

---

## What the Profile Does NOT Store

- Raw audio recordings (privacy — transcripts only)
- Financial account data (Robert's explicit boundary)
- Opinions about Robert's choices or lifestyle
- Health diagnoses or medical interpretations
- Anything Robert explicitly says to forget

---

## Key Design Principles

1. **Robert owns his data.** He can export, delete, or pause it at any time.
2. **Observation without surveillance.** Naavi notices patterns; it does not monitor Robert.
3. **Boundaries are code, not guidelines.** Privacy rules are enforced in the system, not aspirational.
4. **The profile ages gracefully.** Patterns from 3 years ago are weighted lower than patterns from last week.
5. **Confidence scores drive caution.** If Naavi is not confident about a pattern, it asks rather than assumes.
