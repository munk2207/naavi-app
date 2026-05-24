/**
 * Assertion helpers — clear failure messages tuned for Naavi tests.
 *
 * Each helper throws on failure with a message that says what was expected
 * vs what we got, so the report is actionable without needing to read code.
 */

export function expect2xx(status: number, label: string = 'response') {
  if (status < 200 || status >= 300) {
    throw new Error(`${label}: expected 2xx status, got ${status}`);
  }
}

export function expectEqual<T>(actual: T, expected: T, label: string) {
  if (actual !== expected) {
    throw new Error(`${label}: expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
  }
}

export function expectTruthy(value: any, label: string) {
  if (!value) {
    throw new Error(`${label}: expected truthy, got ${JSON.stringify(value)}`);
  }
}

export function expectFalsy(value: any, label: string) {
  if (value) {
    throw new Error(`${label}: expected falsy, got ${JSON.stringify(value)}`);
  }
}

export function expectArrayMinLength(arr: any[], min: number, label: string) {
  if (!Array.isArray(arr)) {
    throw new Error(`${label}: expected array, got ${typeof arr}`);
  }
  if (arr.length < min) {
    throw new Error(`${label}: expected length >= ${min}, got ${arr.length}`);
  }
}

export function expectMatch(value: string, pattern: RegExp, label: string) {
  if (typeof value !== 'string' || !pattern.test(value)) {
    throw new Error(`${label}: expected to match ${pattern}, got ${JSON.stringify(value)}`);
  }
}

export function expectActionType(action: any, expected: string, label: string = 'action') {
  if (!action || typeof action !== 'object') {
    throw new Error(`${label}: expected an object with .type, got ${JSON.stringify(action)}`);
  }
  if (action.type !== expected) {
    throw new Error(`${label}: expected type='${expected}', got '${action.type}'`);
  }
}

/**
 * Throw this from a test to signal "skip" rather than fail. The runner
 * detects err.name === 'TestSkippedError' and marks status='skipped' in
 * the report instead of 'errored'. Useful when a precondition is not met
 * (e.g. OAuth tokens missing for the test user).
 */
export class TestSkippedError extends Error {
  constructor(reason: string) {
    super(reason);
    this.name = 'TestSkippedError';
  }
}

/**
 * Searches a Naavi-chat response payload for an action of the given type.
 * Naavi-chat returns rawText (JSON-shaped string) — we parse it lenient.
 */
export function findActionInRawText(rawText: string, type: string): any | null {
  if (typeof rawText !== 'string') return null;
  // Strip ```json ... ``` fences Haiku sometimes adds.
  const cleaned = rawText
    .replace(/^```(?:json)?\s*/i, '')
    .replace(/\s*```\s*$/i, '')
    .trim();
  try {
    const parsed = JSON.parse(cleaned);
    const actions = Array.isArray(parsed.actions) ? parsed.actions : [];
    return actions.find((a: any) => a?.type === type) ?? null;
  } catch {
    return null;
  }
}

/**
 * V57.11.7 — extract Claude's speech (the user-facing reply text) from
 * the rawText JSON. Used by prompt-regression tests that need to assert
 * speech content does or does not contain a phrase.
 */
export function extractSpeech(rawText: string): string {
  if (typeof rawText !== 'string') return '';
  const cleaned = rawText
    .replace(/^```(?:json)?\s*/i, '')
    .replace(/\s*```\s*$/i, '')
    .trim();
  try {
    const parsed = JSON.parse(cleaned);
    return typeof parsed.speech === 'string' ? parsed.speech : '';
  } catch {
    return '';
  }
}

/**
 * V57.11.7 — assert speech does NOT match a regex (case-insensitive
 * unless the pattern itself specifies). Throws if the rawText's speech
 * contains the pattern.
 */
export function expectSpeechNotMatch(rawText: string, pattern: RegExp, label: string) {
  const speech = extractSpeech(rawText);
  if (pattern.test(speech)) {
    throw new Error(`${label}: speech should NOT match ${pattern}, but got: "${speech.slice(0, 200)}"`);
  }
}

/**
 * B4y Phase 2 (Wael 2026-05-24) — drive a confirm-then-act 2-turn flow.
 * Per new CLAUDE.md Rule 12 + prompt RULE 23, EVERY state-changing action
 * (SET_ACTION_RULE, REMEMBER, CREATE_EVENT, LIST_*, etc.) now requires
 * the user to confirm before Naavi commits. The server-side gate in
 * naavi-chat drops state-changing actions on turn 1 (no prior confirm
 * + user-yes). This helper drives the 2 turns and returns both responses
 * so tests can assert: turn 1 should ask for confirm; turn 2 (after user
 * says yes) should emit the action.
 *
 * Usage:
 *   const { turn1, turn2 } = await chatWithConfirm(ctx, 'alert me at Walmart');
 *   const action = findActionInRawText(turn2.data?.rawText ?? '', 'SET_ACTION_RULE');
 *   expectTruthy(action, 'SET_ACTION_RULE on turn 2');
 *
 * Reuses adapters.naaviChat for both turns. The "yes" reply is hardcoded —
 * if Claude's confirm-shape ask uses a different acceptable affirmative
 * (e.g., "approved"), pass it via `confirmReply`.
 *
 * Imports from tests/lib/adapters.ts are circular-safe via dynamic import
 * to keep this helper standalone.
 */
export async function chatWithConfirm(
  ctx: any,
  userMessage: string,
  confirmReply: string = 'yes',
): Promise<{ turn1: { status: number; data: any }; turn2: { status: number; data: any } }> {
  const { adapters } = await import('./adapters');
  const r1 = await adapters.naaviChat(ctx, {
    messages: [{ role: 'user', content: userMessage }],
    max_tokens: 1024,
  });
  const r1Speech = extractSpeech(r1.data?.rawText ?? '');
  const r2 = await adapters.naaviChat(ctx, {
    messages: [
      { role: 'user',      content: userMessage },
      { role: 'assistant', content: r1Speech },
      { role: 'user',      content: confirmReply },
    ],
    max_tokens: 1024,
  });
  return { turn1: r1, turn2: r2 };
}
