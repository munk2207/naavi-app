/**
 * The ticket pipeline must go through the outbound guard.
 *
 * ── The gap this closes ────────────────────────────────────────────────────
 * t2-outbound-guard.ts proves the guard MODULE behaves correctly — inert
 * without the secret, blocks non-allowlisted destinations, fails closed on an
 * empty one. What nothing proved was whether the ticket pipeline ever calls it.
 *
 * It didn't. Found 2026-08-20 while trying to test the ticket pipeline on
 * staging: `ingest-ticket` emails the reporter AND notifies the real
 * support@mynaavi.com inbox, and `send-ticket-reply` emails an actual customer
 * an actual reply. Neither imported the guard. Architecture Reference §0b
 * claimed a guard "sits in Shared Core on every send path"; it sat on the eight
 * alert-channel senders and none of the ticket pipeline. Staging appeared
 * contained rather than being contained.
 *
 * ── What these tests are, and are not ──────────────────────────────────────
 * These are SOURCE assertions, and s1-voice-pin-scoping.ts is right that source
 * assertions confirm words are present rather than that behaviour is correct.
 * Two reasons they are the right tool here anyway:
 *
 *   1. The behaviour is already covered. t2-outbound-guard.ts exercises the
 *      real shipped logic of what happens once the guard is called. The only
 *      untested link is whether these two functions call it, which is a
 *      structural fact about the source.
 *
 *   2. The live alternative is worse. Proving it end-to-end means POSTing to
 *      the deployed `ingest-ticket`, which CREATES A SUPPORT TICKET. A test
 *      that files a ticket on every run is noise in a real queue.
 *
 * Verified live once, by hand, on the day this landed: an allowlisted reporter
 * received a real reply (ticket #1075), and blocked-test@example.com — an
 * RFC-2606 reserved address — produced HTTP 403 `outbound_blocked`, with the
 * ticket correctly left unanswered rather than falsely marked as replied
 * (#1076).
 *
 * Coverage gap acknowledged: these will pass if someone imports the guard and
 * then ignores its result. They catch removal, not misuse.
 */

import { readFileSync } from 'fs';
import { join } from 'path';
import type { TestCase } from '../lib/types';
import { expectTruthy } from '../lib/assertions';

const REPO = join(__dirname, '..', '..');
const fn = (name: string) =>
  readFileSync(join(REPO, 'supabase', 'functions', name, 'index.ts'), 'utf8');

/** Every function in the ticket pipeline that reaches the outside world. */
const SENDING_TICKET_FUNCTIONS = ['ingest-ticket', 'send-ticket-reply'];

export const ticketPipelineOutboundGuardTests: TestCase[] = [
  {
    id: 'ticket.outbound-guard-is-imported',
    category: 'ticket-pipeline-outbound-guard',
    platform: 'mobile',
    description:
      'Both ticket functions that send email import guardDestination. Without it, a staging test ' +
      'ticket emails the real support@mynaavi.com inbox and a staging reply reaches an actual ' +
      'customer — which is what happened until 2026-08-20.',
    timeoutMs: 10_000,
    async run(ctx) {
      for (const name of SENDING_TICKET_FUNCTIONS) {
        const src = fn(name);
        expectTruthy(
          /import\s*\{[^}]*guardDestination[^}]*\}\s*from\s*['"][^'"]*outbound_guard/.test(src),
          `${name} does not import guardDestination — its sends are outside outbound containment`,
        );
        ctx.log(`${name}: imports the guard`);
      }
    },
  },
  {
    id: 'ticket.outbound-guard-is-called-and-checked',
    category: 'ticket-pipeline-outbound-guard',
    platform: 'mobile',
    description:
      'Each one calls guardDestination and branches on the result. An import alone proves nothing ' +
      'if the verdict is discarded.',
    timeoutMs: 10_000,
    async run(ctx) {
      for (const name of SENDING_TICKET_FUNCTIONS) {
        const src = fn(name);
        expectTruthy(
          /guardDestination\s*\(/.test(src),
          `${name} imports guardDestination but never calls it`,
        );
        expectTruthy(
          /\.allowed/.test(src),
          `${name} calls guardDestination but never reads .allowed — the verdict is discarded`,
        );
        ctx.log(`${name}: calls the guard and branches on the verdict`);
      }
    },
  },
  {
    id: 'ticket.guarded-before-the-postmark-call',
    category: 'ticket-pipeline-outbound-guard',
    platform: 'mobile',
    description:
      'The guard runs BEFORE the Postmark request, not after. A check that happens after the email ' +
      'has left is not a guard, and the ordering is exactly the kind of thing a later refactor ' +
      'reverses without noticing.',
    timeoutMs: 10_000,
    async run(ctx) {
      for (const name of SENDING_TICKET_FUNCTIONS) {
        const src = fn(name);
        const guardAt = src.indexOf('guardDestination(');
        // Both spellings: send-ticket-reply writes the host inline, ingest-ticket
        // builds it from a POSTMARK_API constant, so a single literal search
        // finds one and silently misses the other. The first version of this
        // test did exactly that and failed for the wrong reason.
        const postMatch = src.match(/postmarkapp\.com\/email|\$\{POSTMARK_API\}\/email/);
        const postAt = postMatch ? (postMatch.index ?? -1) : -1;
        expectTruthy(guardAt >= 0, `${name}: no guardDestination call found`);
        expectTruthy(postAt >= 0, `${name}: no Postmark send found — has the send path moved?`);
        expectTruthy(
          guardAt < postAt,
          `${name}: guardDestination appears AFTER the Postmark call — the email would already be gone`,
        );
        ctx.log(`${name}: guard at ${guardAt}, send at ${postAt} — correct order`);
      }
    },
  },
];
