# Session Handoff — 2026-07-08 — F14 Shipped, Website Fixes Shipped

## Next session priority (explicit, from Wael)

**Review F12 manual staging validation results — APK V302.** This was already the standing priority before this session started and remains the only open item. Wael is (or will be) installing staging APK build 302 and running the 3 test scenarios outside this session.

**Read in this order:**
1. `docs/SESSION_HANDOFF_2026-07-06_F12_COMPLETE_STAGING_APK302.md` — the exact 3 manual validation scenarios, the places already used on staging (avoid reusing for new test alerts), and known DB access for verification.
2. `docs/F12_PHASE4_EVIDENCE_2026-07-06.md` — implementation evidence, traceability matrix, rollback instructions.
3. Memory: `project_naavi_f12_literal_address_alert_gap.md`.

**What to actually do next session:** ask Wael what he reports from the 3 scenarios, then verify the corresponding `action_rules` rows on **staging** (`xugvnfudofuskxoknhve`) directly — don't take his report at face value alone; query the DB the same way this session's F12 status check did (see `scripts/check-*.js` for the `createClient` pattern). If all 3 scenarios pass, F12 is ready for Wael's separate explicit production-promotion approval (staging-first rule — do not promote without that approval). If any fail, diagnose from the DB state outward, not from assumptions about what should have happened.

---

## What shipped this session (2026-07-08) — all in `mynaavi-website`, all live on production

This repo has no staging environment — every push here goes straight to mynaavi.com. Nothing this session touched the main Naavi app, voice server, or any Protected Core system.

### 1. F14 — precompiled the 5 demo storyboards, full governance trail

Closed out end-to-end: Phase 1 (`docs/F14_PHASE1_PROBLEM_DEFINITION_2026-07-07.md`) → Phase 2 with 2 external review rounds (`docs/F14_PHASE2_CHANGE_PLAN_2026-07-07.md`) → Phase 3 approved → Phase 4/5 evidence (`docs/F14_PHASE4_EVIDENCE_2026-07-07.md`, later extended same-day for Phase 6/7/8) → Phase 6 approved → Phase 7 (pre-push local testing + 4 post-push production checks) → Phase 8 (pushed, commit `9bae1af`).

**Root cause:** the 5 demo iframes on the homepage each loaded React, Babel Standalone, and Tailwind's CDN JIT compiler, translating JSX live in the browser on every page load. Confirmed via live Lighthouse test that Babel alone was ~86% of all script execution time.

**Fix:** added this repo's first build tooling (Babel CLI + Tailwind CLI), precompiled each demo's JSX/CSS ahead of time, output committed to git rather than built by Vercel (`vercel.json`'s `framework`/`buildCommand` override — verified against Vercel's actual current docs, not assumed).

**Production result, measured directly:**
| Metric | Before | After |
|---|---|---|
| Performance score | 28 | **75** |
| Total Blocking Time | 2,820 ms | **0 ms** |
| Page weight | 1,243 KiB | **546 KiB** |

Build reproducibility confirmed via a clean-checkout rebuild (removed `node_modules`/`dist`, reinstalled, rebuilt from scratch, byte-identical output).

Also fixed same session, discovered via the same investigation thread: the 5 demos looked "very game-like" — 3 of 5 used off-brand stock icon-pack PNGs (one had "MALL" literally written on it). Replaced with custom on-brand SVG icons matching the app's own icon style, thinned the phone-bezel mockups, added scene-transition fades. Full detail: `project_naavi_demo_storyboard_visual_quality` memory.

### 2. Hero video + video-indexing fix (shipped earlier same day, before F14)

`hero.mp4` compressed 24.5MB → 4.8MB (zero visible quality loss — screen-recording content compresses extremely well). Added `VideoObject` structured data after directly verifying Google's actual documentation contradicts a common third-party SEO-blog claim (video does NOT need to be "1/3 of the viewport" — that's not Google's real rule; the real rule is about the page's *purpose*, and the homepage isn't meant to be a video watch page). Full detail: `project_naavi_website_seo_overhaul` memory.

### 3. Three smaller SEO fixes, found via Ahrefs/Screaming Frog reports Wael shared

- **Orphan page fix**: `/report` had zero internal links anywhere — added to the site-wide footer. (3 other pages Ahrefs flagged as "orphaned" were false positives — they're linked via `shared.js`'s client-side-injected nav/footer, which Ahrefs' crawler likely doesn't render even though Google's does. Don't re-flag those without checking `shared.js` first.)
- **Missing H2 tags**: all 5 demo pages had zero `<h2>` anywhere (confirmed genuine, not a crawler artifact — checked both static HTML and JSX source). Added one static H2 tagline per page in the same crawler-visible block that already carries the H1.
- **Duplicate blog content**: `set-it-once` reused two illustrative stories near-verbatim from `agent-without-asking` (published a month earlier). Rewrote the two examples to remove the overlap while preserving the post's own argument. A third post initially suspected of overlap (`orchestration-not-automation`) turned out to be genuinely distinct on full read — no fix needed there.

Full technical detail on all three: `project_naavi_website_seo_overhaul` memory, 2026-07-08 section.

---

## Side threads this session (informational, no code changes)

- **Claude Desktop permission-prompt bug** — Wael's own GitHub issue #75235 confirmed to match a known, still-open Anthropic bug (#62084, closed "not planned" by Anthropic). No workaround exists. Memory: `project_claude_desktop_permission_regression` (updated this session with the verified root cause and issue numbers — don't re-diagnose from scratch).
- **Claude model selection guidance** — discussed which model (Fable 5 / Opus 4.8 / Sonnet 5 / Haiku 4.5) fits Naavi's actual workflow. Recommendation given: Sonnet 5 as the default (matches this project's bounded, checkpoint-driven governance process), Opus 4.8 for Protected Core / production-build sessions specifically, Fable 5 rarely. Not saved to memory — this was guidance for Wael's own tooling choice, not a project fact.
- **Session-length discussion** — confirmed with Wael that closing a session should be a functional/checkpoint decision (work reached a real boundary: shipped + verified, phase closed), not a percentage-of-context decision. Claude Code's own auto-compaction remains an automatic backstop regardless.

---

## Nothing outstanding from this session

All 6 pieces of work shipped, verified, and closed (F14, hero video, orphan page, H2 tags, blog duplicate content — 5 separate production pushes to `mynaavi-website`, all confirmed live). The only carryover to next session is the pre-existing F12/APK V302 priority, unchanged by anything in this session.
