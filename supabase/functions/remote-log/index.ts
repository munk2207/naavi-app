/**
 * remote-log Edge Function
 *
 * Accepts diagnostic timing events from the mobile app and inserts them into
 * the `client_diagnostics` table. Built for the V57.9.x 90-second chat-hang
 * investigation: when adb logcat is unavailable, the phone POSTs each step
 * of the send pipeline here and we read the rows back to find the gap.
 *
 * Shape (POST body):
 *   {
 *     session_id:     string   (uuid generated on the phone per send-attempt)
 *     step:           string   (e.g. 'send-tap', 'fetch-start', 'fetch-error')
 *     user_id?:       string   (uuid, optional — null if pre-auth)
 *     ms_since_start?: number  (ms elapsed since the first event of this session)
 *     payload?:       object   (any small JSON — error msg, sizes, etc.)
 *     build_version?: string   (e.g. 'V57.9.2-128')
 *   }
 *
 * Auth: NO JWT required (`--no-verify-jwt` at deploy). The whole point is
 * that the phone may not have a valid session — that's what we're debugging.
 *
 * Always returns 200 fast. Insert errors are swallowed so the helper on
 * the phone never blocks the chat send pipeline.
 */

import { serve } from 'https://deno.land/std@0.224.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const corsHeaders = {
  'Access-Control-Allow-Origin':  '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  let body: any = null;
  try {
    body = await req.json();
  } catch {
    return new Response(JSON.stringify({ ok: false, reason: 'bad-json' }), {
      status: 200,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }

  const session_id = typeof body?.session_id === 'string' ? body.session_id.slice(0, 64) : null;
  const step       = typeof body?.step       === 'string' ? body.step.slice(0, 80)        : null;
  if (!session_id || !step) {
    return new Response(JSON.stringify({ ok: false, reason: 'missing-required' }), {
      status: 200,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }

  const user_id        = typeof body?.user_id        === 'string' ? body.user_id        : null;
  const ms_since_start = Number.isFinite(body?.ms_since_start) ? Math.round(body.ms_since_start) : null;
  const build_version  = typeof body?.build_version  === 'string' ? body.build_version.slice(0, 40) : null;
  const payload        = body?.payload && typeof body.payload === 'object' ? body.payload : null;

  const admin = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
    { auth: { persistSession: false } },
  );

  const { error } = await admin.from('client_diagnostics').insert({
    user_id,
    session_id,
    step,
    ms_since_start,
    payload,
    build_version,
  });

  if (error) {
    console.error('[remote-log] insert error:', error.message);
    return new Response(JSON.stringify({ ok: false, reason: 'db-error' }), {
      status: 200,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }

  return new Response(JSON.stringify({ ok: true }), {
    status: 200,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
});
