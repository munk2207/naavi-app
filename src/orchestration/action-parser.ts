/**
 * AI Orchestration Layer — Action Parser
 *
 * Claude returns a JSON string. This module:
 * 1. Parses the JSON safely (never crashes if Claude returns something unexpected)
 * 2. Validates that every action is a known type
 * 3. Returns a clean, typed ClaudeResponse — or a safe fallback if parsing fails
 *
 * Plain English: this is the "translator" that turns Claude's raw
 * text output into structured instructions Naavi can act on.
 */

import type { ClaudeResponse, NaaviAction, PendingThread, ProfileUpdate } from './types';

// ─── Main parser ─────────────────────────────────────────────────────────────

/**
 * Parses Claude's raw text response into a typed ClaudeResponse.
 *
 * If Claude returns malformed JSON or an unexpected structure,
 * this returns a safe fallback response — Naavi will say
 * "Let me rephrase that" rather than crashing.
 */
export function parseClaudeResponse(rawText: string): ClaudeResponse {
  // Step 1: Extract JSON from the response
  // Claude sometimes wraps JSON in markdown code blocks — strip those first
  const cleaned = extractJson(rawText);

  // Step 2: Parse the JSON
  let parsed: unknown;
  try {
    parsed = JSON.parse(cleaned);
  } catch {
    console.error('[ActionParser] Failed to parse JSON from Claude response:', rawText);
    return fallbackResponse('I did not catch that — could you say it again?');
  }

  // Step 3: Validate the top-level structure
  if (!isObject(parsed)) {
    return fallbackResponse('Something went wrong on my end — please try again.');
  }

  // Step 4: Extract and validate each field
  const speech = extractSpeech(parsed);
  const actions = extractActions(parsed);
  const pendingThreads = extractPendingThreads(parsed);
  const profileUpdates = extractProfileUpdates(parsed);

  return { speech, actions, pendingThreads, profileUpdates };
}

// ─── Field extractors ─────────────────────────────────────────────────────────

function extractSpeech(obj: Record<string, unknown>): string {
  if (typeof obj.speech === 'string' && obj.speech.trim().length > 0) {
    return obj.speech.trim();
  }
  return 'I am not sure how to respond to that — could you rephrase?';
}

function extractActions(obj: Record<string, unknown>): NaaviAction[] {
  if (!Array.isArray(obj.actions)) return [];

  return obj.actions
    .map(validateAction)
    .filter((a): a is NaaviAction => a !== null);
}

function extractPendingThreads(obj: Record<string, unknown>): PendingThread[] {
  if (!Array.isArray(obj.pendingThreads)) return [];

  return obj.pendingThreads
    .filter(isObject)
    .map(t => ({
      id: typeof t.id === 'string' ? t.id : generateId(),
      description: typeof t.description === 'string' ? t.description : 'Unresolved item',
      followUpDate: typeof t.followUpDate === 'string' ? t.followUpDate : undefined,
      category: isValidThreadCategory(t.category) ? t.category : 'task',
    }));
}

function extractProfileUpdates(obj: Record<string, unknown>): ProfileUpdate[] {
  if (!Array.isArray(obj.profileUpdates)) return [];

  return obj.profileUpdates
    .filter(isObject)
    .filter(u => typeof u.field === 'string' && u.value !== undefined)
    .map(u => ({
      field: u.field as string,
      value: u.value,
      reason: typeof u.reason === 'string' ? u.reason : 'Observed during conversation',
    }));
}

// ─── Action validator ─────────────────────────────────────────────────────────

/**
 * Validates a single action from Claude's response.
 * Returns the typed action if valid, null if invalid.
 * Invalid actions are silently dropped — better to skip an action
 * than to crash the whole response.
 */
function validateAction(raw: unknown): NaaviAction | null {
  if (!isObject(raw) || typeof raw.type !== 'string') return null;

  switch (raw.type) {
    case 'SPEAK':
      if (typeof raw.text !== 'string') return null;
      return { type: 'SPEAK', text: raw.text };

    case 'SET_REMINDER':
      if (typeof raw.title !== 'string' || typeof raw.datetime !== 'string') return null;
      return {
        type: 'SET_REMINDER',
        title: raw.title,
        datetime: raw.datetime,
        notes: typeof raw.notes === 'string' ? raw.notes : undefined,
        source: typeof raw.source === 'string' ? raw.source : 'Requested by Robert',
      };

    case 'UPDATE_PROFILE':
      if (typeof raw.field !== 'string' || raw.value === undefined) return null;
      return {
        type: 'UPDATE_PROFILE',
        field: raw.field,
        value: raw.value,
        reason: typeof raw.reason === 'string' ? raw.reason : 'Observed during conversation',
      };

    case 'DRAFT_MESSAGE':
      if (
        typeof raw.to !== 'string' ||
        typeof raw.subject !== 'string' ||
        typeof raw.body !== 'string'
      ) return null;
      return {
        type: 'DRAFT_MESSAGE',
        to: raw.to,
        subject: raw.subject,
        body: raw.body,
        channel: raw.channel === 'sms' ? 'sms' : 'email',
      };

    case 'FETCH_DETAIL':
      if (typeof raw.integration !== 'string' || typeof raw.resourceId !== 'string') return null;
      return {
        type: 'FETCH_DETAIL',
        integration: raw.integration as NaaviAction extends { type: 'FETCH_DETAIL'; integration: infer I } ? I : never,
        resourceId: raw.resourceId,
        reason: typeof raw.reason === 'string' ? raw.reason : '',
      };

    case 'LOG_CONCERN':
      if (typeof raw.note !== 'string') return null;
      return {
        type: 'LOG_CONCERN',
        category: isValidConcernCategory(raw.category) ? raw.category : 'routine',
        note: raw.note,
        severity: isValidSeverity(raw.severity) ? raw.severity : 'low',
      };

    case 'SET_EMAIL_ALERT': {
      const hasFromName      = typeof raw.fromName === 'string' && raw.fromName.trim().length > 0;
      const hasFromEmail     = typeof raw.fromEmail === 'string' && raw.fromEmail.trim().length > 0;
      const hasSubjectKw     = typeof raw.subjectKeyword === 'string' && raw.subjectKeyword.trim().length > 0;
      if (!hasFromName && !hasFromEmail && !hasSubjectKw) return null;
      if (typeof raw.phoneNumber !== 'string' || !raw.phoneNumber.trim()) return null;
      return {
        type: 'SET_EMAIL_ALERT',
        fromName:        hasFromName  ? (raw.fromName as string).trim()       : undefined,
        fromEmail:       hasFromEmail ? (raw.fromEmail as string).trim()      : undefined,
        subjectKeyword:  hasSubjectKw ? (raw.subjectKeyword as string).trim() : undefined,
        phoneNumber:     (raw.phoneNumber as string).trim(),
        label:           typeof raw.label === 'string' && raw.label.trim()
                           ? raw.label.trim()
                           : buildAlertLabel(raw),
      };
    }

    default:
      console.warn('[ActionParser] Unknown action type:', raw.type);
      return null;
  }
}

function buildAlertLabel(raw: Record<string, unknown>): string {
  if (typeof raw.fromName === 'string' && raw.fromName.trim()) return `Emails from ${raw.fromName.trim()}`;
  if (typeof raw.fromEmail === 'string' && raw.fromEmail.trim()) return `Emails from ${raw.fromEmail.trim()}`;
  if (typeof raw.subjectKeyword === 'string' && raw.subjectKeyword.trim()) return `Emails with "${raw.subjectKeyword.trim()}" in subject`;
  return 'Email alert';
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function extractJson(text: string): string {
  // Remove markdown code blocks if present
  const codeBlockMatch = text.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (codeBlockMatch) return codeBlockMatch[1].trim();

  // Find the first { and last } to extract raw JSON
  const start = text.indexOf('{');
  const end = text.lastIndexOf('}');
  if (start !== -1 && end !== -1) return text.slice(start, end + 1);

  return text.trim();
}

function fallbackResponse(message: string): ClaudeResponse {
  return {
    speech: message,
    actions: [],
    pendingThreads: [],
    profileUpdates: [],
  };
}

function isObject(val: unknown): val is Record<string, unknown> {
  return typeof val === 'object' && val !== null && !Array.isArray(val);
}

function isValidThreadCategory(val: unknown): val is PendingThread['category'] {
  return ['task', 'health', 'social', 'errand'].includes(val as string);
}

function isValidConcernCategory(val: unknown): val is 'health' | 'social' | 'routine' | 'cognitive' {
  return ['health', 'social', 'routine', 'cognitive'].includes(val as string);
}

function isValidSeverity(val: unknown): val is 'low' | 'medium' | 'high' {
  return ['low', 'medium', 'high'].includes(val as string);
}

function generateId(): string {
  return Math.random().toString(36).slice(2, 10);
}
