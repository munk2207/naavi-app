/**
 * resolve-entity-ref Edge Function — F1a Session 2 (Wael 2026-05-12).
 *
 * Resolves natural-language entity references (e.g., "Costco alert", "groceries",
 * "mom's email") to concrete entity IDs. Shared by both voice server and mobile
 * orchestrator (CLAUDE.md Configuration Discipline #3 — one function per job).
 *
 * Operations:
 *   RESOLVE — text → matches[]. Used by list_connect / list_disconnect /
 *             list_connection_query / list_delete to map Claude's entityRef +
 *             entityType (or listName) to a concrete row id.
 *   DESCRIBE — (entity_type, entity_id) → label. Used by LIST_CONNECTION_QUERY
 *              to format "groceries is connected to: Costco alert, Saturday meeting"
 *              when the orchestrator has connection rows but needs human-readable
 *              labels.
 *
 * Spec: docs/F1A_LISTS_AND_CONNECTIONS_SPEC.md.
 *
 * V1 entity types supported via local-table adapters (no Google API calls):
 *   - action_rule  → action_rules.label + trigger_config.place_name
 *   - list         → lists.name
 *   - gmail_message → gmail_messages.subject + from_address + snippet
 *
 * V2 entity types — return matches=[] with `unsupported_in_v1: true`:
 *   - calendar_event, contact (need Google OAuth refresh — separate work)
 *   - reminder, document, sent_message, knowledge_fragment (less common as
 *     entityRef targets per spec; can add when usage demands)
 *
 * Auth: standard CLAUDE.md Rule 4 chain (JWT → body user_id → reject).
 */

import { createClient } from 'npm:@supabase/supabase-js@2';

const corsHeaders = {
  'Access-Control-Allow-Origin':  '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

// Mirrors manage-list-connections ALLOWED_ENTITY_TYPES.
const ALLOWED_ENTITY_TYPES = new Set([
  'action_rule', 'calendar_event', 'gmail_message', 'contact',
  'document', 'reminder', 'sent_message', 'knowledge_fragment', 'list',
]);

const V1_SUPPORTED = new Set(['action_rule', 'list', 'gmail_message']);

// ── Stemming + stopword filter (Wael 2026-05-12, post-voice-test) ───────────
// Real-user phrasings exposed two scoring bugs in v1:
//   - "groceries" failed to resolve the user's "grocery" list (no stemming)
//   - "Movati alert" matched every action_rule because every label literally
//     starts with "Alert when arriving at..." → noise-floor 0.4 across the
//     board. Add a stopword filter to the token-overlap pass so common
//     domain words ("alert", "list", "the", "my", "to", "from", etc.) don't
//     score on their own.

function stem(s: string): string {
  // Tiny English plural stripper. Not Porter — just enough to fold
  // groceries→grocery, items→item, alerts→alert without false-stripping
  // single-syllable words (bus stays as bus).
  if (s.endsWith('ies') && s.length > 3) return s.slice(0, -3) + 'y';
  if (s.endsWith('es')  && s.length > 3) return s.slice(0, -2);
  if (s.endsWith('s')   && s.length > 2 && !s.endsWith('ss')) return s.slice(0, -1);
  return s;
}

const STOPWORDS = new Set([
  // Articles / pronouns / prepositions
  'a', 'an', 'the', 'my', 'your', 'our', 'his', 'her', 'their',
  'to', 'from', 'at', 'on', 'in', 'with', 'of', 'for', 'by', 'and', 'or',
  // Domain noise — every entity is "an alert/list/email/etc.", so on its
  // own these words shouldn't add signal.
  'alert', 'alerts', 'list', 'lists', 'message', 'messages',
  'email', 'emails', 'meeting', 'meetings', 'event', 'events',
  'reminder', 'reminders', 'item', 'items', 'note', 'notes',
  'thing', 'things', 'one',
]);

function tokenize(s: string): string[] {
  return s.split(/\s+/)
    .filter(t => t.length > 2 && !STOPWORDS.has(t))
    .map(stem);
}

interface Match {
  entity_type: string;
  entity_id:   string;
  label:       string;     // human-readable, suitable for TTS readback
  hint?:       string;     // optional secondary detail to disambiguate ("at 2 PM Tue" / "from sarah@…")
  score:       number;     // 0..1 — caller uses to detect strong-single-match vs ambiguous
}

function jsonResponse(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
}

async function resolveUserId(
  supabase: ReturnType<typeof createClient>,
  authHeader: string | null,
  bodyUserId: string | null,
): Promise<string | null> {
  if (authHeader) {
    try {
      const token = authHeader.replace(/^Bearer\s+/i, '');
      const { data: { user } } = await supabase.auth.getUser(token);
      if (user) return user.id;
    } catch (_) { /* ignore */ }
  }
  if (bodyUserId) return bodyUserId;
  return null;
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  if (req.method !== 'POST')    return jsonResponse({ error: 'POST required' }, 405);

  const supabase = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
  );

  let body: any;
  try { body = await req.json(); } catch { return jsonResponse({ error: 'invalid JSON' }, 400); }

  const userId = await resolveUserId(supabase, req.headers.get('Authorization'), body?.user_id ?? null);
  if (!userId) return jsonResponse({ error: 'Unauthorized' }, 401);

  const op = String(body?.type ?? body?.operation ?? '').toUpperCase();

  try {
    switch (op) {
      case 'RESOLVE':  return await handleResolve(supabase, userId, body);
      case 'DESCRIBE': return await handleDescribe(supabase, userId, body);
      default:
        return jsonResponse({ error: `unknown operation: ${op}` }, 400);
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error(`[resolve-entity-ref] ${op} error:`, msg);
    return jsonResponse({ error: msg }, 500);
  }
});

// ── RESOLVE ─────────────────────────────────────────────────────────────────

async function handleResolve(
  supabase: ReturnType<typeof createClient>,
  userId: string,
  body: any,
) {
  const entityType = String(body?.entity_type ?? '').trim();
  const entityRef  = String(body?.entity_ref  ?? '').trim();

  if (!entityType) return jsonResponse({ error: 'entity_type required' }, 400);
  if (!entityRef)  return jsonResponse({ error: 'entity_ref required' },  400);
  if (!ALLOWED_ENTITY_TYPES.has(entityType)) {
    return jsonResponse({ error: `unknown entity_type: ${entityType}` }, 400);
  }
  if (!V1_SUPPORTED.has(entityType)) {
    return jsonResponse({
      success: true,
      matches: [],
      unsupported_in_v1: true,
      note: `entity_type '${entityType}' resolution is deferred; supported in v1: ${[...V1_SUPPORTED].join(', ')}`,
    });
  }

  const refLc = entityRef.toLowerCase();
  let matches: Match[] = [];

  switch (entityType) {
    case 'action_rule':   matches = await resolveActionRule(supabase, userId, refLc);   break;
    case 'list':          matches = await resolveList(supabase, userId, refLc);         break;
    case 'gmail_message': matches = await resolveGmailMessage(supabase, userId, refLc); break;
  }

  // Cap at 5 — UI/voice can show numbered picker per CLAUDE.md Rule 13.
  matches.sort((a, b) => b.score - a.score);
  matches = matches.slice(0, 5);

  return jsonResponse({ success: true, matches });
}

// ── DESCRIBE ────────────────────────────────────────────────────────────────

async function handleDescribe(
  supabase: ReturnType<typeof createClient>,
  userId: string,
  body: any,
) {
  const entityType = String(body?.entity_type ?? '').trim();
  const entityId   = String(body?.entity_id   ?? '').trim();

  if (!entityType) return jsonResponse({ error: 'entity_type required' }, 400);
  if (!entityId)   return jsonResponse({ error: 'entity_id required' },   400);
  if (!ALLOWED_ENTITY_TYPES.has(entityType)) {
    return jsonResponse({ error: `unknown entity_type: ${entityType}` }, 400);
  }
  if (!V1_SUPPORTED.has(entityType)) {
    return jsonResponse({
      success: true,
      label: `(${entityType} ${entityId.slice(0, 8)}…)`,
      unsupported_in_v1: true,
    });
  }

  let label: string | null = null;
  let hint: string | null = null;

  switch (entityType) {
    case 'action_rule': {
      const { data } = await supabase
        .from('action_rules')
        .select('label, trigger_config, enabled')
        .eq('user_id', userId)
        .eq('id', entityId)
        .maybeSingle();
      if (data) {
        label = (data as any).label ?? (data as any).trigger_config?.place_name ?? 'unnamed alert';
        if ((data as any).enabled === false) hint = 'disabled';
      }
      break;
    }
    case 'list': {
      const { data } = await supabase
        .from('lists')
        .select('name, category')
        .eq('user_id', userId)
        .eq('id', entityId)
        .maybeSingle();
      if (data) {
        label = (data as any).name ?? 'unnamed list';
        if ((data as any).category) hint = (data as any).category;
      }
      break;
    }
    case 'gmail_message': {
      const { data } = await supabase
        .from('gmail_messages')
        .select('subject, sender_email, sender_name')
        .eq('user_id', userId)
        .eq('id', entityId)
        .maybeSingle();
      if (data) {
        label = (data as any).subject ?? '(no subject)';
        hint  = (data as any).sender_name || (data as any).sender_email || null;
      }
      break;
    }
  }

  if (!label) {
    return jsonResponse({
      success: false,
      label: null,
      error: 'entity not found or not owned by user',
    }, 404);
  }

  return jsonResponse({ success: true, label, hint });
}

// ── Adapters ────────────────────────────────────────────────────────────────

async function resolveActionRule(
  supabase: ReturnType<typeof createClient>,
  userId: string,
  refLc: string,
): Promise<Match[]> {
  // Personal keyword resolution: "my office" / "office" / "work" → work_address
  // "my home" / "home" / "house" → home_address
  // Match against the saved address in user_settings first, then score that
  // specific alert at 1.0 — avoids fuzzy collision with "Ashraf office" etc.
  const isOfficeKeyword = /^(my\s+)?(office|work)$/.test(refLc);
  const isHomeKeyword   = /^(my\s+)?(home|house|place)$/.test(refLc);
  if (isOfficeKeyword || isHomeKeyword) {
    const { data: settings } = await supabase
      .from('user_settings')
      .select('home_address, work_address')
      .eq('user_id', userId)
      .maybeSingle();
    const savedAddress = isOfficeKeyword
      ? String(settings?.work_address ?? '').trim()
      : String(settings?.home_address ?? '').trim();
    if (savedAddress) {
      const savedLc = savedAddress.toLowerCase();
      const { data: rules } = await supabase
        .from('action_rules')
        .select('id, label, trigger_config, enabled, trigger_type')
        .eq('user_id', userId)
        .eq('enabled', true);
      const matched = (rules ?? []).filter((r: any) => {
        const place = String(r.trigger_config?.place_name ?? '').toLowerCase();
        return place === savedLc || place.includes(savedLc) || savedLc.includes(place);
      });
      if (matched.length === 1) {
        const r = matched[0] as any;
        console.log(`[resolve-entity-ref] personal keyword "${refLc}" → address match: ${r.label}`);
        return [{
          entity_type: 'action_rule',
          entity_id:   r.id,
          label:       r.label || r.trigger_config?.place_name || 'unnamed alert',
          hint:        r.trigger_type || undefined,
          score:       1.0,
        }];
      }
    }
  }

  // Pull enabled rules for the user; do the matching in JS so we can score
  // across label + trigger_config.place_name without complex SQL JSON ILIKE.
  // Rule counts per user are small (typically <30) — JS-side filter is fine.
  const { data, error } = await supabase
    .from('action_rules')
    .select('id, label, trigger_config, enabled, trigger_type')
    .eq('user_id', userId)
    .eq('enabled', true)
    .limit(200);

  if (error) {
    console.error('[resolve-entity-ref] action_rule fetch error:', error.message);
    return [];
  }

  const refStem = stem(refLc);
  const refTokens = tokenize(refLc);

  const out: Match[] = [];
  for (const r of (data ?? []) as any[]) {
    const label     = String(r.label ?? '').toLowerCase();
    const place     = String(r.trigger_config?.place_name ?? '').toLowerCase();
    const labelStem = stem(label);
    const placeStem = stem(place);
    let score = 0;
    // Strip common label prefixes to get the meaningful part for matching.
    // e.g. "Alert when arriving at office" → "office"
    const labelCore = label
      .replace(/^alert\s+(when\s+)?(arriving|leaving|every\s+time\s+i\s+arrive)\s+(at\s+)?/i, '')
      .replace(/^alert\s+/i, '')
      .trim();
    const labelCoreStem = stem(labelCore);

    // Exact match strictly beats stem-equal match so "grocery" doesn't tie
    // with "groceries" — caller treats top-tied scores as ambiguous, so this
    // separation matters for picking a single winner when both exist.
    if (label === refLc || place === refLc || labelCore === refLc) score = 1.0;
    else if (labelStem === refStem || placeStem === refStem || labelCoreStem === refStem) score = 0.9;
    else if (label.includes(refLc) || place.includes(refLc) ||
             label.includes(refStem) || place.includes(refStem)) score = 0.7;
    else if (refTokens.length > 0) {
      // Stop-word-filtered token overlap — domain noise like "alert" / "list"
      // / "the" / "my" no longer scores by itself.
      const matched = refTokens.filter(t => label.includes(t) || place.includes(t));
      if (matched.length === refTokens.length && matched.length > 0) score = 0.6;
      else if (matched.length > 0) score = 0.4;
    }
    if (score === 0) continue;

    out.push({
      entity_type: 'action_rule',
      entity_id:   r.id,
      label:       r.label || r.trigger_config?.place_name || 'unnamed alert',
      hint:        r.trigger_type || undefined,
      score,
    });
  }
  return out;
}

async function resolveList(
  supabase: ReturnType<typeof createClient>,
  userId: string,
  refLc: string,
): Promise<Match[]> {
  const { data, error } = await supabase
    .from('lists')
    .select('id, name, category')
    .eq('user_id', userId)
    .limit(200);

  if (error) {
    console.error('[resolve-entity-ref] list fetch error:', error.message);
    return [];
  }

  const refStem = stem(refLc);
  const refTokens = tokenize(refLc);

  const out: Match[] = [];
  for (const r of (data ?? []) as any[]) {
    const name     = String(r.name ?? '').toLowerCase();
    const nameStem = stem(name);
    let score = 0;
    if (name === refLc) score = 1.0;
    else if (nameStem === refStem) score = 0.9;
    else if (name.includes(refLc) || name.includes(refStem)) score = 0.7;
    else if (refTokens.length > 0) {
      const matched = refTokens.filter(t => name.includes(t));
      if (matched.length === refTokens.length && matched.length > 0) score = 0.6;
      else if (matched.length > 0) score = 0.4;
    }
    if (score === 0) continue;

    out.push({
      entity_type: 'list',
      entity_id:   r.id,
      label:       r.name || 'unnamed list',
      hint:        r.category || undefined,
      score,
    });
  }
  return out;
}

async function resolveGmailMessage(
  supabase: ReturnType<typeof createClient>,
  userId: string,
  refLc: string,
): Promise<Match[]> {
  // Search recent tier-1 emails (within last 30 days, signal!=ambient) by
  // subject, sender_email, sender_name, and snippet. Cap at 100 rows scanned.
  const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 3600 * 1000).toISOString();
  const { data, error } = await supabase
    .from('gmail_messages')
    .select('id, subject, sender_email, sender_name, snippet, received_at, signal_strength')
    .eq('user_id', userId)
    .gte('received_at', thirtyDaysAgo)
    .neq('signal_strength', 'ambient')
    .order('received_at', { ascending: false })
    .limit(100);

  if (error) {
    console.error('[resolve-entity-ref] gmail fetch error:', error.message);
    return [];
  }

  const refStem = stem(refLc);
  const refTokens = tokenize(refLc);

  const out: Match[] = [];
  for (const r of (data ?? []) as any[]) {
    const subj      = String(r.subject       ?? '').toLowerCase();
    const sndrEmail = String(r.sender_email  ?? '').toLowerCase();
    const sndrName  = String(r.sender_name   ?? '').toLowerCase();
    const snip      = String(r.snippet       ?? '').toLowerCase();
    const subjStem = stem(subj);
    const sndrNameStem = stem(sndrName);
    let score = 0;
    if (subj === refLc || sndrEmail === refLc || sndrName === refLc) score = 1.0;
    else if (subjStem === refStem || sndrNameStem === refStem) score = 0.9;
    else if (subj.includes(refLc) || sndrEmail.includes(refLc) || sndrName.includes(refLc) ||
             subj.includes(refStem) || sndrName.includes(refStem)) score = 0.7;
    else if (snip.includes(refLc)) score = 0.4;
    else if (refTokens.length > 0) {
      const matched = refTokens.filter(t =>
        subj.includes(t) || sndrEmail.includes(t) || sndrName.includes(t)
      );
      if (matched.length === refTokens.length && matched.length > 0) score = 0.4;
      else if (matched.length > 0) score = 0.3;
    }
    if (score === 0) continue;

    out.push({
      entity_type: 'gmail_message',
      entity_id:   r.id,
      label:       r.subject || '(no subject)',
      hint:        r.sender_name || r.sender_email || undefined,
      score,
    });
  }
  return out;
}
