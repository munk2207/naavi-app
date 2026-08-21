/**
 * T12 — Voice environment equilibrium. Regression coverage (Rule 15a).
 *
 * ---------------------------------------------------------------------------
 * WHAT T12 IS
 *
 * The voice server calls 32 Supabase Edge Functions. Those functions live in a
 * different repository from the voice server, so promoting voice — merging
 * `staging` -> `main` — moves none of them. Nothing compared them between the
 * two Supabase projects, and three months of divergence was invisible to every
 * check the project owned.
 *
 * These tests lock in the mechanism that fixes it, and the two measurement
 * mistakes that made the problem look different from what it was.
 *
 * ---------------------------------------------------------------------------
 * THE T0 GATE
 *
 * `t12.create-contact.service-role-body-userid-resolves` is not an ordinary
 * regression test. It is the hard gate the Phase 3 review placed in front of
 * EVERY deployment in T12:
 *
 *   "4.1 / T0 must be a hard gate before any deployment. Establish
 *    create-contact behavior first. D1 cannot proceed without a conclusive
 *    result."
 *
 * It answers whether a service-role caller can resolve a user against the
 * deployed `create-contact`. Both real callers send the service-role key —
 * naavi-chat/intentHandlers.ts:1093 (with body user_id) and
 * naavi-voice-server/src/index.js:5263 (without) — and the stock multi-user
 * matrix does not cover that shape: its test (b) calls with mode 'anon'
 * (tests/lib/multiUserMatrix.ts:125). A stock entry would have confirmed only
 * what the source diff already proved.
 *
 * Run it against PRODUCTION to answer the gating question. Production is the
 * project running committed HEAD; staging runs a newer copy and would report
 * success regardless of what HEAD does.
 *
 * ---------------------------------------------------------------------------
 * WHY THIS TEST HAS NO SIDE EFFECTS, WHICH IS NOT OBVIOUS
 *
 * `create-contact` does NOT write to a local table. It writes to the user's
 * Google Contacts through the People API, and there is no `delete-contact` on
 * production to undo it with. A naive test would leave a real contact in a real
 * Google account.
 *
 * It does not need to. The function's own ordering separates the two outcomes
 * before it ever reaches Google:
 *
 *   user resolution fails  -> rejected (401 / "No user found")
 *   user resolution works  -> proceeds -> looks up that user's Google token
 *                             -> none exists -> "No Google token found"
 *
 * So sending a syntactically valid but NONEXISTENT user_id distinguishes the
 * two perfectly, and stops one step short of creating anything. The test asks
 * its question and touches nothing.
 *
 * ---------------------------------------------------------------------------
 * COVERAGE GAPS ACKNOWLEDGED (Rule 15a)
 *
 *  - `parity:verify` itself is not exercised here. It downloads from both
 *    Supabase projects and takes minutes; running it inside the suite would
 *    make every test run depend on two live projects and the Supabase CLI.
 *    It is a manual/promotion-time gate by design (Phase 2 §4b).
 *  - The OUTBOUND_ALLOWLIST production assertion is not exercised here, for the
 *    same reason: it reads production secrets over the network.
 *  - `create-contact` is deliberately NOT added to the standing multi-user
 *    matrix. Doing so needs `tests/lib/multiUserMatrix.ts` extended with a
 *    service-role variant of test (b), and that file is not in the Phase 3
 *    Implementation Boundaries. Recorded as a follow-up, not done silently.
 */

import type { TestCase, TestContext } from '../lib/types';
import { execFileSync } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';

const REPO = path.resolve(__dirname, '..', '..');
const VOICE_SRC = path.join(REPO, 'naavi-voice-server', 'src');
const PARITY_SCRIPT = path.join(REPO, 'scripts', 'edge-function-parity-check.js');
const DEPLOY_SCRIPT = path.join(REPO, 'scripts', 'deploy-edge-function.js');
const PRE_PUSH = path.join(REPO, '.githooks', 'pre-push');

/** The seven slugs that appear ONLY inside comments in the voice server. */
const COMMENT_ONLY_SLUGS = [
  'naavi-chat',
  'sync-gmail',
  'text-to-speech',
  'evaluate-rules',
  'trigger-morning-call',
  'assistant-fulfillment',
  'extract-email-actions',
];

/** Same strict extraction the gate uses: real call sites, not string mentions. */
function strictVoiceBoundary(): string[] {
  const slugs = new Set<string>();
  const walk = (dir: string) => {
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      const p = path.join(dir, e.name);
      if (e.isDirectory()) walk(p);
      else if (e.isFile() && /\.(js|ts|mjs|cjs)$/.test(e.name)) {
        const text = fs.readFileSync(p, 'utf8');
        for (const m of text.matchAll(/functions\/v1\/([a-z0-9-]+)/g)) slugs.add(m[1]);
      }
    }
  };
  walk(VOICE_SRC);
  return [...slugs].sort();
}

export const t12EdgeFunctionParityTests: TestCase[] = [
  // ──────────────────────────────────────────────────────────────────────────
  // THE T0 GATE
  // ──────────────────────────────────────────────────────────────────────────
  {
    id: 't12.create-contact.service-role-body-userid-resolves',
    category: 'contacts',
    description:
      '[T12 T0 GATE] create-contact honours body user_id when called with the service-role key (the shape naavi-chat and the voice server actually use)',
    timeoutMs: 30_000,
    async run(ctx: TestContext) {
      // A syntactically valid UUID that belongs to nobody. If user resolution
      // works, the function proceeds and fails at the Google-token lookup. If
      // resolution does not work, it rejects before that. Nothing is created
      // in either case — see the header.
      const nobody = '00000000-0000-4000-8000-000000000000';

      const res = await fetch(`${ctx.supabaseUrl}/functions/v1/create-contact`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${ctx.serviceRoleKey}`,
          apikey: ctx.serviceRoleKey,
        },
        body: JSON.stringify({ name: 'T12 Probe', user_id: nobody }),
      });

      const text = await res.text();
      ctx.log(`status=${res.status} body=${text.slice(0, 300)}`);

      const rejectedForAuth =
        res.status === 401 ||
        /unauthori[sz]ed/i.test(text) ||
        /no user found/i.test(text);

      if (rejectedForAuth) {
        throw new Error(
          'create-contact REJECTED a service-role caller that supplied body user_id. ' +
            'This is the T12 T0 gate and it has failed: both real callers use this exact ' +
            'shape (naavi-chat/intentHandlers.ts:1093, naavi-voice-server/src/index.js:5263), ' +
            'so ADD_CONTACT is broken in this environment. NO T12 DEPLOYMENT MAY PROCEED. ' +
            `status=${res.status} body=${text.slice(0, 300)}`,
        );
      }

      // Resolution succeeded. Reaching the Google-token step is the proof —
      // it is the first thing that happens AFTER a user is resolved.
      if (!/google token/i.test(text) && !(res.status >= 200 && res.status < 300)) {
        throw new Error(
          'create-contact neither rejected the caller nor reached the Google-token step. ' +
            'The outcome is ambiguous, so the T0 gate is NOT satisfied — per Phase 2 §8.1, ' +
            `escalate to a direct live test rather than assuming. status=${res.status} body=${text.slice(0, 300)}`,
        );
      }
    },
  },

  // ──────────────────────────────────────────────────────────────────────────
  // THE MEASUREMENT MISTAKES — locked so they cannot come back
  // ──────────────────────────────────────────────────────────────────────────
  {
    id: 't12.boundary.excludes-comment-only-mentions',
    category: 'smoke',
    platform: 'voice', // reads naavi-voice-server/ source directly
    description:
      '[T12] the voice boundary is derived from real call sites — slugs appearing only in comments are excluded',
    async run(ctx: TestContext) {
      const boundary = strictVoiceBoundary();
      ctx.log(`boundary size = ${boundary.length}`);

      // Phase 0 of T12 reported 39 functions by matching the slug as a string
      // anywhere in src/. Seven of those were prose inside comments. The
      // strict extraction gives 32. If this ever regresses, the gate starts
      // demanding parity for functions the voice server never calls.
      const leaked = COMMENT_ONLY_SLUGS.filter((s) => boundary.includes(s));
      if (leaked.length) {
        throw new Error(
          `Boundary derivation regressed to loose matching. These appear only in ` +
            `comments in naavi-voice-server/src and must not be in the boundary: ${leaked.join(', ')}`,
        );
      }

      if (boundary.length < 20 || boundary.length > 45) {
        throw new Error(
          `Voice boundary is ${boundary.length} functions, which is outside the sane range. ` +
            'Either the extraction broke or the voice server changed substantially — check before widening this.',
        );
      }
    },
  },

  {
    id: 't12.parity-check.declares-itself-not-proof',
    category: 'smoke',
    description:
      '[T12] parity:check states in its own output that it is NOT proof of equilibrium and names parity:verify as the authority',
    async run(ctx: TestContext) {
      const src = fs.readFileSync(PARITY_SCRIPT, 'utf8');

      // Phase 3 mandatory change 2, item 4: the tooling must enforce this
      // rather than rely on discipline. A future reader of a green
      // parity:check must not be able to mistake it for proof of equality.
      if (!/NOT PROOF OF EQUILIBRIUM/i.test(src)) {
        throw new Error(
          "parity:check no longer tells the reader it is not proof of equilibrium. " +
            'That sentence is a Phase 3 mandatory change, not decoration: the manifest it ' +
            'reads is bypassed by anyone using the raw Supabase CLI.',
        );
      }
      if (!/parity:verify/.test(src)) {
        throw new Error('parity:check no longer names parity:verify as the authoritative check.');
      }
      ctx.log('disclaimer and authority reference both present');
    },
  },

  {
    id: 't12.parity-gate.wired-into-pre-push',
    category: 'smoke',
    description: '[T12] the parity gate is bound to pre-push, not left as a command someone must remember',
    async run(ctx: TestContext) {
      const hook = fs.readFileSync(PRE_PUSH, 'utf8');
      if (!/parity:check/.test(hook)) {
        throw new Error(
          'pre-push no longer runs parity:check. Binding it to a command someone must ' +
            'remember makes it a ritual, not a gate — the exact reasoning that put the ' +
            'drift check here (Wael, 2026-08-20).',
        );
      }
      if (!/PUSH REFUSED/.test(hook)) {
        throw new Error('pre-push no longer refuses the push on a parity failure.');
      }
      ctx.log('parity gate present in pre-push and fails closed');
    },
  },

  // ──────────────────────────────────────────────────────────────────────────
  // THE MECHANISM THAT ADDRESSES THE ROOT CAUSE
  // ──────────────────────────────────────────────────────────────────────────
  {
    id: 't12.deploy-wrapper.refuses-uncommitted-source',
    category: 'smoke',
    description:
      '[T12] the deploy wrapper refuses to deploy a function with uncommitted changes — the defect that put unversioned code on staging',
    timeoutMs: 60_000,
    async run(ctx: TestContext) {
      // Staging's create-contact was found running 37 lines that existed in no
      // commit, while production matched HEAD exactly. A promotion mechanism
      // keyed on git would never have moved that code. This refusal is what
      // makes "deployment comes from git" true rather than merely intended.
      const probeDir = path.join(REPO, 'supabase', 'functions', 'get-naavi-prompt');
      const probe = path.join(probeDir, '__t12_probe.ts');

      fs.writeFileSync(probe, '// temporary T12 test probe — deleted by teardown\n');

      let exitCode = 0;
      let output = '';
      try {
        output = execFileSync(
          process.execPath,
          [DEPLOY_SCRIPT, 'get-naavi-prompt', 'staging', '--dry-run'],
          { cwd: REPO, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] },
        );
      } catch (e: any) {
        exitCode = e.status ?? 1;
        output = `${e.stdout ?? ''}${e.stderr ?? ''}`;
      }

      ctx.log(`exit=${exitCode} output=${output.slice(0, 300)}`);

      if (exitCode === 0) {
        throw new Error(
          'The deploy wrapper allowed a dry-run deploy of a function with an uncommitted ' +
            'file present. The dirty-tree refusal is the mechanism that prevents unversioned ' +
            'code reaching a Supabase project, and it is not working.',
        );
      }
      if (!/DEPLOY REFUSED/.test(output)) {
        throw new Error(`Wrapper exited non-zero but did not refuse for the expected reason: ${output.slice(0, 300)}`);
      }
    },
    async teardown() {
      const probe = path.join(REPO, 'supabase', 'functions', 'get-naavi-prompt', '__t12_probe.ts');
      if (fs.existsSync(probe)) fs.unlinkSync(probe);
    },
  },

  {
    id: 't12.parity.normalization-ignores-formatting',
    category: 'smoke',
    description:
      '[T12] source comparison normalizes line endings and trailing whitespace — one extra space must never register as drift',
    async run(ctx: TestContext) {
      const src = fs.readFileSync(PARITY_SCRIPT, 'utf8');

      // Architecture Reference §0c: the T4 drift check hashed function bodies
      // raw, and one extra space made two identical functions look different.
      // That defect presented exactly like real drift. This is the fix, and it
      // must stay.
      const hasCrlf = /replace\(\/\\r\\n\/g, '\\n'\)/.test(src);
      const hasTrailing = /replace\(\/\[ \\t\]\+\$\/, ''\)/.test(src);

      if (!hasCrlf || !hasTrailing) {
        throw new Error(
          'Source normalization was removed from the parity check. Raw hashing has already ' +
            'produced false drift in this project once (Architecture Reference §0c) — ' +
            `crlf=${hasCrlf} trailingWhitespace=${hasTrailing}`,
        );
      }

      // And the comparator proven wrong must not reappear AS CODE.
      //
      // This assertion originally grepped the raw file and errored on its first
      // real run (Phase 7, 2026-08-21) — because the parity script's header
      // comment explains at length WHY ezbr_sha256 must never be used, and the
      // grep matched that explanation. The test failed on the documentation of
      // the rule it exists to enforce.
      //
      // Precisely: the old form was OVER-strict, not under-strict. It caught
      // every real usage too, so nothing slipped past it — the cost was a
      // permanent false positive that punished explaining the rule, and would
      // have pushed a future maintainer to delete the explanation to get the
      // suite green. Stripping comments keeps the same protection without
      // creating an incentive to remove the reasoning.
      //
      // Verified in three cases when fixed: real file passes (2 mentions, 0 in
      // code); an injected property access is caught; and a usage added after
      // deleting the comments is still caught.
      const code = src
        .replace(/\/\*[\s\S]*?\*\//g, '')
        .split('\n')
        .filter((l) => !/^\s*(\/\/|\*)/.test(l))
        .join('\n');

      if (/ezbr_sha256/.test(code)) {
        throw new Error(
          'The parity check USES ezbr_sha256 in executable code. That field is not a hash of ' +
            'the function source — it reported 20 differences on the voice boundary of which 15 ' +
            'were byte-identical on production, staging and in the repo. It must not be used as ' +
            'a comparator. (Mentioning it in a comment is fine and expected.)',
        );
      }
      ctx.log('normalization present; ezbr_sha256 absent from executable code');
    },
  },
];
