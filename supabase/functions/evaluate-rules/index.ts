/**
 * evaluate-rules Edge Function
 *
 * Unified trigger-action engine. Runs every minute via pg_cron.
 * Evaluates all enabled action_rules and fires matching actions.
 *
 * Trigger types:
 *   - email:    new email matching from_name/from_email/subject_keyword
 *   - time:     datetime has passed
 *   - calendar: upcoming event matches event_match within N minutes
 *
 * Action types:
 *   - sms:      send SMS via Twilio
 *   - whatsapp: send WhatsApp via Twilio
 *   - email:    send email via Gmail adapter (send-email-action)
 *
 * Dedup: action_rule_log prevents re-firing for the same trigger event.
 * One-shot rules auto-disable after first fire.
 */

import { serve } from 'https://deno.land/std@0.224.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

interface ActionRule {
  id: string;
  user_id: string;
  trigger_type: 'email' | 'time' | 'calendar';
  trigger_config: Record<string, any>;
  action_type: 'email' | 'sms' | 'whatsapp';
  action_config: Record<string, any>;
  label: string;
  one_shot: boolean;
  created_at: string;
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

  const adminClient = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
  );

  const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
  const interFnKey  = Deno.env.get('NAAVI_ANON_KEY') ?? Deno.env.get('SUPABASE_ANON_KEY')!;
  const now = new Date();

  // Load all enabled rules
  const { data: rules, error: rulesError } = await adminClient
    .from('action_rules')
    .select('*')
    .eq('enabled', true);

  if (rulesError) {
    console.error('[evaluate-rules] Failed to load rules:', rulesError.message);
    return new Response(JSON.stringify({ error: rulesError.message }), {
      status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }

  if (!rules?.length) {
    return new Response(JSON.stringify({ message: 'No active rules', checked_at: now.toISOString() }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }

  const fired: { rule_id: string; label: string; trigger_ref: string }[] = [];
  const errors: string[] = [];

  for (const rule of rules as ActionRule[]) {
    try {
      const triggers = await findTriggers(adminClient, rule, now);

      for (const triggerRef of triggers) {
        // Dedup check
        const { data: existing } = await adminClient
          .from('action_rule_log')
          .select('id')
          .eq('rule_id', rule.id)
          .eq('trigger_ref', triggerRef)
          .maybeSingle();

        if (existing) continue;

        // Fire the action
        const success = await fireAction(rule, supabaseUrl, interFnKey);

        if (success) {
          // Log to prevent re-firing
          await adminClient.from('action_rule_log').insert({
            rule_id: rule.id,
            trigger_ref: triggerRef,
          });

          // Update last_fired_at
          await adminClient
            .from('action_rules')
            .update({ last_fired_at: now.toISOString() })
            .eq('id', rule.id);

          // Disable one-shot rules
          if (rule.one_shot) {
            await adminClient
              .from('action_rules')
              .update({ enabled: false })
              .eq('id', rule.id);
          }

          fired.push({ rule_id: rule.id, label: rule.label, trigger_ref: triggerRef });
          console.log(`[evaluate-rules] Fired: "${rule.label}" (trigger: ${triggerRef})`);
        }
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      errors.push(`Rule ${rule.id}: ${msg}`);
      console.error(`[evaluate-rules] Error for rule ${rule.id}:`, msg);
    }
  }

  return new Response(
    JSON.stringify({ fired: fired.length, details: fired, errors, checked_at: now.toISOString() }),
    { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
  );
});

// ─── Find matching triggers ─────────────────────────────────────────────────

async function findTriggers(
  client: any,
  rule: ActionRule,
  now: Date,
): Promise<string[]> {
  switch (rule.trigger_type) {
    case 'email':
      return findEmailTriggers(client, rule, now);
    case 'time':
      return findTimeTriggers(rule, now);
    case 'calendar':
      return findCalendarTriggers(client, rule, now);
    default:
      return [];
  }
}

// ── Email triggers ──────────────────────────────────────────────────────────

async function findEmailTriggers(
  client: any,
  rule: ActionRule,
  now: Date,
): Promise<string[]> {
  const config = rule.trigger_config;
  const fromName = config.from_name as string | null;
  const fromEmail = config.from_email as string | null;
  const subjectKeyword = config.subject_keyword as string | null;

  if (!fromName && !fromEmail && !subjectKeyword) return [];

  // Only check emails from after the rule was created, within last 24h
  const cutoff = new Date(Math.max(
    new Date(rule.created_at).getTime(),
    now.getTime() - 24 * 60 * 60 * 1000
  )).toISOString();

  const { data: messages, error } = await client
    .from('gmail_messages')
    .select('gmail_message_id, subject, sender_name, sender_email, snippet, received_at')
    .eq('user_id', rule.user_id)
    .gte('received_at', cutoff)
    .order('received_at', { ascending: false })
    .limit(50);

  if (error || !messages?.length) return [];

  return (messages as GmailMessage[])
    .filter(msg => {
      const nameMatch = fromName
        ? msg.sender_name.toLowerCase().includes(fromName.toLowerCase())
        : false;
      const emailMatch = fromEmail
        ? msg.sender_email.toLowerCase() === fromEmail.toLowerCase()
        : false;
      const subjectMatch = subjectKeyword
        ? msg.subject.toLowerCase().includes(subjectKeyword.toLowerCase())
        : false;
      return nameMatch || emailMatch || subjectMatch;
    })
    .map(msg => msg.gmail_message_id);
}

// ── Time triggers ───────────────────────────────────────────────────────────

function findTimeTriggers(rule: ActionRule, now: Date): string[] {
  const datetime = rule.trigger_config.datetime as string | null;
  if (!datetime) return [];

  const triggerTime = new Date(datetime);
  if (triggerTime > now) return []; // not yet

  // Use the datetime string as trigger_ref for dedup
  return [datetime];
}

// ── Calendar triggers ───────────────────────────────────────────────────────

async function findCalendarTriggers(
  client: any,
  rule: ActionRule,
  now: Date,
): Promise<string[]> {
  const config = rule.trigger_config;
  const eventMatch = (config.event_match as string ?? '').toLowerCase();
  const timing = (config.timing as string) ?? 'before'; // 'before' or 'after'
  const minutes = (config.minutes as number) ?? 30;

  if (!eventMatch) return [];

  // Look for calendar events in the Google Calendar data stored in Supabase
  // We check events starting within the trigger window
  const windowStart = timing === 'before'
    ? now
    : new Date(now.getTime() - minutes * 60_000);
  const windowEnd = timing === 'before'
    ? new Date(now.getTime() + minutes * 60_000)
    : now;

  // Query calendar_items table for events matching the keyword
  const { data: events, error } = await client
    .from('calendar_items')
    .select('id, title, start_time')
    .eq('user_id', rule.user_id)
    .gte('start_time', windowStart.toISOString())
    .lte('start_time', windowEnd.toISOString())
    .limit(20);

  if (error || !events?.length) return [];

  return events
    .filter((evt: any) => (evt.title ?? '').toLowerCase().includes(eventMatch))
    .map((evt: any) => `cal_${evt.id}_${rule.id}`);
}

// ─── Fire action ────────────────────────────────────────────────────────────

async function fireAction(
  rule: ActionRule,
  supabaseUrl: string,
  interFnKey: string,
): Promise<boolean> {
  const config = rule.action_config;
  const body = String(config.body ?? '');
  const toPhone = String(config.to_phone ?? '');
  const toEmail = String(config.to_email ?? '');

  if (rule.action_type === 'sms' || rule.action_type === 'whatsapp') {
    if (!toPhone || !body) {
      console.error(`[evaluate-rules] Rule ${rule.id}: missing to_phone or body for ${rule.action_type}`);
      return false;
    }

    const res = await fetch(`${supabaseUrl}/functions/v1/send-sms`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${interFnKey}`,
      },
      body: JSON.stringify({
        to: toPhone,
        body: body,
        channel: rule.action_type,
      }),
    });

    if (!res.ok) {
      const errData = await res.json().catch(() => ({}));
      console.error(`[evaluate-rules] ${rule.action_type} failed for rule ${rule.id}:`, errData);
      return false;
    }
    return true;
  }

  if (rule.action_type === 'email') {
    if (!toEmail || !body) {
      console.error(`[evaluate-rules] Rule ${rule.id}: missing to_email or body for email`);
      return false;
    }

    // Use the send-email Edge Function or Gmail API directly
    // For now, call send-sms with a notification that the email action was triggered
    // TODO: Wire up Gmail send via adapter when available server-side
    const subject = String(config.subject ?? 'Message from MyNaavi');
    const toName = String(config.to_name ?? '');

    // Send via Gmail REST API using the user's stored tokens
    const { data: tokens } = await createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
    )
      .from('user_google_tokens')
      .select('access_token')
      .eq('user_id', rule.user_id)
      .maybeSingle();

    if (!tokens?.access_token) {
      console.error(`[evaluate-rules] Rule ${rule.id}: no Google token for email action`);
      return false;
    }

    // Build RFC 2822 email
    const emailLines = [
      `To: ${toName ? `${toName} <${toEmail}>` : toEmail}`,
      `Subject: ${subject}`,
      'Content-Type: text/plain; charset=UTF-8',
      '',
      body,
    ].join('\r\n');

    const raw = btoa(unescape(encodeURIComponent(emailLines)))
      .replace(/\+/g, '-')
      .replace(/\//g, '_')
      .replace(/=+$/, '');

    const gmailRes = await fetch('https://gmail.googleapis.com/gmail/v1/users/me/messages/send', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${tokens.access_token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ raw }),
    });

    if (!gmailRes.ok) {
      const errData = await gmailRes.json().catch(() => ({}));
      console.error(`[evaluate-rules] Gmail send failed for rule ${rule.id}:`, errData);
      return false;
    }
    return true;
  }

  return false;
}
