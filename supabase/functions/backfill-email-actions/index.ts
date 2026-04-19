/**
 * backfill-email-actions Edge Function
 *
 * One-off utility: for a given user_id, runs extract-email-actions across
 * every tier-1 gmail message that doesn't yet have a row in email_actions.
 * Sequential to respect Anthropic rate limits. Returns counts.
 *
 * Input body: { user_id: string, max?: number }
 */

import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.45.0';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  try {
    const { user_id, max = 100 } = await req.json();
    if (!user_id) throw new Error('user_id required');

    const supabase = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '',
    );

    // Fetch tier-1 messages that don't already have an email_action row.
    const { data: msgs, error } = await supabase
      .from('gmail_messages')
      .select('gmail_message_id')
      .eq('user_id', user_id)
      .eq('is_tier1', true)
      .order('received_at', { ascending: false })
      .limit(max);

    if (error) throw new Error(error.message);

    const existing = await supabase
      .from('email_actions')
      .select('gmail_message_id')
      .eq('user_id', user_id);
    const seen = new Set((existing.data ?? []).map((r: { gmail_message_id: string }) => r.gmail_message_id));

    const todo = (msgs ?? [])
      .map((r: { gmail_message_id: string }) => r.gmail_message_id)
      .filter((id: string) => !seen.has(id));

    const supabaseUrl = Deno.env.get('SUPABASE_URL') ?? '';
    const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';

    let processed = 0;
    let actionable = 0;
    let notActionable = 0;
    let errors = 0;

    for (const id of todo) {
      try {
        const res = await fetch(`${supabaseUrl}/functions/v1/extract-email-actions`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${serviceKey}`,
          },
          body: JSON.stringify({ gmail_message_id: id, user_id }),
        });
        const data = await res.json();
        if (data?.action) actionable++;
        else notActionable++;
        processed++;
      } catch (e) {
        errors++;
        console.error('[backfill] failed for', id, e);
      }
    }

    return new Response(
      JSON.stringify({
        total_tier1: msgs?.length ?? 0,
        already_extracted: seen.size,
        processed,
        actionable,
        not_actionable: notActionable,
        errors,
      }),
      { headers: { ...corsHeaders, 'content-type': 'application/json' } },
    );
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'Unknown error';
    console.error('[backfill-email-actions] Error:', msg);
    return new Response(
      JSON.stringify({ error: msg }),
      { status: 500, headers: { ...corsHeaders, 'content-type': 'application/json' } },
    );
  }
});
