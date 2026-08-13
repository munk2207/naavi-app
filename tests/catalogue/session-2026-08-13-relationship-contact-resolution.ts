/**
 * 2026-08-13 — relationship-word contact resolution (DRAFT_MESSAGE recipient).
 *
 * Live bug, found by Wael: "Send sms to my wife saying good morning"
 * produced a draft addressed literally "To: wife" and asked him to type an
 * email manually — even though he'd just told Naavi "Linda is my wife" and
 * Linda is a real saved contact (Linda Fournier, phone + email on file).
 * The prompt claims "contact resolution happens automatically" for this
 * exact phrase ("text my wife" is its own worked example), but nothing in
 * the code ever substituted "wife" → "Linda" before searching Google
 * Contacts for a contact literally named "wife" — which never exists.
 *
 * Fix: lookup-contact (the single confluence point both DraftCard's SMS
 * path (`lookupContact`) and email path (`resolveRecipient`) call) now
 * checks knowledge_fragments for a saved relationship fact matching the
 * word before running its normal Google Contacts search — see
 * supabase/functions/_shared/resolve_relationship_contact.ts.
 *
 * Coverage note: there's no delete-capable Edge Function to manufacture a
 * throwaway contact for this test to fully own end to end (create-contact
 * exists, no counterpart delete), so the positive control self-seeds a
 * relationship fact ("Bob is my boss") against "Bob" — confirmed as a real,
 * MyNaavi-labelled contact on the auto-tester's own account (`ctx.testUserId`,
 * NOT Robert's — see b10r-contact-birthdays.ts, which established this same
 * account has "Bob" with a real birthday/anniversary on file). This avoids
 * depending on Robert's separate "Linda is my wife" data, which lives on a
 * different, protected account (`f1bc46b8...`) this suite never touches.
 */

import { adapters } from '../lib/adapters';
import { expect2xx, expectTruthy } from '../lib/assertions';
import type { TestCase } from '../lib/types';

export const relationshipContactResolutionTests: TestCase[] = [
  {
    id: 'session-2026-08-13.relationship-word-resolves-to-real-contact',
    category: 'contacts',
    description:
      'lookup-contact("boss") must resolve to the real contact backing a ' +
      'just-saved "Bob is my boss" fact, not search for a contact literally named "boss".',
    timeoutMs: 20_000,
    async run(ctx) {
      const ingest = await adapters.ingestNote(ctx, 'Bob is my boss.');
      expect2xx(ingest.status, 'ingest-note');
      await new Promise(r => setTimeout(r, 2000));

      const res = await adapters.lookupContact(ctx, 'boss');
      expect2xx(res.status, 'lookup-contact');
      ctx.log(`contact=${JSON.stringify(res.data?.contact)}`);
      expectTruthy(res.data?.contact, 'lookup-contact("boss") must return a resolved contact, not null');
      expectTruthy(
        String(res.data?.contact?.name ?? '').toLowerCase().includes('bob'),
        `resolved contact must be Bob (from "Bob is my boss"), got "${res.data?.contact?.name}"`,
      );
    },
  },
  {
    id: 'session-2026-08-13.unrelated-relationship-word-stays-honest',
    category: 'contacts',
    description:
      'lookup-contact("neighbour") must return not-found cleanly when no ' +
      'relationship fact is saved for that word — never guess or fabricate a match.',
    timeoutMs: 20_000,
    async run(ctx) {
      const res = await adapters.lookupContact(ctx, 'neighbour');
      expect2xx(res.status, 'lookup-contact');
      ctx.log(`contact=${JSON.stringify(res.data?.contact)}`);
      expectTruthy(res.data?.contact == null, 'must not fabricate a contact for an unsaved relationship word');
    },
  },
];
