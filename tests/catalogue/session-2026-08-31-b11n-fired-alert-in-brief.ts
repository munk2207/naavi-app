/**
 * Session 2026-08-31 — B11n: a one-shot alert vanished from today's brief the
 * instant it fired, instead of staying visible as already done.
 *
 * Wael, 2026-08-23, live: "Even when the alert expires, it kept as a triggered
 * alert not completely empty."
 *
 * Root cause: fetchTodayTimeAlerts (app/index.tsx) filtered the query on
 * .eq('enabled', true), and a one-shot rule sets enabled=false the moment it
 * fires. The row survives with everything needed to display it — rule
 * 697fa07d still reads label "Call the farmer at 10:05 PM" with
 * last_fired_at set — but the query dropped it and never selected
 * last_fired_at at all.
 *
 * Why it matters: an empty brief after an alert fires is indistinguishable
 * from the alert never having existed. The user cannot tell "it ran" from "it
 * was never created" — the same family as the truth-at-user-layer items.
 *
 * ── Scope correction found while fixing it, worth keeping ─────────────────
 * The row said the alert vanished "from the app entirely". It did not. The
 * Alerts screen (app/alerts.tsx) already loads fired rules through
 * manage-rules, labels them with an "Expired" pill and offers Reactivate.
 * Today's brief on the home screen was the ONLY place that dropped them, so
 * the fix belongs there and nowhere else.
 *
 * ── Why the fix filters in JS rather than in the query ────────────────────
 * The two cases we want cannot be expressed as one equality: keep enabled
 * rules, AND keep one-shot rules that already fired, but still hide a rule the
 * user deliberately switched off. Dropping .eq('enabled', true) without the JS
 * guard would resurrect deliberately-disabled rules, which is a different bug
 * pointing the other way.
 *
 * ── Why the label goes in `detail` and not a new field ────────────────────
 * BriefItem is a shared DTO with several consumers. Extending it would require
 * a full regression pass first (feedback_shared_dto_extension_regression_first).
 * Changing the wording needs none and answers the actual complaint.
 *
 * Coverage gap acknowledged, per CLAUDE.md Rule 15a: app/index.tsx is a React
 * Native module with Expo/RN imports that cannot be safely imported into this
 * Node/tsx runner. These are source-pattern assertions on the real file, the
 * same precedent as session-2026-07-13-b9p. They verify the query no longer
 * excludes fired rules, that deliberately-disabled rules are still excluded,
 * and that a fired alert is labelled differently from an upcoming one. They
 * cannot verify what the screen actually renders — that needs a build.
 */

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { expectTruthy } from '../lib/assertions';
import type { TestCase } from '../lib/types';

const INDEX_PATH = join(process.cwd(), 'app', 'index.tsx');

/** The body of fetchTodayTimeAlerts, so assertions cannot match elsewhere. */
function fetchTodayTimeAlertsBody(): string {
  const src = readFileSync(INDEX_PATH, 'utf8');
  const start = src.indexOf('async function fetchTodayTimeAlerts');
  expectTruthy(start !== -1, 'fetchTodayTimeAlerts not found in app/index.tsx');
  // Ends at the next top-level function/comment banner.
  const end = src.indexOf('\n// ─── Enrich calendar events', start);
  expectTruthy(end !== -1, 'could not find the end of fetchTodayTimeAlerts');
  return src.slice(start, end);
}

export const session2026_08_31_b11nFiredAlertInBriefTests: TestCase[] = [
  {
    id: 'b11n.brief-query-no-longer-drops-fired-one-shot-alerts',
    category: 'rules',
    description: "today's brief no longer filters time alerts on enabled=true, which deleted a one-shot alert from the brief the moment it fired",
    async run() {
      const body = fetchTodayTimeAlertsBody();

      expectTruthy(
        !/\.eq\(\s*['"]enabled['"]\s*,\s*true\s*\)/.test(body),
        "B11n regression: fetchTodayTimeAlerts must NOT filter .eq('enabled', true) — a one-shot rule sets enabled=false the instant it fires, so that filter erases the alert from the brief exactly when the user wants to see it happened",
      );
      expectTruthy(
        /last_fired_at/.test(body) && /one_shot/.test(body),
        'the query must select last_fired_at and one_shot — without them a fired rule cannot be told apart from a deliberately-disabled one',
      );
    },
  },
  {
    id: 'b11n.deliberately-disabled-rules-stay-hidden',
    category: 'rules',
    description: 'removing the enabled filter does not resurrect rules the user deliberately switched off — only one-shot rules that actually fired come back',
    async run() {
      const body = fetchTodayTimeAlertsBody();

      // The guard must require ALL THREE of: not enabled, one-shot, and
      // actually fired. Any weaker test lets a switched-off rule reappear.
      expectTruthy(
        /rule\.enabled\s*===\s*false/.test(body)
        && /rule\.one_shot\s*===\s*true/.test(body)
        && /rule\.last_fired_at/.test(body),
        'the fired-rule guard must check enabled===false AND one_shot===true AND last_fired_at — a weaker check would bring back rules the user deliberately turned off, which is the same bug pointing the other way',
      );
      expectTruthy(
        /if\s*\(\s*rule\.enabled\s*!==\s*true\s*&&\s*!hasFired\s*\)\s*return\s*\[\]/.test(body),
        'anything neither enabled nor fired must still be dropped from the brief',
      );
    },
  },
  {
    id: 'b11n.fired-alert-reads-differently-from-an-upcoming-one',
    category: 'rules',
    description: 'a fired alert is labelled as already done rather than reading like one still to come',
    async run() {
      const body = fetchTodayTimeAlertsBody();

      expectTruthy(
        /hasFired\s*\?/.test(body) && /Alerted at/.test(body) && /Alert at/.test(body),
        'the brief must distinguish a fired alert from an upcoming one — showing a fired alert as "Alert at 10:05 PM" tells the user it is still coming, which is a second untruth on top of the first',
      );
    },
  },
];
