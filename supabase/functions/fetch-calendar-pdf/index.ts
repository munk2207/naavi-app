/**
 * fetch-calendar-pdf Edge Function
 *
 * Returns the user's most recent calendar PDF as a base64 blob, ready
 * to attach as a Claude `document` content block.
 *
 * Used by the voice server (Railway) to give Claude the actual PDF
 * body when Robert asks date/time questions about school, holidays,
 * games, exams, etc. — same trick that makes the mobile app
 * (`naavi-chat::fetchCalendarPdfBlock`) answer "first day of school
 * is September 2, 2025" instead of just listing search hits.
 *
 * Voice server doesn't carry Google OAuth client_id/client_secret,
 * so we centralize the refresh-token exchange + Drive download here
 * (same pattern as extract-document-text).
 *
 * Input:
 *   { user_id: string, intent_text?: string, max_bytes?: number }
 *
 * Output (success):
 *   { ok: true, pdf_base64: "...", file_name: "...", drive_file_id: "..." }
 *
 * Output (no PDF available, or intent didn't match):
 *   { ok: true, pdf_base64: null, reason: "..." }
 *
 * Output (hard error):
 *   { ok: false, error: "..." }
 */

import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.45.0';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

const GOOGLE_TOKEN_URL = 'https://oauth2.googleapis.com/token';
const DRIVE_FILES_URL  = 'https://www.googleapis.com/drive/v3/files';

const DEFAULT_MAX_BYTES = 20 * 1024 * 1024; // 20 MB — Claude's PDF cap

// Same intent regex as naavi-chat::CALENDAR_INTENT_RE.
const CALENDAR_INTENT_RE =
  /\b(when|what\s+(date|day|time)|how\s+many\s+days|next|first|last|upcoming)\b[\s\S]{0,80}\b(school|pa\s*day|holiday|break|semester|term|class|practice|game|tournament|match|concert|report\s*card|parent\s*teacher|exam|final)\b/i;

function bytesToBase64(bytes: Uint8Array): string {
  let binary = '';
  const CHUNK = 0x8000;
  for (let i = 0; i < bytes.length; i += CHUNK) {
    const slice = bytes.subarray(i, i + CHUNK);
    binary += String.fromCharCode(...slice);
  }
  return btoa(binary);
}

async function getAccessToken(refreshToken: string): Promise<string | null> {
  try {
    const res = await fetch(GOOGLE_TOKEN_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        client_id:     Deno.env.get('GOOGLE_CLIENT_ID')     ?? '',
        client_secret: Deno.env.get('GOOGLE_CLIENT_SECRET') ?? '',
        refresh_token: refreshToken,
        grant_type:    'refresh_token',
      }),
    });
    const data = await res.json();
    return typeof data.access_token === 'string' ? data.access_token : null;
  } catch (err) {
    console.error('[fetch-calendar-pdf] token refresh failed:', err);
    return null;
  }
}

serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });

  try {
    const body = await req.json().catch(() => ({}));
    const userId: string | undefined = body.user_id;
    const intentText: string = typeof body.intent_text === 'string' ? body.intent_text : '';
    const maxBytes: number = typeof body.max_bytes === 'number' ? body.max_bytes : DEFAULT_MAX_BYTES;

    if (!userId) {
      return new Response(JSON.stringify({ ok: false, error: 'user_id required' }), {
        status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // Intent gate — only fetch when the question is calendar-shaped.
    // Voice server can also pass intent_text="" to force-fetch (e.g. for
    // a manual test or a generic "what's coming up at school" query).
    if (intentText && !CALENDAR_INTENT_RE.test(intentText)) {
      return new Response(JSON.stringify({ ok: true, pdf_base64: null, reason: 'intent_no_match' }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const supabase = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '',
    );

    // Most recent calendar PDF for this user
    const { data: calDoc } = await supabase
      .from('documents')
      .select('drive_file_id, file_name, size_bytes, mime_type')
      .eq('user_id', userId)
      .eq('document_type', 'calendar')
      .eq('mime_type', 'application/pdf')
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle();

    if (!calDoc?.drive_file_id) {
      return new Response(JSON.stringify({ ok: true, pdf_base64: null, reason: 'no_calendar_pdf' }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    if (typeof calDoc.size_bytes === 'number' && calDoc.size_bytes > maxBytes) {
      return new Response(JSON.stringify({ ok: true, pdf_base64: null, reason: 'too_large' }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // Get the user's refresh token
    const { data: tokenRow } = await supabase
      .from('user_tokens')
      .select('refresh_token')
      .eq('user_id', userId)
      .eq('provider', 'google')
      .maybeSingle();

    if (!tokenRow?.refresh_token) {
      return new Response(JSON.stringify({ ok: true, pdf_base64: null, reason: 'no_google_token' }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const accessToken = await getAccessToken(tokenRow.refresh_token);
    if (!accessToken) {
      return new Response(JSON.stringify({ ok: false, error: 'failed_to_refresh_token' }), {
        status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // Download the PDF binary
    const dlRes = await fetch(
      `${DRIVE_FILES_URL}/${encodeURIComponent(calDoc.drive_file_id)}?alt=media`,
      { headers: { 'Authorization': `Bearer ${accessToken}` } },
    );
    if (!dlRes.ok) {
      return new Response(JSON.stringify({ ok: false, error: `drive_download_failed_${dlRes.status}` }), {
        status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const bytes = new Uint8Array(await dlRes.arrayBuffer());
    if (bytes.length === 0) {
      return new Response(JSON.stringify({ ok: true, pdf_base64: null, reason: 'empty_file' }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    console.log(`[fetch-calendar-pdf] user=${userId} file=${calDoc.file_name} size=${bytes.length}`);

    return new Response(JSON.stringify({
      ok: true,
      pdf_base64: bytesToBase64(bytes),
      file_name: calDoc.file_name,
      drive_file_id: calDoc.drive_file_id,
    }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });

  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error('[fetch-calendar-pdf] fatal:', msg);
    return new Response(JSON.stringify({ ok: false, error: msg }), {
      status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});
