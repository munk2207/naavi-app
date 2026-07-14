/**
 * Session 2026-07-13 — B9l: the Layer 2 classifier doesn't reliably put a
 * self-override destination into self_override_*; live-confirmed it can
 * instead put the literal phone number into to_name ("WhatsApp me at
 * +16137976746 in 3 minutes say helo" -> params.to_name="+16137976746", no
 * self_override_whatsapp field at all). This sent the request down the
 * third-party lookup-contact path in the time-trigger __FALLTHROUGH__
 * handler, which searched contacts for a contact literally named a phone
 * number, found none, and failed with "I couldn't find a phone number for
 * +16137976746 in your contacts. Please add them and try again." — a
 * confusing, wrong response for what was actually a valid self-override
 * request.
 *
 * Root cause is a classifier consistency issue, not a routing bug (B9i,
 * already fixed, handles the case where self_override_* IS present
 * correctly) — the classifier just doesn't always populate the field. Fix
 * is a deterministic code-level guard rather than a prompt tweak, matching
 * this codebase's existing philosophy of never trusting the LLM to be
 * consistent (see project_naavi_deterministic_design memory): if to_name is
 * itself phone-shaped and no self_override_* field is already set, it was
 * never a real contact name — move it into the self_override_* field
 * matching action_type (whatsapp/email/sms) and clear to_name, before the
 * third-party lookup-contact path ever runs.
 *
 * Coverage gap, disclosed per CLAUDE.md Rule 15a: naavi-chat/index.ts is a
 * Deno Edge Function and cannot be imported into this Node/tsx test runner
 * — same disclosed limitation as the rest of the F12/F15/B9i/B9k catalogue.
 * These are source-pattern assertions verifying the guard exists, runs
 * before the third-party lookup-contact call, and is scoped correctly (only
 * fires when to_name is phone-shaped AND no self_override_* is already
 * present, so a genuine third-party alert with a real contact name is
 * unaffected).
 */

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { expectTruthy } from '../lib/assertions';
import type { TestCase } from '../lib/types';

const NAAVI_CHAT_PATH = join(process.cwd(), 'supabase', 'functions', 'naavi-chat', 'index.ts');

export const session2026_07_13_b9lPhoneShapedToNameTests: TestCase[] = [
  {
    id: 'b9l.phone-shaped-to-name-reclassified-before-lookup-contact',
    category: 'rules',
    description: 'a phone-shaped to_name with no self_override_* already present gets moved into the matching self_override_* field and to_name cleared, before the third-party lookup-contact call runs',
    async run() {
      const src = readFileSync(NAAVI_CHAT_PATH, 'utf8');

      const ftBlockStart = src.indexOf("if (_ftTrigger === 'time' && userId) {");
      expectTruthy(ftBlockStart !== -1, 'time-trigger __FALLTHROUGH__ handler not found');

      const guardIdx = src.indexOf('/^\\+?\\d[\\d\\s\\-().]{5,}$/.test(_ftToName)', ftBlockStart);
      expectTruthy(guardIdx !== -1, 'B9l fix: phone-shaped to_name regex guard not found in time-trigger fallthrough handler');

      const lookupContactIdx = src.indexOf('/functions/v1/lookup-contact', ftBlockStart);
      expectTruthy(lookupContactIdx !== -1, 'lookup-contact fetch call not found in time-trigger fallthrough handler (unexpected — did the surrounding code change shape?)');

      expectTruthy(
        guardIdx < lookupContactIdx,
        'B9l fix: the phone-shaped to_name guard must run BEFORE the lookup-contact call, otherwise a self-override misclassified as to_name still hits the contact-lookup failure path',
      );

      const guardBlockEnd = src.indexOf("_ftToName = '';", guardIdx);
      const guardBlock = src.slice(guardIdx - 400, guardBlockEnd + 20);

      expectTruthy(
        guardBlock.includes('!_ftParamAny.self_override_email') && guardBlock.includes('!_ftParamAny.self_override_whatsapp'),
        'B9l fix must only fire when no self_override_* field is already present, so a correctly-classified self-override request is unaffected (handled entirely by the existing B9i logic)',
      );
      expectTruthy(
        guardBlock.includes("_ftActionType === 'whatsapp' ? 'self_override_whatsapp'"),
        'B9l fix must route a phone-shaped to_name to self_override_whatsapp when action_type is whatsapp, matching the classifier\'s own documented field-per-channel convention',
      );
      expectTruthy(
        guardBlock.includes("_ftToName = '';"),
        'B9l fix must clear to_name after reclassifying it, so the third-party lookup-contact branch is skipped entirely for this request',
      );
    },
  },
];
