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
