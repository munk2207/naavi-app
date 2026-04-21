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
 *   - weather:         daily forecast matches condition+threshold at fire_at_hour in fire_at_timezone
 *   - contact_silence: specific sender hasn't emailed within the last N days
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
import { buildAlertBody } from '../_shared/alert_body.ts';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

interface ActionRule {
  id: string;
  user_id: string;
  trigger_type: 'email' | 'time' | 'calendar' | 'weather' | 'contact_silence';
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

  // Auto-disable any enabled rule whose trigger_config.expiry date is past.
  // Works across all trigger types (weather, location, contact_silence, etc.)
  // Cheap: one indexed UPDATE per cron tick.
  {
    const today = new Date().toISOString().slice(0, 10);
    const { error: expiryErr } = await adminClient
      .from('action_rules')
      .update({ enabled: false })
      .eq('enabled', true)
      .lt('trigger_config->>expiry', today);
    if (expiryErr) console.error('[evaluate-rules] expiry sweep failed:', expiryErr.message);
  }

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
        const success = await fireAction(rule, adminClient, supabaseUrl, interFnKey);

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
    case 'weather':
      return findWeatherTriggers(rule, now);
    case 'contact_silence':
      return findContactSilenceTriggers(client, rule, now);
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

// ── Weather triggers ────────────────────────────────────────────────────────

interface DayForecast {
  date: string;         // "YYYY-MM-DD" in the requested timezone
  temp_max: number;     // °C
  temp_min: number;     // °C
  precip_prob: number;  // %
  weather_code: number; // WMO
}

// WMO weather codes grouped by condition family.
// Reference: https://open-meteo.com/en/docs (Weather code — WMO)
const RAIN_CODES = new Set([51, 53, 55, 61, 63, 65, 80, 81, 82, 95]);
const SNOW_CODES = new Set([71, 73, 75, 85, 86]);

function localHour(date: Date, tz: string): number {
  const h = date.toLocaleString('en-US', { timeZone: tz, hour: '2-digit', hour12: false });
  return parseInt(h, 10);
}

function localDateISO(date: Date, tz: string): string {
  // en-CA returns "YYYY-MM-DD"
  return date.toLocaleDateString('en-CA', {
    timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit',
  });
}

function addDaysISO(iso: string, n: number): string {
  const [y, m, d] = iso.split('-').map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  dt.setUTCDate(dt.getUTCDate() + n);
  const yy = dt.getUTCFullYear();
  const mm = String(dt.getUTCMonth() + 1).padStart(2, '0');
  const dd = String(dt.getUTCDate()).padStart(2, '0');
  return `${yy}-${mm}-${dd}`;
}

async function geocodeCity(city: string): Promise<{ lat: number; lng: number } | null> {
  try {
    const url =
      `https://geocoding-api.open-meteo.com/v1/search` +
      `?name=${encodeURIComponent(city)}&count=1&language=en&format=json`;
    const res = await fetch(url);
    if (!res.ok) return null;
    const data = await res.json();
    const first = data.results?.[0];
    if (!first) return null;
    return { lat: first.latitude, lng: first.longitude };
  } catch (err) {
    console.error(`[evaluate-rules/weather] geocode failed for "${city}":`, err);
    return null;
  }
}

async function fetchWeatherForecast(
  lat: number,
  lng: number,
  tz: string,
): Promise<DayForecast[]> {
  try {
    const url =
      `https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lng}` +
      `&daily=temperature_2m_max,temperature_2m_min,precipitation_probability_max,weather_code` +
      `&timezone=${encodeURIComponent(tz)}&forecast_days=7`;
    const res = await fetch(url);
    if (!res.ok) return [];
    const data = await res.json();
    const d = data.daily;
    if (!d?.time) return [];
    return d.time.map((date: string, i: number) => ({
      date,
      temp_max: d.temperature_2m_max?.[i] ?? 0,
      temp_min: d.temperature_2m_min?.[i] ?? 0,
      precip_prob: d.precipitation_probability_max?.[i] ?? 0,
      weather_code: d.weather_code?.[i] ?? 0,
    }));
  } catch (err) {
    console.error('[evaluate-rules/weather] forecast fetch failed:', err);
    return [];
  }
}

function matchesWeatherCondition(day: DayForecast, condition: string, threshold: number): boolean {
  switch (condition) {
    case 'rain':
      return RAIN_CODES.has(day.weather_code) && day.precip_prob >= threshold;
    case 'snow':
      return SNOW_CODES.has(day.weather_code) && day.precip_prob >= threshold;
    case 'temp_max_above':
      return day.temp_max > threshold;
    case 'temp_min_below':
      return day.temp_min < threshold;
    default:
      return false;
  }
}

function resolveDayWindow(when: string, todayISO: string): { days: string[]; windowKey: string } {
  if (when === 'today') return { days: [todayISO], windowKey: `today-${todayISO}` };
  if (when === 'tomorrow') {
    const t = addDaysISO(todayISO, 1);
    return { days: [t], windowKey: `tomorrow-${t}` };
  }
  if (when === 'next_3_days') {
    const d = [addDaysISO(todayISO, 1), addDaysISO(todayISO, 2), addDaysISO(todayISO, 3)];
    return { days: d, windowKey: `next3-${d[0]}..${d[2]}` };
  }
  if (when === 'this_week') {
    const d: string[] = [];
    for (let i = 0; i < 7; i++) d.push(addDaysISO(todayISO, i));
    return { days: d, windowKey: `week-${d[0]}..${d[6]}` };
  }
  if (/^\d{4}-\d{2}-\d{2}$/.test(when)) return { days: [when], windowKey: `date-${when}` };
  return { days: [], windowKey: '' };
}

async function findWeatherTriggers(rule: ActionRule, now: Date): Promise<string[]> {
  const cfg = rule.trigger_config;
  const condition = String(cfg.condition ?? '');
  const threshold = Number(cfg.threshold);
  const when = String(cfg.when ?? 'tomorrow');
  const city = String(cfg.city ?? 'Ottawa');
  const matchMode = String(cfg.match ?? 'any');
  const fireHour = Number(cfg.fire_at_hour ?? 7);
  const fireTz = String(cfg.fire_at_timezone ?? 'America/Toronto');

  if (!condition || Number.isNaN(threshold)) return [];

  // Gate: only evaluate during the configured fire-hour in the configured
  // timezone. The cron runs every minute, so this function will evaluate
  // ~60 times per 7 AM hour; dedupe via trigger_ref prevents re-fire.
  if (localHour(now, fireTz) !== fireHour) return [];

  const geo = await geocodeCity(city);
  if (!geo) return [];

  const todayISO = localDateISO(now, fireTz);
  const window = resolveDayWindow(when, todayISO);
  if (window.days.length === 0) return [];

  const forecast = await fetchWeatherForecast(geo.lat, geo.lng, fireTz);
  if (forecast.length === 0) return [];

  const matchedDays = window.days.filter(d => {
    const day = forecast.find(f => f.date === d);
    return day ? matchesWeatherCondition(day, condition, threshold) : false;
  });

  const fires = matchMode === 'all'
    ? matchedDays.length === window.days.length
    : matchedDays.length > 0;

  if (!fires) return [];

  return [`weather-${condition}-${window.windowKey}`];
}

// ── Contact-silence triggers ────────────────────────────────────────────────
//
// Fires when a specific sender hasn't emailed within the last `days_silent`
// days. Inverse of the 'email' trigger. Self-contained — reads gmail_messages
// only.
//
// trigger_config:
//   { from_name?, from_email?, days_silent, fire_at_hour?, fire_at_timezone? }
// At least one of from_name / from_email is required. If both are set, they
// AND (both must match a row for it to count as activity).

async function findContactSilenceTriggers(
  client: any,
  rule: ActionRule,
  now: Date,
): Promise<string[]> {
  const cfg = rule.trigger_config;
  const fromName   = (cfg.from_name  as string | undefined) ?? '';
  const fromEmail  = (cfg.from_email as string | undefined) ?? '';
  const daysSilent = Number(cfg.days_silent);
  const fireHour   = Number(cfg.fire_at_hour ?? 7);
  const fireTz     = String(cfg.fire_at_timezone ?? 'America/Toronto');

  if (!fromName && !fromEmail) return [];
  if (!Number.isFinite(daysSilent) || daysSilent <= 0) return [];

  // Gate on the configured fire-hour, like weather.
  if (localHour(now, fireTz) !== fireHour) return [];

  const cutoff = new Date(now.getTime() - daysSilent * 24 * 60 * 60 * 1000).toISOString();

  let q = client
    .from('gmail_messages')
    .select('id')
    .eq('user_id', rule.user_id)
    .gte('received_at', cutoff)
    .limit(1);

  if (fromEmail) q = q.ilike('sender_email', fromEmail);
  if (fromName)  q = q.ilike('sender_name',  `%${fromName}%`);

  const { data, error } = await q;
  if (error) {
    console.error('[evaluate-rules/contact_silence] gmail_messages query failed:', error.message);
    return [];
  }

  const recentCount = (data ?? []).length;
  if (recentCount > 0) return []; // contact has emailed within window — no silence

  // Silence detected.
  const today = localDateISO(now, fireTz);
  const senderKey = (fromEmail || fromName).toLowerCase().replace(/[^a-z0-9]+/g, '-');
  return [`silence-${senderKey}-${today}`];
}

// ─── Fire action ────────────────────────────────────────────────────────────
//
// Fan-out policy (see project_naavi_alert_fanout.md memory + CLAUDE.md
// ALERT FAN-OUT section):
//   - Self-alert (destination matches user's own phone or email):
//       SMS + WhatsApp + Email + Push — all 4 in parallel.
//   - Third-party phone: SMS + WhatsApp (same number, 2-way fan-out).
//   - Third-party email: single email via user's Gmail.
// The rule.action_type is retained only to pick which destination field
// (to_phone vs to_email) is authoritative for self-alert detection.

async function fireAction(
  rule: ActionRule,
  adminClient: any,
  supabaseUrl: string,
  interFnKey: string,
): Promise<boolean> {
  const config = rule.action_config;
  const toPhone = String(config.to_phone ?? '');
  const toEmail = String(config.to_email ?? '');
  const subject = String(config.subject ?? rule.label ?? 'Message from MyNaavi');
  const toName  = String(config.to_name ?? '');

  // Build the final body from base + inline tasks + linked list items.
  // See _shared/alert_body.ts for the merge rules.
  const body = await buildAlertBody(config, rule.user_id, supabaseUrl, interFnKey);

  if (!body) {
    console.error(`[evaluate-rules] Rule ${rule.id}: empty body after buildAlertBody`);
    return false;
  }

  // Look up the user's own contact info for self-alert detection.
  const { data: settings } = await adminClient
    .from('user_settings')
    .select('phone, name')
    .eq('user_id', rule.user_id)
    .maybeSingle();
  const userPhone = settings?.phone ?? null;
  const userName  = settings?.name  ?? null;

  const { data: authData } = await adminClient.auth.admin.getUserById(rule.user_id);
  const userEmail = authData?.user?.email ?? null;

  const isSelfByPhone = toPhone && userPhone && toPhone === userPhone;
  const isSelfByEmail = toEmail && userEmail && toEmail.toLowerCase() === userEmail.toLowerCase();
  const isSelfAlert   = Boolean(isSelfByPhone || isSelfByEmail);

  // Channel call helpers
  const callSMS = (channel: 'sms' | 'whatsapp', to: string) =>
    fetch(`${supabaseUrl}/functions/v1/send-sms`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${interFnKey}` },
      body: JSON.stringify({
        to, body, channel,
        user_id: rule.user_id,
        recipient_name: toName || userName || undefined,
        sender_name: 'Naavi',
        source: 'alert',
      }),
    }).then(res => ({ channel, ok: res.ok }))
      .catch(() => ({ channel, ok: false }));

  const callEmail = (to: string) =>
    fetch(`${supabaseUrl}/functions/v1/send-user-email`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${interFnKey}` },
      body: JSON.stringify({ user_id: rule.user_id, subject, body, to }),
    }).then(res => ({ channel: 'email', ok: res.ok }))
      .catch(() => ({ channel: 'email', ok: false }));

  const callPush = () =>
    fetch(`${supabaseUrl}/functions/v1/send-push-notification`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${interFnKey}` },
      body: JSON.stringify({
        user_id: rule.user_id,
        title: rule.label ?? 'Naavi Alert',
        body,
      }),
    }).then(res => ({ channel: 'push', ok: res.ok }))
      .catch(() => ({ channel: 'push', ok: false }));

  const sends: Promise<{ channel: string; ok: boolean }>[] = [];

  if (isSelfAlert) {
    // Quadruple-channel: SMS + WhatsApp + Email + Push.
    // Gracefully skip channels where the user has no destination.
    if (userPhone) {
      sends.push(callSMS('sms', userPhone));
      sends.push(callSMS('whatsapp', userPhone));
    }
    if (userEmail) {
      sends.push(callEmail(userEmail));
    }
    // Push — function looks up tokens itself; attempt regardless.
    sends.push(callPush());
  } else if (toPhone) {
    // Third-party phone — SMS + WhatsApp fan-out to the specified number.
    sends.push(callSMS('sms', toPhone));
    sends.push(callSMS('whatsapp', toPhone));
  } else if (toEmail) {
    // Third-party email — single email via user's Gmail.
    sends.push(callEmail(toEmail));
  } else {
    console.error(`[evaluate-rules] Rule ${rule.id}: no destination (to_phone or to_email)`);
    return false;
  }

  const results = await Promise.allSettled(sends);
  const parts: string[] = [];
  let successCount = 0;
  for (const r of results) {
    if (r.status === 'fulfilled') {
      parts.push(`${r.value.channel}=${r.value.ok ? 'ok' : 'fail'}`);
      if (r.value.ok) successCount++;
    } else {
      parts.push('unknown=error');
    }
  }

  const mode = isSelfAlert ? 'self' : (toPhone ? 'third-party-phone' : 'third-party-email');
  console.log(
    `[evaluate-rules] Rule ${rule.id} fan-out (${mode}): ${parts.join(' ')} — ${successCount}/${sends.length} ok`,
  );

  return successCount > 0;
}
