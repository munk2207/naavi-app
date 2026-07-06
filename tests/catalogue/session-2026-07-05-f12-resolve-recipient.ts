/**
 * Session 2026-07-05 — F12 Phase 4 (zero-risk increment): resolve-recipient
 * Edge Function + lookup-contact's contact_id support.
 *
 * These are source-assertion tests (same pattern as
 * session-2026-07-03-f2b-reminder-label.ts and session-2026-07-05-f12-defect-b.ts)
 * confirming the new component's contract shape exists as designed in
 * docs/F12_PHASE2_CHANGE_PLAN_2026-07-05.md §1.
 *
 * Coverage gap acknowledged (Rule 15a exception path): resolve-recipient is
 * NOT YET WIRED to any caller — mobile, voice, and evaluate-rules all still
 * use their pre-existing resolution paths, deliberately, as a zero-risk
 * increment (see conversation 2026-07-05). A live end-to-end test (real HTTP
 * call, real contact data) should be added once a caller is switched over —
 * that is a separate, future step, not this one. Until then, these
 * structural tests are the coverage: they prove the code exists and is
 * shaped correctly, not that it behaves correctly end-to-end against live
 * Google People API data.
 */

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { expectTruthy } from '../lib/assertions';
import type { TestCase } from '../lib/types';

const RESOLVE_RECIPIENT_PATH = join(process.cwd(), 'supabase', 'functions', 'resolve-recipient', 'index.ts');
const LOOKUP_CONTACT_PATH    = join(process.cwd(), 'supabase', 'functions', 'lookup-contact', 'index.ts');
const CONFIG_TOML_PATH       = join(process.cwd(), 'supabase', 'config.toml');

export const session2026_07_05_f12ResolveRecipientTests: TestCase[] = [
  {
    id: 'f12.resolve-recipient-all-six-output-kinds',
    category: 'contacts',
    description: 'resolve-recipient implements all six output kinds from the Phase 2 §1 contract',
    async run() {
      const src = readFileSync(RESOLVE_RECIPIENT_PATH, 'utf8');
      for (const kind of ['literal_email', 'literal_phone', 'resolved_contact', 'ambiguous', 'not_found', 'invalid']) {
        expectTruthy(src.includes(`kind: '${kind}'`), `resolve-recipient must be able to return kind: '${kind}'`);
      }
    },
  },
  {
    id: 'f12.resolve-recipient-mode-specific-input',
    category: 'contacts',
    description: 'resolve-recipient distinguishes create mode (raw `to`) from fire mode (contact_id primary, to_name fallback)',
    async run() {
      const src = readFileSync(RESOLVE_RECIPIENT_PATH, 'utf8');
      expectTruthy(
        src.includes("const mode   = body.mode === 'fire' ? 'fire' : 'create';"),
        'mode must default to create and only switch to fire on explicit request',
      );
      expectTruthy(
        src.includes('callLookupContact({ contact_id: contactId, user_id: userId })'),
        'fire mode must try contact_id (canonical identity) first',
      );
      expectTruthy(
        src.includes("falling back to to_name") && src.includes('callLookupContact({ name: toName, user_id: userId })'),
        'fire mode must fall back to to_name only if contact_id lookup misses, per the identity hierarchy',
      );
    },
  },
  {
    id: 'f12.resolve-recipient-not-wired-to-any-caller',
    category: 'contacts',
    description: 'guard: resolve-recipient is not yet called from useOrchestrator.ts, the voice server, or evaluate-rules (zero-risk increment — this must stay true until a deliberate wiring step)',
    async run() {
      const orchestratorSrc = readFileSync(join(process.cwd(), 'hooks', 'useOrchestrator.ts'), 'utf8');
      const voiceSrc        = readFileSync(join(process.cwd(), 'naavi-voice-server', 'src', 'index.js'), 'utf8');
      const evaluateSrc     = readFileSync(join(process.cwd(), 'supabase', 'functions', 'evaluate-rules', 'index.ts'), 'utf8');
      expectTruthy(!orchestratorSrc.includes('resolve-recipient'), 'useOrchestrator.ts must not call resolve-recipient yet — this test should be updated (not deleted) when wiring happens');
      expectTruthy(!voiceSrc.includes('resolve-recipient'), 'naavi-voice-server must not call resolve-recipient yet');
      expectTruthy(!evaluateSrc.includes('resolve-recipient'), 'evaluate-rules must not call resolve-recipient yet');
    },
  },
  {
    id: 'f12.lookup-contact-contact-id-support',
    category: 'contacts',
    description: 'lookup-contact accepts contact_id as an alternative to name, and returns contact_id in every response shape',
    async run() {
      const src = readFileSync(LOOKUP_CONTACT_PATH, 'utf8');
      expectTruthy(
        src.includes('const { name, contact_id: bodyContactId, user_id: bodyUserId } = body;'),
        'lookup-contact must accept an optional contact_id in the request body',
      );
      expectTruthy(
        src.includes('if (bodyContactId?.trim()) {'),
        'lookup-contact must branch to a direct people/get fetch when contact_id is provided',
      );
      expectTruthy(
        src.includes('contact_id:       resourceName ?? null,') || src.includes('contact_id:        person.resourceName ?? bodyContactId.trim(),'),
        'lookup-contact must return contact_id in the mapped Contact shape',
      );
    },
  },
  {
    id: 'f12.lookup-contact-name-still-optional-input-unchanged',
    category: 'contacts',
    description: 'lookup-contact still accepts name-only requests exactly as before (backward compatibility for existing callers)',
    async run() {
      const src = readFileSync(LOOKUP_CONTACT_PATH, 'utf8');
      expectTruthy(
        src.includes('if (!name?.trim() && !bodyContactId?.trim()) {'),
        'lookup-contact must only reject when BOTH name and contact_id are absent — a name-only request (existing behavior) must still work',
      );
    },
  },
  {
    id: 'f12.resolve-recipient-registered-in-config-toml',
    category: 'smoke',
    description: 'resolve-recipient has a config.toml entry (verify_jwt = false, matching lookup-contact) so it deploys correctly',
    async run() {
      const src = readFileSync(CONFIG_TOML_PATH, 'utf8');
      expectTruthy(
        src.includes('[functions.resolve-recipient]'),
        'config.toml must have a [functions.resolve-recipient] section',
      );
    },
  },
];
