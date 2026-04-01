/**
 * Gmail integration
 *
 * Fetches important unread emails from the Supabase cache.
 * The cache is populated by the sync-gmail Edge Function (hourly cron).
 * Robert never sees token management — it all runs server-side.
 */

import { supabase } from './supabase';

const SUPABASE_URL      = process.env.EXPO_PUBLIC_SUPABASE_URL      ?? '';
const SUPABASE_ANON_KEY = process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY ?? '';

export interface GmailMessageRow {
  gmail_message_id: string;
  subject: string;
  sender_name: string;
  sender_email: string;
  snippet: string;
  received_at: string;
  is_important: boolean;
  labels: string[];
  is_unread: boolean;
}

// ─── Trigger sync ─────────────────────────────────────────────────────────────

export async function triggerGmailSync(): Promise<void> {
  try {
    await fetch(`${SUPABASE_URL}/functions/v1/sync-gmail`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${SUPABASE_ANON_KEY}`,
      },
    });
  } catch (err) {
    console.error('[Gmail] Sync trigger failed:', err);
  }
}

// ─── Fetch important unread emails for the brief ──────────────────────────────

export async function fetchImportantEmails(passedUserId?: string): Promise<GmailMessageRow[]> {
  if (!supabase) return [];

  let userId = passedUserId;
  if (!userId) {
    const { data: { session } } = await supabase.auth.getSession();
    userId = session?.user?.id;
  }
  if (!userId) return [];

  const startOfToday = new Date();
  startOfToday.setHours(0, 0, 0, 0);

  try {
    const { data: messages, error } = await supabase
      .from('gmail_messages')
      .select('gmail_message_id, subject, sender_name, sender_email, snippet, received_at, is_important, labels, is_unread')
      .eq('user_id', userId)
      .gte('received_at', startOfToday.toISOString())
      .order('received_at', { ascending: false })
      .limit(10);

    if (error || !messages || messages.length === 0) return [];
    return messages as GmailMessageRow[];
  } catch (err) {
    console.error('[Gmail] Fetch failed:', err);
    return [];
  }
}

// ─── Send an email via Gmail API ─────────────────────────────────────────────

export async function sendEmail(opts: {
  to: string;
  toName?: string;
  subject: string;
  body: string;
}): Promise<{ success: boolean; error?: string }> {
  if (!supabase) return { success: false, error: 'Not configured' };

  try {
    const { data, error } = await supabase.functions.invoke('send-email', {
      body: opts,
    });
    if (error) return { success: false, error: error.message ?? 'Send failed' };
    return { success: true };
  } catch (err) {
    return { success: false, error: err instanceof Error ? err.message : 'Unknown error' };
  }
}

// ─── Search emails by person name ────────────────────────────────────────────

export async function fetchEmailsFromPerson(name: string, userId: string): Promise<{
  subject: string;
  snippet: string;
  received_at: string;
  is_unread: boolean;
}[]> {
  if (!supabase) return [];

  const nameLower = name.toLowerCase();

  try {
    const { data, error } = await supabase
      .from('gmail_messages')
      .select('subject, snippet, received_at, is_unread, sender_name, sender_email')
      .eq('user_id', userId)
      .or(`sender_name.ilike.%${nameLower}%,sender_email.ilike.%${nameLower}%,subject.ilike.%${nameLower}%`)
      .order('received_at', { ascending: false })
      .limit(10);

    if (error || !data) return [];
    return data;
  } catch {
    return [];
  }
}
