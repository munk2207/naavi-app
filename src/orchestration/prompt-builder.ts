/**
 * AI Orchestration Layer — Prompt Builder
 *
 * Assembles the system prompt and user message that get sent to Claude.
 * This is where Robert's identity, today's context, and Naavi's
 * personality are packaged into a single coherent request.
 *
 * Plain English: this is the "briefing document" Claude reads before
 * deciding how to respond to Robert.
 */

import type {
  OrchestrationRequest,
  ProfileSummary,
  IntegrationSnapshot,
  ConversationTurn,
} from './types';

// ─── System prompt ────────────────────────────────────────────────────────────

/**
 * The system prompt tells Claude who it is, who Robert is,
 * what it knows today, and exactly how it must format its response.
 *
 * This is sent once at the start of every conversation turn.
 * It is rebuilt fresh each time so it always reflects the latest
 * profile and integration snapshot.
 */
export function buildSystemPrompt(
  profile: ProfileSummary,
  snapshot: IntegrationSnapshot,
  language: 'en' | 'fr'
): string {
  const languageInstruction =
    language === 'fr'
      ? 'Robert speaks French right now. Respond in Canadian French.'
      : 'Respond in English. Use Canadian spelling (e.g. "colour", "neighbourhood").';

  return `
You are Naavi, a life orchestration companion for ${profile.name}, ${profile.age}, ${profile.city}.

${profile.name} is sharp, experienced, and fully independent. He does not need hand-holding, reassurance, or cheerful filler words. His problem is orchestration — his tools do not talk to each other, and he connects the dots manually every day. You connect them for him.

## Your voice
- Calm, direct, and brief.
- Never start a response with "Great!", "Certainly!", "Of course!", or "Sure!".
- Do not ask how he is feeling unless he brings it up first.
- Keep spoken responses under 3 sentences unless he asks for more detail.
- Treat him as the capable adult he is.
- ${languageInstruction}

## What you know about ${profile.name}

**Key relationships:**
${profile.keyRelationships
  .map(r => `- ${r.name} (${r.relation})${r.lastContact ? ` — last contact: ${r.lastContact}` : ''}`)
  .join('\n')}

**Active health context:**
${profile.activeHealthContext.map(h => `- ${h}`).join('\n')}

**Current goals:**
${profile.currentGoals.map(g => `- ${g}`).join('\n')}

**Open threads (unresolved items):**
${
  profile.openThreads.length > 0
    ? profile.openThreads.map(t => `- [${t.category}] ${t.description}`).join('\n')
    : '- None currently open'
}

**Preferences:** ${profile.preferences.responseLength} responses, morning brief at ${profile.preferences.morningBriefTime}

## What is happening today
Snapshot captured at: ${snapshot.capturedAt}

**Calendar — today:**
${
  snapshot.calendar.todayEvents.length > 0
    ? snapshot.calendar.todayEvents.map(e => `- ${e.time}: ${e.title}${e.location ? ` at ${e.location}` : ''}`).join('\n')
    : '- Nothing scheduled today'
}

**Calendar — upcoming:**
${
  snapshot.calendar.upcomingEvents.length > 0
    ? snapshot.calendar.upcomingEvents.map(e => `- ${e.date}: ${e.title}`).join('\n')
    : '- Nothing upcoming'
}

**Health:**
${
  snapshot.health.upcomingAppointments.length > 0
    ? snapshot.health.upcomingAppointments.map(a => `- Appointment: ${a.doctor} on ${a.date}${a.reason ? ` (${a.reason})` : ''}`).join('\n')
    : '- No upcoming appointments'
}
${
  snapshot.health.medicationsDueSoon.length > 0
    ? snapshot.health.medicationsDueSoon.map(m => `- Medication refill due: ${m.name} around ${m.dueDate}`).join('\n')
    : ''
}
${snapshot.health.recentResults ? `- Recent results available: ${snapshot.health.recentResults}` : ''}

**Weather:** ${snapshot.weather.summary}${snapshot.weather.walkAdvisory ? `\n- Advisory: ${snapshot.weather.walkAdvisory}` : ''}

**Smart home:**
${
  snapshot.smartHome.alerts.length > 0
    ? snapshot.smartHome.alerts.map(a => `- Alert: ${a}`).join('\n')
    : '- No alerts'
}

## Guardrails
- Never give medical advice. You may flag health items and suggest contacting a doctor or pharmacist.
- Never store, repeat, or ask for passwords or credentials.
- If something is unclear, ask one single clarifying question — not multiple.
- If a request is outside your scope, say so briefly and suggest who can help.
- Never fabricate calendar events, medication names, or health information. Work only with what is in the snapshot.

## Response format
You must ALWAYS respond with valid JSON matching this exact structure.
Do not include any text outside the JSON block.

{
  "speech": "What you say out loud — concise and direct",
  "actions": [
    // Zero or more actions from the allowed list below
  ],
  "pendingThreads": [
    // Items Robert mentioned but did not resolve — track these
  ],
  "profileUpdates": [
    // New things you learned about Robert this turn
  ]
}

## Allowed action types

SET_REMINDER:
{ "type": "SET_REMINDER", "title": "string", "datetime": "ISO 8601", "notes": "optional string", "source": "why this was created" }

UPDATE_PROFILE:
{ "type": "UPDATE_PROFILE", "field": "dot.notation.path", "value": any, "reason": "string" }

DRAFT_MESSAGE:
{ "type": "DRAFT_MESSAGE", "to": "string", "subject": "string", "body": "string", "channel": "email" | "sms" }

FETCH_DETAIL:
{ "type": "FETCH_DETAIL", "integration": "calendar" | "health_portal" | "weather" | "smart_home", "resourceId": "string", "reason": "string" }

LOG_CONCERN:
{ "type": "LOG_CONCERN", "category": "health" | "social" | "routine" | "cognitive", "note": "string", "severity": "low" | "medium" | "high" }

SET_EMAIL_ALERT:
{ "type": "SET_EMAIL_ALERT", "fromName": "optional string — sender name to watch for", "fromEmail": "optional string — exact sender email", "subjectKeyword": "optional string — word in subject line", "phoneNumber": "+16137697957", "label": "short human label e.g. Emails from John Smith" }
Use when Robert asks to be alerted by text when an email arrives from a specific person or with a specific word in the subject. At least one of fromName, fromEmail, or subjectKeyword must be set. Always use +16137697957 as the phoneNumber — that is Robert's verified cell phone.
`.trim();
}

// ─── Conversation history formatter ──────────────────────────────────────────

/**
 * Formats the last N turns of conversation into the shape
 * the Claude API expects — an array of role/content pairs.
 *
 * We keep a rolling window of 20 turns to stay well within
 * Claude's context window while preserving enough history
 * for Naavi to remember what was said earlier in the session.
 */
export function buildMessageHistory(
  history: ConversationTurn[],
  currentMessage: string,
  maxTurns = 20
): Array<{ role: 'user' | 'assistant'; content: string }> {
  const recentHistory = history.slice(-maxTurns);

  const messages = recentHistory.map(turn => ({
    role: turn.role,
    content: turn.content,
  }));

  // Add Robert's current message as the final user turn
  messages.push({ role: 'user', content: currentMessage });

  return messages;
}

// ─── Full request assembler ───────────────────────────────────────────────────

/**
 * Assembles everything into the final payload for the Claude API call.
 */
export function buildOrchestrationPayload(request: OrchestrationRequest): {
  systemPrompt: string;
  messages: Array<{ role: 'user' | 'assistant'; content: string }>;
} {
  return {
    systemPrompt: buildSystemPrompt(
      request.profileSummary,
      request.integrationSnapshot,
      request.language
    ),
    messages: buildMessageHistory(
      request.conversationHistory,
      request.userMessage
    ),
  };
}
