/**
 * Session 2026-06-11 — regression coverage for B7d (postal code search format mismatch)
 * and soft-delete / deactivate alerts (new bug 2026-06-11).
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

const MANAGE_RULES_PATH = join(
  process.cwd(),
  'supabase', 'functions', 'manage-rules', 'index.ts',
);

const ALERTS_SCREEN_PATH = join(
  process.cwd(),
  'app', 'alerts.tsx',
);

import { expectTruthy } from '../lib/assertions';
import type { TestCase } from '../lib/types';

const CONTACTS_ADAPTER_PATH = join(
  process.cwd(),
  'supabase', 'functions', 'global-search', 'adapters', 'contacts.ts',
);

const GLOBAL_SEARCH_INDEX_PATH = join(
  process.cwd(),
  'supabase', 'functions', 'global-search', 'index.ts',
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
        src.includes('[a-z]\\d[a-z]') || src.includes('[A-Za-z]\\d[A-Za-z]'),
        'contacts adapter must use Canadian postal code regex ([a-z]\\d[a-z] or [A-Za-z]\\d[A-Za-z])',
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
  // ── Voice: update note on already-enabled alert — 2026-06-11 ─────────────
  {
    id: 'note-update.pending-note-update-state-declared',
    description: 'Voice server declares pendingNoteUpdate state for updating note on enabled alerts',
    tags: ['note-update', 'voice', 'location'],
    run: async () => {
      const src = readFileSync(
        join(process.cwd(), 'naavi-voice-server', 'src', 'index.js'),
        'utf8',
      );
      expectTruthy(
        src.includes('pendingNoteUpdate = null'),
        'voice server must declare pendingNoteUpdate state variable',
      );
      expectTruthy(
        src.includes('[pendingNoteUpdate]'),
        'voice server must have a pendingNoteUpdate handler block',
      );
    },
  },
  {
    id: 'note-update.enabled-branch-offers-update',
    description: 'Voice server memory-hit enabled branch offers note update when new body differs',
    tags: ['note-update', 'voice', 'location'],
    run: async () => {
      const src = readFileSync(
        join(process.cwd(), 'naavi-voice-server', 'src', 'index.js'),
        'utf8',
      );
      expectTruthy(
        src.includes('newBody && newBody.toLowerCase() !=='),
        'enabled memory-hit branch must compare newBody vs existingBody',
      );
      // F12 Phase 4 (2026-07-06) — the literal phrase moved from one inline
      // template into a separate `updateDesc` variable when the branch was
      // extended to also offer updating a changed recipient (Defect B fix).
      // Runtime output for the body-only case is unchanged: "Want me to
      // update the message to "..."?" — checking both halves confirms that
      // rather than relying on one contiguous source string.
      expectTruthy(
        src.includes('update the message to "${newBody}"'),
        'enabled memory-hit branch must build an update-the-message offer when body differs',
      );
      expectTruthy(
        src.includes('Want me to ${updateDesc}?'),
        'enabled memory-hit branch must speak the update offer to the user',
      );
    },
  },
  // ── Re-arm preserves new action_config note — 2026-06-11 ─────────────────
  {
    id: 'rearm.action-config-param-present',
    description: 'reArmLocationRule accepts action_config param and merges it into the DB update',
    tags: ['rearm', 'location', 'action-config'],
    run: async () => {
      const src = readFileSync(
        join(process.cwd(), 'hooks', 'useOrchestrator.ts'),
        'utf8',
      );
      // The function signature must include action_config
      expectTruthy(
        src.includes('action_config?: Record<string, any>'),
        'reArmLocationRule must accept action_config in its updates param',
      );
      // The merge must spread existing over new
      expectTruthy(
        src.includes('mergedActionConfig') && src.includes('existingRule?.action_config'),
        'reArmLocationRule must merge new action_config over existing rule action_config',
      );
      // The DB update must include the merged config when present
      expectTruthy(
        src.includes('mergedActionConfig ? { action_config: mergedActionConfig }'),
        'reArmLocationRule DB update must include mergedActionConfig when provided',
      );
    },
  },
  {
    id: 'rearm.picker-callsite-passes-action-config',
    description: 'Picker re-arm call site passes originalAction.action_config to reArmLocationRule',
    tags: ['rearm', 'location', 'picker'],
    run: async () => {
      const src = readFileSync(
        join(process.cwd(), 'hooks', 'useOrchestrator.ts'),
        'utf8',
      );
      expectTruthy(
        src.includes('action_config: pending.originalAction?.action_config'),
        'Picker re-arm call site must pass pending.originalAction.action_config',
      );
    },
  },

  // ── Soft-delete (deactivate) alerts — 2026-06-11 ──────────────────────────
  {
    id: 'soft-delete.manage-rules-has-deactivate-op',
    description: 'manage-rules Edge Function has deactivate op that sets enabled=false',
    tags: ['soft-delete', 'alerts', 'manage-rules'],
    run: async () => {
      const src = readFileSync(MANAGE_RULES_PATH, 'utf8');
      expectTruthy(
        src.includes("op: 'deactivate'") || src.includes('op === \'deactivate\'') || src.includes('body.op === \'deactivate\''),
        'manage-rules must handle op=deactivate',
      );
      expectTruthy(
        src.includes('enabled: false'),
        'manage-rules deactivate must set enabled=false',
      );
    },
  },
  {
    id: 'soft-delete.alerts-screen-calls-deactivate-not-delete',
    description: 'alerts.tsx confirmDelete calls op=deactivate for active rules, op=delete for expired rules',
    tags: ['soft-delete', 'alerts'],
    run: async () => {
      const src = readFileSync(ALERTS_SCREEN_PATH, 'utf8');
      // Both ops must be present: deactivate for active rules, delete for expired
      expectTruthy(
        src.includes("op: 'deactivate'") || src.includes("'deactivate'"),
        'alerts.tsx confirmDelete must still use op=deactivate for active rules',
      );
      expectTruthy(
        src.includes("isExpired ? 'delete' : 'deactivate'"),
        'alerts.tsx confirmDelete must use op=delete for expired rules',
      );
    },
  },
  {
    id: 'soft-delete.alerts-screen-keeps-row-on-disable',
    description: 'alerts.tsx: active rule disables (keeps row greyed); expired rule is removed from list',
    tags: ['soft-delete', 'alerts'],
    run: async () => {
      const src = readFileSync(ALERTS_SCREEN_PATH, 'utf8');
      // Active path: row stays with enabled=false
      expectTruthy(
        src.includes('enabled: false'),
        'alerts.tsx must update active row to enabled=false after deactivate',
      );
      // Expired path: row is removed
      expectTruthy(
        src.includes('.filter(r => r.id !== deleted.id)'),
        'alerts.tsx must filter out the row when hard-deleting an expired rule',
      );
    },
  },
  {
    id: 'soft-delete.modal-text-updated',
    description: 'alerts.tsx modal says "Disable alert?" not "Delete alert?"',
    tags: ['soft-delete', 'alerts'],
    run: async () => {
      const src = readFileSync(ALERTS_SCREEN_PATH, 'utf8');
      expectTruthy(
        src.includes('Disable alert?'),
        'alerts.tsx modal title must say "Disable alert?"',
      );
      expectTruthy(
        src.includes('You can reactivate it any time'),
        'alerts.tsx modal sub-text must say "You can reactivate it any time."',
      );
    },
  },

  {
    id: 'b4w.anchor-filter-normalizes-spaces',
    description: 'B4w: anchor-term filter in index.ts strips spaces when matching anchor words against result snippets',
    tags: ['b4w', 'global-search', 'postal-code'],
    run: async () => {
      const src = readFileSync(GLOBAL_SEARCH_INDEX_PATH, 'utf8');
      // The fix: hayNorm and space-stripped anchor comparison must be present.
      expectTruthy(
        src.includes('hayNorm'),
        'index.ts anchor filter must define hayNorm (space-stripped hay)',
      );
      expectTruthy(
        src.includes('hayNorm.includes(a.replace'),
        'index.ts anchor filter must check hayNorm against space-stripped anchor word',
      );
    },
  },
];
