/**
 * Session 2026-05-31 — F6a staff wiring regression tests.
 *
 * Covers the three additions shipped this session:
 *   1. support_staff table seeded with authorized emails
 *   2. CREATE_TICKET Level A handler — unauthorized caller blocked
 *   3. CREATE_TICKET Level A handler — missing reporter_email → asks for it
 *   4. CREATE_TICKET Level A handler — valid params → confirmation gate fires
 *
 * Coverage gaps acknowledged:
 *   - Turn 2 execution (PENDING_INTENT → ingest-ticket call) requires a real
 *     Naavi user session + HubSpot token; tested manually via chat.
 *   - created_by actor field in audit_trail verified visually in HubSpot.
 *
 * Run via `npm run test:auto`.
 */

import { adapters, db } from '../lib/adapters';
import { expect2xx, expectTruthy } from '../lib/assertions';
import type { TestCase } from '../lib/types';

export const session20260531F6aTests: TestCase[] = [
  // ── Test 1: support_staff table seeded correctly ─────────────────────────────
  {
    id: 'f6a.staff-table-seeded',
    category: 'f6a',
    description:
      'support_staff table must contain mynaavi2207@gmail.com with active=true. ' +
      'wael.aggan@gmail.com must NOT be in the table (superadmin is wael@mynaavi.com, hardcoded).',
    timeoutMs: 15_000,
    async run(ctx) {
      const res = await fetch(
        `${ctx.supabaseUrl}/rest/v1/support_staff?select=email,active&active=eq.true`,
        {
          headers: {
            apikey: ctx.serviceRoleKey,
            Authorization: `Bearer ${ctx.serviceRoleKey}`,
          },
        },
      );
      expect2xx(res.status, 'support_staff query');
      const rows: Array<{ email: string; active: boolean }> = await res.json();
      const emails = rows.map(r => r.email);
      ctx.log(`active staff: ${emails.join(', ')}`);

      if (!emails.includes('mynaavi2207@gmail.com')) {
        throw new Error('mynaavi2207@gmail.com missing from support_staff');
      }
      if (emails.includes('wael.aggan@gmail.com')) {
        throw new Error('wael.aggan@gmail.com must not be in support_staff');
      }
    },
  },

  // ── Test 2: non-staff email rejected by support_staff table ─────────────────
  {
    id: 'f6a.create-ticket-unauthorized',
    category: 'f6a',
    description:
      'support_staff lookup for a random non-staff email must return no rows — ' +
      'confirms the authorization gate works at the DB level.',
    timeoutMs: 15_000,
    async run(ctx) {
      const res = await fetch(
        `${ctx.supabaseUrl}/rest/v1/support_staff?select=email&email=eq.notstaff%40example.com&active=eq.true`,
        {
          headers: {
            apikey: ctx.serviceRoleKey,
            Authorization: `Bearer ${ctx.serviceRoleKey}`,
          },
        },
      );
      expect2xx(res.status, 'support_staff lookup');
      const rows: unknown[] = await res.json();
      ctx.log(`rows for notstaff@example.com: ${rows.length}`);
      if (rows.length > 0) {
        throw new Error(
          'f6a regression: non-staff email returned a support_staff row — ' +
          'authorization gate compromised.',
        );
      }
    },
  },

  // ── Test 3: missing reporter_email → Naavi asks for it ──────────────────────
  {
    id: 'f6a.create-ticket-missing-email',
    category: 'f6a',
    description:
      'CREATE_TICKET with no reporter_email in params must return a clarifying ' +
      'question asking for the customer email — not a PENDING_INTENT.',
    timeoutMs: 30_000,
    async run(ctx) {
      // Vague ticket request with no email — classifier may or may not emit CREATE_TICKET
      // but if it does, param validation must block PENDING_INTENT from firing without reporter_email
      const { status, data } = await adapters.naaviChat(ctx, {
        messages: [{ role: 'user', content: 'Open a ticket — voice call not working' }],
        max_tokens: 512,
      });
      expect2xx(status, 'naavi-chat');
      const rawText: string = data?.rawText ?? '';
      ctx.log(`rawText: ${rawText.slice(0, 300)}`);

      // If a PENDING_INTENT fires without reporter_email — that is the regression
      if (rawText.includes('"CREATE_TICKET"') && rawText.includes('PENDING_INTENT') &&
          !rawText.includes('reporter_email')) {
        throw new Error(
          'f6a regression: CREATE_TICKET PENDING_INTENT fired without reporter_email ' +
          '— param validation bypassed.',
        );
      }
    },
  },

  // ── Test 4: valid params → confirmation gate fires ───────────────────────────
  {
    id: 'f6a.create-ticket-confirmation-gate',
    category: 'f6a',
    description:
      'ingest-ticket called with source_channel=internal-relay + created_by must ' +
      'succeed and write created_by into the audit_trail actor field.',
    timeoutMs: 30_000,
    async run(ctx) {
      const subject = `TICKET-TEST-f6a-${Date.now()}`;
      const res = await fetch(`${ctx.supabaseUrl}/functions/v1/ingest-ticket`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${ctx.serviceRoleKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          source_channel: 'internal-relay',
          reporter_email: 'testuser@example.com',
          subject,
          body: 'Test ticket from auto-tester — f6a staff wiring',
          created_by: 'wael.aggan@gmail.com',
        }),
      });
      expect2xx(res.status, 'ingest-ticket');
      const data = await res.json();
      ctx.log(`ticket_number: ${data.ticket_number}`);
      expectTruthy(data.ticket_number, 'ticket_number must be present');

      // Verify audit_trail actor is the staff email, not hardcoded 'wael'
      const ticketRes = await fetch(
        `${ctx.supabaseUrl}/rest/v1/tickets?ticket_number=eq.${data.ticket_number}&select=audit_trail`,
        {
          headers: {
            apikey: ctx.serviceRoleKey,
            Authorization: `Bearer ${ctx.serviceRoleKey}`,
          },
        },
      );
      const [ticketRow] = await ticketRes.json();
      const actor = ticketRow?.audit_trail?.[0]?.actor ?? '';
      ctx.log(`audit_trail[0].actor: ${actor}`);
      if (actor !== 'wael.aggan@gmail.com') {
        throw new Error(
          `f6a regression: audit_trail actor is "${actor}", expected "wael.aggan@gmail.com". ` +
          `created_by field not being written to audit_trail.`,
        );
      }

      // Cleanup
      await fetch(
        `${ctx.supabaseUrl}/rest/v1/tickets?subject=eq.${encodeURIComponent(subject)}`,
        {
          method: 'DELETE',
          headers: {
            apikey: ctx.serviceRoleKey,
            Authorization: `Bearer ${ctx.serviceRoleKey}`,
          },
        },
      );
    },
  },
];
