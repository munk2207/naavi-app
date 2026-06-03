/**
 * check-ticket-replies Edge Function (2026-06-01)
 *
 * Runs every minute via pg_cron. Checks Wael's Gmail inbox for unread
 * emails with the "Support" label and subject containing "Re: Ticket #".
 * Matches each email to the correct ticket by ticket number, appends the
 * reply to tickets.replies, marks the Gmail message as read, and notifies
 * staff via a follow-up email to support@mynaavi.com.
 *
 * Uses Wael's Google refresh token (user_id = WAEL_USER_ID env var or
 * looked up by wael.aggan@gmail.com).
 */

import { createClient } from 'npm:@supabase/supabase-js@2';

const GOOGLE_TOKEN_URL = 'https://oauth2.googleapis.com/token';
const GMAIL_API        = 'https://gmail.googleapis.com/gmail/v1/users/me';
const POSTMARK_API     = 'https://api.postmarkapp.com';
const SUPPORT_EMAIL    = 'support@mynaavi.com';
const SUPPORT_LABEL    = 'Support'; // Gmail label name

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
}

async function getAccessToken(refreshToken: string): Promise<string> {
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
  if (!data.access_token) throw new Error(`Token refresh failed: ${JSON.stringify(data).slice(0, 200)}`);
  return data.access_token;
}

function decodeBase64(str: string): string {
  try {
    return atob(str.replace(/-/g, '+').replace(/_/g, '/'));
  } catch { return ''; }
}

function extractText(payload: any): string {
  if (!payload) return '';
  if (payload.body?.data) return decodeBase64(payload.body.data);
  if (Array.isArray(payload.parts)) {
    for (const part of payload.parts) {
      if (part.mimeType === 'text/plain' && part.body?.data) return decodeBase64(part.body.data);
    }
    for (const part of payload.parts) {
      const nested = extractText(part);
      if (nested) return nested;
    }
  }
  return '';
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });

  const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
  const serviceKey  = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
  const pmToken     = Deno.env.get('POSTMARK_SERVER_TOKEN') ?? '';
  const admin       = createClient(supabaseUrl, serviceKey);

  try {
    // ── Get Wael's refresh token ─────────────────────────────────────
    const { data: tokenRow } = await admin
      .from('user_tokens')
      .select('user_id, refresh_token')
      .eq('provider', 'google')
      .ilike('email', '%wael.aggan%')
      .maybeSingle();

    let refreshToken: string | null = tokenRow?.refresh_token ?? null;

    if (!refreshToken) {
      // Fallback: look up by user_id from auth.users
      const { data: users } = await admin.auth.admin.listUsers();
      const wael = users?.users?.find(u => u.email === 'wael.aggan@gmail.com');
      if (!wael) return json({ error: 'wael user not found' }, 404);
      const { data: tr } = await admin
        .from('user_tokens')
        .select('refresh_token')
        .eq('user_id', wael.id)
        .eq('provider', 'google')
        .maybeSingle();
      if (!tr?.refresh_token) return json({ error: 'no google refresh token for wael' }, 404);
      refreshToken = tr.refresh_token;
    }

    const accessToken = await getAccessToken(refreshToken);

    // ── List unread messages with Ticket # subject ───────────────────
    // Search by subject pattern only — no label required. Customers reply
    // directly to the thread; Gmail doesn't auto-label their replies.
    const listUrl = new URL(`${GMAIL_API}/messages`);
    listUrl.searchParams.set('q', 'is:unread subject:"Re: Ticket #" in:inbox');
    listUrl.searchParams.set('maxResults', '20');
    const listRes = await fetch(listUrl.toString(), {
      headers: { Authorization: `Bearer ${accessToken}` },
    });
    const listData = await listRes.json();
    const messageIds: string[] = (listData.messages ?? []).map((m: { id: string }) => m.id);

    if (messageIds.length === 0) return json({ processed: 0 });

    let processed = 0;
    for (const msgId of messageIds) {
      try {
        // ── Fetch full message ───────────────────────────────────────
        const msgRes = await fetch(`${GMAIL_API}/messages/${msgId}?format=full`, {
          headers: { Authorization: `Bearer ${accessToken}` },
        });
        const msg = await msgRes.json();

        const headers   = msg.payload?.headers ?? [];
        const subject   = headers.find((h: any) => h.name === 'Subject')?.value ?? '';
        const fromHdr   = headers.find((h: any) => h.name === 'From')?.value ?? '';
        const body      = extractText(msg.payload).slice(0, 4000);

        // ── Extract ticket number from subject ───────────────────────
        const ticketMatch = subject.match(/Ticket\s+#(\d+)/i);
        if (!ticketMatch) {
          console.log(`[check-ticket-replies] no ticket number in subject: "${subject}" — skipping`);
          continue;
        }
        const ticketNumber = parseInt(ticketMatch[1], 10);

        // ── Find matching ticket ─────────────────────────────────────
        const { data: ticket } = await admin
          .from('tickets')
          .select('id, ticket_number, status, replies, audit_trail')
          .eq('ticket_number', ticketNumber)
          .maybeSingle();

        if (!ticket) {
          console.warn(`[check-ticket-replies] no ticket found for #${ticketNumber}`);
          continue;
        }
        if (ticket.status === 'closed') {
          console.log(`[check-ticket-replies] ticket #${ticketNumber} is closed — skipping`);
          continue;
        }

        // ── Parse sender ─────────────────────────────────────────────
        const fromMatch  = fromHdr.match(/^(?:"?([^"<]+)"?\s+)?<?([^>]+)>?$/);
        const fromName   = fromMatch?.[1]?.trim() ?? '';
        const fromEmail  = fromMatch?.[2]?.trim() ?? fromHdr;

        // ── Dedup: skip if this message_id already in replies ────────
        const existingReplies = Array.isArray(ticket.replies) ? ticket.replies : [];
        if (existingReplies.some((r: any) => r.message_id === msgId)) {
          console.log(`[check-ticket-replies] message ${msgId} already in replies for ticket #${ticketNumber} — skipping`);
          // Still mark as read so we don't keep picking it up
          await fetch(`${GMAIL_API}/messages/${msgId}/modify`, {
            method: 'POST',
            headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
            body: JSON.stringify({ removeLabelIds: ['UNREAD'] }),
          });
          continue;
        }

        // ── Append reply to tickets.replies ──────────────────────────
        const newReply = {
          at:         new Date().toISOString(),
          from_email: fromEmail,
          from_name:  fromName,
          direction:  'inbound',
          body:       body.trim(),
          message_id: msgId,
        };
        const replies = [...existingReplies, newReply];

        const auditEntry = {
          at:          new Date().toISOString(),
          actor:       'check-ticket-replies',
          from_status: ticket.status,
          to_status:   ticket.status,
          note:        `Customer reply received from ${fromEmail} (Gmail message ${msgId})`,
        };
        const newAudit = Array.isArray(ticket.audit_trail)
          ? [...ticket.audit_trail, auditEntry]
          : [auditEntry];

        await admin.from('tickets').update({ replies, audit_trail: newAudit }).eq('id', ticket.id);

        // ── Mark Gmail message as read ────────────────────────────────
        await fetch(`${GMAIL_API}/messages/${msgId}/modify`, {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${accessToken}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({ removeLabelIds: ['UNREAD'] }),
        });

        // ── Notify staff ──────────────────────────────────────────────
        if (pmToken) {
          await fetch(`${POSTMARK_API}/email`, {
            method: 'POST',
            headers: {
              'X-Postmark-Server-Token': pmToken,
              'Content-Type': 'application/json',
              'Accept': 'application/json',
            },
            body: JSON.stringify({
              From:          `MyNaavi Team <${SUPPORT_EMAIL}>`,
              To:            SUPPORT_EMAIL,
              Subject:       `Customer replied — Ticket #${ticketNumber}`,
              TextBody:      `${fromName ? fromName + ' ' : ''}<${fromEmail}> replied to Ticket #${ticketNumber}.\n\n${body.slice(0, 500)}`,
              Tag:           'ticket-reply-notify',
              MessageStream: 'outbound',
            }),
          }).catch(e => console.warn('[check-ticket-replies] staff notify failed:', e));
        }

        console.log(`[check-ticket-replies] reply appended to ticket #${ticketNumber} from ${fromEmail}`);
        processed++;
      } catch (msgErr) {
        console.error(`[check-ticket-replies] error processing message ${msgId}:`, msgErr);
      }
    }

    return json({ processed });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error('[check-ticket-replies] error:', msg);
    return json({ error: msg }, 500);
  }
});
