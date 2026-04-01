/**
 * check-email-alerts Edge Function
 *
 * Runs after every Gmail sync (called from sync-gmail).
 * Can also be called directly for a specific user.
 *
 * For each active email watch rule:
 * 1. Queries gmail_messages for recent emails matching the rule criteria
 * 2. Skips emails already alerted (deduped via email_alert_log)
 * 3. Sends an SMS via send-sms for each new match
 * 4. Logs sent alerts to prevent duplicate messages
 *
 * Match logic:
 * - from_name:       sender_name ILIKE '%value%'
 * - from_email:      sender_email ILIKE 'value'  (exact, case-insensitive)
 * - subject_keyword: subject ILIKE '%value%'
 * Multiple criteria on the same rule are OR'd together.
 */

import { serve } from 'https://deno.land/std@0.224.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

interface WatchRule {
  id: string;
  user_id: string;
  from_name: string | null;
  from_email: string | null;
  subject_keyword: string | null;
  phone_number: string;
  label: string;
}

interface GmailMessage {
  gmail_message_id: string;
  subject: string;
  sender_name: string;
  sender_email: string;
  snippet: string;
  received_at: string;
}

serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });

  // Accept optional user_id to narrow the check to one user
  let targetUserId: string | null = null;
  try {
    const body = await req.json().catch(() => ({}));
    targetUserId = body.user_id ?? null;
  } catch {
    // no body — check all users
  }

  const adminClient = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
  );

  const supabaseUrl = Deno.env.get('SUPABASE_URL')!;

  // Load active rules
  let rulesQuery = adminClient
    .from('email_watch_rules')
    .select('id, user_id, from_name, from_email, subject_keyword, phone_number, label')
    .eq('is_active', true);

  if (targetUserId) rulesQuery = rulesQuery.eq('user_id', targetUserId);

  const { data: rules, error: rulesError } = await rulesQuery;

  if (rulesError) {
    console.error('[check-email-alerts] Failed to load rules:', rulesError.message);
    return new Response(JSON.stringify({ error: rulesError.message }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }

  if (!rules?.length) {
    return new Response(JSON.stringify({ message: 'No active watch rules' }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }

  const alertsSent: { rule_id: string; gmail_message_id: string; label: string }[] = [];
  const errors: string[] = [];

  for (const rule of rules as WatchRule[]) {
    try {
      // Build OR filter for this rule's match criteria
      // We fetch recent emails (last 2 hours) to limit the scan window
      const twoHoursAgo = new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString();

      const { data: messages, error: msgError } = await adminClient
        .from('gmail_messages')
        .select('gmail_message_id, subject, sender_name, sender_email, snippet, received_at')
        .eq('user_id', rule.user_id)
        .gte('received_at', twoHoursAgo)
        .order('received_at', { ascending: false })
        .limit(50);

      if (msgError) {
        errors.push(`Rule ${rule.id}: ${msgError.message}`);
        continue;
      }

      if (!messages?.length) continue;

      // Filter messages client-side using the rule criteria
      const matches = (messages as GmailMessage[]).filter(msg => {
        const nameMatch = rule.from_name
          ? msg.sender_name.toLowerCase().includes(rule.from_name.toLowerCase())
          : false;
        const emailMatch = rule.from_email
          ? msg.sender_email.toLowerCase() === rule.from_email.toLowerCase()
          : false;
        const subjectMatch = rule.subject_keyword
          ? msg.subject.toLowerCase().includes(rule.subject_keyword.toLowerCase())
          : false;
        return nameMatch || emailMatch || subjectMatch;
      });

      for (const msg of matches) {
        // Check dedup — was this alert already sent?
        const { data: existing } = await adminClient
          .from('email_alert_log')
          .select('id')
          .eq('rule_id', rule.id)
          .eq('gmail_message_id', msg.gmail_message_id)
          .maybeSingle();

        if (existing) continue; // already alerted

        // Build SMS text
        const smsBody = [
          `MyNaavi: New email matching "${rule.label}"`,
          `From: ${msg.sender_name || msg.sender_email}`,
          `Subject: ${msg.subject || '(no subject)'}`,
          msg.snippet ? `"${msg.snippet.slice(0, 80)}"` : '',
        ].filter(Boolean).join('\n');

        // Send SMS — use NAAVI_ANON_KEY (SUPABASE_SERVICE_ROLE_KEY was rotated)
        const interFnKey = Deno.env.get('NAAVI_ANON_KEY') ?? Deno.env.get('SUPABASE_ANON_KEY')!;
        const smsRes = await fetch(`${supabaseUrl}/functions/v1/send-sms`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${interFnKey}`,
          },
          body: JSON.stringify({ to: rule.phone_number, body: smsBody }),
        });

        if (!smsRes.ok) {
          const errData = await smsRes.json().catch(() => ({}));
          errors.push(`SMS failed for rule ${rule.id}: ${errData.error ?? smsRes.status}`);
          continue;
        }

        // Log the alert so we never send it again
        await adminClient.from('email_alert_log').insert({
          user_id: rule.user_id,
          rule_id: rule.id,
          gmail_message_id: msg.gmail_message_id,
        });

        alertsSent.push({
          rule_id: rule.id,
          gmail_message_id: msg.gmail_message_id,
          label: rule.label,
        });

        console.log(`[check-email-alerts] Alert sent — rule "${rule.label}", msg ${msg.gmail_message_id}`);
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      errors.push(`Rule ${rule.id}: ${message}`);
      console.error(`[check-email-alerts] Error processing rule ${rule.id}:`, message);
    }
  }

  return new Response(
    JSON.stringify({ alerts_sent: alertsSent.length, details: alertsSent, errors }),
    { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
  );
});
