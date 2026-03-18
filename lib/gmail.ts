/**
 * Gmail integration
 *
 * Fetches important unread emails from the Supabase cache.
 * The cache is populated by the sync-gmail Edge Function (hourly cron).
 * Robert never sees token management — it all runs server-side.
 */

import { supabase } from './supabase';
import type { BriefItem } from './naavi-client';

const SUPABASE_URL      = process.env.EXPO_PUBLIC_SUPABASE_URL      ?? '';
const SUPABASE_ANON_KEY = process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY ?? '';

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

export async function fetchImportantEmails(passedUserId?: string): Promise<BriefItem[]> {
  if (!supabase) return [];

  let userId = passedUserId;
  if (!userId) {
    const { data: { session } } = await supabase.auth.getSession();
    userId = session?.user?.id;
  }
  if (!userId) return [];

  const sevenDaysAgo = new Date();
  sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);

  try {
    const { data: messages, error } = await supabase
      .from('gmail_messages')
      .select('gmail_message_id, subject, sender_name, sender_email, snippet, received_at, is_important, labels')
      .eq('user_id', userId)
      .eq('is_unread', true)
      .gte('received_at', sevenDaysAgo.toISOString())
      .order('received_at', { ascending: false })
      .limit(5);

    if (error || !messages || messages.length === 0) return [];

    return messages.map(msg => {
      const sender = msg.sender_name || msg.sender_email || 'Unknown';
      const urgent = msg.is_important || (msg.labels ?? []).includes('CATEGORY_PRIMARY');
      const received = new Date(msg.received_at ?? '');
      const timeLabel = received.toLocaleDateString('en-CA', { month: 'short', day: 'numeric' });

      return {
        id: `gmail-${msg.gmail_message_id}`,
        category: 'task' as const,
        title: `✉ ${sender} — ${msg.subject || '(no subject)'}`,
        detail: msg.snippet || '',
        urgent,
      };
    });
  } catch (err) {
    console.error('[Gmail] Fetch failed:', err);
    return [];
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
