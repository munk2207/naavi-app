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
import { isInstitutionalEmail } from '../_shared/institutional_domains.ts';

const GOOGLE_TOKEN_URL = 'https://oauth2.googleapis.com/token';
const GMAIL_API = 'https://gmail.googleapis.com/gmail/v1/users/me';
const PEOPLE_CONNECTIONS_API = 'https://people.googleapis.com/v1/people/me/connections';
const OTHER_CONTACTS_API = 'https://people.googleapis.com/v1/otherContacts';
const MAX_CONTACTS_PER_SOURCE = 500;

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

// Build the user's personal-contact email set from Google People API (the same
// source the Global Search contacts adapter reads). Matches the user's real
// address book — NOT the sparse local `contacts` table.
async function fetchGoogleContactEmails(accessToken: string): Promise<Set<string>> {
  const out = new Set<string>();

  const pages = async (baseUrl: string, maskKey: string, arrayKey: string) => {
    let pageToken: string | undefined;
    let fetched = 0;
    while (fetched < MAX_CONTACTS_PER_SOURCE) {
      const url = new URL(baseUrl);
      url.searchParams.set(maskKey, 'emailAddresses');
      url.searchParams.set('pageSize', '1000');
      if (pageToken) url.searchParams.set('pageToken', pageToken);
      try {
        const res = await fetch(url.toString(), {
          headers: { Authorization: `Bearer ${accessToken}` },
        });
        if (!res.ok) return;
        const data = await res.json();
        const list = (data?.[arrayKey] ?? []) as Array<{ emailAddresses?: Array<{ value?: string }> }>;
        for (const p of list) {
          for (const e of p.emailAddresses ?? []) {
            const v = (e.value ?? '').toLowerCase().trim();
            if (v.length > 0) out.add(v);
          }
        }
        fetched += list.length;
        pageToken = typeof data?.nextPageToken === 'string' ? data.nextPageToken : undefined;
        if (!pageToken) return;
      } catch (err) {
        console.warn('[sync-gmail] People API page fetch failed:', err);
        return;
      }
    }
  };

  await Promise.all([
    pages(PEOPLE_CONNECTIONS_API, 'personFields', 'connections'),
    pages(OTHER_CONTACTS_API,     'readMask',     'otherContacts'),
  ]);

  return out;
}

serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });

  // V57.9.1 — optional request body for one-shot manual backfill:
  //   days_back: how many days of history to pull (default 7, max 730)
  //   target_user_id: limit the run to a single user (skip dormancy filter)
  //   tier1_only: only persist tier-1 emails — recommended for backfill mode
  //               so we don't bloat the cache with year-old marketing.
  // When called with no body (cron path), behaves exactly as before:
  //   days_back=7, runs for all active users, persists all classifications.
  let daysBack    = 7;
  let beforeDaysBack: number | null = null;  // Optional upper bound for chunking
  let targetUserId: string | null = null;
  let tier1Only   = false;
  if (req.method === 'POST') {
    try {
      const body = await req.clone().json();
      if (typeof body.days_back === 'number' && body.days_back > 0) {
        daysBack = Math.min(Math.floor(body.days_back), 730);
      }
      if (typeof body.before_days_back === 'number' && body.before_days_back > 0) {
        beforeDaysBack = Math.min(Math.floor(body.before_days_back), 730);
      }
      if (typeof body.target_user_id === 'string' && body.target_user_id.length > 0) {
        targetUserId = body.target_user_id;
      }
      if (body.tier1_only === true) {
        tier1Only = true;
      }
    } catch {
      /* no body / invalid JSON — fall through to defaults */
    }
  }
  const isBackfillMode = daysBack > 7;
  console.log(`[sync-gmail] Mode: days_back=${daysBack}, target_user=${targetUserId ?? 'all'}, tier1_only=${tier1Only}, backfill=${isBackfillMode}`);

  const adminClient = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
  );

  let tokensQuery = adminClient
    .from('user_tokens')
    .select('user_id, refresh_token')
    .eq('provider', 'google');
  if (targetUserId) tokensQuery = tokensQuery.eq('user_id', targetUserId);
  const { data: tokens, error: tokenError } = await tokensQuery;

  if (tokenError || !tokens?.length) {
    return new Response(JSON.stringify({ message: 'No Google tokens found' }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }

  // V57.7 cost audit — DORMANCY FILTER. Skip users who haven't signed in
  // for 30+ days. They likely aren't using Naavi, and Claude/OCR/Gmail
  // costs to keep dormant inboxes synced are pure waste.
  // Industry stat: ~30-50% of beta signups go dormant within 30 days.
  // At 100 beta users this saves ~$500-1500/month.
  //
  // When a dormant user signs back in, Supabase Auth updates last_sign_in_at
  // automatically — the next cron tick will pick them up.
  const DORMANCY_DAYS = 30;
  const dormancyThreshold = new Date(Date.now() - DORMANCY_DAYS * 24 * 60 * 60 * 1000);
  const activeUserIds = new Set<string>();
  try {
    const { data: usersPage } = await adminClient.auth.admin.listUsers({ perPage: 1000 });
    for (const u of usersPage?.users ?? []) {
      const lastSignIn = u.last_sign_in_at ? new Date(u.last_sign_in_at) : null;
      if (lastSignIn && lastSignIn >= dormancyThreshold) {
        activeUserIds.add(u.id);
      }
    }
    console.log(`[sync-gmail] Dormancy filter: ${activeUserIds.size}/${usersPage?.users?.length ?? 0} users active in last ${DORMANCY_DAYS} days`);
  } catch (err) {
    console.error('[sync-gmail] Failed to load active users — fail open (sync all):', err);
    // Fail-open so we never accidentally drop real users from the sync if
    // the auth admin API has a transient issue.
    for (const t of tokens) activeUserIds.add(t.user_id);
  }

  const skippedDormant: string[] = [];
  const results: { user_id: string; messages: number; error?: string }[] = [];

  for (const { user_id, refresh_token } of tokens) {
    // Skip dormancy filter when this is a one-shot manual backfill for a
    // specific user — the operator explicitly asked for this run.
    if (!targetUserId && !activeUserIds.has(user_id)) {
      skippedDormant.push(user_id);
      continue;
    }
    try {
      const accessToken = await getNewAccessToken(refresh_token);

      // Fetch the user's Google People contacts ONCE per sync run, so
      // per-message personal-signal classification is a cheap Set.has()
      // lookup. Uses Google People API (same source as the contacts adapter
      // in Global Search) — the local `contacts` table is only populated by
      // manual saves and was too sparse to rely on for signal strength.
      const contactEmails = await fetchGoogleContactEmails(accessToken);

      // Fetch messages in [now - daysBack, now - beforeDaysBack]. Default
      // 7 days back, no upper bound (cron). Backfill chunks pass both bounds
      // to walk through history without re-processing the same recent
      // window every call.
      const cutoffTs = Math.floor((Date.now() - daysBack * 24 * 60 * 60 * 1000) / 1000);
      const beforeTs = beforeDaysBack !== null
        ? Math.floor((Date.now() - beforeDaysBack * 24 * 60 * 60 * 1000) / 1000)
        : null;
      const query = beforeTs !== null
        ? `after:${cutoffTs} before:${beforeTs}`
        : `after:${cutoffTs}`;

      // Paginate through Gmail's 500-per-page list. In cron mode (7 days)
      // we cap at 500 messages; in backfill mode we fetch everything in the
      // window up to a safety ceiling of 10000 messages per user.
      const pageSize = isBackfillMode ? 500 : 100;
      const messageCap = isBackfillMode ? 10_000 : 500;
      const messageIds: string[] = [];
      let pageToken: string | undefined;
      do {
        const url = new URL(`${GMAIL_API}/messages`);
        url.searchParams.set('maxResults', String(pageSize));
        url.searchParams.set('q', query);
        if (pageToken) url.searchParams.set('pageToken', pageToken);
        const listRes = await fetch(url.toString(), {
          headers: { Authorization: `Bearer ${accessToken}` },
        });
        if (!listRes.ok) {
          results.push({ user_id, messages: 0, error: `Gmail list ${listRes.status}` });
          break;
        }
        const listData = await listRes.json();
        const ids: string[] = (listData.messages ?? []).map((m: { id: string }) => m.id);
        messageIds.push(...ids);
        pageToken = listData.nextPageToken;
        if (messageIds.length >= messageCap) break;
      } while (pageToken && isBackfillMode);
      console.log(`[sync-gmail] user ${user_id}: ${messageIds.length} message ids from Gmail list (days_back=${daysBack})`);

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
          bodyText = decodeBase64(textPart.body.data).slice(0, 3000);
        } else if (msg.payload?.body?.data) {
          bodyText = decodeBase64(msg.payload.body.data).slice(0, 3000);
        }

        const labels: string[] = msg.labelIds ?? [];
        const isUnread    = labels.includes('UNREAD');
        const isImportant = labels.includes('IMPORTANT') || labels.includes('CATEGORY_PRIMARY');
        const receivedAt  = dateStr ? new Date(dateStr).toISOString() : new Date().toISOString();

        // Naavi tier-1 classification — separate from Gmail's IMPORTANT label.
        // Tier 1 means "worth surfacing in the morning brief and extracting
        // actions from". Rules:
        //   - Sender is in Robert's Google contacts (personal), OR
        //   - Sender domain is on the institutional list (government, bank,
        //     insurance, utility, telecom, major courier), OR
        //   - Gmail flagged IMPORTANT, OR
        //   - Gmail categorized as CATEGORY_PERSONAL (human correspondence)
        //   AND never if in PROMOTIONS / SOCIAL / FORUMS (Gmail's IMPORTANT
        //   ML can be wrong on marketing — we override).
        const senderEmailLower = (senderEmail ?? '').toLowerCase().trim();
        const isMarketing = labels.includes('CATEGORY_PROMOTIONS')
          || labels.includes('CATEGORY_SOCIAL')
          || labels.includes('CATEGORY_FORUMS');
        const inContacts = senderEmailLower.length > 0 && contactEmails.has(senderEmailLower);
        const isInstitutional = isInstitutionalEmail(senderEmailLower);
        const isTier1 = !isMarketing && (
          inContacts
          || isInstitutional
          || labels.includes('IMPORTANT')
          || labels.includes('CATEGORY_PERSONAL')
        );

        // Three-tier sub-ranking within tier-1:
        //   institutional — domain matches a trusted institution list
        //                   (covers senders Robert will never have as
        //                    personal contacts, like Revenue Canada)
        //   personal      — sender is in Robert's Google People contacts
        //   ambient       — tier-1 by Gmail label alone (lower confidence)
        //   null          — not tier-1
        // Institutional wins over personal for messages that satisfy both —
        // this surfaces the INSTITUTION nature of the email (bill, notice)
        // over the personal relationship with the sender.
        const signalStrength: 'personal' | 'institutional' | 'ambient' | null = !isTier1
          ? null
          : isInstitutional
            ? 'institutional'
            : inContacts
              ? 'personal'
              : 'ambient';

        // V57.9.1 — backfill cost gate. When the operator passes tier1_only=true
        // (recommended for the 365-day historical sweep), skip non-tier-1
        // emails entirely so we don't bloat storage with year-old marketing
        // and don't trigger Haiku/OCR fan-out on them. Cron mode (default)
        // keeps the original behaviour: store everything, fan out only on tier-1.
        if (tier1Only && !isTier1) continue;

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
            is_tier1:     isTier1,
            signal_strength: signalStrength,
            labels,
            updated_at:   new Date().toISOString(),
          }, { onConflict: 'user_id,gmail_message_id' });

        if (!error) count++;

        // Fire-and-forget action extraction for every tier-1 email. The
        // extract-email-actions function writes to email_actions (which the
        // morning brief reads). We do NOT await — sync-gmail must stay fast;
        // extraction per email can take 2-3s against Claude.
        if (!error && isTier1) {
          fetch(`${Deno.env.get('SUPABASE_URL')}/functions/v1/extract-email-actions`, {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              'Authorization': `Bearer ${Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')}`,
            },
            body: JSON.stringify({ user_id, gmail_message_id: messageId }),
          }).catch((e) => console.error('[sync-gmail] extract-email-actions call failed:', e?.message ?? e));
        }
      }

      results.push({ user_id, messages: count });
      console.log(`[sync-gmail] Synced ${count} messages for user ${user_id}`);

      // Trigger the unified rule evaluator immediately after new messages arrive
      // (evaluate-rules reads action_rules — the consolidated rule store)
      if (count > 0) {
        fetch(`${Deno.env.get('SUPABASE_URL')}/functions/v1/evaluate-rules`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${Deno.env.get('NAAVI_ANON_KEY') ?? Deno.env.get('SUPABASE_ANON_KEY')}`,
          },
          body: JSON.stringify({ user_id }),
        }).catch(err => console.error('[sync-gmail] evaluate-rules trigger failed:', err));
      }

    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      results.push({ user_id, messages: 0, error: msg });
      console.error(`[sync-gmail] Failed for user ${user_id}:`, msg);
    }
  }

  return new Response(JSON.stringify({ results, skipped_dormant: skippedDormant.length }), {
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
});
