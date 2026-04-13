/**
 * voice-confirm.ts
 *
 * Voice confirmation framework for hands-free operation.
 * Robert says "yes" / "send" / "cancel" instead of tapping buttons.
 *
 * Architecture is action-type-agnostic — Phase A handles DRAFT_MESSAGE only,
 * but adding new confirmable types (CREATE_EVENT, REMEMBER, etc.) requires
 * only adding to CONFIRMABLE_ACTIONS and a summary case.
 */

import type { NaaviAction } from '@/lib/naavi-client';

// ─── Types ──────────────────────────────────────────────────────────────────

export interface PendingAction {
  id: string;
  action: NaaviAction;
  summary: string;
  execute: () => Promise<{ ok: boolean; speech: string }>;
  turnIndex: number;
}

// ─── Confirmable action types (extend for Phase B/C) ────────────────────────

export const CONFIRMABLE_ACTIONS: NaaviAction['type'][] = ['DRAFT_MESSAGE'];

export function isConfirmable(action: NaaviAction): boolean {
  return CONFIRMABLE_ACTIONS.includes(action.type);
}

// ─── Timeout ────────────────────────────────────────────────────────────────

export const CONFIRM_TIMEOUT_MS = 30000;
export const CONFIRM_SILENCE_CHUNKS = 6; // 6 × 5s = 30s

// ─── Vocabulary ─────────────────────────────────────────────────────────────

const CONFIRM_WORDS = [
  'yes', 'send', 'send it', 'go ahead', 'confirm', 'do it',
  'go', 'yeah', 'yep', 'sure', 'ok', 'okay',
];

const CANCEL_WORDS = [
  'no', 'cancel', 'stop', 'never mind', 'nevermind',
  "don't send", 'forget it', 'nope', 'no thanks',
];

/**
 * Classify a transcript as confirm, cancel, or edit (free-form change).
 * Short utterances that match vocabulary → confirm/cancel.
 * Anything else → treat as an edit instruction.
 */
export function classifyConfirmation(
  transcript: string,
): 'confirm' | 'cancel' | 'edit' {
  const lower = transcript.toLowerCase().replace(/[.,!?;:]+$/g, '').trim();
  if (!lower) return 'cancel'; // empty = silence, treat as timeout elsewhere

  // Check cancel first — "no" is shorter and more likely to be accidental
  for (const word of CANCEL_WORDS) {
    if (lower === word || lower.startsWith(word + ' ') || lower.endsWith(' ' + word)) {
      return 'cancel';
    }
  }

  for (const word of CONFIRM_WORDS) {
    if (lower === word || lower.startsWith(word + ' ') || lower.endsWith(' ' + word)) {
      return 'confirm';
    }
  }

  // Anything else is a free-form edit
  return 'edit';
}

// ─── Summary builders ───────────────────────────────────────────────────────

/**
 * Build a spoken summary for a pending action.
 * Used as a fallback if Claude's speech doesn't include a confirmation prompt.
 */
export function buildActionSummary(action: NaaviAction): string {
  switch (action.type) {
    case 'DRAFT_MESSAGE': {
      const to = String(action.to ?? '');
      const channel = String(action.channel ?? 'email').toLowerCase();
      const subject = String(action.subject ?? '');

      if (channel === 'email') {
        return subject
          ? `I've drafted an email to ${to} about ${subject}. Say yes to send, or tell me what to change.`
          : `I've drafted an email to ${to}. Say yes to send, or tell me what to change.`;
      }
      const label = channel === 'whatsapp' ? 'WhatsApp' : 'text message';
      return `I've drafted a ${label} to ${to}. Say yes to send, or tell me what to change.`;
    }

    // Phase B+ — add cases here:
    // case 'CREATE_EVENT': { ... }
    // case 'REMEMBER': { ... }
    // case 'DELETE_EVENT': { ... }

    default:
      return 'Should I go ahead? Say yes or no.';
  }
}

// ─── Spoken outcome messages ────────────────────────────────────────────────

export const SPEECH = {
  CANCELLED: 'OK, cancelled.',
  TIMEOUT: "I didn't hear a confirmation. The draft is still here when you're ready.",
  GENERIC_ERROR: 'Something went wrong. The draft is still here.',
  SENT: 'Sent.',
} as const;
