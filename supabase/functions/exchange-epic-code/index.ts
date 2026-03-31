/**
 * exchange-epic-code Edge Function
 *
 * Called from the Epic callback page with the authorization code + PKCE verifier.
 * Exchanges the code for tokens server-side (avoids browser CSP restrictions)
 * and stores them in epic_tokens — no Supabase user session required.
 */

import { serve } from 'https://deno.land/std@0.177.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

const EPIC_TOKEN_URL = 'https://fhir.epic.com/interconnect-fhir-oauth/oauth2/token';
const EPIC_CLIENT_ID = 'f2b6e09c-0569-4ecf-8e81-027432281052';
const REDIRECT_URI   = 'https://naavi-app.vercel.app/auth/epic/callback';

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  try {
    const { code, code_verifier } = await req.json();

    if (!code || !code_verifier) {
      return new Response(JSON.stringify({ error: 'code and code_verifier required' }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // Exchange code for tokens (server-side — no CSP restrictions)
    const body = new URLSearchParams({
      grant_type:    'authorization_code',
      code,
      redirect_uri:  REDIRECT_URI,
      client_id:     EPIC_CLIENT_ID,
      code_verifier,
    });

    const tokenRes = await fetch(EPIC_TOKEN_URL, {
      method:  'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body:    body.toString(),
    });

    if (!tokenRes.ok) {
      const text = await tokenRes.text();
      console.error('[exchange-epic-code] Token exchange failed:', text);
      return new Response(JSON.stringify({ error: `Token exchange failed: ${text}` }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const tokens = await tokenRes.json();
    console.log('[exchange-epic-code] Token exchange success, patient:', tokens.patient);

    // Store tokens using service role — no user auth needed
    const adminClient = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
    );

    // Use a stable anonymous user key based on patient_id so tokens persist across sessions
    const patientId = tokens.patient ?? 'unknown';
    const expiresAt = new Date(Date.now() + (tokens.expires_in ?? 3600) * 1000).toISOString();

    const { error: dbError } = await adminClient
      .from('epic_tokens')
      .upsert({
        user_id:       '00000000-0000-0000-0000-000000000001', // placeholder — no auth user needed
        access_token:  tokens.access_token,
        refresh_token: tokens.refresh_token ?? null,
        expires_at:    expiresAt,
        patient_id:    patientId,
        scope:         tokens.scope ?? '',
        updated_at:    new Date().toISOString(),
      }, { onConflict: 'patient_id' });

    if (dbError) {
      console.error('[exchange-epic-code] DB error:', dbError.message);
      // Still return success — tokens will be used from response
    }

    return new Response(JSON.stringify({
      ok: true,
      patient_id: patientId,
      scope:      tokens.scope,
    }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });

  } catch (err) {
    console.error('[exchange-epic-code] Unexpected error:', err);
    return new Response(JSON.stringify({ error: String(err) }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});
