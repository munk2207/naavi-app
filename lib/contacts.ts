/**
 * Google Contacts integration
 *
 * Looks up a contact by name using multiple sources in order:
 * 1. Naavi's own contacts table (saved via ADD_CONTACT)
 * 2. Gmail sender cache (gmail_messages table)
 * 3. Google People API (server-side Edge Function)
 *
 * No extra OAuth scope needed for sources 1 and 2.
 */

import { supabase } from './supabase';
import { invokeWithTimeout, queryWithTimeout, getSessionWithTimeout } from './invokeWithTimeout';
import { remoteLog } from './remoteLog';

export interface ContactAddress {
  type: string;       // 'home' | 'work' | 'other' | etc.
  formatted: string;  // formatted address (may contain newlines from People API)
}

export interface Contact {
  name: string;
  email: string | null;
  phone: string | null;
  // 2026-05-22 (Wael) — addresses[] from People API. Only populated by the
  // Google People API path in lookupContact (sources 2-4 don't have them).
  // Used by the possessive resolver ("Alert me at Bob's home") to look up
  // the contact's saved address without hitting Google Places.
  addresses?: ContactAddress[];
}

export async function lookupContactByPhone(phone: string, diagSession?: string): Promise<Contact | null> {
  if (!supabase || !phone.trim()) return null;

  // Strip to digits only — e.g. "613-769-7957" → "6137697957"
  let digits = phone.replace(/\D/g, '');
  // 2026-07-10 fix (B9g investigation) — if the caller passed a number that
  // still includes the NANP country code (e.g. "+16137976746"), `digits` came
  // out as 11 digits instead of 10, corrupting every variant built below:
  // `+1${digits}` doubled the "1" ("+116137976746") and the spaced format's
  // slice offsets shifted every group by one digit ("+1 161 379 76746") —
  // confirmed live via Edge Function logs, both variants returned 0 results.
  // useOrchestrator's caller now strips this before calling in, but this is
  // kept as defense-in-depth for any other caller.
  if (digits.length === 11 && digits.startsWith('1')) {
    digits = digits.slice(1);
  }

  // Try Google People API with multiple formats (dashes, digits, +1 prefix)
  const queries = [
    phone.trim(),                        // "613-769-7957"
    digits,                              // "6137697957"
    `+1${digits}`,                       // "+16137697957"
    `+1 ${digits.slice(0,3)} ${digits.slice(3,6)} ${digits.slice(6)}`, // "+1 613 769 7957"
  ];

  // B9g diagnostic (2026-07-10) — confirmed via live Edge Function logs that
  // the 3 corrupted variants above (pre-fix) all returned 0 results, including
  // through lookup-contact's phonetic fallback — ruling that fallback out as
  // the source of the "Laura" misroute. The successful match came from the
  // correctly-formatted `phone.trim()` variant; which exact fallback path (if
  // any) inside lookup-contact produced it is still not logged there. This
  // logs which variant (if any) produced the match on this side so the next
  // reproduction narrows it further.
  if (diagSession) {
    remoteLog(diagSession, 'phone-lookup-start', { phone, digits, queries });
  }

  for (const query of queries) {
    try {
      const { data, error } = await invokeWithTimeout<any>('lookup-contact', { body: { name: query } }, 15_000);
      if (!error && !data?.error && data?.contact) {
        console.log('[contacts] Phone lookup found via Google People API:', data.contact.name);
        if (diagSession) {
          remoteLog(diagSession, 'phone-lookup-matched', {
            query,
            matched_name: data.contact.name,
            matched_phone: data.contact.phone,
            matched_email: data.contact.email,
          });
        }
        return data.contact;
      }
    } catch { /* continue */ }
  }

  if (diagSession) {
    remoteLog(diagSession, 'phone-lookup-no-match', { phone, digits });
  }

  return null;
}

export async function lookupContact(name: string): Promise<Contact | null> {
  if (!supabase || !name.trim()) return null;

  const nameLower = name.toLowerCase().trim();

  // V57.12.2 Bug L fix — capture user_id once and use it on every Supabase
  // query so cross-user rows can't leak into a single-user lookup, and so
  // RLS-scoped tables actually return rows to the caller. Multi-user
  // safety per CLAUDE.md Rule 10.
  const session = await getSessionWithTimeout();
  const userId = session?.user?.id ?? null;

  // 1. Google People API — the CANONICAL source for user-owned contacts.
  //    It reads the user's real address book and returns the actual phone
  //    numbers Robert has curated. Put first because anything else is at
  //    best a cache and at worst a regex-extracted hallucination from a
  //    voice transcript (seen with Fatma — "+20261" was pulled out of a
  //    Test Drive recording by a greedy digit regex).
  try {
    const { data, error } = await invokeWithTimeout<any>('lookup-contact', { body: { name } }, 15_000);
    if (!error && !data?.error && data?.contact && (data.contact.phone || data.contact.email || (Array.isArray(data.contact.addresses) && data.contact.addresses.length > 0))) {
      // V57.12.2 Bug L fix — only short-circuit when Google People API
      // returned a contact with at least one usable channel. Previously a
      // null-phone-null-email Google match blocked the local-table fallback
      // that DID have the phone number. Wael 2026-05-06 saved John locally,
      // tried to text him, hit "no phone for John" because Google had a
      // partial record without a number.
      // 2026-05-22 (Wael) — also accept contacts with only an address (no
      // phone/email) since the possessive resolver only needs the address.
      console.log('[contacts] Found via Google People API:', data.contact.name);
      return data.contact;
    }
  } catch { /* continue */ }

  // 2. Local `people` table — populated by the ADD_CONTACT action when the
  //    user asks Naavi to save someone. Structured, safe.
  if (userId) try {
    const { data } = await queryWithTimeout(
      supabase
        .from('people')
        .select('name, phone, email')
        .eq('user_id', userId)
        .ilike('name', `%${nameLower}%`)
        .limit(1),
      15_000,
      'select-people-by-name',
    );

    if (data && data.length > 0 && (data[0].phone || data[0].email)) {
      console.log('[contacts] Found in people table:', data[0].name);
      return { name: data[0].name, email: data[0].email ?? null, phone: data[0].phone ?? null };
    }
  } catch { /* continue */ }

  // 3. Gmail sender cache — email-only fallback when the person has emailed
  //    the user but isn't in their Google contacts yet.
  if (userId) try {
    const { data } = await queryWithTimeout(
      supabase
        .from('gmail_messages')
        .select('sender_name, sender_email')
        .eq('user_id', userId)
        .ilike('sender_name', `%${nameLower}%`)
        .not('sender_email', 'is', null)
        .limit(1),
      15_000,
      'select-gmail-sender',
    );

    if (data && data.length > 0 && data[0].sender_email) {
      return { name: data[0].sender_name ?? name, email: data[0].sender_email, phone: null };
    }
  } catch { /* continue */ }

  // 4. `contacts` table — written by saveContact during ADD_CONTACT. Has BOTH
  //    name+email AND a phone column (migration 20260419_contacts_phone.sql)
  //    even though older code paths only read the email. V57.12.2 Bug L fix —
  //    now read the phone column too so a saved contact with a phone but no
  //    email still resolves on the SMS draft path.
  if (userId) try {
    const { data } = await queryWithTimeout(
      supabase
        .from('contacts')
        .select('name, email, phone')
        .eq('user_id', userId)
        .ilike('name', `%${nameLower}%`)
        .limit(1),
      15_000,
      'select-contacts-by-name',
    );

    if (data && data.length > 0 && (data[0].phone || data[0].email)) {
      return { name: data[0].name, email: data[0].email ?? null, phone: data[0].phone ?? null };
    }
  } catch { /* continue */ }

  // Deliberately NOT searching knowledge_fragments for phone numbers.
  // That path used a greedy digit regex on free-text voice transcripts,
  // which produced garbage numbers like "+20261" extracted from phrases
  // uttered during recorded conversations. Phone numbers are structured
  // data and must come from structured sources only.

  return null;
}
