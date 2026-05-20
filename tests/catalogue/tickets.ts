/**
 * tickets test catalogue — F6a Phase 1 (Wael 2026-05-20).
 *
 * Verifies the support-ticket data model + ingest-ticket Edge Function:
 *
 *   1. ingest accepts internal-relay payload (subject + body direct).
 *   2. ingest accepts Formspree-shaped payload (description / context /
 *      severity → derived subject + body).
 *   3. ingest rejects unknown source_channel.
 *   4. ingest rejects empty subject + body (NOT NULL + CHECK on table).
 *   5. status CHECK constraint rejects invalid transitions in raw UPDATE.
 *   6. ticket_number is monotonically increasing + unique.
 */

import { db } from '../lib/adapters';
import { expect2xx, expectEqual, expectTruthy } from '../lib/assertions';
import type { TestCase, TestContext } from '../lib/types';

const SMOKE_PREFIX = 'TICKET-TEST-';

async function deleteTestTickets(ctx: TestContext) {
  await fetch(
    `${ctx.supabaseUrl}/rest/v1/tickets?subject=ilike.${encodeURIComponent(SMOKE_PREFIX)}%`,
    {
      method: 'DELETE',
      headers: {
        apikey: ctx.serviceRoleKey,
        Authorization: `Bearer ${ctx.serviceRoleKey}`,
      },
    },
  );
}

async function callIngest(ctx: TestContext, body: Record<string, unknown>) {
  const res = await fetch(`${ctx.supabaseUrl}/functions/v1/ingest-ticket`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${ctx.serviceRoleKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
  });
  return { status: res.status, data: await res.json() };
}

async function rawInsertTicket(ctx: TestContext, row: Record<string, unknown>) {
  const res = await fetch(`${ctx.supabaseUrl}/rest/v1/tickets`, {
    method: 'POST',
    headers: {
      apikey: ctx.serviceRoleKey,
      Authorization: `Bearer ${ctx.serviceRoleKey}`,
      'Content-Type': 'application/json',
      Prefer: 'return=representation',
    },
    body: JSON.stringify(row),
  });
  return { ok: res.ok, status: res.status, body: await res.text() };
}

async function rawUpdateTicket(ctx: TestContext, ticketId: string, patch: Record<string, unknown>) {
  const res = await fetch(`${ctx.supabaseUrl}/rest/v1/tickets?id=eq.${ticketId}`, {
    method: 'PATCH',
    headers: {
      apikey: ctx.serviceRoleKey,
      Authorization: `Bearer ${ctx.serviceRoleKey}`,
      'Content-Type': 'application/json',
      Prefer: 'return=representation',
    },
    body: JSON.stringify(patch),
  });
  return { ok: res.ok, status: res.status, body: await res.text() };
}

export const ticketsTests: TestCase[] = [
  // ──────────────────────────────────────────────────────────────────
  // 1. ingest accepts internal-relay payload.
  // ──────────────────────────────────────────────────────────────────
  {
    id: 'tickets.ingest-internal-relay-creates-ticket',
    category: 'tickets',
    description: 'ingest-ticket accepts internal-relay payload and returns ticket_number',
    timeoutMs: 15_000,
    async setup(ctx) { await deleteTestTickets(ctx); },
    async teardown(ctx) { await deleteTestTickets(ctx); },
    async run(ctx) {
      const r = await callIngest(ctx, {
        source_channel: 'internal-relay',
        subject: SMOKE_PREFIX + 'internal',
        body: 'Internal-relay smoke test from automated suite.',
        reporter_name: 'Auto Tester',
      });
      expect2xx(r.status, 'ingest-ticket');
      expectEqual(r.data?.success, true, `expected success=true, got ${JSON.stringify(r.data)}`);
      expectTruthy(typeof r.data?.ticket_number === 'number' && r.data.ticket_number >= 1000,
        `expected ticket_number >= 1000, got ${r.data?.ticket_number}`);
      expectEqual(r.data?.status, 'new', 'ingested ticket should default to status=new');
    },
  },

  // ──────────────────────────────────────────────────────────────────
  // 2. ingest accepts Formspree-shaped payload and derives subject + body.
  // ──────────────────────────────────────────────────────────────────
  {
    id: 'tickets.ingest-formspree-shape-derives-fields',
    category: 'tickets',
    description: 'ingest-ticket maps Formspree description + context into derived subject/body',
    timeoutMs: 15_000,
    async setup(ctx) { await deleteTestTickets(ctx); },
    async teardown(ctx) { await deleteTestTickets(ctx); },
    async run(ctx) {
      const description = SMOKE_PREFIX + 'formspree desc — alert never fired';
      const r = await callIngest(ctx, {
        source_channel: 'formspree-report',
        email: 'autotest@example.com',
        name: 'Auto Tester',
        description,
        context: 'I tapped the icon and nothing happened',
        severity: 'annoying',
      });
      expect2xx(r.status, 'ingest-ticket');
      expectEqual(r.data?.success, true, `expected success=true, got ${JSON.stringify(r.data)}`);
      // Verify the ticket row got the derived subject/body
      const verifyRes = await fetch(
        `${ctx.supabaseUrl}/rest/v1/tickets?id=eq.${r.data.ticket_id}&select=subject,body,severity,reporter_email,reporter_name`,
        { headers: { apikey: ctx.serviceRoleKey, Authorization: `Bearer ${ctx.serviceRoleKey}` } },
      );
      const rows = await verifyRes.json();
      const row = Array.isArray(rows) ? rows[0] : null;
      expectTruthy(!!row, 'ticket row should exist');
      expectTruthy(String(row.subject || '').includes(SMOKE_PREFIX), `subject should include prefix, got "${row.subject}"`);
      expectTruthy(String(row.body || '').includes('I tapped the icon'), `body should include context, got "${row.body}"`);
      expectEqual(row.severity, 'annoying', 'severity should map through');
      expectEqual(row.reporter_email, 'autotest@example.com', 'email should map to reporter_email');
    },
  },

  // ──────────────────────────────────────────────────────────────────
  // 3. Unknown source_channel rejected at the application layer.
  // ──────────────────────────────────────────────────────────────────
  {
    id: 'tickets.ingest-unknown-source-rejected',
    category: 'tickets',
    description: 'ingest-ticket returns 400 for unrecognized source_channel',
    timeoutMs: 15_000,
    async setup(ctx) { await deleteTestTickets(ctx); },
    async teardown(ctx) { await deleteTestTickets(ctx); },
    async run(ctx) {
      const r = await callIngest(ctx, {
        source_channel: 'made-up-channel',
        subject: SMOKE_PREFIX + 'should-not-land',
        body: 'should not land',
      });
      expectEqual(r.status, 400, `unknown channel should 400, got ${r.status}`);
    },
  },

  // ──────────────────────────────────────────────────────────────────
  // 4. Empty subject + body rejected — DB-level CHECK constraint.
  // ──────────────────────────────────────────────────────────────────
  {
    id: 'tickets.empty-subject-rejected-by-db',
    category: 'tickets',
    description: 'Raw INSERT with empty subject is rejected by the CHECK constraint',
    timeoutMs: 15_000,
    async setup(ctx) { await deleteTestTickets(ctx); },
    async teardown(ctx) { await deleteTestTickets(ctx); },
    async run(ctx) {
      const r = await rawInsertTicket(ctx, {
        source_channel: 'internal-relay',
        subject: '',
        body: 'has body but no subject',
      });
      expectEqual(r.ok, false, `empty subject should be rejected, got status=${r.status} body=${r.body.slice(0,200)}`);
      expectTruthy(r.status === 400 || r.body.includes('check'), `expected CHECK violation, got status=${r.status}`);
    },
  },

  // ──────────────────────────────────────────────────────────────────
  // 5. Invalid status rejected — CHECK on status enum.
  // ──────────────────────────────────────────────────────────────────
  {
    id: 'tickets.invalid-status-rejected-by-db',
    category: 'tickets',
    description: 'UPDATE to invalid status rejected by CHECK constraint',
    timeoutMs: 15_000,
    async setup(ctx) { await deleteTestTickets(ctx); },
    async teardown(ctx) { await deleteTestTickets(ctx); },
    async run(ctx) {
      // Insert a valid ticket first
      const ingest = await callIngest(ctx, {
        source_channel: 'internal-relay',
        subject: SMOKE_PREFIX + 'status-test',
        body: 'status validation test',
      });
      expect2xx(ingest.status, 'ingest-ticket');
      const ticketId = ingest.data.ticket_id;
      // Attempt invalid status
      const update = await rawUpdateTicket(ctx, ticketId, { status: 'bogus' });
      expectEqual(update.ok, false, `bogus status should be rejected, got status=${update.status}`);
      expectTruthy(update.status === 400 || update.body.includes('check'), `expected CHECK violation, got status=${update.status}`);
      // Verify status didn't change
      const verify = await fetch(
        `${ctx.supabaseUrl}/rest/v1/tickets?id=eq.${ticketId}&select=status`,
        { headers: { apikey: ctx.serviceRoleKey, Authorization: `Bearer ${ctx.serviceRoleKey}` } },
      );
      const rows = await verify.json();
      expectEqual(rows[0]?.status, 'new', 'status should remain "new" after rejected update');
    },
  },

  // ──────────────────────────────────────────────────────────────────
  // 6. ticket_number is monotonically increasing across inserts.
  // ──────────────────────────────────────────────────────────────────
  {
    id: 'tickets.ticket-number-monotonic',
    category: 'tickets',
    description: 'Two successive ingests produce monotonically increasing ticket_numbers',
    timeoutMs: 15_000,
    async setup(ctx) { await deleteTestTickets(ctx); },
    async teardown(ctx) { await deleteTestTickets(ctx); },
    async run(ctx) {
      const r1 = await callIngest(ctx, {
        source_channel: 'internal-relay',
        subject: SMOKE_PREFIX + 'monotonic-1',
        body: 'first',
      });
      const r2 = await callIngest(ctx, {
        source_channel: 'internal-relay',
        subject: SMOKE_PREFIX + 'monotonic-2',
        body: 'second',
      });
      expect2xx(r1.status, 'first');
      expect2xx(r2.status, 'second');
      expectTruthy(r2.data.ticket_number > r1.data.ticket_number,
        `second ticket_number (${r2.data.ticket_number}) should be greater than first (${r1.data.ticket_number})`);
    },
  },
];
