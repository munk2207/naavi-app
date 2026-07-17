# F14 — Phase 1: Problem Definition

Per `docs/AI_DEVELOPMENT_GOVERNANCE.md` Phase 1. No code is written in this phase. This formalizes and strengthens the informal scoping captured in the F14 holding-list entry (`docs/HOLDING_LIST_CLASSIFICATION_2026-06-11.md`) with live evidence gathered 2026-07-07, and adds the "alternatives considered" analysis that entry was missing.

Phase 2 (Change Planning) has not started.

---

## 1. What exactly is broken

The mynaavi-website homepage (`index.html`) embeds 5 demo storyboards via iframe: `notes-demo-storyboard.html`, `brakes-demo-storyboard.html`, `granddaughter-demo-storyboard.html`, `doctor-demo-storyboard.html`, `insurance-demo-storyboard.html`. Each one independently loads React, ReactDOM, and Babel Standalone from a CDN, plus Tailwind's CDN build, then translates its own JSX source code live in the visitor's browser, on every page load — regardless of whether the visitor ever scrolls down to see a demo (all 5 iframes are `loading="eager"`).

This makes the homepage's main thread too busy to respond to input (taps, scrolls, clicks) for several seconds after the page becomes visible.

## 2. What evidence proves the problem

**Evidence 1 — original PageSpeed Insights audit (Google's own infrastructure, 2026-07-07, prior session same day):**
- Performance score: 62/100 ("needs improvement")
- Total Blocking Time: 6,300ms
- Main-thread work: 8.3s
- Console warning, quoted directly (not paraphrased): *"You are using the in-browser Babel transformer. Be sure to precompile your scripts for production"*
- Also flagged in the same run, not yet fixed, out of scope for F14: an accessibility contrast issue (Accessibility score 91; SEO 100, Best Practices 96 — both clean).

**Evidence 2 — live Lighthouse re-test against production, this session (2026-07-07), mobile profile, standard PageSpeed methodology (`throttlingMethod: simulate`, `cpuSlowdownMultiplier: 4`, `formFactor: mobile`):**
- Total page weight: 1,243 KB
- Server response time: 210ms; network round-trip to mynaavi.com: 7.9ms — network is not the bottleneck
- Script execution, by source (`bootup-time` audit):

  | Script | Main-thread time |
  |---|---|
  | `babel.min.js` (Babel Standalone) | **8,809 ms** |
  | mynaavi.com's own page script | 806 ms |
  | `react.production.min.js` | 673 ms |
  | Unattributable | 471 ms |
  | insurance-demo-storyboard | 210 ms |
  | granddaughter-demo-storyboard | 177 ms |
  | brakes-demo-storyboard | 156 ms |
  | notes-demo-storyboard | 152 ms |
  | doctor-demo-storyboard | 144 ms |
  | `react-dom.production.min.js` | 109 ms |

- Main-thread work breakdown: Script Evaluation 8,732ms, Script Parsing & Compilation 1,510ms, Style & Layout 774ms, Other 552ms, Garbage Collection 203ms, Parse HTML & CSS 106ms, Rendering 32ms.
- **Babel Standalone alone accounts for ~86% of all script execution time measured.** The 5 demo storyboards' own component code (144–210ms each) is a small fraction of the cost — the compiler doing the translating, not the code being translated, is the dominant cost.

**Evidence 3 — direct source confirmation.** `grep` across all 5 files confirms each independently loads:
```
unpkg.com/react@18/umd/react.production.min.js
unpkg.com/react-dom@18/umd/react-dom.production.min.js
unpkg.com/@babel/standalone@7.23.5/babel.min.js
cdn.tailwindcss.com
```
and each has a `<script type="text/babel">` block (250–500 lines of inline JSX) that Babel Standalone translates at runtime. Tailwind's CDN script separately throws its own console warning: *"cdn.tailwindcss.com should not be used in production. To use Tailwind CSS in production, install it as a PostCSS plugin or use the Tailwind CLI."*

## 3. Ruled out during this investigation (documented so it is not re-raised)

**Not the cause: hero.mp4 file size.** A hypothesis raised this session was that the 24.5MB (pre-fix) hero video was the main driver of homepage slowness. Evidence against this, gathered directly rather than assumed:
- The hero `<video>` element uses `preload="metadata"` and no `autoplay` — confirmed via network log this session showing `206 Partial Content` range requests, not a full download, on page load.
- Evidence 2's total page weight (1,243 KB) is small and doesn't reflect a 24.5MB (or even the now-compressed 4.8MB) video being downloaded on load.
- The video does not appear anywhere in the script-execution or main-thread-work breakdown (Evidence 2) because it isn't a script and isn't fetched until a visitor presses play.
- The hero video was independently compressed this session (24.5MB → 4.8MB, unrelated fix, already shipped to production) — Evidence 2's re-test was run *after* that fix, and still shows the same Babel-dominated profile, confirming the video was never the driver.

## 4. What alternatives exist (Phase 2 will formally evaluate; listed here per the Phase 1 checklist)

1. **Precompile via Babel CLI + Tailwind CLI.** Translate each demo's JSX ahead of time using the exact same transform engine (`@babel/preset-react`) already proven correct at runtime in these 5 files, and replace Tailwind's CDN JIT with a CLI-built CSS file. React/ReactDOM stay on the CDN (Evidence 2 shows they're a negligible cost, 673ms + 109ms combined). **Leading candidate** — lowest behavioral-parity risk, since it's a translation of already-working code, not a rewrite.
2. **Precompile via esbuild instead of Babel CLI.** Faster build tool, but uses a different JSX-transform implementation than the one already validated in-browser — introduces a second variable (new tool *and* moved to build-time) instead of one.
3. **Rewrite the 5 demos without React/JSX entirely** (plain JS/DOM). Eliminates the framework dependency completely, but is a substantially larger rewrite of working code with correspondingly higher regression risk, including to the Web Audio-based brake-squeal synthesis in `brakes-demo-storyboard.html`.
4. **Replace the demos with real screen recordings or screenshots of the app**, matching the hero video's approach. Explicitly considered and rejected by Wael this session: *"the hero videos and YouTube videos will cover the real, I need to create a clear images and smoother looks."* The 5 demos stay illustrated/animated by design — this alternative is closed, not open for Phase 2.
5. **Do nothing / defer.** Evaluated this session: no confirmed real-world harm (no user complaints on record, site functions correctly today), only a synthetic benchmark score and a real-but-unquantified UX/SEO cost. Legitimate given the fix's genuine size (new build tooling in a repo that has none, full governance process, 5-file parity verification). Not selected only because Wael chose to proceed with scoping — but recorded here as a real, considered option, not dismissed.

**Deployment-approach note relevant to Phase 2 risk classification:** the safer implementation path is running the build locally and committing the precompiled output directly (matching this repo's current zero-build-step deploy model), rather than having Vercel run the build on every push — the latter would introduce a new failure mode where a broken build takes down the entire site, not just these 5 pages. This should be treated as effectively decided going into Phase 2, not a live alternative, given the "Protect stability before adding functionality" principle in `AI_DEVELOPMENT_GOVERNANCE.md` §2.

## 5. Why this is a full-governance item, not a cosmetic change

Checked directly against `AI_DEVELOPMENT_GOVERNANCE.md` §5's cosmetic-change test (only UI files change / no shared logic changes / no dependency changes / no configuration changes / no backend changes):
- **Fails on dependencies** — this repo has zero `package.json` today; adding Babel CLI and Tailwind CLI as dev dependencies is a first for this repo.
- **Fails on configuration** — Vercel currently serves raw static files with no build command; even the "build locally, commit output" approach (§4) changes the files' content and structure, and any future move to a Vercel-side build would change deploy configuration.

Per §5: *"If any non-UI component changes, the task is reclassified according to its actual risk."* Zero Protected Core overlap (`mynaavi-website` has no backend — confirmed against all 12 Protected Core areas in `AI_DEVELOPMENT_GOVERNANCE.md` §4), but risk is assessed as at least Medium given the homepage is the site's highest-traffic page and a mishandled build/deploy change has a larger blast radius than the change itself suggests. Medium/High risk requires Phase 3 (external technical review) before any code is written.

## 6. Next step

Phase 2 (Change Planning) has not started. It will formally evaluate the alternatives in §4 (leading hypothesis: direction 1, precompile via Babel CLI + Tailwind CLI, local build + committed output), produce the file classification and regression-impact table required by `AI_DEVELOPMENT_GOVERNANCE.md` §3 Phase 2, and assign a final risk rating — after which Phase 3 external review is required before implementation begins.
