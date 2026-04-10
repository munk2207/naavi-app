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

  // Accumulate partial results — first source with phone wins for phone,
  // first source with email wins for email.
  let bestName = name;
  let bestEmail: string | null = null;
  let bestPhone: string | null = null;

  // 1. Search people table (has phone + email, written by ADD_CONTACT)
  try {
    const { data } = await supabase
      .from('people')
      .select('name, email, phone')
      .ilike('name', `%${nameLower}%`)
      .limit(1);

    if (data && data.length > 0) {
      bestName = data[0].name ?? bestName;
      if (data[0].phone) bestPhone = data[0].phone;
      if (data[0].email) bestEmail = data[0].email;
    }
  } catch { /* continue */ }

  // If we already have both, return early
  if (bestPhone && bestEmail) return { name: bestName, email: bestEmail, phone: bestPhone };

  // 2. Search Naavi's contacts table
  try {
    const { data } = await supabase
      .from('contacts')
      .select('name, email')
      .ilike('name', `%${nameLower}%`)
      .limit(1);

    if (data && data.length > 0 && data[0].email && !bestEmail) {
      bestName = data[0].name ?? bestName;
      bestEmail = data[0].email;
    }
  } catch { /* continue */ }

  // 3. Search knowledge fragments (where "Remember X's phone is..." stores data)
  if (!bestPhone) {
    try {
      const { data } = await supabase
        .from('knowledge_fragments')
        .select('content')
        .ilike('content', `%${nameLower}%`)
        .ilike('content', '%phone%')
        .limit(5);

      if (data && data.length > 0) {
        // Extract phone number from free text like "Hussein's phone is +16137697957"
        for (const row of data) {
          const phoneMatch = row.content.match(/(\+?\d[\d\s\-().]{7,})/);
          if (phoneMatch) {
            bestPhone = phoneMatch[1].replace(/[\s\-().]/g, '');
            break;
          }
        }
      }
    } catch { /* continue */ }
  }

  // 4. Search Gmail sender cache
  if (!bestEmail) {
    try {
      const { data } = await supabase
        .from('gmail_messages')
        .select('sender_name, sender_email')
        .ilike('sender_name', `%${nameLower}%`)
        .not('sender_email', 'is', null)
        .limit(1);

      if (data && data.length > 0 && data[0].sender_email) {
        bestName = data[0].sender_name ?? bestName;
        bestEmail = data[0].sender_email;
      }
    } catch { /* continue */ }
  }

  // 5. Google People API via Edge Function
  if (!bestPhone || !bestEmail) {
    try {
      const { data, error } = await supabase.functions.invoke('lookup-contact', {
        body: { name },
      });
      if (!error && !data?.error && data?.contact) {
        if (!bestPhone && data.contact.phone) bestPhone = data.contact.phone;
        if (!bestEmail && data.contact.email) bestEmail = data.contact.email;
        bestName = data.contact.name ?? bestName;
      }
    } catch { /* continue */ }
  }

  if (!bestPhone && !bestEmail) return null;
  return { name: bestName, email: bestEmail, phone: bestPhone };
}
