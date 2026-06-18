/**
 * Session 2026-06-18 — Build 266 location alert fixes
 *
 * Covers:
 * 1. Haiku classifier: "remind me with X" phrasing extracts tasks param for location alerts
 * 2. Haiku classifier: "remind me when I arrive to Y with X" (task after place) also covered
 * 3. Haiku classifier: pronoun resolution — "his/her/their/there home" resolves to named person
 * 4. buildActionConfirm location path: Haiku-extracted tasks merged into action_config.tasks[]
 * 5. get-naavi-prompt: "remind me WITH X" = task content rule documented
 * 6. resolve-place: use_geocoding flag accepted for contact address resolution
 * 7. naavi-chat: label emits null (not empty string) for unlabeled location alerts
 *
 * Run via `npm run test:auto`.
 */

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { expectTruthy } from '../lib/assertions';
import type { TestCase } from '../lib/types';

const NAAVI_CHAT_PATH   = join(process.cwd(), 'supabase', 'functions', 'naavi-chat', 'index.ts');
const PROMPT_PATH       = join(process.cwd(), 'supabase', 'functions', 'get-naavi-prompt', 'index.ts');
const RESOLVE_PLACE_PATH = join(process.cwd(), 'supabase', 'functions', 'resolve-place', 'index.ts');

export const session2026_06_18Tests: TestCase[] = [
  {
    id: 'location-alert.haiku-tasks-param-remind-with',
    description: 'Haiku classifier: "remind me with X" phrasing has tasks param extraction in SET_ACTION_RULE location',
    tags: ['location-alert', 'haiku'],
    run: async () => {
      const src = readFileSync(NAAVI_CHAT_PATH, 'utf8');
      expectTruthy(
        src.includes('tasks (for location+reminder'),
        'Haiku classifier prompt missing tasks param extraction for location+reminder — "remind me with X" will not extract tasks',
      );
    },
  },

  {
    id: 'location-alert.haiku-tasks-after-place',
    description: 'Haiku classifier: "remind me when I arrive to Y with X" (task after place) covered in prompt examples',
    tags: ['location-alert', 'haiku'],
    run: async () => {
      const src = readFileSync(NAAVI_CHAT_PATH, 'utf8');
      expectTruthy(
        src.includes('remind me when I arrive to Bob home with his kid Sam'),
        'Haiku classifier prompt missing "task after place" example — will miss task when user puts it after the place name',
      );
    },
  },

  {
    id: 'location-alert.haiku-pronoun-resolution',
    description: 'Haiku classifier: "his/her/their/there home" resolves to named person from same message',
    tags: ['location-alert', 'haiku'],
    run: async () => {
      const src = readFileSync(NAAVI_CHAT_PATH, 'utf8');
      expectTruthy(
        src.includes('PRONOUN RULE'),
        'Haiku classifier prompt missing PRONOUN RULE for his/her/their home resolution',
      );
      expectTruthy(
        src.includes('their home') && src.includes('there home'),
        'Haiku classifier PRONOUN RULE missing "their home" or "there home" variants',
      );
    },
  },

  {
    id: 'location-alert.build-action-confirm-merges-haiku-tasks',
    description: 'buildActionConfirm location path: Haiku-extracted tasks param merged into action_config.tasks[]',
    tags: ['location-alert', 'haiku'],
    run: async () => {
      const src = readFileSync(NAAVI_CHAT_PATH, 'utf8');
      expectTruthy(
        src.includes('haikuTasks') && src.includes('baseActionConfig.tasks = [haikuTasks]'),
        'buildActionConfirm location path not merging Haiku tasks param into action_config.tasks[] — task content will be lost',
      );
    },
  },

  {
    id: 'location-alert.prompt-remind-with-equals-task',
    description: 'get-naavi-prompt: "remind me WITH X" documented as equivalent to task content',
    tags: ['location-alert', 'prompt'],
    run: async () => {
      const src = readFileSync(PROMPT_PATH, 'utf8');
      expectTruthy(
        src.includes('"remind me WITH X" = "remind me OF X"'),
        'get-naavi-prompt missing "remind me WITH X" = task content rule — main Claude path may miss task extraction',
      );
    },
  },

  {
    id: 'location-alert.resolve-place-use-geocoding-flag',
    description: 'resolve-place: use_geocoding flag accepted to route contact addresses through Geocoding API',
    tags: ['location-alert', 'resolve-place'],
    run: async () => {
      const src = readFileSync(RESOLVE_PLACE_PATH, 'utf8');
      expectTruthy(
        src.includes('use_geocoding') && src.includes('useGeocoding'),
        'resolve-place missing use_geocoding flag — contact address alerts will fail (Places Text Search rejects residential addresses)',
      );
    },
  },

  {
    id: 'location-alert.null-label-not-empty-string',
    description: 'naavi-chat: unlabeled location alerts emit null label, not empty string (prevents unique-index collision)',
    tags: ['location-alert', 'naavi-chat'],
    run: async () => {
      const src = readFileSync(NAAVI_CHAT_PATH, 'utf8');
      expectTruthy(
        src.includes(".trim() || null"),
        'naavi-chat label emit still uses empty string fallback — second unlabeled alert will hit 23505 unique constraint',
      );
    },
  },
];
