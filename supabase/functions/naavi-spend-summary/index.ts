/**
 * naavi-spend-summary Edge Function
 *
 * Aggregates extracted invoice/renewal amounts by vendor and time period and
 * returns ONE number per currency. Built so questions like
 *   "How much did Anthropic charge me last month?"
 * return a number, not a list.
 *
 * Source data: `email_actions` rows where action_type IN ('pay', 'renewal').
 * Every billing email Naavi ingests goes through `extract-email-actions` which
 * populates `vendor`, `amount_cents`, `currency`, and `created_at`. That's
 * already enough to aggregate without any schema change. PDF-only amounts
 * (where the email body says "see attached" and the dollar amount lives only
 * in the PDF) are a future enhancement that joins through `documents`.
 *
 * Auth (CLAUDE.md Rule 4):
 *   1. JWT in Authorization header (mobile app)
 *   2. user_id in body (voice server / server-side)
 *   No user_tokens fallback — multi-user safety.
 *
 * Request body:
 *   {
 *     vendor:        string,           // matched ILIKE %vendor%
 *     user_id?:      string,           // server-side path
 *     period_start?: string (ISO),     // optional explicit start (inclusive)
 *     period_end?:   string (ISO),     // optional explicit end (exclusive)
 *     period_label?: string,           // 'last month' | 'this month' | 'last year' | 'this year' | 'last week' | 'this week' | 'today' | 'yesterday' | 'all time'
 *     timezone?:     string,           // default 'America/Toronto'
 *     action_types?: string[],         // default ['pay', 'renewal']
 *   }
 *
 * Response:
 *   {
 *     vendor:         string,
 *     period_label:   string,
 *     period_start:   string (ISO, inclusive),
 *     period_end:     string (ISO, exclusive),
 *     invoice_count:  number,
 *     total_cents:    number | null,   // sum across all currencies (null if mixed)
 *     currency:       string | null,   // dominant currency, null if mixed
 *     by_currency:    [{ currency: string, total_cents: number, invoice_count: number }],
 *     vendors_seen:   string[],        // distinct vendor strings that matched
 *   }
 */

import { serve } from 'https://deno.land/std@0.224.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const corsHeaders = {
  'Access-Control-Allow-Origin':  '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

const DEFAULT_TZ = 'America/Toronto';
const DEFAULT_ACTION_TYPES = ['pay', 'renewal'];

interface EmailActionRow {
  vendor: string | null;
  amount_cents: number | null;
  currency: string | null;
  created_at: string;
}

interface CurrencyBucket {
  currency: string;
  total_cents: number;
  invoice_count: number;
}

/** Return [start, end) ISO strings for a labeled period, anchored in the given IANA tz. */
function resolvePeriod(label: string, tz: string): { start: string; end: string; resolvedLabel: string } {
  const now = new Date();
  // Get the now-in-tz year/month/day via Intl. The values are LOCAL to tz.
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: tz,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(now);
  const get = (t: string) => Number(parts.find(p => p.type === t)?.value ?? '0');
  const Y = get('year');
  const M = get('month'); // 1-12
  const D = get('day');

  const localStartOfDay = (y: number, m: number, d: number): string => {
    // Build an ISO string anchored at midnight in tz. We take advantage of
    // the fact that Deno supports tz-aware ISO strings via `Intl` only for
    // formatting, not parsing. Workaround: format the target instant in tz,
    // adjust for the offset, return UTC ISO. Simple loop.
    const local = new Date(Date.UTC(y, m - 1, d, 0, 0, 0));
    // Get tz offset for that instant.
    const tzFmt = new Intl.DateTimeFormat('en-US', {
      timeZone: tz, hour12: false,
      year: 'numeric', month: '2-digit', day: '2-digit',
      hour: '2-digit', minute: '2-digit', second: '2-digit',
    }).formatToParts(local);
    const tzGet = (t: string) => Number(tzFmt.find(p => p.type === t)?.value ?? '0');
    const tzY = tzGet('year'), tzM = tzGet('month'), tzD = tzGet('day'),
          tzH = tzGet('hour'), tzMin = tzGet('minute'), tzS = tzGet('second');
    const asIfUTC = Date.UTC(tzY, tzM - 1, tzD, tzH, tzMin, tzS);
    const offsetMs = asIfUTC - local.getTime();
    return new Date(local.getTime() - offsetMs).toISOString();
  };

  const k = label.trim().toLowerCase();

  if (k === 'last month') {
    const lmY = M === 1 ? Y - 1 : Y;
    const lmM = M === 1 ? 12 : M - 1;
    return { start: localStartOfDay(lmY, lmM, 1), end: localStartOfDay(Y, M, 1), resolvedLabel: 'last month' };
  }
  if (k === 'this month') {
    const nmY = M === 12 ? Y + 1 : Y;
    const nmM = M === 12 ? 1 : M + 1;
    return { start: localStartOfDay(Y, M, 1), end: localStartOfDay(nmY, nmM, 1), resolvedLabel: 'this month' };
  }
  if (k === 'last year') {
    return { start: localStartOfDay(Y - 1, 1, 1), end: localStartOfDay(Y, 1, 1), resolvedLabel: 'last year' };
  }
  if (k === 'this year') {
    return { start: localStartOfDay(Y, 1, 1), end: localStartOfDay(Y + 1, 1, 1), resolvedLabel: 'this year' };
  }
  if (k === 'today') {
    const tmrD = new Date(Y, M - 1, D + 1);
    return { start: localStartOfDay(Y, M, D), end: localStartOfDay(tmrD.getFullYear(), tmrD.getMonth() + 1, tmrD.getDate()), resolvedLabel: 'today' };
  }
  if (k === 'yesterday') {
    const ydD = new Date(Y, M - 1, D - 1);
    return { start: localStartOfDay(ydD.getFullYear(), ydD.getMonth() + 1, ydD.getDate()), end: localStartOfDay(Y, M, D), resolvedLabel: 'yesterday' };
  }
  if (k === 'last week' || k === 'past week' || k === 'past 7 days') {
    const past = new Date(Y, M - 1, D - 7);
    const tmrD = new Date(Y, M - 1, D + 1);
    return { start: localStartOfDay(past.getFullYear(), past.getMonth() + 1, past.getDate()), end: localStartOfDay(tmrD.getFullYear(), tmrD.getMonth() + 1, tmrD.getDate()), resolvedLabel: 'past week' };
  }
  if (k === 'all time' || k === 'ever' || k === 'all') {
    // 1970 to far future — effectively unbounded
    return { start: '1970-01-01T00:00:00.000Z', end: '2100-01-01T00:00:00.000Z', resolvedLabel: 'all time' };
  }
  // Fallback: last 30 days
  const past = new Date(Y, M - 1, D - 30);
  const tmrD = new Date(Y, M - 1, D + 1);
  return {
    start: localStartOfDay(past.getFullYear(), past.getMonth() + 1, past.getDate()),
    end: localStartOfDay(tmrD.getFullYear(), tmrD.getMonth() + 1, tmrD.getDate()),
    resolvedLabel: 'past 30 days',
  };
}

serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });

  const authHeader = req.headers.get('Authorization');
  if (!authHeader) {
    return new Response(JSON.stringify({ error: 'Unauthorized' }), {
      status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }

  let body: any = null;
  try { body = await req.json(); } catch {
    return new Response(JSON.stringify({ error: 'Invalid JSON' }), {
      status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }

  const vendor: string = typeof body?.vendor === 'string' ? body.vendor.trim() : '';
  if (!vendor) {
    return new Response(JSON.stringify({ error: 'Missing vendor' }), {
      status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }

  const tz: string = typeof body?.timezone === 'string' && body.timezone.length > 0 ? body.timezone : DEFAULT_TZ;
  const actionTypes: string[] = Array.isArray(body?.action_types) && body.action_types.length > 0
    ? body.action_types.filter((t: unknown) => typeof t === 'string')
    : DEFAULT_ACTION_TYPES;

  let periodStart: string;
  let periodEnd: string;
  let resolvedLabel: string;
  if (typeof body?.period_start === 'string' && typeof body?.period_end === 'string') {
    periodStart = body.period_start;
    periodEnd = body.period_end;
    resolvedLabel = typeof body?.period_label === 'string' ? body.period_label : 'custom range';
  } else {
    const label = typeof body?.period_label === 'string' ? body.period_label : 'last month';
    const r = resolvePeriod(label, tz);
    periodStart = r.start; periodEnd = r.end; resolvedLabel = r.resolvedLabel;
  }

  // ── User resolution per CLAUDE.md Rule 4 ────────────────────────────────────
  let userId: string | null = null;
  try {
    const userClient = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_ANON_KEY')!,
      { global: { headers: { Authorization: authHeader } } },
    );
    const { data: { user } } = await userClient.auth.getUser();
    if (user) userId = user.id;
  } catch { /* ignore */ }
  if (!userId && typeof body?.user_id === 'string') userId = body.user_id;
  if (!userId) {
    return new Response(JSON.stringify({ error: 'No user found' }), {
      status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }

  // ── Aggregation ─────────────────────────────────────────────────────────────
  const admin = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
    { auth: { persistSession: false } },
  );

  const { data, error } = await admin
    .from('email_actions')
    .select('vendor, amount_cents, currency, created_at')
    .eq('user_id', userId)
    .eq('dismissed', false)
    .in('action_type', actionTypes)
    .ilike('vendor', `%${vendor}%`)
    .gte('created_at', periodStart)
    .lt('created_at', periodEnd);

  if (error) {
    console.error('[naavi-spend-summary] query error:', error.message);
    return new Response(JSON.stringify({ error: error.message }), {
      status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }

  const rows: EmailActionRow[] = data ?? [];
  const buckets = new Map<string, CurrencyBucket>();
  const vendorsSet = new Set<string>();
  let totalAcrossAllCurrenciesCents = 0;
  let countAll = 0;

  for (const r of rows) {
    if (typeof r.amount_cents !== 'number' || r.amount_cents <= 0) continue;
    const cur = (r.currency || '').toUpperCase().trim() || 'UNKNOWN';
    const b = buckets.get(cur) ?? { currency: cur, total_cents: 0, invoice_count: 0 };
    b.total_cents += r.amount_cents;
    b.invoice_count += 1;
    buckets.set(cur, b);
    totalAcrossAllCurrenciesCents += r.amount_cents;
    countAll += 1;
    if (r.vendor) vendorsSet.add(r.vendor);
  }

  const byCurrency = [...buckets.values()].sort((a, b) => b.total_cents - a.total_cents);
  const dominantCurrency = byCurrency[0]?.currency ?? null;
  const isMixed = byCurrency.length > 1;

  const responsePayload = {
    vendor,
    period_label: resolvedLabel,
    period_start: periodStart,
    period_end: periodEnd,
    invoice_count: countAll,
    total_cents: isMixed ? null : (byCurrency[0]?.total_cents ?? 0),
    currency: isMixed ? null : dominantCurrency,
    total_cents_all_currencies_summed: isMixed ? totalAcrossAllCurrenciesCents : undefined,
    by_currency: byCurrency,
    vendors_seen: [...vendorsSet],
  };

  console.log(
    `[naavi-spend-summary] user=${userId.slice(0, 8)} vendor="${vendor}" ` +
    `period=${resolvedLabel} count=${countAll} total=${responsePayload.total_cents} ${responsePayload.currency ?? '(mixed)'}`
  );

  return new Response(JSON.stringify(responsePayload), {
    status: 200,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
});
