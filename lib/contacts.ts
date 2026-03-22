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
      const { data, error } = await supabase.functions.invoke('lookup-contact', {
        body: { name: query },
      });
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

  // 1. Search Naavi's own contacts table
  try {
    const { data } = await supabase
      .from('contacts')
      .select('name, email')
      .ilike('name', `%${nameLower}%`)
      .limit(1);

    if (data && data.length > 0 && data[0].email) {
      return { name: data[0].name, email: data[0].email, phone: null };
    }
  } catch { /* continue */ }

  // 2. Search Gmail sender cache
  try {
    const { data } = await supabase
      .from('gmail_messages')
      .select('sender_name, sender_email')
      .ilike('sender_name', `%${nameLower}%`)
      .not('sender_email', 'is', null)
      .limit(1);

    if (data && data.length > 0 && data[0].sender_email) {
      return { name: data[0].sender_name ?? name, email: data[0].sender_email, phone: null };
    }
  } catch { /* continue */ }

  // 3. Google People API via Edge Function
  try {
    const { data, error } = await supabase.functions.invoke('lookup-contact', {
      body: { name },
    });
    if (!error && !data?.error && data?.contact) return data.contact;
  } catch { /* continue */ }

  return null;
}
