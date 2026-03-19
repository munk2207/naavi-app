/**
 * Supabase client — Phase 8
 *
 * Handles two things:
 * 1. Calling the naavi-chat Edge Function (Anthropic key lives server-side)
 * 2. Saving contacts and reminders to the database
 */

import { createClient } from '@supabase/supabase-js';

const SUPABASE_URL     = process.env.EXPO_PUBLIC_SUPABASE_URL     ?? '';
const SUPABASE_ANON_KEY = process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY ?? '';

export const supabase = SUPABASE_URL && SUPABASE_ANON_KEY
  ? createClient(SUPABASE_URL, SUPABASE_ANON_KEY)
  : null;

export function isSupabaseConfigured(): boolean {
  return Boolean(SUPABASE_URL && SUPABASE_ANON_KEY);
}

// ─── Edge Function call ────────────────────────────────────────────────────────

export async function callNaaviEdgeFunction(
  system: string,
  messages: { role: 'user' | 'assistant'; content: string }[],
): Promise<string> {
  const url = `${SUPABASE_URL}/functions/v1/naavi-chat`;

  const res = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${SUPABASE_ANON_KEY}`,
    },
    body: JSON.stringify({ system, messages, max_tokens: 2048 }),
  });

  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Edge Function error ${res.status}: ${body}`);
  }

  const { rawText, error } = await res.json();
  if (error) throw new Error(`Edge Function returned error: ${error}`);
  return rawText as string;
}

// ─── Database helpers ──────────────────────────────────────────────────────────

export async function saveContact(contact: {
  name: string;
  email: string;
  phone?: string;
  relationship?: string;
}): Promise<void> {
  if (!supabase) return;
  const { data: { session } } = await supabase.auth.getSession();
  const userId = session?.user?.id;
  if (!userId) {
    console.error('[Supabase] Cannot save contact — no user session');
    return;
  }
  // Only insert columns that definitely exist in the contacts table
  const { error } = await supabase.from('contacts').insert({
    user_id: userId,
    name: contact.name,
    email: contact.email,
  });
  if (error) console.error('[Supabase] Failed to save contact:', error.message);
  else console.log('[Supabase] Contact saved:', contact.name);
}

export async function saveReminder(reminder: {
  title: string;
  datetime: string;
  source: string;
}): Promise<void> {
  if (!supabase) return;
  const { error } = await supabase.from('reminders').insert(reminder);
  if (error) console.error('[Supabase] Failed to save reminder:', error.message);
  else console.log('[Supabase] Reminder saved:', reminder.title);
}

export async function saveDriveNote(note: {
  title: string;
  webViewLink?: string;
}): Promise<void> {
  if (!supabase) return;
  const { data: { session } } = await supabase.auth.getSession();
  const userId = session?.user?.id;
  if (!userId) return;
  const { error } = await supabase.from('naavi_notes').insert({
    user_id: userId,
    title: note.title,
    web_view_link: note.webViewLink ?? null,
  });
  if (error) console.error('[Supabase] Failed to save drive note:', error.message);
  else console.log('[Supabase] Drive note saved:', note.title);
}
