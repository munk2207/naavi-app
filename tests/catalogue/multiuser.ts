/**
 * Multi-user safety tests — generated from the matrix helper.
 *
 * Each call to multiUserMatrix() emits 2 tests (b, c) for one Edge
 * Function. Tests (a) and (d) require JWT fixtures and are deferred.
 *
 * See docs/TEST_CATALOGUE.md Category 8 for the full matrix design.
 */

import { multiUserMatrix } from '../lib/multiUserMatrix';
import type { TestCase } from '../lib/types';

// ────────────────────────────────────────────────────────────────────────────
// Per-function matrices. One line per Edge Function.
//
// Order: priority from docs/TEST_CATALOGUE.md Category 8.
// ────────────────────────────────────────────────────────────────────────────

const naaviChatMatrix = multiUserMatrix({
  fnName: 'naavi-chat',
  description: 'naavi-chat (was the Hussein-bug epicenter)',
  body: {
    system: 'You are Naavi. Reply with: {"speech": "ok", "actions": [], "pendingThreads": []}',
    messages: [{ role: 'user', content: 'echo' }],
    max_tokens: 64,
  },
  validateOk: (data) => typeof data?.rawText === 'string' && data.rawText.length > 0,
});

const manageRulesMatrix = multiUserMatrix({
  fnName: 'manage-rules',
  description: 'manage-rules op=list',
  body: { op: 'list' },
  validateOk: (data) => Array.isArray(data?.rules),
});

const sendSmsMatrix = multiUserMatrix({
  fnName: 'send-sms',
  // High-blast-radius: this fires real SMS. send-sms validates `to` and
  // `body` BEFORE user resolution (defensive design — good). For the
  // matrix we need to reach the user-resolution step, so payload must
  // be syntactically valid. We deliberately use `dryRun: true` if the
  // function supports it; otherwise we send to a non-routable test number
  // to avoid actually triggering Twilio.
  description: 'send-sms (test-only payload, no real SMS fired)',
  body: {
    to: '+15555550100', // North American "fictional" range — no carrier
    body: 'multi-user safety test — should never actually send',
    dryRun: true, // ignored if function doesn't support it
  },
  validateOk: (_data) => true,
  // Twilio returns 502 when the fictional test number is rejected. That
  // means send-sms reached Twilio (after resolving the user successfully)
  // and Twilio said no. The auth chain is the only thing this matrix
  // tests, so 502 is acceptable here.
  userResolvedStatuses: [200, 201, 202, 502],
  skipJwtTests: true,
});

const lookupContactMatrix = multiUserMatrix({
  fnName: 'lookup-contact',
  description: 'lookup-contact (Google People API access scope)',
  body: { name: 'TestNonExistentName-XYZQQ' },
  validateOk: (_data) => true, // any 2xx is fine; we don't care about the lookup result
});

const ingestNoteMatrix = multiUserMatrix({
  fnName: 'ingest-note',
  description: 'ingest-note (knowledge fragment write)',
  body: { text: 'Test fact for multi-user safety check.', source: 'auto-tester' },
  validateOk: (data) => 'fragments' in (data ?? {}),
});

const searchKnowledgeMatrix = multiUserMatrix({
  fnName: 'search-knowledge',
  description: 'search-knowledge (cross-user data leak surface)',
  body: { q: 'test', top_k: 5 },
  validateOk: (data) =>
    Array.isArray(data?.results) || Array.isArray(data?.fragments) || Array.isArray(data),
});

const globalSearchMatrix = multiUserMatrix({
  fnName: 'global-search',
  description: 'global-search (aggregates across all user data)',
  body: { query: 'test', limit: 5 },
  validateOk: (data) => Array.isArray(data?.ranked) || Array.isArray(data?.results),
});

const manageListMatrix = multiUserMatrix({
  fnName: 'manage-list',
  description: 'manage-list type=LIST_READ (non-existent list)',
  // manage-list takes `type` (uppercase action like LIST_READ / LIST_ADD)
  // and `listName` (camelCase). Both discovered via auto-tester iteration.
  body: { type: 'LIST_READ', listName: 'multiuser-test-nonexistent' },
  validateOk: (_data) => true,
});

const resolvePlaceMatrix = multiUserMatrix({
  fnName: 'resolve-place',
  description: 'resolve-place (reads user_settings.home_address)',
  body: { place_name: 'somewhere-test', save_to_cache: false },
  validateOk: (data) => typeof data?.status === 'string',
});

// Calendar functions — body user_id required. Use a far-future event so
// nothing real lands on Robert's calendar.
const createCalEventMatrix = multiUserMatrix({
  fnName: 'create-calendar-event',
  description: 'create-calendar-event (writes to user calendar)',
  body: {
    summary: 'multiuser-safety-test (delete me)',
    start: '2099-01-01T10:00:00Z',
    end: '2099-01-01T10:30:00Z',
  },
  // 401/403 (token missing/expired) is acceptable for body-userid test if
  // the test user has no Calendar OAuth — the resolution path still ran.
  validateOk: (_data) => true,
  skipJwtTests: true,
});

// ────────────────────────────────────────────────────────────────────────────
// Combined export.
// ────────────────────────────────────────────────────────────────────────────

export const multiUserTests: TestCase[] = [
  ...naaviChatMatrix,
  ...manageRulesMatrix,
  ...sendSmsMatrix,
  ...lookupContactMatrix,
  ...ingestNoteMatrix,
  ...searchKnowledgeMatrix,
  ...globalSearchMatrix,
  ...manageListMatrix,
  ...resolvePlaceMatrix,
  ...createCalEventMatrix,
];
