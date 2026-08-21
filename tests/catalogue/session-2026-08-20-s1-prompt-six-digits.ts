/**
 * S1 Track C — the spoken PIN instructions must say six digits.
 *
 * The defect this locks down: S1 Track C (2026-08-19) changed the voice PIN
 * from 4 digits to 6 — the migration, `manage-voice-pin`'s PIN_SET_RE, and the
 * voice server's spoken-digit extraction all moved. RULE 19 of the shared
 * prompt did not. So Naavi kept telling callers, in her own words:
 *
 *   "To change your voice PIN, say: set my PIN to your four digits.
 *    For example, set my PIN to one two three four."
 *
 * A caller who followed that instruction exactly would have their PIN refused
 * by manage-voice-pin with `pin_must_be_6_digits`. Naavi was reading out a
 * recipe for a guaranteed failure.
 *
 * Found 2026-08-20 by Wael on a live production call, after the S1 promotion —
 * not by any test, and not by either of S1's two external reviews. It had been
 * wrong on staging for a day before that and nothing noticed, because nothing
 * was looking at what Naavi actually SAYS about the feature, only at what the
 * feature DOES.
 *
 * ── Why there are two tests here, not one ──────────────────────────────────
 * The source assertion alone would not have caught the shape of tonight's
 * incident, and it is worth being precise about why.
 *
 * The prompt lives in an Edge Function that is deployed per environment. The
 * source can be correct in the repo while the deployed copy is months old —
 * production's was from 14 August, five days before S1 landed. A repo-only
 * assertion is blind to that gap by construction. So the second test asks the
 * DEPLOYED function what it actually returns, which is the only thing a caller
 * ever hears.
 *
 * That second test is also the one that fails when someone edits the prompt
 * and forgets to deploy it — the single most common way this file's subject
 * regresses.
 *
 * What neither test proves: that Claude repeats the instruction verbatim.
 * RULE 19 says the speech MUST be EXACTLY this string, and prompt-regression.ts
 * is where that kind of behavioural claim belongs. These two prove the
 * instruction Claude is handed is correct — a precondition, not the whole.
 */

import { readFileSync } from 'fs';
import { join } from 'path';
import type { TestCase } from '../lib/types';
import { expectTruthy } from '../lib/assertions';

const REPO = join(__dirname, '..', '..');
const PROMPT_SRC = 'supabase/functions/get-naavi-prompt/index.ts';

/** RULE 19 is the voice-PIN section; everything else in the prompt is noise here. */
function rule19(src: string): string {
  const start = src.indexOf('RULE 19 — VOICE PIN');
  if (start === -1) throw new Error(`RULE 19 not found in ${PROMPT_SRC} — the section was renamed or removed`);
  const end = src.indexOf('CRITICAL — KNOWLEDGE AND PREFERENCES', start);
  return src.slice(start, end === -1 ? start + 4000 : end);
}

/**
 * "four" is legitimate inside the migration note that tells Naavi an existing
 * 4-digit PIN still verifies. Only the INSTRUCTION must not say four, so match
 * the instruction shapes rather than the bare word.
 */
const BAD_INSTRUCTION = [
  /PIN to your four digits/i,
  /set my PIN to one two three four(?! five six)/i,
  /\b4-digit voice PIN\b/i,
];

export const s1PromptSixDigitsTests: TestCase[] = [
  {
    id: 's1.prompt-instruction-says-six-digits',
    category: 's1-prompt-six-digits',
    platform: 'shared',
    description:
      'RULE 19 in get-naavi-prompt must instruct six digits. Saying four hands the caller a PIN that '
      + 'manage-voice-pin rejects with pin_must_be_6_digits.',
    timeoutMs: 10_000,
    async run(ctx) {
      const section = rule19(readFileSync(join(REPO, PROMPT_SRC), 'utf8'));

      for (const bad of BAD_INSTRUCTION) {
        const hit = section.match(bad);
        expectTruthy(
          !hit,
          `RULE 19 still instructs four digits (matched ${bad}: "${hit?.[0]}") — a caller following it `
          + 'verbatim gets pin_must_be_6_digits',
        );
      }

      expectTruthy(
        /PIN to your six digits/i.test(section),
        'RULE 19 no longer contains the six-digit instruction — the exact-speech string was changed or lost',
      );
      expectTruthy(
        /one two three four five six/i.test(section),
        'the spoken example must be six digits; a four-digit example teaches the caller the wrong length',
      );

      // The migration note matters as much as the digit count: without it Naavi
      // may tell a 4-digit holder their PIN is invalid, which it is not.
      expectTruthy(
        /still works for verification/i.test(section),
        'RULE 19 must say an existing 4-digit PIN still verifies — otherwise Naavi tells long-standing '
        + 'users to change a PIN that works fine',
      );
      ctx.log('RULE 19 instructs six digits and preserves the 4-digit migration window');
    },
  },
  {
    id: 's1.deployed-prompt-says-six-digits',
    category: 's1-prompt-six-digits',
    platform: 'shared',
    description:
      'The DEPLOYED get-naavi-prompt returns the six-digit instruction. Catches the case the source '
      + 'assertion cannot see: prompt fixed in the repo, never deployed to this environment.',
    timeoutMs: 30_000,
    async run(ctx) {
      const url = process.env.SUPABASE_URL;
      const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
      expectTruthy(!!url && !!key, 'SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY must be set to check the deployed prompt');

      const res = await fetch(`${url}/functions/v1/get-naavi-prompt`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${key}` },
        body: JSON.stringify({ channel: 'voice', userName: 'Robert', userPhone: '+15550000000' }),
      });
      expectTruthy(res.ok, `get-naavi-prompt returned HTTP ${res.status} — cannot verify what callers hear`);

      const prompt = (await res.json())?.prompt;
      expectTruthy(typeof prompt === 'string' && prompt.length > 100, 'get-naavi-prompt returned no usable prompt');

      // Voice-only rule: if RULE 19 is absent the channel plumbing changed, and
      // silently passing would hide exactly the regression this test exists for.
      expectTruthy(
        prompt.includes('RULE 19 — VOICE PIN'),
        'the deployed voice prompt has no RULE 19 — the PIN instructions are not reaching callers at all',
      );

      for (const bad of BAD_INSTRUCTION) {
        const hit = prompt.match(bad);
        expectTruthy(
          !hit,
          `the DEPLOYED prompt still instructs four digits (matched "${hit?.[0]}") — this environment is `
          + 'serving a stale get-naavi-prompt; redeploy it',
        );
      }
      expectTruthy(
        /PIN to your six digits/i.test(prompt),
        'the deployed prompt does not carry the six-digit instruction — redeploy get-naavi-prompt to this environment',
      );
      ctx.log('deployed prompt instructs six digits');
    },
  },
];
