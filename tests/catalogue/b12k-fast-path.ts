/**
 * B12k Stage 3a — conversational check-ins on the fast path.
 *
 * Governed by docs/B12K_PHASE3_TECHNICAL_REVIEW_2026-08-29.md §4a, branch A2:
 * extend the Haiku predicate ONLY to the turn classes where answer quality
 * held in the controlled comparison.
 *
 * Why this suite exists rather than a note in a document. The measured
 * comparison (2026-08-29, 3 trials per case, both models forced) found:
 *
 *   check-in  "Are you there?"          Sonnet 6.76s | Haiku 3.28s | answers equivalent
 *   lookup    "What is my home address?" Sonnet 7.24s | Haiku 3.61s | HAIKU STATED A FALSEHOOD
 *   open      kitchen repaint question   Sonnet 8.9s  | Haiku 8.09s | HAIKU TRUNCATED 3 of 3
 *
 * Haiku was faster on every type and wrong on two of them. On the lookup it
 * answered "your home address is 688 Bayview Dr" when that is the WORK
 * address and no home address exists — CLAUDE.md Rule 18, Naavi reshaping a
 * fact to fit what she has stored.
 *
 * So the boundary this suite defends is not stylistic. The fast path may
 * contain phrases that ASK FOR NOTHING. The moment it contains a phrase that
 * requests information, that request starts being answered by a model already
 * measured getting it wrong.
 *
 * The negative cases below are the ones that matter. "Can you hear me read my
 * emails" and "Are you there when I call Bob" both begin with a check-in and
 * are real requests. If a future widening of this pattern lets either through,
 * this suite fails.
 */

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { expectTruthy } from '../lib/assertions';
import type { TestCase } from '../lib/types';

const VOICE_PATH = join(process.cwd(), 'naavi-voice-server', 'src', 'index.js');

/** Pull the live trivialRe out of the voice server rather than restating it. */
function loadTrivialRe(): RegExp {
  const src = readFileSync(VOICE_PATH, 'utf8');
  const m = src.match(/const trivialRe = (\/\^.*?\/i);/s);
  if (!m) throw new Error('trivialRe not found in voice server — pattern renamed or removed');
  // eslint-disable-next-line no-eval
  return eval(m[1]) as RegExp;
}

/** Phrases that ask for nothing — safe on the fast path. */
const CHECK_INS = [
  'Are you there?',
  'are you still there',
  'Can you hear me?',
  'You there?',
  'are you listening',
];

/**
 * Phrases that MUST stay on the slower model. Three are ordinary requests;
 * two deliberately begin with a check-in and then ask for something, which is
 * the shape a careless widening of the pattern would let through.
 */
const MUST_NOT_FAST_PATH = [
  'What is my home address?',
  'What alerts do I have?',
  'What is on my calendar this week?',
  'can you hear me read my emails',
  'Are you there when I call Bob?',
];

export const b12kFastPathTests: TestCase[] = [
  {
    id: 'b12k.fast-path.check-ins-route-to-haiku',
    platform: 'voice',
    category: 'b12k',
    description: 'Stage 3a — conversational check-ins match the trivial fast path',
    tags: ['voice', 'b12k', 'latency'],
    run: async () => {
      const re = loadTrivialRe();
      for (const phrase of CHECK_INS) {
        expectTruthy(
          re.test(phrase),
          `"${phrase}" must match trivialRe — measured 3.28s on Haiku vs 6.76s on Sonnet, answers equivalent`,
        );
      }
    },
  },

  {
    id: 'b12k.fast-path.information-requests-stay-off-it',
    platform: 'voice',
    category: 'b12k',
    description: 'Stage 3a — anything asking for information must NOT reach the fast path',
    tags: ['voice', 'b12k', 'latency', 'truth-at-user-layer'],
    run: async () => {
      const re = loadTrivialRe();
      for (const phrase of MUST_NOT_FAST_PATH) {
        expectTruthy(
          !re.test(phrase),
          `"${phrase}" must NOT match trivialRe — it requests information, and the model on that path ` +
          `was measured answering "what is my home address?" with the WORK address (2026-08-29, 3 of 3 trials)`,
        );
      }
    },
  },

  {
    id: 'b12k.fast-path.selection-comment-records-the-boundary',
    platform: 'voice',
    category: 'b12k',
    description: 'Stage 3a — the reason the fast path is limited to check-ins survives in the source',
    tags: ['voice', 'b12k'],
    run: async () => {
      const src = readFileSync(VOICE_PATH, 'utf8');
      expectTruthy(
        src.includes('carrying NO information request'),
        'the trivialRe comment must state why the fast path is limited to phrases that ask for nothing — ' +
        'without it, the next person widening this pattern has no reason not to',
      );
    },
  },
];
