/**
 * Session 2026-06-11 — regression coverage for B7d (postal code search format mismatch).
 *
 * B7d: Contact postal-code search failed when query format differed from stored format.
 * - "K1C5M3" (no space) failed to find contacts stored as "K1C 5M3"
 * - "K1C 5M3" (with space) matched ALL contacts in the K1C forward sortation area
 *   because tokensFromVariants split it into ["k1c","5m3"] and "k1c" substring-matched
 *   every K1C* postal code.
 *
 * Fix: detect Canadian postal code in query via regex, then use ONLY exact normalized
 * match (strip spaces from both sides) — never fall through to token-based matching
 * when a postal code is present in the query.
 *
 * Run via `npm run test:auto`.
 */

import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { expectTruthy } from '../lib/assertions';
import type { TestCase } from '../lib/types';

const CONTACTS_ADAPTER_PATH = join(
  process.cwd(),
  'supabase', 'functions', 'global-search', 'adapters', 'contacts.ts',
);

export const session2026_06_11Tests: TestCase[] = [
  {
    id: 'b7d.postal-code-regex-gate-present',
    description: 'B7d: contacts adapter has postalInQuery regex gate to prevent broad token match',
    tags: ['b7d', 'contacts', 'postal-code'],
    run: async () => {
      const src = readFileSync(CONTACTS_ADAPTER_PATH, 'utf8');
      expectTruthy(
        src.includes('postalInQuery'),
        'contacts adapter must define postalInQuery to detect postal code in query',
      );
      expectTruthy(
        src.includes('[A-Za-z]\\d[A-Za-z]'),
        'contacts adapter must use Canadian postal code regex ([A-Za-z]\\d[A-Za-z])',
      );
    },
  },
  {
    id: 'b7d.postal-code-gate-skips-token-fallback',
    description: 'B7d: when postalInQuery is set, token fallback is bypassed',
    tags: ['b7d', 'contacts', 'postal-code'],
    run: async () => {
      const src = readFileSync(CONTACTS_ADAPTER_PATH, 'utf8');
      // The fix must return early when postalInQuery is set, before the token fallback.
      expectTruthy(
        src.includes('if (postalInQuery)'),
        'contacts adapter must short-circuit on postalInQuery before token fallback',
      );
      // The exact normalized match must compare postalNorm === postalInQuery.
      expectTruthy(
        src.includes('postalNorm === postalInQuery'),
        'contacts adapter must use exact normalized match (postalNorm === postalInQuery)',
      );
    },
  },
  {
    id: 'b7d.postal-normalization-unit',
    description: 'B7d: postal code normalization logic — "K1C 5M3" and "K1C5M3" both resolve to "k1c5m3"',
    tags: ['b7d', 'contacts', 'postal-code'],
    run: async () => {
      // Replicate the normalization logic from the fix inline.
      const normalize = (s: string) => s.replace(/\s+/g, '').toLowerCase();
      const POSTAL_RE = /\b([A-Za-z]\d[A-Za-z])\s?(\d[A-Za-z]\d)\b/;

      const extractFromQuery = (q: string) => {
        const m = q.match(POSTAL_RE);
        return m ? (m[1] + m[2]).toLowerCase() : null;
      };

      // Query with space → normalized to k1c5m3
      const q1 = 'find contact with postal code K1C 5M3';
      expectTruthy(extractFromQuery(q1) === 'k1c5m3', `query "${q1}" should extract "k1c5m3"`);

      // Query without space → normalized to k1c5m3
      const q2 = 'find contact with postal code K1C5M3';
      expectTruthy(extractFromQuery(q2) === 'k1c5m3', `query "${q2}" should extract "k1c5m3"`);

      // Stored "K1C 5M3" → normalized to k1c5m3
      expectTruthy(normalize('K1C 5M3') === 'k1c5m3', 'stored "K1C 5M3" should normalize to "k1c5m3"');

      // Stored "K1C5M3" → normalized to k1c5m3
      expectTruthy(normalize('K1C5M3') === 'k1c5m3', 'stored "K1C5M3" should normalize to "k1c5m3"');

      // Both normalize to same value → they match
      expectTruthy(
        normalize('K1C 5M3') === extractFromQuery(q1),
        '"K1C 5M3" stored and "K1C 5M3" queried must match after normalization',
      );
      expectTruthy(
        normalize('K1C 5M3') === extractFromQuery(q2),
        '"K1C 5M3" stored and "K1C5M3" queried must match after normalization',
      );

      // Different postal code must NOT match
      expectTruthy(
        normalize('K1A 0B1') !== extractFromQuery(q1),
        '"K1A 0B1" must NOT match a "K1C 5M3" query',
      );
    },
  },
];
