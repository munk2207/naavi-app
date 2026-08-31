/**
 * Shared types for the auto-tester.
 */

export type TestCategory =
  | 'smoke'
  | 'chat'
  | 'rules'
  | 'contacts'
  | 'location'
  | 'calendar'
  | 'memory'
  | 'email';

export interface TestContext {
  /** Supabase project URL. */
  supabaseUrl: string;
  /** Service-role key (bypasses RLS — only valid for tests, never in client code). */
  serviceRoleKey: string;
  /** Anon key (used to mimic mobile-app auth). */
  anonKey: string;
  /** The test user's id, provisioned at suite start. */
  testUserId: string;
  /** Logger for diagnostic output during a test. */
  log: (msg: string) => void;
}

export interface TestCase {
  /** Stable id like 'location.alert-defaults-to-one-time'. */
  id: string;
  category: TestCategory;
  /**
   * Which platform this test actually verifies. Default (omitted) means
   * Mobile/shared-backend — the surface `npm run test:auto` (Gate 1) gates
   * for the APK/AAB. Set to 'voice' only for tests that call the live
   * voice server or read naavi-voice-server/ source directly — those run
   * under Gate 2 instead and are excluded from the default Gate 1 run.
   * Added 2026-08-11 after Gate 1 and Gate 2 were discovered to be the
   * same command with no actual separation — see the corresponding
   * session's memory for the incident this fixes.
   */
  platform?: 'voice';
  /** One-line summary shown in the report. */
  description: string;
  /** Optional setup before the test (e.g. insert fixture row). */
  setup?: (ctx: TestContext) => Promise<void>;
  /** The test itself. Throws on failure (with a clear message). */
  run: (ctx: TestContext) => Promise<void>;
  /** Optional cleanup after the test (regardless of pass/fail). */
  teardown?: (ctx: TestContext) => Promise<void>;
  /** Hard timeout for the whole test (ms). Default 30_000. */
  timeoutMs?: number;
}

export interface TestResult {
  id: string;
  category: TestCategory;
  description: string;
  status: 'passed' | 'failed' | 'errored' | 'timed-out' | 'skipped';
  durationMs: number;
  errorMessage?: string;
  errorStack?: string;
  /** Diagnostic log lines captured during the test. */
  log: string[];
}

export interface SuiteReport {
  startedAt: string;
  finishedAt: string;
  /**
   * Which environment this run actually tested — 'STAGING' | 'PRODUCTION' |
   * 'UNKNOWN' — and the Supabase project ref it resolved to.
   *
   * B12a (2026-08-31). The runner has printed this as a console banner since
   * 2026-07-20, added after a production AAB was built on a green run that had
   * actually tested production's stale backend. The banner fixed the console
   * and stopped there, so the same class of mistake survived in the artifact
   * the console produced: once scrollback is gone, no saved report can be
   * trusted, because nobody can tell what it was testing.
   *
   * Not hypothetical — dating B11z needed to know whether the 2026-08-22 run
   * had targeted staging or production, and that answer is unrecoverable.
   *
   * Optional so older reports still parse; absent means "written before this
   * field existed", which is itself the honest answer for them.
   */
  environment?: 'STAGING' | 'PRODUCTION' | 'UNKNOWN';
  /** Supabase project ref the run resolved to. Recorded alongside the label
   *  because the label is a translation and the ref is the fact. */
  projectRef?: string;
  durationMs: number;
  total: number;
  passed: number;
  failed: number;
  errored: number;
  timedOut: number;
  skipped: number;
  results: TestResult[];
}
