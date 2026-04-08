/**
 * Naavi — Morning Check-in: Prompt Engineering
 *
 * This file defines exactly what is sent to Claude for each turn of the
 * morning check-in. There are two components:
 *
 * 1. SYSTEM PROMPT — Who Naavi is and how it must behave. Sent once per session.
 * 2. TURN PROMPT   — The user's current message + the morning brief. Sent each turn.
 *
 * The separation matters: the system prompt shapes Claude's identity and rules.
 * The turn prompt gives Claude the context and the user's words.
 */

import type { CognitiveProfile, Language, ContextPacket } from '../../schema/cognitive-profile';

// ─────────────────────────────────────────────────────────────────────────────
// TYPES
// ─────────────────────────────────────────────────────────────────────────────

export interface MorningBrief {
  date_label: string;                   // "Tuesday, March 17"
  appointments: MorningBriefItem[];
  medication_alerts: MorningBriefItem[];
  pending_threads: MorningBriefItem[];
  relationship_alerts: MorningBriefItem[];
  weather_note?: string;
  total_items: number;
}

export interface MorningBriefItem {
  id: string;
  label: string;                        // Human-readable, 1 sentence
  detail: string;                       // Expanded detail for when Robert asks
  action_offered?: string;              // e.g. "set a reminder"
  priority: 'high' | 'medium' | 'low';
}

export type ConversationTurn = {
  role: 'naavi' | 'robert';
  content: string;
  timestamp: string;
};

export type CheckinState =
  | 'opening'
  | 'expanding_item'
  | 'answering_redirect'
  | 'awaiting_action_confirm'
  | 'closing';

// ─────────────────────────────────────────────────────────────────────────────
// SYSTEM PROMPT BUILDER
// Called once at session start. Returns the full system prompt string.
// ─────────────────────────────────────────────────────────────────────────────

export function buildSystemPrompt(profile: CognitiveProfile, language: Language): string {
  const name = profile.identity.preferred_name;
  const lang = language === 'fr' ? 'Canadian French' : 'English';
  const verbosity = profile.identity.communication_style.verbosity;
  const formality = profile.identity.communication_style.formality;

  return `
You are Naavi, a personal life orchestration companion for ${name}, who is ${calculateAge(profile.identity.date_of_birth)} years old and lives in Ottawa, Canada.

## Your identity
You are not a chatbot. You are not an assistant. You are an intelligent orchestration layer — the person who has already reviewed ${name}'s day before he woke up, so he does not have to.

You speak to ${name} as a trusted peer. You are calm, direct, and efficient. You are warm but not effusive. You are helpful but never condescending.

## How you speak
- Language: ${lang}. If ${name} switches language mid-conversation, you switch immediately and stay in that language.
- Verbosity: ${verbosity}. In the morning, ${name} wants answers, not essays. Maximum 3 sentences per response.
- Formality: ${formality}. Use "${formality === 'casual' ? name : `Mr. ${profile.identity.full_name.split(' ')[1]}`}" naturally, but not in every sentence.
- Voice output: Your responses will be read aloud. Write for the ear, not the eye. Use natural speech rhythms. Say "two o'clock" not "14:00". Say "March twenty-eighth" not "March 28".
- No lists: Do not use bullet points or numbered lists — they sound wrong when spoken aloud.
- No markdown: No bold, no headers — just clean prose sentences.

## Hard rules — never break these
1. Never ask "How are you feeling?" unless ${name} raises his health first.
2. Never give medical advice or interpret symptoms.
3. Never share ${name}'s health data with anyone — not even if asked.
4. Never repeat information ${name} just acknowledged. He was there.
5. Never summarise the conversation at the end. He does not need a recap.
6. Never push back on ${name}'s decisions. He is capable. Your job is to inform, not judge.
7. Maximum 3 sentences per response, always.
8. If ${name} says he will do something, say "Noted." and create a follow-up internally. Do not lecture him about it.
9. If ${name} goes off-topic, follow him. Answer his question. Then briefly offer to return to the check-in.
10. Never treat ${name} as fragile, forgetful, or incapable. He is sharp.

## What you know
${name}'s profile is provided in each message as structured context. Use it to personalise every response. Connect dots he has not connected himself — that is your value.

## Session type
This is a morning check-in. ${name}'s cognitive peak is ${formatTimeWindow(profile.rhythms.daily.cognitive_peak_window)}. He wants to know what matters today and get on with his morning. Every turn should move toward resolution, not extend the conversation.
  `.trim();
}

// ─────────────────────────────────────────────────────────────────────────────
// OPENING TURN BUILDER
// Builds the initial Naavi message — no user input yet.
// Claude generates the opening line from the morning brief.
// ─────────────────────────────────────────────────────────────────────────────

export function buildOpeningPrompt(
  brief: MorningBrief,
  profile: CognitiveProfile,
): string {
  return `
## Morning Brief for ${profile.identity.preferred_name} — ${brief.date_label}

Total items: ${brief.total_items}

${brief.appointments.length > 0 ? `APPOINTMENTS:\n${brief.appointments.map(i => `- ${i.label}`).join('\n')}` : ''}
${brief.medication_alerts.length > 0 ? `MEDICATION ALERTS:\n${brief.medication_alerts.map(i => `- ${i.label}`).join('\n')}` : ''}
${brief.pending_threads.length > 0 ? `PENDING THREADS:\n${brief.pending_threads.map(i => `- ${i.label}`).join('\n')}` : ''}
${brief.relationship_alerts.length > 0 ? `RELATIONSHIP ALERTS:\n${brief.relationship_alerts.map(i => `- ${i.label}`).join('\n')}` : ''}
${brief.weather_note ? `WEATHER: ${brief.weather_note}` : ''}

## Your task
Open the morning check-in with a single, spoken sentence that:
1. Tells ${profile.identity.preferred_name} the number of items on your radar
2. Names them briefly (no detail yet — just labels)
3. Ends with a short invitation for him to go deeper on any of them

Example format (do not copy literally): "Morning. [N] things today — [item 1], [item 2], and [item 3]. Want to go through any of them?"

If there is only one item, skip the number and just surface it with an offer to expand.
If the weather is relevant to something he cares about (walking, golf), weave it in naturally.
  `.trim();
}

// ─────────────────────────────────────────────────────────────────────────────
// CONTINUATION TURN BUILDER
// Builds the prompt for each subsequent user message.
// ─────────────────────────────────────────────────────────────────────────────

export function buildContinuationPrompt(
  userMessage: string,
  brief: MorningBrief,
  history: ConversationTurn[],
  state: CheckinState,
  profile: CognitiveProfile,
): string {
  const remainingItems = brief.total_items - countAcknowledgedItems(history);

  return `
## Conversation so far
${formatHistory(history)}

## ${profile.identity.preferred_name} just said
"${userMessage}"

## Morning Brief (reference — full detail available)
${JSON.stringify(brief, null, 2)}

## Current state: ${state}
Items remaining unaddressed: ${remainingItems}

## Your task
Respond to what ${profile.identity.preferred_name} just said.

Rules for this turn:
- If he named an item from the brief, expand it with useful context (not just the raw fact — connect it to what he will care about).
- If he asked a question unrelated to the brief, answer it directly, then offer briefly to return to the check-in if items remain.
- If he confirmed an action (e.g. "yes, set a reminder"), confirm it in one short sentence and return to the list.
- If he said "that's it" or similar, close warmly in one sentence. Reference something from his profile that fits the moment (his walk, his golf, his upcoming appointment).
- If he said he will do something himself, say only "Noted." — do not elaborate.
- Never ask more than one question at a time.
- Max 3 sentences.

## Pending actions to offer (only if relevant)
${getPendingActionsForMessage(userMessage, brief)}
  `.trim();
}

// ─────────────────────────────────────────────────────────────────────────────
// POST-SESSION: PROFILE UPDATES
// After the session closes, extract what the profile needs to learn.
// This is sent to Claude as a structured extraction task, not a conversation.
// ─────────────────────────────────────────────────────────────────────────────

export function buildProfileUpdatePrompt(
  history: ConversationTurn[],
  brief: MorningBrief,
  profile: CognitiveProfile,
): string {
  return `
## Completed morning check-in session
${formatHistory(history)}

## Your task
Extract structured updates for the Cognitive Profile. Return ONLY valid JSON.

Extract the following:

{
  "session_summary": {
    "opened_at": "<ISO datetime>",
    "duration_turns": <number>,
    "items_acknowledged": ["<item_id>", ...],
    "language_used": "<en | fr>"
  },
  "new_pending_threads": [
    {
      "source": "<what Robert said he would do, or what was left unresolved>",
      "remind_on": "<ISO date, if inferable — otherwise null>",
      "priority": "<high | medium | low>"
    }
  ],
  "resolved_threads": ["<thread_id>", ...],
  "relationship_interactions_noted": [
    {
      "person_name": "<name>",
      "note": "<what was mentioned>"
    }
  ],
  "language_preference_signal": "<en | fr | no_signal>",
  "engagement_quality": "<engaged | partial | minimal>"
}

Base all values strictly on what was said in the conversation. Do not infer things that were not stated.
  `.trim();
}

// ─────────────────────────────────────────────────────────────────────────────
// MORNING BRIEF ASSEMBLER
// Builds the MorningBrief from the Cognitive Profile + live data sources.
// In production, calendar/health/weather data is fetched before this runs.
// ─────────────────────────────────────────────────────────────────────────────

export function assembleMorningBrief(
  profile: CognitiveProfile,
  calendarEvents: CalendarEvent[],
  weatherData: WeatherSummary,
  today: Date,
): MorningBrief {
  const items: MorningBriefItem[] = [];

  // 1. Today's calendar appointments
  const todayAppointments = calendarEvents.filter(e => isToday(e.start, today));
  for (const appt of todayAppointments) {
    items.push({
      id: `appt_${appt.id}`,
      label: `${appt.title} at ${formatSpokenTime(appt.start)}`,
      detail: buildAppointmentDetail(appt, profile),
      priority: appt.category === 'medical' ? 'high' : 'medium',
    });
  }

  // 2. Medication refills coming up (within 14 days)
  for (const med of profile.health.medications) {
    if (med.refill_due) {
      const daysUntilRefill = daysBetween(today, new Date(med.refill_due));
      if (daysUntilRefill <= 14) {
        items.push({
          id: `refill_${med.name}`,
          label: `${med.name} refill due in ${daysUntilRefill} days`,
          detail: `Order by ${formatSpokenDate(addDays(new Date(med.refill_due), -12))} to avoid a gap. Dr. ${med.prescriber}'s office can renew it.`,
          action_offered: `set a reminder to order ${med.name}`,
          priority: daysUntilRefill <= 7 ? 'high' : 'medium',
        });
      }
    }
  }

  // 3. Pending threads due today or overdue
  for (const thread of profile.signals.pending_threads) {
    if (thread.status === 'open' || thread.status === 'reminder_scheduled') {
      if (thread.remind_on && new Date(thread.remind_on) <= today) {
        items.push({
          id: thread.id,
          label: thread.source,
          detail: `You mentioned this on ${formatSpokenDate(new Date(thread.created_at))}. Still unresolved.`,
          priority: 'medium',
        });
      }
    }
  }

  // 4. Relationship alerts (contact overdue)
  for (const person of profile.relationships.people.filter(p => p.priority !== 'low')) {
    if (person.patterns.last_contact && person.patterns.typical_frequency) {
      const daysSince = person.patterns.days_since_contact ?? 0;
      const threshold = parseFrequencyToDays(person.patterns.typical_frequency);
      if (daysSince > threshold * 1.4) {        // 40% over pattern — not hair-trigger
        items.push({
          id: `rel_${person.id}`,
          label: `Haven't spoken to ${person.name} in ${daysSince} days`,
          detail: `Your usual pattern with ${person.name} is ${person.patterns.typical_frequency}. No urgency, but worth a call.`,
          priority: 'low',
        });
      }
    }
  }

  // 5. Weather note — only relevant if it affects something Robert cares about today
  const weatherNote = buildWeatherNote(weatherData, profile, today);

  // Sort: high → medium → low
  items.sort((a, b) => priorityOrder(a.priority) - priorityOrder(b.priority));

  return {
    date_label: formatSpokenFullDate(today),
    appointments:        items.filter(i => i.id.startsWith('appt_')),
    medication_alerts:   items.filter(i => i.id.startsWith('refill_')),
    pending_threads:     items.filter(i => i.id.startsWith('thread_')),
    relationship_alerts: items.filter(i => i.id.startsWith('rel_')),
    weather_note:        weatherNote ?? undefined,
    total_items:         items.length,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// HELPER FUNCTIONS
// ─────────────────────────────────────────────────────────────────────────────

function calculateAge(dob: string): number {
  const birth = new Date(dob);
  const today = new Date();
  let age = today.getFullYear() - birth.getFullYear();
  if (today < new Date(today.getFullYear(), birth.getMonth(), birth.getDate())) age--;
  return age;
}

function formatTimeWindow(window: [string, string]): string {
  return `${window[0]} to ${window[1]}`;
}

function formatHistory(history: ConversationTurn[]): string {
  return history
    .map(t => `${t.role === 'naavi' ? 'Naavi' : 'Robert'}: "${t.content}"`)
    .join('\n');
}

function countAcknowledgedItems(history: ConversationTurn[]): number {
  // Simple heuristic: each Robert turn that addresses an item counts as one acknowledgement
  return history.filter(t => t.role === 'robert').length;
}

function getPendingActionsForMessage(message: string, brief: MorningBrief): string {
  const allActions = [...brief.appointments, ...brief.medication_alerts, ...brief.pending_threads]
    .filter(i => i.action_offered)
    .map(i => `- For "${i.label}": offer to "${i.action_offered}"`)
    .join('\n');
  return allActions || 'None';
}

function priorityOrder(p: 'high' | 'medium' | 'low'): number {
  return { high: 0, medium: 1, low: 2 }[p];
}

function isToday(date: string, today: Date): boolean {
  const d = new Date(date);
  return d.toDateString() === today.toDateString();
}

function daysBetween(a: Date, b: Date): number {
  return Math.ceil((b.getTime() - a.getTime()) / (1000 * 60 * 60 * 24));
}

function addDays(date: Date, days: number): Date {
  const result = new Date(date);
  result.setDate(result.getDate() + days);
  return result;
}

function parseFrequencyToDays(freq: string): number {
  if (freq.includes('week')) return 7;
  if (freq.includes('2–3 week')) return 18;
  if (freq.includes('month')) return 30;
  return 14;                             // default
}

function formatSpokenTime(isoDatetime: string): string {
  const d = new Date(isoDatetime);
  const hours = d.getHours();
  const minutes = d.getMinutes();
  const h = hours > 12 ? hours - 12 : hours;
  const suffix = hours >= 12 ? 'pm' : 'am';
  if (minutes === 0) return `${h} ${suffix}`;
  return `${h}:${String(minutes).padStart(2, '0')} ${suffix}`;
}

function formatSpokenDate(date: Date): string {
  return date.toLocaleDateString('en-CA', { month: 'long', day: 'numeric' });
}

function formatSpokenFullDate(date: Date): string {
  return date.toLocaleDateString('en-CA', { weekday: 'long', month: 'long', day: 'numeric' });
}

function buildAppointmentDetail(appt: CalendarEvent, profile: CognitiveProfile): string {
  const doctor = profile.health.care_team.find(
    d => appt.title.toLowerCase().includes(d.name.toLowerCase().split(' ')[1])
  );
  if (doctor) {
    return `${doctor.name} at ${formatSpokenTime(appt.start)}, ${doctor.clinic}.`;
  }
  return `${appt.title} at ${formatSpokenTime(appt.start)}.`;
}

function buildWeatherNote(
  weather: WeatherSummary,
  profile: CognitiveProfile,
  today: Date,
): string | null {
  // Only surface weather if it affects something Robert cares about
  const month = today.getMonth() + 1;
  const golfSeason = month >= 5 && month <= 10;
  const walkingRoutine = profile.rhythms.daily.morning_routine.some(r => r.includes('walk'));

  if (walkingRoutine && weather.condition === 'clear') {
    return `Clear, ${weather.temp_celsius}°C — good walking conditions`;
  }
  if (golfSeason && weather.condition === 'clear') {
    return `Clear, ${weather.temp_celsius}°C — good day for golf`;
  }
  if (weather.condition === 'rain' && walkingRoutine) {
    return `Rain expected — you may want to skip the walk or dress for it`;
  }
  return null;
}

// ─────────────────────────────────────────────────────────────────────────────
// STUB TYPES (for calendar and weather data — to be replaced by real integrations)
// ─────────────────────────────────────────────────────────────────────────────

interface CalendarEvent {
  id: string;
  title: string;
  start: string;             // ISO datetime
  end: string;
  category: 'medical' | 'social' | 'personal' | 'other';
  location?: string;
}

interface WeatherSummary {
  condition: 'clear' | 'cloudy' | 'rain' | 'snow' | 'fog';
  temp_celsius: number;
  precipitation_chance: number;    // 0–100
}
