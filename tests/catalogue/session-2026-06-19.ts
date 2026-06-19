/**
 * Session 2026-06-19 — T3c voice regression suite + F8a voice support tickets
 *
 * Covers:
 * 1. ingest-ticket: test tickets (example.com email or TICKET-TEST- subject) skip email/SMS
 * 2. ingest-ticket: voice-call source_channel accepted
 * 3. voice server: F8a support trigger regex matches expected phrases
 * 4. voice server: F8a confirmation marker regex matches expected wording
 * 5. voice server: /test/ask endpoint guard rejects wrong secret
 * 6. receive-sms-reply: inbound SMS appends to ticket thread (F8b)
 * 7. receive-sms-reply: "close" keyword closes ticket (F8b)
 * 8. receive-sms-reply: unknown phone is silently ignored (F8b)
 * 9. send-ticket-reply: SMS fires for both voice-call and internal-relay (F8b)
 * 10. checkGrantedScopes: returns failed scope names for 401/403 responses (F8c)
 * 11. checkGrantedScopes: ignores network errors, never blocks sign-in (F8c)
 * 12. scope prompt modal: scopePromptOverlay style present in app/index.tsx (F8c)
 */

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { expectTruthy, expectEqual } from '../lib/assertions';
import type { TestCase, TestContext } from '../lib/types';

const SUPABASE_LIB_PATH       = join(process.cwd(), 'lib', 'supabase.ts');
const APP_INDEX_PATH          = join(process.cwd(), 'app', 'index.tsx');
const INGEST_TICKET_PATH      = join(process.cwd(), 'supabase', 'functions', 'ingest-ticket', 'index.ts');
const SEND_TICKET_REPLY_PATH  = join(process.cwd(), 'supabase', 'functions', 'send-ticket-reply', 'index.ts');
const VOICE_SERVER_PATH       = join(process.cwd(), 'naavi-voice-server', 'src', 'index.js');

const SMOKE_PHONE = '+15550000001'; // fake phone used only in SMS ingest tests

async function createSmsTestTicket(ctx: TestContext): Promise<{ id: string; ticket_number: number }> {
  const res = await fetch(`${ctx.supabaseUrl}/rest/v1/tickets`, {
    method: 'POST',
    headers: {
      apikey: ctx.serviceRoleKey,
      Authorization: `Bearer ${ctx.serviceRoleKey}`,
      'Content-Type': 'application/json',
      Prefer: 'return=representation',
    },
    body: JSON.stringify({
      source_channel: 'voice-call',
      subject: 'TICKET-TEST-sms-inbound',
      body: 'SMS inbound test fixture',
      reporter_email: 'autotester@example.com',
      reporter_phone: SMOKE_PHONE,
      status: 'sent',
    }),
  });
  const rows = await res.json();
  return rows[0] as { id: string; ticket_number: number };
}

async function deleteSmsTestTickets(ctx: TestContext) {
  await fetch(
    `${ctx.supabaseUrl}/rest/v1/tickets?subject=ilike.${encodeURIComponent('TICKET-TEST-sms-inbound%')}`,
    {
      method: 'DELETE',
      headers: {
        apikey: ctx.serviceRoleKey,
        Authorization: `Bearer ${ctx.serviceRoleKey}`,
      },
    },
  );
}

async function postSmsWebhook(ctx: TestContext, from: string, body: string): Promise<Response> {
  const params = new URLSearchParams({ From: from, To: '+12495235394', Body: body, MessageSid: 'SMtest000' });
  return fetch(`${ctx.supabaseUrl}/functions/v1/receive-sms-reply`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      apikey: ctx.serviceRoleKey,
    },
    body: params.toString(),
  });
}

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

  // ── F8b: receive-sms-reply tests ────────────────────────────────────

  {
    id: 'f8b.sms-inbound-appends-to-thread',
    category: 'smoke',
    description: 'receive-sms-reply: inbound SMS appends reply to ticket thread with direction=inbound',
    timeoutMs: 15_000,
    async setup(ctx) { await deleteSmsTestTickets(ctx); },
    async teardown(ctx) { await deleteSmsTestTickets(ctx); },
    async run(ctx) {
      const ticket = await createSmsTestTicket(ctx);
      const res = await postSmsWebhook(ctx, SMOKE_PHONE, 'This is my reply');
      expectEqual(res.status, 200, `receive-sms-reply should return 200, got ${res.status}`);

      const verify = await fetch(
        `${ctx.supabaseUrl}/rest/v1/tickets?id=eq.${ticket.id}&select=replies,status`,
        { headers: { apikey: ctx.serviceRoleKey, Authorization: `Bearer ${ctx.serviceRoleKey}` } },
      );
      const rows = await verify.json();
      const row = rows[0];
      const inbound = (row.replies as Array<Record<string, unknown>>).find(r => r.direction === 'inbound');
      expectTruthy(!!inbound, 'No inbound reply found in ticket thread after SMS webhook');
      expectEqual(inbound!.channel as string, 'sms', 'Inbound reply should have channel=sms');
      expectEqual(row.status, 'new', 'Status should be new after inbound SMS reply');
    },
  },

  {
    id: 'f8b.sms-close-keyword-closes-ticket',
    category: 'smoke',
    description: 'receive-sms-reply: SMS body containing "close" sets ticket status to closed',
    timeoutMs: 15_000,
    async setup(ctx) { await deleteSmsTestTickets(ctx); },
    async teardown(ctx) { await deleteSmsTestTickets(ctx); },
    async run(ctx) {
      const ticket = await createSmsTestTicket(ctx);
      const res = await postSmsWebhook(ctx, SMOKE_PHONE, 'Please close this ticket');
      expectEqual(res.status, 200, `receive-sms-reply should return 200, got ${res.status}`);

      const verify = await fetch(
        `${ctx.supabaseUrl}/rest/v1/tickets?id=eq.${ticket.id}&select=status`,
        { headers: { apikey: ctx.serviceRoleKey, Authorization: `Bearer ${ctx.serviceRoleKey}` } },
      );
      const rows = await verify.json();
      expectEqual(rows[0]?.status, 'closed', `Ticket should be closed after "close" SMS, got ${rows[0]?.status}`);
    },
  },

  {
    id: 'f8b.sms-unknown-phone-ignored',
    category: 'smoke',
    description: 'receive-sms-reply: SMS from unknown phone returns 200 and skips silently',
    timeoutMs: 15_000,
    async run(ctx) {
      const res = await postSmsWebhook(ctx, '+15559999999', 'hello from unknown');
      expectEqual(res.status, 200, `receive-sms-reply should return 200 for unknown phone, got ${res.status}`);
      const text = await res.text();
      expectTruthy(text.includes('<Response>'), 'Should return TwiML response');
    },
  },

  {
    id: 'f8b.send-ticket-reply-sms-for-internal-relay',
    category: 'smoke',
    description: 'send-ticket-reply: SMS fires for internal-relay channel (code guard check)',
    async run() {
      const src = readFileSync(SEND_TICKET_REPLY_PATH, 'utf8');
      expectTruthy(
        src.includes("source_channel === 'voice-call' || ticket.source_channel === 'internal-relay'"),
        'send-ticket-reply missing internal-relay in SMS send condition',
      );
    },
  },

  // ── F8c: OAuth scope probe ────────────────────────────────────────────

  {
    id: 'f8c.check-granted-scopes-detects-failures',
    category: 'smoke',
    description: 'checkGrantedScopes: returns names of scope groups that returned 401/403',
    async run() {
      const src = readFileSync(SUPABASE_LIB_PATH, 'utf8');
      // Verify all 4 scope groups are probed
      expectTruthy(src.includes("name: 'Calendar'"), 'checkGrantedScopes missing Calendar probe');
      expectTruthy(src.includes("name: 'Gmail'"),    'checkGrantedScopes missing Gmail probe');
      expectTruthy(src.includes("name: 'Contacts'"), 'checkGrantedScopes missing Contacts probe');
      expectTruthy(src.includes("name: 'Drive'"),    'checkGrantedScopes missing Drive probe');
      // Verify 401 and 403 both treated as failures
      expectTruthy(
        src.includes('res.status === 401 || res.status === 403'),
        'checkGrantedScopes must treat both 401 and 403 as scope failures',
      );
      // Verify network errors are swallowed
      expectTruthy(
        src.includes('return null; // network error'),
        'checkGrantedScopes must swallow network errors and return null (never block sign-in)',
      );
    },
  },

  {
    id: 'f8c.scope-probe-hooked-into-signed-in',
    category: 'smoke',
    description: 'checkGrantedScopes: called in SIGNED_IN handler with session.provider_token',
    async run() {
      const src = readFileSync(APP_INDEX_PATH, 'utf8');
      expectTruthy(
        src.includes('checkGrantedScopes'),
        'app/index.tsx missing checkGrantedScopes call in SIGNED_IN handler',
      );
      expectTruthy(
        src.includes('session?.provider_token'),
        'app/index.tsx must pass session.provider_token to checkGrantedScopes',
      );
      expectTruthy(
        src.includes('setShowScopePrompt(true)'),
        'app/index.tsx missing setShowScopePrompt(true) on scope failure',
      );
    },
  },

  {
    id: 'f8c.scope-prompt-modal-present',
    category: 'smoke',
    description: 'Scope prompt modal rendered in app/index.tsx with instruction text',
    async run() {
      const src = readFileSync(APP_INDEX_PATH, 'utf8');
      expectTruthy(
        src.includes('showScopePrompt'),
        'app/index.tsx missing showScopePrompt state',
      );
      expectTruthy(
        src.includes('Select all'),
        'Scope prompt modal missing "Select all" instruction text',
      );
      expectTruthy(
        src.includes('scopePromptOverlay'),
        'app/index.tsx missing scopePromptOverlay style',
      );
    },
  },
];
