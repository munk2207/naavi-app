/**
 * sync-gmail Edge Function
 *
 * Runs on a schedule (cron) every hour.
 * Can also be triggered manually from the app.
 *
 * For every user who has a stored Google refresh token:
 * 1. Gets a fresh access token from Google
 * 2. Fetches unread emails from the last 7 days
 * 3. Upserts them into the gmail_messages Supabase table
 */

import { serve } from 'https://deno.land/std@0.224.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const GOOGLE_TOKEN_URL = 'https://oauth2.googleapis.com/token';
const GMAIL_API = 'https://gmail.googleapis.com/gmail/v1/users/me';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

async function getNewAccessToken(refreshToken: string): Promise<string> {
  const res = await fetch(GOOGLE_TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id:     Deno.env.get('GOOGLE_CLIENT_ID')!,
      client_secret: Deno.env.get('GOOGLE_CLIENT_SECRET')!,
      refresh_token: refreshToken,
      grant_type:    'refresh_token',
    }),
  });
  const data = await res.json();
  if (!data.access_token) throw new Error(`Token refresh failed: ${JSON.stringify(data)}`);
  return data.access_token;
}

function decodeBase64(str: string): string {
  try {
    const base64 = str.replace(/-/g, '+').replace(/_/g, '/');
    return atob(base64);
  } catch {
    return '';
  }
}

function getHeader(headers: { name: string; value: string }[], name: string): string {
  return headers.find(h => h.name.toLowerCase() === name.toLowerCase())?.value ?? '';
}

function parseSender(from: string): { name: string; email: string } {
  const match = from.match(/^(.+?)\s*<(.+?)>$/);
  if (match) return { name: match[1].trim().replace(/^"|"$/g, ''), email: match[2].trim() };
  return { name: '', email: from.trim() };
}

serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });

  const adminClient = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
  );

  const { data: tokens, error: tokenError } = await adminClient
    .from('user_tokens')
    .select('user_id, refresh_token')
    .eq('provider', 'google');

  if (tokenError || !tokens?.length) {
    return new Response(JSON.stringify({ message: 'No Google tokens found' }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }

  const results: { user_id: string; messages: number; error?: string }[] = [];

  for (const { user_id, refresh_token } of tokens) {
    try {
      const accessToken = await getNewAccessToken(refresh_token);

      // Fetch all messages from last 24 hours (read and unread)
      // so Robert's brief always shows today's emails even after he reads them
      const oneDayAgo = Math.floor((Date.now() - 24 * 60 * 60 * 1000) / 1000);
      const query = `after:${oneDayAgo}`;

      const listRes = await fetch(
        `${GMAIL_API}/messages?maxResults=20&q=${encodeURIComponent(query)}`,
        { headers: { Authorization: `Bearer ${accessToken}` } }
      );

      if (!listRes.ok) {
        results.push({ user_id, messages: 0, error: `Gmail list ${listRes.status}` });
        continue;
      }

      const listData = await listRes.json();
      const messageIds: string[] = (listData.messages ?? []).map((m: { id: string }) => m.id);

      let count = 0;
      for (const messageId of messageIds) {
        const msgRes = await fetch(
          `${GMAIL_API}/messages/${messageId}?format=full`,
          { headers: { Authorization: `Bearer ${accessToken}` } }
        );
        if (!msgRes.ok) continue;

        const msg = await msgRes.json();
        const headers = msg.payload?.headers ?? [];

        const subject    = getHeader(headers, 'Subject');
        const fromRaw    = getHeader(headers, 'From');
        const dateStr    = getHeader(headers, 'Date');
        const { name: senderName, email: senderEmail } = parseSender(fromRaw);

        // Extract plain text body
        let bodyText = '';
        const parts = msg.payload?.parts ?? [];
        const textPart = parts.find((p: { mimeType: string }) => p.mimeType === 'text/plain');
        if (textPart?.body?.data) {
          bodyText = decodeBase64(textPart.body.data).slice(0, 500);
        } else if (msg.payload?.body?.data) {
          bodyText = decodeBase64(msg.payload.body.data).slice(0, 500);
        }

        const labels: string[] = msg.labelIds ?? [];
        const isUnread    = labels.includes('UNREAD');
        const isImportant = labels.includes('IMPORTANT') || labels.includes('CATEGORY_PRIMARY');
        const receivedAt  = dateStr ? new Date(dateStr).toISOString() : new Date().toISOString();

        const { error } = await adminClient
          .from('gmail_messages')
          .upsert({
            user_id,
            gmail_message_id: messageId,
            thread_id:    msg.threadId ?? '',
            subject,
            sender_name:  senderName,
            sender_email: senderEmail,
            snippet:      msg.snippet ?? '',
            body_text:    bodyText,
            received_at:  receivedAt,
            is_unread:    isUnread,
            is_important: isImportant,
            labels,
            updated_at:   new Date().toISOString(),
          }, { onConflict: 'user_id,gmail_message_id' });

        if (!error) count++;
      }

      results.push({ user_id, messages: count });
      console.log(`[sync-gmail] Synced ${count} messages for user ${user_id}`);

      // Trigger email alert check immediately after new messages arrive
      if (count > 0) {
        fetch(`${Deno.env.get('SUPABASE_URL')}/functions/v1/check-email-alerts`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${Deno.env.get('NAAVI_ANON_KEY') ?? Deno.env.get('SUPABASE_ANON_KEY')}`,
          },
          body: JSON.stringify({ user_id }),
        }).catch(err => console.error('[sync-gmail] Alert check trigger failed:', err));
      }

    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      results.push({ user_id, messages: 0, error: msg });
      console.error(`[sync-gmail] Failed for user ${user_id}:`, msg);
    }
  }

  return new Response(JSON.stringify({ results }), {
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
});
