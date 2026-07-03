/**
 * Session 2026-07-03 — F10a: feedback/ticket-submission completeness
 * (website + mobile), pre-Play-Store-launch.
 *
 * Covers:
 * 1. app/report.tsx no longer posts to the retired Formspree endpoint —
 *    it uses ingest-ticket with source_channel: 'mobile-report' instead.
 * 2. app/help.tsx has a "Report a problem" row routing to /report (was
 *    orphaned — no menu entry pointed at it before this session).
 * 3. app/index.tsx has the dismissible home-screen feedback banner.
 * 4. mynaavi-website/shared.js's nav includes a homepage-only "Feedback"
 *    link, not shown on other pages (e.g. /faq).
 *
 * Static source-code guard-check pattern (same as F8a/F8b/B8b) — these are
 * UI/wiring changes with no live side effects worth exercising end-to-end
 * on every auto-tester run.
 */

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { expectTruthy } from '../lib/assertions';
import type { TestCase } from '../lib/types';

const REPORT_PATH     = join(process.cwd(), 'app', 'report.tsx');
const HELP_PATH       = join(process.cwd(), 'app', 'help.tsx');
const INDEX_PATH      = join(process.cwd(), 'app', 'index.tsx');
const SHARED_JS_PATH  = join(process.cwd(), 'mynaavi-website', 'shared.js');

export const session2026_07_03_f10aTests: TestCase[] = [
  {
    id: 'f10a.report-screen-uses-ingest-ticket-not-formspree',
    category: 'smoke',
    description: 'app/report.tsx posts to ingest-ticket (source_channel: mobile-report), not the retired Formspree endpoint',
    async run() {
      const src = readFileSync(REPORT_PATH, 'utf8');
      expectTruthy(
        !src.includes('formspree.io'),
        'report.tsx must not reference the retired Formspree endpoint (old B-class bug)',
      );
      expectTruthy(
        src.includes("source_channel:  'mobile-report'") || src.includes("source_channel: 'mobile-report'"),
        'report.tsx must POST to ingest-ticket with source_channel mobile-report',
      );
      expectTruthy(
        src.includes('/functions/v1/ingest-ticket'),
        'report.tsx must call the ingest-ticket Edge Function',
      );
    },
  },

  {
    id: 'f10a.help-screen-has-report-a-problem-row',
    category: 'smoke',
    description: 'app/help.tsx has a "Report a problem" row routing to /report (previously orphaned, unreachable)',
    async run() {
      const src = readFileSync(HELP_PATH, 'utf8');
      expectTruthy(
        src.includes('Report a problem'),
        'help.tsx must have a "Report a problem" row label',
      );
      expectTruthy(
        src.includes("router.push('/report')"),
        'help.tsx must route the Report-a-problem row to /report',
      );
    },
  },

  {
    id: 'f10a.home-screen-has-feedback-banner',
    category: 'smoke',
    description: 'app/index.tsx has a dismissible feedback banner routing to /help',
    async run() {
      const src = readFileSync(INDEX_PATH, 'utf8');
      expectTruthy(
        src.includes('showFeedbackBanner'),
        'index.tsx must have the feedback banner visibility state',
      );
      expectTruthy(
        src.includes('naavi_feedback_banner_dismissed'),
        'index.tsx must persist the dismiss choice so the banner does not reappear',
      );
      expectTruthy(
        src.includes("Got feedback? Tell the team"),
        'index.tsx must render the feedback invitation copy',
      );
    },
  },

  {
    id: 'f10a.website-nav-feedback-link-homepage-only',
    category: 'smoke',
    description: 'mynaavi-website shared.js nav shows Feedback only on the homepage, not other pages',
    async run() {
      const src = readFileSync(SHARED_JS_PATH, 'utf8');
      expectTruthy(
        src.includes("isHome ? '<a href=\"/contact\" class=\"nav-cta\">Feedback</a>' : ''"),
        'shared.js buildNav must conditionally render the Feedback link only when isHome is true',
      );
      expectTruthy(
        /var isHome = \(path === '\/' \|\| path === '\/index' \|\| path === '\/index\.html'\)/.test(src),
        'shared.js must define isHome from the current path (homepage-only scope, not site-wide like Blogs/Discover/FAQ)',
      );
    },
  },
];
