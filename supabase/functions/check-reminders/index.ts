/**
 * check-reminders Edge Function
 *
 * Runs every minute via pg_cron.
 * Finds all reminders where datetime <= now() and fired = false,
 * sends a Twilio SMS to the stored phone number, then marks as fired.
 *
 * Completely server-side — works whether or not Robert has the app open.
 */

import { serve } from 'https://deno.land/std@0.224.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

interface Reminder {
  id: string;
  user_id: string;
  title: string;
  datetime: string;
  phone_number: string;
}

serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });

  const adminClient = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
  );

  const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
  const interFnKey  = Deno.env.get('NAAVI_ANON_KEY') ?? Deno.env.get('SUPABASE_ANON_KEY')!;

  const now = new Date().toISOString();

  // Find all due reminders not yet fired
  const { data: reminders, error } = await adminClient
    .from('reminders')
    .select('id, user_id, title, datetime, phone_number')
    .eq('fired', false)
    .not('phone_number', 'is', null)
    .lte('datetime', now);

  if (error) {
    console.error('[check-reminders] Query error:', error.message);
    return new Response(JSON.stringify({ error: error.message }), {
      status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }

  if (!reminders?.length) {
    return new Response(JSON.stringify({ message: 'No reminders due', checked_at: now }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }

  const fired: string[] = [];
  const errors: string[] = [];

  for (const reminder of reminders as Reminder[]) {
    try {
      const alertTime = new Date().toLocaleString('en-CA', {
        timeZone: 'America/Toronto',
        month: 'short', day: 'numeric',
        hour: 'numeric', minute: '2-digit',
        hour12: true,
      });

      const smsBody = `🔔 Reminder: ${reminder.title}\n🕐 ${alertTime}\n— MyNaavi`;

      const smsRes = await fetch(`${supabaseUrl}/functions/v1/send-sms`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${interFnKey}`,
        },
        body: JSON.stringify({ to: reminder.phone_number, body: smsBody }),
      });

      if (!smsRes.ok) {
        const errData = await smsRes.json().catch(() => ({}));
        errors.push(`Reminder ${reminder.id}: ${errData.error ?? smsRes.status}`);
        continue;
      }

      // Mark as fired
      await adminClient
        .from('reminders')
        .update({ fired: true, fired_at: now })
        .eq('id', reminder.id);

      fired.push(reminder.id);
      console.log(`[check-reminders] Fired: "${reminder.title}" → ${reminder.phone_number}`);

    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      errors.push(`Reminder ${reminder.id}: ${msg}`);
      console.error(`[check-reminders] Error for reminder ${reminder.id}:`, msg);
    }
  }

  return new Response(
    JSON.stringify({ fired: fired.length, fired_ids: fired, errors }),
    { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
  );
});
