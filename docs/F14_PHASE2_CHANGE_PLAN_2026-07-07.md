# F14 — Phase 2: Change Plan

Per `docs/AI_DEVELOPMENT_GOVERNANCE.md` Phase 2. No code written in this document. Builds on `docs/F14_PHASE1_PROBLEM_DEFINITION_2026-07-07.md` (root cause: Babel Standalone ~86% of script execution time; Tailwind CDN the secondary live-compilation dependency; hero-video-size hypothesis ruled out with evidence; direction 1 of 5 alternatives selected as leading hypothesis).

---

## 1. Chosen direction (from Phase 1 §4)

**Precompile via Babel CLI + Tailwind CLI, local build with committed output — not a Vercel-side build.**

- Babel CLI (`@babel/core`, `@babel/cli`, `@babel/preset-react`) translates each demo's JSX ahead of time, using the same transform (`preset-react`) already proven correct at runtime in all 5 files — a translation of working code, not a rewrite.
- Tailwind CLI replaces the CDN JIT script with a single precompiled CSS file.
- React and ReactDOM stay on the CDN unchanged — Phase 1 Evidence 2 showed they're a negligible cost (673ms + 109ms combined, vs. Babel's 8,809ms).
- The build runs locally, and its output is committed to git like any other file — Vercel continues serving static files with zero build step, exactly as it does today. This avoids introducing a new failure mode where a broken build takes the entire site down (not just these 5 pages).

## 2. Files that will change

| File | Classification | Change |
|---|---|---|
| `mynaavi-website/package.json` | **Dependency** (new file — first for this repo) | Declares `@babel/core`, `@babel/cli`, `@babel/preset-react`, `tailwindcss` as dev dependencies; adds a `build:demos` script. |
| `mynaavi-website/.gitignore` | Configuration | Add `node_modules/` — without this, adding `package.json` risks committing the dependency tree. |
| `mynaavi-website/babel.config.json` | Configuration (new) | Tells Babel CLI to use `@babel/preset-react`, matching the runtime config each file's `<script type="text/babel">` block implicitly used via Babel Standalone's defaults. |
| `mynaavi-website/tailwind.config.js` | Configuration (new) | Points Tailwind CLI at the 5 demo HTML/JSX files so it generates CSS only for classes actually used, matching what the CDN's JIT scanner did live. |
| `mynaavi-website/vercel.json` | **Configuration** | Add `"framework": null` (selects "Other" preset) + `"buildCommand": ""` (empty override). **Required, not optional** — once `package.json` exists in this repo, Vercel's framework auto-detection could start running an unintended build on every push. **Verified against Vercel's current official documentation** (`vercel.com/docs/project-configuration/vercel-json`, `vercel.com/docs/deployments/configure-a-build`, fetched 2026-07-07) rather than assumed: the documented "Skip Build Step" path is exactly "Specify 'Other' as the framework preset, enable the Override option for the Build Command, leave the Build Command empty — this prevents running the build, and your content is served directly." Note this corrects an earlier draft of this plan, which proposed `"buildCommand": null` alone — that property's `null` state isn't documented as meaning "skip the build," only as "unset/default," which could still fall through to auto-detection. |
| `mynaavi-website/src/notes-demo.jsx`, `brakes-demo.jsx`, `granddaughter-demo.jsx`, `doctor-demo.jsx`, `insurance-demo.jsx` | UI (new files) | Each file's existing JSX is moved out of its inline `<script type="text/babel">` block into its own source file — copy, not rewrite. Content unchanged. |
| `mynaavi-website/notes-demo-storyboard.html`, `brakes-demo-storyboard.html`, `granddaughter-demo-storyboard.html`, `doctor-demo-storyboard.html`, `insurance-demo-storyboard.html` | UI | Remove the `babel.min.js` and `cdn.tailwindcss.com` `<script>` tags. Remove the inline `<script type="text/babel">` block (content now lives in the matching `.jsx` file, §2 above). Add one `<link rel="stylesheet" href="dist/demos.css">` and one `<script src="dist/[name].compiled.js"></script>`. React/ReactDOM CDN tags, all HTML structure, all CSS classes, all Web Audio/audio-file code: **unchanged**. |
| `mynaavi-website/dist/notes-demo.compiled.js` (and 4 more, one per demo) | UI (generated, committed) | Build output — the precompiled JS each HTML file now loads instead of translating live. **Never edited by hand — see rule below.** |
| `mynaavi-website/dist/demos.css` | UI (generated, committed) | Build output — the precompiled stylesheet replacing the Tailwind CDN script. **Never edited by hand — see rule below.** |
| `docs/HOLDING_LIST_CLASSIFICATION_2026-06-11.md` | Documentation | Update on completion. |

**Not touched:** any file in the main Naavi repo, `naavi-voice-server`, or any Supabase Edge Function — this is entirely contained within `mynaavi-website`, which has no backend. No DB migration (this repo has no database). No change to the 5 demos' visual design, animation timing, sound effects, or the icon/bezel/transition work shipped earlier this session.

## 3. Explanation for every modification (why each file needs to change)

- **`package.json`, `.gitignore`, `babel.config.json`, `tailwind.config.js`** exist because this repo has zero build tooling today (confirmed, Phase 1 §5) — these are the minimum files needed to run Babel CLI and Tailwind CLI at all.
- **`vercel.json`** needs the explicit no-op build override because Vercel's zero-config static hosting (current, working, zero-risk) could otherwise auto-detect the new `package.json` and start running its own build — an unintended and unreviewed change to how the *entire site* deploys, not just these 5 pages.
- **The 5 `.jsx` source files** exist because Babel CLI needs a real file to compile — it can't reach into an inline `<script>` tag inside an HTML file the way Babel Standalone (running in the browser) could.
- **The 5 HTML files** change only in *which scripts they load*, not in what they contain or how they look — three CDN tags out, two local file references in.
- **The `dist/` output** exists because the whole point of this fix is: translate once, ahead of time, instead of on every single page load.

**Generated-file rule (added per external review):** files under `dist/` are build output, never a source of truth. Any future change to a demo's behavior must be made in its `src/*.jsx` file and regenerated via `npm run build:demos` — never patched directly in `dist/`. Without this rule stated explicitly, a future session could edit `dist/notes-demo.compiled.js` directly (it looks like ordinary JS, nothing marks it as generated), and the next full rebuild would silently discard that edit — a maintenance trap that costs nothing to prevent now with one sentence.

**Build reproducibility (optional, best practice, non-blocking — for Phase 4 implementation, not this plan):** before any release that touches the 5 demos, the `dist/` output should be regenerated from a clean checkout (`npm install` then `npm run build:demos`) rather than trusting a possibly-stale local build. This is how a future session can immediately tell whether committed `dist/` output still matches `src/` after the build process itself changes, rather than discovering drift later. Noted here so it isn't lost before Phase 4 begins; not required to unblock Phase 3 or implementation.

## 4. Risk classification

| Change | Risk | Why |
|---|---|---|
| New `.jsx` source files (content moved, not rewritten) | **Low** | Mechanical extraction of already-working code; no logic changes. |
| Babel CLI / Tailwind CLI build tooling (`package.json`, configs) | **Low** | Dev-only tooling; does not run in the browser, does not affect what a visitor's browser executes beyond the final output files. |
| `vercel.json` build-override | **Medium** | Prevents an unintended risk (Vercel auto-build) but is itself a deploy-configuration change to the whole site, not just these 5 pages — must be verified correct before merge, not assumed. |
| The 5 HTML files' script/style tag swap | **Medium** | Touches the site's highest-traffic page (the homepage embeds all 5 via iframe). Low complexity per file, but a mistake here is visible to every homepage visitor immediately, unlike a change buried in a less-trafficked page. |
| Compiled output correctness (does the translated JS/CSS actually behave identically to the live-compiled version) | **Medium** | This is the crux of the whole change — precompiled output must be behaviorally identical to what Babel Standalone produced at runtime, including the Web Audio brake-squeal synthesis in `brakes-demo-storyboard.html`, which is plain JS (not JSX-dependent) but must still be verified working end-to-end after the file reorganization. |

**Overall: Medium.** No Protected Core overlap (confirmed Phase 1 §5 — `mynaavi-website` has no backend), but the homepage-traffic factor and the deploy-configuration change together keep this above a Low rating. Per `AI_DEVELOPMENT_GOVERNANCE.md`, Medium risk requires Phase 3 external review before implementation.

## 5. Regression Impact

Per `AI_DEVELOPMENT_GOVERNANCE.md` Phase 2's mandatory checklist — every item addressed explicitly, none skipped:

| Area | Affected? | Why |
|---|---|---|
| Voice commands | **No** | `mynaavi-website` has no connection to `naavi-voice-server` or any voice code path. |
| Geofencing | **No** | No connection to location/geofencing systems — this repo has no backend at all. |
| Gmail integration | **No** | No connection to Gmail/email systems. |
| Calendar integration | **No** | No connection to calendar systems. |
| Reminders | **No** | No connection to the reminders system. |
| SMS / call alerts | **No** | No connection to alert-firing systems. |
| Onboarding | **No** | `mynaavi-website` is the marketing site, not the app's onboarding flow (that's in the mobile app repo). |
| Staging build | **No** | This repo has no staging environment (per `CLAUDE.md`: "this repo has no staging environment — Vercel auto-deploys `origin/main` directly to mynaavi.com"). There is no staging build to affect. |

**What *is* affected, stated explicitly since the checklist above is all "No":** the mynaavi.com homepage's rendering of the 5 embedded demos (visual output and interactive behavior must remain identical), and the site's Vercel deploy configuration (via the `vercel.json` change in §2). Both are addressed by the testing plan in §6.

## 6. Testing plan (for Phase 4, stated now per Phase 2 requirements)

- Side-by-side comparison of each demo's full scene sequence, before and after, on both the standalone page and the homepage iframe embed.
- Confirm every sound cue fires correctly post-change: the Brakes squeal (Web Audio synthesis, plain JS — should be unaffected by the JSX precompile but must be verified end-to-end since its file was reorganized), and the pre-recorded voice-clip audio (`audio/robert/`, `audio/naavi/`, `audio/layla/`) across all 5 demos.
- Confirm Play / Replay / Stop controls still work on all 5.
- Re-run Lighthouse against the deployed change (same methodology as Phase 1 Evidence 2) and confirm Total Blocking Time drops substantially and the `babel.min.js`/Tailwind CDN console warnings are gone.
- Confirm `vercel.json`'s config actually prevents Vercel from running an unintended build — verify via the Vercel deploy log on the first push that includes `package.json`.

**Added per external review — real-user responsiveness, not synthetic score alone.** Lighthouse's Total Blocking Time is a synthetic, simulated-throttling metric — it approximates but is not identical to what a visitor actually experiences. The real business objective this fix serves is: **verify the homepage becomes immediately scrollable after initial render.** Specifically:
- Browser memory usage on the homepage before vs. after (DevTools Performance/Memory panel), to confirm the fix isn't just moving the cost from CPU-time-to-first-scroll into a larger memory footprint.
- CPU usage during and immediately after homepage load.
- Direct manual check: does the page respond to a scroll gesture immediately after content appears, or is there a perceptible freeze — this is the concrete, user-facing form of what Total Blocking Time only approximates.

This repo has no automated test suite (`npm run test:auto` covers the main Naavi repo only) — all verification here is manual, browser-based, consistent with how this repo has always been validated (per `project_naavi_website_seo_overhaul` memory's "verify every claim against the live site" practice).

## 7. Rollback (added per external review — mechanics, not just what changes)

Rollback consists of restoring the previous versions of the 5 HTML files (which reference the CDN scripts directly, no `dist/` dependency) and removing the new `dist/`, `src/`, `package.json`, `babel.config.json`, `tailwind.config.js`, and `vercel.json` changes, then redeploying — a standard `git revert` of the merge commit. **Since this change touches no backend, no database schema, and no runtime configuration outside this one static site, rollback is immediate and low-risk**: the reverted HTML files go straight back to loading React/Babel/Tailwind from the CDN exactly as they do today, with no data migration, no state to reconcile, and no other system affected. This is a materially simpler rollback than most changes in this project specifically because F14 has zero Protected Core overlap (Phase 1 §5) — confirmed again here, not just asserted.

## 8. Phase 3 — Technical Review (Before Coding)

**Complete, approved 2026-07-07.** Two review rounds during Phase 2 (real-user responsiveness testing, generated-file rule, rollback mechanics, Vercel config correction verified against current docs; plus the optional build-reproducibility note), followed by an explicit final approval pass confirming the plan as revised is approved to proceed to Phase 4. Per `AI_DEVELOPMENT_GOVERNANCE.md` §8 Approval Philosophy, this approval came from Wael (Product Owner), not self-declared.

## 9. Next step

**Approved for Phase 4 (Implementation), 2026-07-07.** Implementation limited strictly to the files and changes listed in §2 — per the governance doc's Phase 4 "No Extra Changes Rule," no refactoring, cleanup, renaming, or unrelated changes beyond what's approved here.

## 10. Revision history

- **2026-07-07, first draft.**
- **2026-07-07, this revision** (after external technical review): added explicit real-user-responsiveness verification (browser memory, CPU usage, and direct "does it scroll immediately" check) alongside Lighthouse, since Lighthouse is a synthetic metric and the actual business objective is felt responsiveness, not a score — Recommendation 1. Added an explicit rule that `dist/` output is never hand-edited, source of truth is always `src/*.jsx`, to prevent future maintenance debt — Recommendation 2. Added explicit rollback mechanics (§7), not just a list of what changes — Recommendation 3. **Corrected the Vercel build-disable mechanism** after being asked to verify rather than assume: `"buildCommand": null` alone is not Vercel's documented way to skip a build; verified against current Vercel docs that the actual mechanism is `"framework": null` + an empty `"buildCommand"` string (§2).
- **2026-07-07, second review round** (optional, non-blocking): added a build-reproducibility note to §2 — regenerate `dist/` from a clean checkout before release, so drift between source and committed output is caught immediately rather than discovered later. Marked explicitly as best practice, not a governance requirement; does not delay Phase 3 or implementation.
