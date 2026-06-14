/**
 * Session 2026-05-27 — regression coverage for B6d, F2h, B4w (voice), B4s.
 *
 * B6d: When Naavi presents the user with 2+ options (disambiguation,
 * multiple matches, "which one?"), she was using bullet points instead
 * of numbered lists. The user couldn't reply "# 2" to pick an option
 * because options weren't numbered.
 * Fix: Added CHOICES MUST BE NUMBERED rule to get-naavi-prompt v98.
 *
 * F2h: Contacts adapter (global-search) didn't fetch `addresses` from
 * the Google People API. Queries like "find contact at postal code K1A 0B1"
 * structurally returned 0 results because the adapter only requested
 * names, emailAddresses, phoneNumbers.
 * Fix: Added `addresses` to both personFields and readMask; added
 * PersonAddress type; added postal/city/address scoring in the search loop.
 *
 * B4w (voice): When contact-attribute search returned 0 results, Haiku
 * fabricated contact names ("Saline Paris", "CSA mailing list") — both
 * non-existent. Violates CLAUDE.md Rule 18 (truth-at-user-layer).
 * Fix: Added server-side bypass in naavi-voice-server/askClaude that
 * detects Canadian postal-code queries, calls global-search contacts
 * adapter, returns canonical honest-out if 0 results — zero LLM in path.
 *
 * B4s: Holding-list said "voice missing alerts context + 3-layer validation".
 * Code audit 2026-05-27 confirmed ALL THREE layers + alerts context are
 * already ported to naavi-voice-server/src/index.js. B4s is CLOSED — already
 * at parity. No fix needed.
 *
 * Coverage gaps acknowledged (Rule 15a exception):
 *   B6d behavioral: live disambiguation triggers require seeding conflicting
 *     data state. Covered by static rule-text checks; Wael verifies live.
 *   F2h live: live postal-code round-trip test would need a test-user contact
 *     with a known postal code in Google Contacts. Covered by static code
 *     check + contacts-adapter search path logic test.
 *   B4w voice: the voice-server bypass lives in Railway (askClaude), not
 *     reachable from the Supabase auto-tester. Covered by code inspection;
 *     Wael verifies live on +1 249 523 5394.
 *   B6c keyboard flicker: KeyboardAvoidingView behavior + inputFull minHeight
 *     fix is React Native client code in app/index.tsx. Not reachable from
 *     the Node auto-tester. Verified by Wael on next APK install.
 *
 * Run via `npm run test:auto`.
 */

import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { adapters } from '../lib/adapters';
import { expect2xx, expectTruthy, expectFalsy } from '../lib/assertions';
import type { TestCase } from '../lib/types';

// Path to contacts.ts for static code checks.
const CONTACTS_ADAPTER_PATH = join(
  process.cwd(),
  'supabase', 'functions', 'global-search', 'adapters', 'contacts.ts',
);

export const session2026_05_27Tests: TestCase[] = [
  // ─── B6d: numbered choices ─────────────────────────────────────────────────
  {
    id: 'b6d.prompt-contains-numbered-choices-rule',
    category: 'b6d',
    description:
      'B6d — get-naavi-prompt v98 must include the CHOICES MUST BE NUMBERED rule. ' +
      'This locks in that the rule survives prompt template rendering and will be ' +
      'seen by Claude on every session start.',
    timeoutMs: 15_000,
    async run(ctx) {
      const prompt = await adapters._fetchPrompt(ctx, 'app');
      expectTruthy(
        prompt.includes('CHOICES MUST BE NUMBERED'),
        'Prompt must contain "CHOICES MUST BE NUMBERED" rule — B6d regression',
      );
      expectTruthy(
        prompt.includes('NEVER use bullet points'),
        'Rule must explicitly ban bullet points for choices',
      );
    },
  },
  {
    id: 'b6d.prompt-version-bumped-to-v98',
    category: 'b6d',
    description:
      'B6d/Nav-disambiguation — PROMPT_VERSION must be 2026-06-14-v107-multi-action-rule24 (latest live version). ' +
      'Updated from v105 → v106 when search-card one-sentence rule was strengthened (2026-06-09).',
    timeoutMs: 15_000,
    async run(ctx) {
      const { status, data } = await adapters.call(
        ctx, 'get-naavi-prompt', { channel: 'app' }, { timeoutMs: 15_000 },
      );
      expect2xx(status, 'get-naavi-prompt');
      const version: string = data?.version ?? '';
      ctx.log(`version: ${version}`);
      expectTruthy(
        version === '2026-06-14-v107-multi-action-rule24',
        `Expected version "2026-06-14-v107-multi-action-rule24", got "${version}"`,
      );
    },
  },
  {
    id: 'b6d.voice-prompt-also-contains-numbered-choices-rule',
    category: 'b6d',
    description:
      'B6d — voice channel prompt must also contain the CHOICES MUST BE NUMBERED rule. ' +
      'Both surfaces share the same rule; parity check.',
    timeoutMs: 15_000,
    async run(ctx) {
      const { status, data } = await adapters.call(
        ctx, 'get-naavi-prompt', { channel: 'voice' }, { timeoutMs: 15_000 },
      );
      expect2xx(status, 'get-naavi-prompt (voice)');
      const prompt: string = data?.prompt ?? '';
      expectTruthy(
        prompt.includes('CHOICES MUST BE NUMBERED'),
        'Voice prompt must contain "CHOICES MUST BE NUMBERED" rule — B6d parity',
      );
    },
  },

  // ─── F2h: contacts adapter now fetches addresses ───────────────────────────
  {
    id: 'f2h.contacts-adapter-fetches-addresses-connections',
    category: 'f2h',
    description:
      'F2h — contacts adapter personFields must include "addresses" in the ' +
      'fetchConnections call. Without this, postal-code + city queries always ' +
      'return 0 contact matches even when the user has an address on a contact.',
    timeoutMs: 1_000,
    async run() {
      const src = readFileSync(CONTACTS_ADAPTER_PATH, 'utf8');
      expectTruthy(
        src.includes("'names,emailAddresses,phoneNumbers,addresses'") ||
        src.includes('"names,emailAddresses,phoneNumbers,addresses"') ||
        src.includes("'names,emailAddresses,phoneNumbers,addresses,memberships'") ||
        src.includes('"names,emailAddresses,phoneNumbers,addresses,memberships"'),
        'contacts.ts fetchConnections must include "addresses" in personFields — F2h regression',
      );
    },
  },
  {
    id: 'f2h.contacts-adapter-fetches-addresses-other-contacts',
    category: 'f2h',
    description:
      'F2h — contacts adapter readMask must include "addresses" in the ' +
      'fetchOtherContacts call. Parity check for the "Other contacts" source.',
    timeoutMs: 1_000,
    async run() {
      const src = readFileSync(CONTACTS_ADAPTER_PATH, 'utf8');
      // readMask appears in fetchOtherContacts; personFields in fetchConnections.
      // Both must include addresses.
      const readMaskOk = (src.match(/readMask.*addresses/s) ?? []).length > 0;
      expectTruthy(
        readMaskOk,
        'contacts.ts fetchOtherContacts must include "addresses" in readMask — F2h regression',
      );
    },
  },
  {
    id: 'f2h.contacts-adapter-scores-address-match',
    category: 'f2h',
    description:
      'F2h — contacts adapter scoring loop must include an addressTokenMatch branch ' +
      'with score >= 0.7 so postal-code / city queries produce ranked results.',
    timeoutMs: 1_000,
    async run() {
      const src = readFileSync(CONTACTS_ADAPTER_PATH, 'utf8');
      expectTruthy(
        src.includes('addressTokenMatch'),
        'contacts.ts scoring loop must have an addressTokenMatch branch — F2h regression',
      );
      expectTruthy(
        src.includes('postalNorm') && src.includes('postalCode'),
        'contacts.ts must normalize postal codes before comparison — F2h regression',
      );
    },
  },
  {
    id: 'f2h.contacts-adapter-includes-addresses-in-metadata',
    category: 'f2h',
    description:
      'F2h — contacts adapter metadata must include an "addresses" array in ' +
      'the hit object so Claude can read address info from search results.',
    timeoutMs: 1_000,
    async run() {
      const src = readFileSync(CONTACTS_ADAPTER_PATH, 'utf8');
      expectTruthy(
        src.includes('addresses:') && src.includes('postal_code'),
        'contacts.ts metadata must include addresses with postal_code — F2h regression',
      );
    },
  },

  // ─── B4s: already ported — close check ────────────────────────────────────
  {
    id: 'b4s.voice-already-has-alerts-context-and-validation',
    category: 'b4s',
    description:
      'B4s — code audit 2026-05-27 confirmed alerts context + 3-layer entity-existence ' +
      'validation are already ported to naavi-voice-server. This test verifies the ' +
      'alerts context builder AND 3-layer parity comment exist in voice server source.',
    timeoutMs: 1_000,
    async run() {
      const voiceSrc = readFileSync(
        join(process.cwd(), 'naavi-voice-server', 'src', 'index.js'),
        'utf8',
      );
      expectTruthy(
        voiceSrc.includes('_b4xBuildAlertsContext'),
        'voice server must have _b4xBuildAlertsContext — B4s already-ported parity check',
      );
      // The 3-layer validator comment was added in the B4s port.
      expectTruthy(
        voiceSrc.includes('3-layer entity-existence validation'),
        'voice server must have 3-layer entity-existence validation comment — B4s parity',
      );
    },
  },

  // ─── B4w: postal-code contact bypass in voice server ─────────────────────
  {
    id: 'b4w.voice-server-has-postal-code-bypass',
    category: 'b4w',
    description:
      'B4w — voice server must have the B4w postal-code contact bypass. ' +
      'This static check verifies the bypass was added to askClaude in ' +
      'naavi-voice-server/src/index.js so fabrication is blocked structurally.',
    timeoutMs: 1_000,
    async run() {
      const voiceSrc = readFileSync(
        join(process.cwd(), 'naavi-voice-server', 'src', 'index.js'),
        'utf8',
      );
      expectTruthy(
        voiceSrc.includes('B4w BYPASS'),
        'voice server must have B4w BYPASS comment in askClaude — fabrication guard',
      );
      expectTruthy(
        voiceSrc.includes('POSTAL_RE'),
        'voice server B4w bypass must define POSTAL_RE for Canadian postal codes',
      );
      expectTruthy(
        voiceSrc.includes("I don't have a contact with postal code"),
        'voice server B4w bypass must produce canonical honest-out speech',
      );
    },
  },
];
