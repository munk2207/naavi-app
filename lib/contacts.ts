/**
 * Google Contacts integration
 *
 * Looks up a contact by name using the People API (server-side).
 * Used to auto-resolve email addresses when Robert says "email John".
 */

import { supabase } from './supabase';

export interface Contact {
  name: string;
  email: string | null;
  phone: string | null;
}

export async function lookupContact(name: string): Promise<Contact | null> {
  if (!supabase || !name.trim()) return null;

  try {
    const { data, error } = await supabase.functions.invoke('lookup-contact', {
      body: { name },
    });
    if (error || data?.error) return null;
    return data?.contact ?? null;
  } catch {
    return null;
  }
}
