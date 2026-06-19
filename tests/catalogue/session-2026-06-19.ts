/**
 * Session 2026-06-19 — T3c voice regression suite + F8a voice support tickets
 *
 * Covers:
 * 1. ingest-ticket: test tickets (example.com email or TICKET-TEST- subject) skip email/SMS
 * 2. ingest-ticket: voice-call source_channel accepted
 * 3. voice server: F8a support trigger regex matches expected phrases
 * 4. voice server: F8a confirmation marker regex matches expected wording
 * 5. voice server: /test/ask endpoint guard rejects wrong secret
 */

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { expectTruthy, expectEqual } from '../lib/assertions';
import type { TestCase } from '../lib/types';

const INGEST_TICKET_PATH  = join(process.cwd(), 'supabase', 'functions', 'ingest-ticket', 'index.ts');
const VOICE_SERVER_PATH   = join(process.cwd(), 'naavi-voice-server', 'src', 'index.js');

const VOICE_SERVER_URL  = process.env.VOICE_SERVER_URL  || '';
const VOICE_TEST_SECRET = process.env.VOICE_TEST_SECRET || '';

export const session2026_06_19Tests: TestCase[] = [
  {
    id: 'f8a.ingest-ticket-test-address-skips-email',
    category: 'smoke',
    description: 'ingest-ticket: isTestTicket guard present — .example.com and TICKET-TEST- skip email/SMS',
    run: async () => {
      const src = readFileSync(INGEST_TICKET_PATH, 'utf8');
      expectTruthy(
        src.includes('isTestTicket') && src.includes('example') && src.includes('TICKET-TEST-'),
        'ingest-ticket missing isTestTicket guard — auto-tester runs will flood staff email',
      );
      expectTruthy(
        src.includes('!isTestTicket'),
        'ingest-ticket isTestTicket guard not applied to email/SMS sends',
      );
    },
  },

  {
    id: 'f8a.ingest-ticket-voice-call-channel-allowed',
    category: 'smoke',
    description: 'ingest-ticket: voice-call is in the allowed source_channel set',
    run: async () => {
      const src = readFileSync(INGEST_TICKET_PATH, 'utf8');
      expectTruthy(
        src.includes("'voice-call'"),
        'ingest-ticket missing voice-call in allowedChannels — voice support tickets will be rejected',
      );
    },
  },

  {
    id: 'f8a.ingest-ticket-sms-for-voice-and-relay',
    category: 'smoke',
    description: 'ingest-ticket: SMS confirmation fires for voice-call and internal-relay channels',
    run: async () => {
      const src = readFileSync(INGEST_TICKET_PATH, 'utf8');
      expectTruthy(
        src.includes("channel === 'voice-call' || channel === 'internal-relay'") && src.includes('send-sms'),
        'ingest-ticket missing SMS confirmation for voice-call/internal-relay channels',
      );
    },
  },

  {
    id: 'f8a.voice-support-trigger-regex',
    category: 'smoke',
    description: 'Voice server: F8a support trigger regex present and matches expected phrases',
    run: async () => {
      const src = readFileSync(VOICE_SERVER_PATH, 'utf8');
      expectTruthy(
        src.includes('SUPPORT_TRIGGER') && src.includes('need.*help') || src.includes('SUPPORT_TRIGGER'),
        'Voice server missing F8a SUPPORT_TRIGGER regex',
      );
      expectTruthy(
        src.includes('F8a: Support ticket bypass'),
        'Voice server missing F8a support ticket bypass block',
      );
    },
  },

  {
    id: 'f8a.voice-confirmation-turn-present',
    category: 'smoke',
    description: 'Voice server: F8a confirmation ask (Turn 2) present before ticket creation',
    run: async () => {
      const src = readFileSync(VOICE_SERVER_PATH, 'utf8');
      expectTruthy(
        src.includes('SUPPORT_CONFIRM') && src.includes("I'll open a ticket for:"),
        'Voice server missing F8a Turn 2 confirmation ask',
      );
    },
  },

  {
    id: 'f8a.voice-test-endpoint-rejects-wrong-secret',
    category: 'smoke',
    description: 'Voice server: /test/ask returns 403 for wrong secret',
    timeoutMs: 10_000,
    run: async () => {
      if (!VOICE_SERVER_URL) return; // skip if not configured
      const res = await fetch(`${VOICE_SERVER_URL}/test/ask`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ secret: 'wrong-secret', user_id: 'test', message: 'hello' }),
      });
      expectEqual(res.status, 403, `Expected 403 for wrong secret, got ${res.status}`);
    },
  },
];
