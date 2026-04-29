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
import { invokeWithTimeout, queryWithTimeout } from './invokeWithTimeout';

export interface Contact {
  name: string;
  email: string | null;
  phone: string | null;
}

export async function lookupContactByPhone(phone: string): Promise<Contact | null> {
  if (!supabase || !phone.trim()) return null;

  // Strip to digits only — e.g. "613-769-7957" → "6137697957"
  const digits = phone.replace(/\D/g, '');

  // Try Google People API with multiple formats (dashes, digits, +1 prefix)
  const queries = [
    phone.trim(),                        // "613-769-7957"
    digits,                              // "6137697957"
    `+1${digits}`,                       // "+16137697957"
    `+1 ${digits.slice(0,3)} ${digits.slice(3,6)} ${digits.slice(6)}`, // "+1 613 769 7957"
  ];

  for (const query of queries) {
    try {
      const { data, error } = await invokeWithTimeout<any>('lookup-contact', { body: { name: query } }, 15_000);
      if (!error && !data?.error && data?.contact) {
        console.log('[contacts] Phone lookup found via Google People API:', data.contact.name);
        return data.contact;
      }
    } catch { /* continue */ }
  }

  return null;
}

export async function lookupContact(name: string): Promise<Contact | null> {
  if (!supabase || !name.trim()) return null;

  const nameLower = name.toLowerCase().trim();

  // 1. Google People API — the CANONICAL source for user-owned contacts.
  //    It reads the user's real address book and returns the actual phone
  //    numbers Robert has curated. Put first because anything else is at
  //    best a cache and at worst a regex-extracted hallucination from a
  //    voice transcript (seen with Fatma — "+20261" was pulled out of a
  //    Test Drive recording by a greedy digit regex).
  try {
    const { data, error } = await invokeWithTimeout<any>('lookup-contact', { body: { name } }, 15_000);
    if (!error && !data?.error && data?.contact) {
      console.log('[contacts] Found via Google People API:', data.contact.name);
      return data.contact;
    }
  } catch { /* continue */ }

  // 2. Local `people` table — populated by the ADD_CONTACT action when the
  //    user asks Naavi to save someone. Structured, safe.
  try {
    const { data } = await queryWithTimeout(
      supabase
        .from('people')
        .select('name, phone, email')
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
  try {
    const { data } = await queryWithTimeout(
      supabase
        .from('gmail_messages')
        .select('sender_name, sender_email')
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

  // 4. Legacy `contacts` table — kept for email-only lookup; do not add a
  //    phone column here. This table is sparse and being deprecated in
  //    favour of Google People API (step 1).
  try {
    const { data } = await queryWithTimeout(
      supabase
        .from('contacts')
        .select('name, email')
        .ilike('name', `%${nameLower}%`)
        .limit(1),
      15_000,
      'select-contacts-by-name',
    );

    if (data && data.length > 0 && data[0].email) {
      return { name: data[0].name, email: data[0].email, phone: null };
    }
  } catch { /* continue */ }

  // Deliberately NOT searching knowledge_fragments for phone numbers.
  // That path used a greedy digit regex on free-text voice transcripts,
  // which produced garbage numbers like "+20261" extracted from phrases
  // uttered during recorded conversations. Phone numbers are structured
  // data and must come from structured sources only.

  return null;
}
