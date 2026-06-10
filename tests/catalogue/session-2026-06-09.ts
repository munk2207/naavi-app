/**
 * Session 2026-06-09 — regression coverage for B4w + contacts address fix.
 *
 * B4w (mobile): a server-side bypass was added to naavi-chat to prevent Claude
 * fabricating contact names on postal-code queries. The bypass called
 * global-search server-to-server, which timed out at 4 seconds and returned 0
 * results — causing Naavi to say "I don't have a contact" when real contacts
 * existed. The bypass was REMOVED from naavi-chat (2026-06-09) because the
 * mobile orchestrator already runs global-search and passes real contact results
 * to Claude before it answers — so the bypass was overriding correct results
 * with a broken server-side call.
 *
 * The voice server bypass is unaffected (voice has no orchestrator).
 *
 * contacts.ts fix (2026-06-09): addressTokenMatch was not matching postal codes
 * stored in formattedValue with a space ("K1C 5M3") when the query arrived
 * without a space ("K1C5M3"). Fixed by also comparing addrLower with spaces
 * stripped against qNorm.
 *
 * Coverage gaps acknowledged (Rule 15a exception):
 *   Live round-trip postal-code search: requires a contact with a known postal
 *   code in the test user's Google Contacts. Covered here by static code checks;
 *   Wael verifies live on mobile.
 *
 * Run via `npm run test:auto`.
 */

import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { expectTruthy } from '../lib/assertions';
import type { TestCase } from '../lib/types';

const NAAVI_CHAT_PATH = join(
  process.cwd(),
  'supabase', 'functions', 'naavi-chat', 'index.ts',
);

const CONTACTS_ADAPTER_PATH = join(
  process.cwd(),
  'supabase', 'functions', 'global-search', 'adapters', 'contacts.ts',
);

export const session2026_06_09Tests: TestCase[] = [
  // ─── B4w mobile: bypass removed from naavi-chat ────────────────────────────
  {
    id: 'b4w.mobile-bypass-removed-from-naavi-chat',
    description: 'naavi-chat does NOT contain the B4w postal-code bypass (removed 2026-06-09)',
    tags: ['b4w', 'trust', 'mobile-parity'],
    run: async () => {
      const src = readFileSync(NAAVI_CHAT_PATH, 'utf8');
      expectTruthy(
        !src.includes('B4w 2026-06-09'),
        'naavi-chat must NOT contain the B4w bypass block — it was removed because the mobile orchestrator handles postal-code contact searches correctly'
      );
    },
  },

  // ─── contacts.ts: addressTokenMatch handles space-stripped formattedValue ───
  {
    id: 'b4w.contacts-adapter-addr-norm-fix',
    description: 'contacts.ts addressTokenMatch uses addrNorm (space-stripped) for postal matching',
    tags: ['b4w', 'contacts', 'address-match'],
    run: async () => {
      const src = readFileSync(CONTACTS_ADAPTER_PATH, 'utf8');
      expectTruthy(
        src.includes('addrNorm') && src.includes('addrLower.replace(/\\s+/g,'),
        'contacts.ts must strip spaces from formattedValue (addrNorm) before postal-code matching'
      );
      expectTruthy(
        src.includes('addrNorm.includes(qNorm)'),
        'contacts.ts must check addrNorm.includes(qNorm) to catch "K1C 5M3" in a full address string'
      );
    },
  },
];
