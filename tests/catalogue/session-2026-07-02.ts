/**
 * Session 2026-07-02/03 — B8b: staff-created tickets must not get an extra SMS
 *
 * Covers:
 * 1. ingest-ticket: created_by is persisted as its own column for every
 *    channel, not just internal-relay (previously silently discarded).
 * 2. ingest-ticket: the ticket-received SMS confirmation is skipped when
 *    a staffer created the ticket (no live-call urgency; the ack email
 *    already covers it).
 * 3. send-ticket-reply: the supplementary SMS reply is skipped when a
 *    staffer created the ticket — email always sends regardless, so
 *    staff-created tickets get exactly one reply, not two.
 *
 * Same source-code guard-check pattern as the existing F8a/F8b tests in
 * session-2026-06-19.ts (Postmark/Twilio side effects make live E2E
 * testing here expensive to run on every pass; this locks in the
 * conditional logic itself).
 */

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { expectTruthy } from '../lib/assertions';
import type { TestCase } from '../lib/types';

const INGEST_TICKET_PATH     = join(process.cwd(), 'supabase', 'functions', 'ingest-ticket', 'index.ts');
const SEND_TICKET_REPLY_PATH = join(process.cwd(), 'supabase', 'functions', 'send-ticket-reply', 'index.ts');

export const session2026_07_02Tests: TestCase[] = [
  {
    id: 'b8b.ingest-ticket-persists-created-by-all-channels',
    category: 'smoke',
    description: 'ingest-ticket: created_by is stored on the ticket row for every channel, not only internal-relay',
    run: async () => {
      const src = readFileSync(INGEST_TICKET_PATH, 'utf8');
      expectTruthy(
        /created_by:\s*createdBy \|\| null/.test(src),
        'ingest-ticket must insert created_by unconditionally (any channel), not gate it on internal-relay',
      );
      expectTruthy(
        !/channel === 'internal-relay' \? String\(payload\.created_by/.test(src),
        'ingest-ticket must not still gate created_by capture behind channel === internal-relay (old B8b bug)',
      );
    },
  },

  {
    id: 'b8b.ingest-ticket-sms-skips-staff-created',
    category: 'smoke',
    description: 'ingest-ticket: ticket-received SMS confirmation is skipped for staff-created tickets',
    run: async () => {
      const src = readFileSync(INGEST_TICKET_PATH, 'utf8');
      expectTruthy(
        /!createdBy && \(channel === 'voice-call' \|\| channel === 'internal-relay'\)/.test(src),
        'ingest-ticket SMS confirmation must be guarded by !createdBy — a staffer manually logging a ticket has no live-call urgency',
      );
    },
  },

  {
    id: 'b8b.send-ticket-reply-sms-skips-staff-created',
    category: 'smoke',
    description: 'send-ticket-reply: supplementary SMS reply is skipped for staff-created tickets (email always sends regardless)',
    run: async () => {
      const src = readFileSync(SEND_TICKET_REPLY_PATH, 'utf8');
      expectTruthy(
        /!ticket\.created_by && \(ticket\.source_channel === 'voice-call' \|\| ticket\.source_channel === 'internal-relay'\)/.test(src),
        'send-ticket-reply SMS send must be guarded by !ticket.created_by — staff-created tickets should get exactly one reply (email), not two',
      );
      expectTruthy(
        src.includes("'id, ticket_number, subject, reporter_email, reporter_name, reporter_phone, source_channel, created_by, status, replies, audit_trail'"),
        'send-ticket-reply must select created_by from the tickets table to check it',
      );
    },
  },
];
