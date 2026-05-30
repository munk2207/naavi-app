/**
 * Session 2026-05-29 — regression coverage for B-NEW-4, nav-disambiguation (v101),
 * and the OAuth scope-version gate.
 *
 * B-NEW-4: Stop button tap did not stop TTS audio on Android.
 * Root cause: stopSpeaking() fired _pendingPlaybackCleanup (= cleanupAndResolve)
 * which sets _currentSound = null. By the time the `if (_currentSound)` block ran,
 * _currentSound was already null → stopAsync() was never called. Only unloadAsync()
 * ran (async/fire-and-forget from cleanupAndResolve), which does not reliably halt
 * active playback immediately on Android.
 * Fix: capture _currentSound into soundToStop BEFORE calling _pendingPlaybackCleanup
 * so stopAsync() is always called on the live Sound object.
 *
 * OAuth scope-version gate: when Google OAuth scopes change between app versions,
 * users with stale tokens must re-authenticate to get the new scopes. The gate
 * stores REQUIRED_OAUTH_SCOPE_VERSION in AsyncStorage and signs the user out
 * silently on startup if their token was issued under an older scope set.
 * Fix: checkOAuthScopeVersion() in lib/supabase.ts; called on startup in
 * app/index.tsx before setting isSignedIn=true; markOAuthScopeVersionCurrent()
 * called after SIGNED_IN event to record the current version.
 * REQUIRED_OAUTH_SCOPE_VERSION = 2 (contacts write scope added for Community).
 *
 * Nav-disambiguation v101: prompt rule prevents Naavi from re-asking "which one?"
 * after she has already identified a unique meeting with a physical location. Tested
 * via prompt version check (also covered in session-2026-05-27 and session-2026-05-28).
 *
 * Coverage gaps acknowledged (Rule 15a exception):
 *   B-NEW-4 live: TTS stop behavior is Android-native audio (expo-av Sound object).
 *   Not reachable from the Node.js auto-tester. Covered by static code pattern check;
 *   Wael verifies live by tapping Stop mid-speech on Samsung device.
 *
 *   OAuth scope gate live: AsyncStorage behavior is React Native client-side.
 *   Not reachable from the Node.js auto-tester. Covered by static code checks
 *   (constant value, helper presence, app/index.tsx wiring). Wael verifies live
 *   on next APK install — existing install should be redirected to sign-in screen.
 *
 * Run via `npm run test:auto -- --grep session-2026-05-29`.
 */

import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { expectTruthy, expectFalsy } from '../lib/assertions';
import type { TestCase } from '../lib/types';

const FIXTURES_PATH      = join(process.cwd(), 'tests', 'lib', 'fixtures.ts');
const CREATE_CAL_PATH    = join(process.cwd(), 'supabase', 'functions', 'create-calendar-event', 'index.ts');
const DELETE_CAL_PATH    = join(process.cwd(), 'supabase', 'functions', 'delete-calendar-event', 'index.ts');

const ORCHESTRATOR_PATH  = join(process.cwd(), 'hooks', 'useOrchestrator.ts');
const APP_INDEX_PATH_B207 = join(process.cwd(), 'app', 'index.tsx');
const CONTACTS_ADAPTER_PATH = join(process.cwd(), 'supabase', 'functions', 'global-search', 'adapters', 'contacts.ts');

const SUPABASE_LIB_PATH = join(process.cwd(), 'lib', 'supabase.ts');
const APP_INDEX_PATH    = join(process.cwd(), 'app', 'index.tsx');

export const session2026_05_29Tests: TestCase[] = [
  // ─── B-NEW-4: Stop button stopAsync fix ────────────────────────────────────
  {
    id: 'session-2026-05-29.b-new-4-stopspeaking-captures-sound-before-cleanup',
    category: 'session-2026-05-29',
    description:
      'B-NEW-4 — stopSpeaking() must capture _currentSound into soundToStop BEFORE ' +
      'invoking _pendingPlaybackCleanup. The cleanup callback sets _currentSound = null, ' +
      'so without this capture stopAsync() was never called.',
    timeoutMs: 1_000,
    async run() {
      const src = readFileSync(ORCHESTRATOR_PATH, 'utf8');
      // The fix pattern: soundToStop is assigned from _currentSound before the
      // _pendingPlaybackCleanup block.
      expectTruthy(
        src.includes('const soundToStop = _currentSound'),
        'stopSpeaking() must capture _currentSound into soundToStop before cleanup — B-NEW-4 fix',
      );
      expectTruthy(
        src.includes('soundToStop.stopAsync()'),
        'stopSpeaking() must call stopAsync() on soundToStop — B-NEW-4 fix',
      );
    },
  },
  {
    id: 'session-2026-05-29.b-new-4-stopspeaking-clears-current-sound-early',
    category: 'session-2026-05-29',
    description:
      'B-NEW-4 — stopSpeaking() must null _currentSound before the cleanup callback ' +
      'so that if cleanupAndResolve also tries to null it, both are safe no-ops.',
    timeoutMs: 1_000,
    async run() {
      const src = readFileSync(ORCHESTRATOR_PATH, 'utf8');
      // After the capture, _currentSound must be nulled so concurrent calls
      // don't double-stop the same Sound object.
      const captureIdx = src.indexOf('const soundToStop = _currentSound');
      const clearIdx   = src.indexOf('_currentSound = null', captureIdx);
      const cleanupIdx = src.indexOf('_pendingPlaybackCleanup', captureIdx);
      expectTruthy(captureIdx >= 0, 'soundToStop capture must exist');
      expectTruthy(
        clearIdx >= 0 && clearIdx < cleanupIdx,
        '_currentSound must be nulled before _pendingPlaybackCleanup fires — prevents double-stop',
      );
    },
  },
  {
    id: 'session-2026-05-29.b-new-4-stopspeaking-uses-soundtostop-guard',
    category: 'session-2026-05-29',
    description:
      'B-NEW-4 — stopSpeaking() must use `if (soundToStop)` guard (not `if (_currentSound)`). ' +
      'The old guard was always false because cleanupAndResolve nulled _currentSound first.',
    timeoutMs: 1_000,
    async run() {
      const src = readFileSync(ORCHESTRATOR_PATH, 'utf8');
      const fnStart = src.indexOf('export function stopSpeaking()');
      expectTruthy(fnStart >= 0, 'stopSpeaking function must exist');
      // 2000 chars covers the full function body including the soundToStop block.
      const fnBody = src.slice(fnStart, fnStart + 2000);
      expectTruthy(
        fnBody.includes('if (soundToStop)'),
        'stopSpeaking() must use `if (soundToStop)` guard — B-NEW-4 fix',
      );
      // The actual code guard `if (_currentSound)` must not appear in the executable
      // part of the function (comments may reference it; we check the region after
      // the last comment block, which starts with `if (soundToStop)`).
      const soundToStopGuardIdx = fnBody.indexOf('if (soundToStop)');
      const afterGuard = fnBody.slice(soundToStopGuardIdx);
      expectFalsy(
        afterGuard.includes('if (_currentSound)'),
        'No `if (_currentSound)` guard should appear after the soundToStop block',
      );
    },
  },

  // ─── OAuth scope-version gate ──────────────────────────────────────────────
  {
    id: 'session-2026-05-29.oauth-scope-version-constant-is-2',
    category: 'session-2026-05-29',
    description:
      'OAuth scope gate — REQUIRED_OAUTH_SCOPE_VERSION must be 2 (contacts write scope ' +
      'added for MyNaavi Community 2026-05-29). Increment this when scopes change again.',
    timeoutMs: 1_000,
    async run() {
      const src = readFileSync(SUPABASE_LIB_PATH, 'utf8');
      expectTruthy(
        src.includes('REQUIRED_OAUTH_SCOPE_VERSION = 2'),
        'lib/supabase.ts must have REQUIRED_OAUTH_SCOPE_VERSION = 2',
      );
    },
  },
  {
    id: 'session-2026-05-29.oauth-scope-gate-helpers-exist',
    category: 'session-2026-05-29',
    description:
      'OAuth scope gate — lib/supabase.ts must export checkOAuthScopeVersion() and ' +
      'markOAuthScopeVersionCurrent() so app/index.tsx can wire the gate.',
    timeoutMs: 1_000,
    async run() {
      const src = readFileSync(SUPABASE_LIB_PATH, 'utf8');
      expectTruthy(
        src.includes('export async function checkOAuthScopeVersion'),
        'lib/supabase.ts must export checkOAuthScopeVersion()',
      );
      expectTruthy(
        src.includes('export async function markOAuthScopeVersionCurrent'),
        'lib/supabase.ts must export markOAuthScopeVersionCurrent()',
      );
    },
  },
  {
    id: 'session-2026-05-29.oauth-scope-gate-wired-in-startup',
    category: 'session-2026-05-29',
    description:
      'OAuth scope gate — app/index.tsx startup must call checkOAuthScopeVersion() ' +
      'before setting isSignedIn=true, and markOAuthScopeVersionCurrent() after SIGNED_IN.',
    timeoutMs: 1_000,
    async run() {
      const src = readFileSync(APP_INDEX_PATH, 'utf8');
      expectTruthy(
        src.includes('checkOAuthScopeVersion'),
        'app/index.tsx must call checkOAuthScopeVersion() in startup useEffect',
      );
      expectTruthy(
        src.includes('markOAuthScopeVersionCurrent'),
        'app/index.tsx must call markOAuthScopeVersionCurrent() after SIGNED_IN',
      );
      // SIGNED_IN handler must call markOAuthScopeVersionCurrent() unconditionally
      // (provider_refresh_token guard was removed 2026-05-29 — the guard caused
      // repeated sign-outs when provider_refresh_token was absent on emulator/test accounts).
      const signedInIdx = src.indexOf("event === 'SIGNED_IN'");
      expectTruthy(signedInIdx >= 0, 'SIGNED_IN handler must exist');
      const signedInBlock = src.slice(signedInIdx, signedInIdx + 400);
      expectTruthy(
        signedInBlock.includes('markOAuthScopeVersionCurrent'),
        'markOAuthScopeVersionCurrent() must be called inside the SIGNED_IN block (not gated by provider_refresh_token)',
      );
    },
  },

  // ─── Calendar cleanup fixes ────────────────────────────────────────────────
  {
    id: 'session-2026-05-29.calendar-events-in-owned-tables',
    category: 'session-2026-05-29',
    description:
      'calendar_events must be in OWNED_TABLES so teardown clears DB rows each run. ' +
      'Without this, stale rows accumulate indefinitely.',
    timeoutMs: 1_000,
    async run() {
      const src = readFileSync(FIXTURES_PATH, 'utf8');
      expectTruthy(
        src.includes("'calendar_events'"),
        "fixtures.ts OWNED_TABLES must include 'calendar_events'",
      );
    },
  },
  {
    id: 'session-2026-05-29.create-calendar-event-onconflict-compound-key',
    category: 'session-2026-05-29',
    description:
      'create-calendar-event upsert must use onConflict: "user_id,google_event_id" (the ' +
      'actual DB UNIQUE constraint). The single-column "google_event_id" key caused the ' +
      'upsert to fail silently on every call — no calendar_events DB rows were written.',
    timeoutMs: 1_000,
    async run() {
      const src = readFileSync(CREATE_CAL_PATH, 'utf8');
      expectTruthy(
        src.includes("onConflict: 'user_id,google_event_id'"),
        "create-calendar-event must use onConflict: 'user_id,google_event_id'",
      );
      expectFalsy(
        src.includes("onConflict: 'google_event_id'"),
        "create-calendar-event must NOT use single-column 'google_event_id' conflict key",
      );
    },
  },
  {
    id: 'session-2026-05-29.delete-calendar-event-single-events-true',
    category: 'session-2026-05-29',
    description:
      'delete-calendar-event must use singleEvents=true in event list queries. ' +
      'singleEvents=false caused freshly created events to not appear in list results, ' +
      'so teardown always returned deleted:0.',
    timeoutMs: 1_000,
    async run() {
      const src = readFileSync(DELETE_CAL_PATH, 'utf8');
      expectFalsy(
        src.includes('singleEvents=false'),
        'delete-calendar-event must not use singleEvents=false',
      );
      expectTruthy(
        src.includes('singleEvents=true'),
        'delete-calendar-event must use singleEvents=true',
      );
    },
  },
  {
    id: 'session-2026-05-29.fixtures-status-400-logging',
    category: 'session-2026-05-29',
    description:
      'fixtures.ts calendar cleanup must log status >= 400 responses (not > 400). ' +
      'The old condition `status >= 400 && status !== 400` silently swallowed HTTP 400 errors.',
    timeoutMs: 1_000,
    async run() {
      const src = readFileSync(FIXTURES_PATH, 'utf8');
      expectFalsy(
        src.includes('status >= 400 && status !== 400'),
        'fixtures.ts must not have the silent-400 condition — use `status >= 400`',
      );
      expectTruthy(
        src.includes('if (status >= 400)'),
        'fixtures.ts calendar cleanup must log all HTTP error responses',
      );
    },
  },

  // ─── B-NEW-3: stop TTS before opening mic ─────────────────────────────────
  {
    id: 'session-2026-05-29.b-new-3-stop-tts-before-mic',
    category: 'session-2026-05-29',
    description:
      'B-NEW-3 — mic button handler must call stopSpeaking() before startRecording(). ' +
      'Without this, active TTS audio echoes into the mic, garbling the transcript.',
    timeoutMs: 1_000,
    async run() {
      const src = readFileSync(APP_INDEX_PATH_B207, 'utf8');
      // Find the mic button onPress handler — identified by the 300ms delay comment.
      const markerIdx = src.indexOf('B-NEW-3: stop any active TTS before opening the mic');
      expectTruthy(markerIdx >= 0, 'B-NEW-3 fix marker must exist in app/index.tsx mic handler');
      const region = src.slice(markerIdx, markerIdx + 600);
      expectTruthy(
        region.includes('stopSpeaking()'),
        'stopSpeaking() must be called before startRecording() — B-NEW-3 fix',
      );
      expectTruthy(
        region.includes('startRecording()'),
        'startRecording() must be called after stopSpeaking() inside setTimeout — B-NEW-3 fix',
      );
    },
  },

  // ─── Build 207 fixes ───────────────────────────────────────────────────────
  {
    id: 'session-2026-05-29.community-resource-name-in-presearch-context',
    category: 'session-2026-05-29',
    description:
      'B6d — pre-search contact context must include resource_name so Claude can ' +
      'populate contact_resource_name when calling add_to_community. Without this, ' +
      'the tool was called with an empty string and Google API returned 200 OK silently.',
    timeoutMs: 1_000,
    async run() {
      const src = readFileSync(ORCHESTRATOR_PATH, 'utf8');
      expectTruthy(
        src.includes('meta?.resource_name'),
        'useOrchestrator pre-search contact formatting must include resource_name from metadata',
      );
      expectTruthy(
        src.includes('resource_name:${meta.resource_name}'),
        'useOrchestrator must append [resource_name:...] to contact lines so Claude has it',
      );
    },
  },
  // ─── B6e: enrichedUserMessage persisted in history ───────────────────────
  {
    id: 'session-2026-05-29.b6e-enriched-message-stored-in-turn',
    category: 'session-2026-05-29',
    description:
      'B6e — ConversationTurn must have enrichedUserMessage field so resource_name ' +
      'from pre-search context persists in conversation history across turns. ' +
      'Root cause: enrichedMessage (with [resource_name:...]) was sent to Claude on ' +
      'turn 1 but NOT stored in history — on turn 2 Claude had no resource_name and ' +
      'called add_to_community with empty string, silently failing.',
    timeoutMs: 1_000,
    async run() {
      const src = readFileSync(ORCHESTRATOR_PATH, 'utf8');
      expectTruthy(
        src.includes('enrichedUserMessage?: string'),
        'ConversationTurn must have enrichedUserMessage field — B6e fix',
      );
      expectTruthy(
        src.includes('enrichedUserMessage ?? t.userMessage'),
        'historyRef must use enrichedUserMessage ?? userMessage so resource_name persists — B6e fix',
      );
      expectTruthy(
        src.includes('enrichedUserMessage: enrichedMessage !== userMessage ? enrichedMessage : undefined'),
        'newTurn must store enrichedUserMessage when enrichedMessage differs from userMessage — B6e fix',
      );
    },
  },
  {
    id: 'session-2026-05-29.bottom-buttons-right-align-no-margin-auto',
    category: 'session-2026-05-29',
    description:
      'B6d — actionButtonsRight must NOT use marginLeft:auto (caused Yoga layout bug ' +
      'where buttons disappeared). Right-alignment is achieved via conditional ' +
      'justifyContent on actionButtonsRow.',
    timeoutMs: 1_000,
    async run() {
      const src = readFileSync(APP_INDEX_PATH_B207, 'utf8');
      expectFalsy(
        src.includes("marginLeft: 'auto'"),
        'actionButtonsRight must not use marginLeft:auto — use conditional justifyContent instead',
      );
      expectTruthy(
        src.includes("justifyContent: 'flex-end'"),
        'actionButtonsRow must use justifyContent:flex-end when Stop button is hidden',
      );
    },
  },

  // ─── Community two-phase search (B-community-arch 2026-05-29) ───────────────
  {
    id: 'session-2026-05-29.community-phase1-queries-db-before-people-api',
    category: 'session-2026-05-29',
    description:
      'Community two-phase search — contacts adapter must query community_members from ' +
      'Supabase BEFORE fetching from Google People API. If Phase 1 hits are found, ' +
      'Phase 2 (People API) must be skipped entirely.',
    timeoutMs: 1_000,
    async run() {
      const src = readFileSync(CONTACTS_ADAPTER_PATH, 'utf8');
      // Phase 1 block must be present.
      expectTruthy(
        src.includes("'community_members'"),
        "contacts adapter must query community_members table (Phase 1)",
      );
      expectTruthy(
        src.includes('Phase 1: community DB'),
        "contacts adapter must have Phase 1 community DB comment",
      );
      // Phase 1 must appear BEFORE the Phase 2 (People API) block in source order.
      // Note: the file also has from('user_tokens') in isConnected (before search),
      // so we only compare phase markers — not the first user_tokens occurrence.
      const phase1Idx = src.indexOf('Phase 1: community DB');
      const phase2Idx = src.indexOf('Phase 2: Google People API');
      expectTruthy(phase1Idx >= 0, 'Phase 1 marker must exist');
      expectTruthy(phase2Idx >= 0, 'Phase 2 marker must exist');
      expectTruthy(
        phase1Idx < phase2Idx,
        'Phase 1 community DB query must come before Phase 2 (People API) in source order',
      );
      // Early-return when community hits found.
      expectTruthy(
        src.includes('communityHits.length > 0'),
        'contacts adapter must early-return communityHits when Phase 1 finds results',
      );
    },
  },
  {
    id: 'session-2026-05-29.community-phase1-metadata-is-community-true',
    category: 'session-2026-05-29',
    description:
      'Community two-phase search — Phase 1 results must have is_community: true in ' +
      'metadata so the prompt framing rule can detect them and say "I found X in your ' +
      'MyNaavi community" instead of "I found X in your contacts".',
    timeoutMs: 1_000,
    async run() {
      const src = readFileSync(CONTACTS_ADAPTER_PATH, 'utf8');
      // The communityHits push must set is_community: true.
      const communityPushIdx = src.indexOf('communityHits.push(');
      expectTruthy(communityPushIdx >= 0, 'communityHits.push must exist in Phase 1');
      const pushBlock = src.slice(communityPushIdx, communityPushIdx + 600);
      expectTruthy(
        pushBlock.includes('is_community: true'),
        'Phase 1 community hits must set is_community: true in metadata',
      );
    },
  },
  {
    id: 'session-2026-05-29.community-framing-rule-in-prompt',
    category: 'session-2026-05-29',
    description:
      'Community two-phase search — get-naavi-prompt must instruct Claude to frame ' +
      'community hits as "found in your MyNaavi community" (not "found in your contacts"). ' +
      'This framing rule replaces the old boost-and-rank-first approach.',
    timeoutMs: 1_000,
    async run() {
      const PROMPT_PATH = join(process.cwd(), 'supabase', 'functions', 'get-naavi-prompt', 'index.ts');
      const src = readFileSync(PROMPT_PATH, 'utf8');
      expectTruthy(
        src.includes('is_community: true'),
        'get-naavi-prompt must reference is_community: true metadata flag',
      );
      expectTruthy(
        src.includes('in your MyNaavi community'),
        'get-naavi-prompt must instruct community framing in search results',
      );
      expectTruthy(
        src.includes('two-phase'),
        'get-naavi-prompt must document the two-phase search architecture',
      );
    },
  },

  // ─── B6f: contacts adapter AND-logic for multi-token name queries ──────────
  {
    id: 'session-2026-05-29.b6f-contacts-name-match-and-logic-for-multi-token',
    category: 'session-2026-05-29',
    description:
      'B6f — contacts adapter nameTokenMatch must use AND logic for multi-token queries ' +
      '(tokens.size >= 2). OR logic caused "sarah davidson" to match "sarah james" on ' +
      'the "sarah" token alone, surfacing the wrong contact.',
    timeoutMs: 1_000,
    async run() {
      const src = readFileSync(CONTACTS_ADAPTER_PATH, 'utf8');
      // Positive: AND logic for multi-token path must exist.
      expectTruthy(
        src.includes('tokens.size >= 2') && src.includes('.every(t => nameLower.includes(t))'),
        'contacts adapter must use every() (AND) for multi-token name queries — B6f fix',
      );
      // Negative: the old top-level OR pattern must be gone.
      // (Single-token .some() is still valid — we check the old combined assignment is absent.)
      expectFalsy(
        src.includes('tokens.size > 0 && [...tokens].some(t => nameLower.includes(t))'),
        'contacts adapter must not use old OR-only nameTokenMatch assignment — B6f fix',
      );
      // Email match must be disabled for multi-token queries (prevents "sarah@gmail.com"
      // from matching query "sarah james" on the "sarah" token alone).
      expectTruthy(
        src.includes('tokens.size <= 1') && src.includes('return false'),
        'contacts adapter email match must disable token-matching for multi-token queries',
      );
    },
  },
];
