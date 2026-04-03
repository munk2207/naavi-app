/**
 * store-epic-token Edge Function
 *
 * Called from the app after Epic SMART on FHIR OAuth completes.
 * Stores the access + refresh tokens in the epic_tokens table so the
 * server can call Epic FHIR APIs on Robert's behalf without prompting him.
 */

import { serve } from 'https://deno.land/std@0.177.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  try {
    const { access_token, refresh_token, expires_in, patient_id, scope } = await req.json();

    if (!access_token) {
      return new Response(JSON.stringify({ error: 'access_token required' }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // Identify caller
    const authHeader = req.headers.get('Authorization');
    const userClient = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_ANON_KEY')!,
      { global: { headers: { Authorization: authHeader! } } }
    );
    const { data: { user }, error: userError } = await userClient.auth.getUser();
    if (userError || !user) {
      return new Response(JSON.stringify({ error: 'Unauthorized' }), {
        status: 401,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const adminClient = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
    );

    const expiresAt = new Date(Date.now() + (expires_in ?? 3600) * 1000).toISOString();

    const { error } = await adminClient
      .from('epic_tokens')
      .upsert({
        user_id:       user.id,
        access_token,
        refresh_token: refresh_token ?? null,
        expires_at:    expiresAt,
        patient_id:    patient_id    ?? null,
        scope:         scope         ?? '',
        updated_at:    new Date().toISOString(),
      }, { onConflict: 'user_id' });

    if (error) {
      console.error('[store-epic-token] DB error:', error.message);
      return new Response(JSON.stringify({ error: error.message }), {
        status: 500,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    console.log('[store-epic-token] Stored Epic tokens for user:', user.id, 'patient:', patient_id);
    return new Response(JSON.stringify({ ok: true }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });

  } catch (err) {
    console.error('[store-epic-token] Unexpected error:', err);
    return new Response(JSON.stringify({ error: 'Internal server error' }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});
