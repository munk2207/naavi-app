/**
 * Session 2026-07-03 — F2b: demo reminder label collision, second bug.
 *
 * Live-call regression: same caller (name + phone) tried to set a SECOND
 * demo reminder and got the generic "Sorry, I couldn't set that up" — the
 * label (name + phone only) collided with their own first reminder's row,
 * hit the action_rules unique-index on (user_id, label), and the insert
 * was silently rejected. Confirmed via direct DB query: only the first
 * row ever existed, the second attempt never landed.
 *
 * Fix: label now also includes fire_at, so two reminders only collide if
 * they share name, phone, AND the exact same scheduled time.
 */

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { expectTruthy } from '../lib/assertions';
import type { TestCase } from '../lib/types';

const CREATE_DEMO_REMINDER_PATH = join(process.cwd(), 'supabase', 'functions', 'create-demo-reminder', 'index.ts');

export const session2026_07_03_f2bReminderLabelTests: TestCase[] = [
  {
    id: 'f2b.demo-reminder-label-includes-fire-at',
    category: 'smoke',
    description: 'create-demo-reminder label includes fire_at so a caller\'s second reminder does not collide with their first',
    async run() {
      const src = readFileSync(CREATE_DEMO_REMINDER_PATH, 'utf8');
      expectTruthy(
        src.includes('`Demo reminder for ${name} (${phone}) @ ${fire_at}`'),
        'named-caller label must include fire_at, not just name + phone (old bug: same caller\'s 2nd reminder collided with their 1st)',
      );
      expectTruthy(
        src.includes('`Demo reminder (${phone}) @ ${fire_at}`'),
        'anonymous-caller label must include fire_at, not just phone',
      );
    },
  },
];
