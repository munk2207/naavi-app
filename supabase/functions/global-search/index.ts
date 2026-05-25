/**
 * global-search Edge Function
 *
 * One entry point that searches every connected data source for a query
 * and returns grouped, ranked results. Backs the GLOBAL_SEARCH action
 * (mobile chat + voice call) and the mobile app's "find anything about X"
 * UI.
 *
 * Called from:
 *   - Mobile orchestrator: POST with Authorization = user JWT (no user_id body)
 *   - Voice server: POST with Authorization = service role JWT + user_id in body
 *
 * User-ID resolution follows CLAUDE.md Rule 4:
 *   1. JWT auth (mobile)
 *   2. Body user_id (voice / server-side)
 *   3. user_tokens fallback (single-user dev only)
 *
 * Adapters live in ./adapters/ and register themselves in ./adapters/_registry.ts.
 * The handler iterates the registry, runs isConnected + search in parallel per
 * adapter, and merges results.
 */

import { createClient, type SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2.45.0';
import { adapters } from './adapters/_registry.ts';
import type { SearchResult, SearchContext } from './adapters/_interface.ts';
import { expandQuery } from './query_expansion.ts';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

// Per-adapter timeout — one slow source must not stall global search.
const ADAPTER_TIMEOUT_MS = 4000;
// Default per-adapter result count. The mobile UI groups results by source
// and can request more via the limit param.
const DEFAULT_LIMIT_PER_SOURCE = 5;

// ── User ID resolution (CLAUDE.md Rule 4) ────────────────────────────────────

async function resolveUserId(
  supabase: SupabaseClient,
  token: string,
  bodyUserId: string | undefined,
): Promise<string | null> {
  // 1. JWT auth — mobile app
  if (token) {
    try {
      const { data, error } = await supabase.auth.getUser(token);
      if (!error && data.user?.id) return data.user.id;
    } catch {
      /* fall through */
    }
  }

  // 2. Body user_id — voice server / server-side
  if (bodyUserId && typeof bodyUserId === 'string' && bodyUserId.length > 0) {
    return bodyUserId;
  }

  // 3. user_tokens fallback — single-user dev only; returns null in multi-user
  //    deployments where no token and no body user_id were supplied.
  return null;
}

// ── Adapter runner with timeout + error isolation ─────────────────────────────

async function runAdapter(
  adapter: (typeof adapters)[number],
  ctx: SearchContext,
): Promise<{ source: string; results: SearchResult[]; ok: boolean; ms: number; error?: string }> {
  const start = Date.now();
  try {
    const connected = await adapter.isConnected(ctx);
    if (!connected) {
      return { source: adapter.name, results: [], ok: true, ms: Date.now() - start };
    }

    const timeout = new Promise<SearchResult[]>((_, reject) =>
      setTimeout(() => reject(new Error('adapter_timeout')), ADAPTER_TIMEOUT_MS),
    );
    const results = await Promise.race([adapter.search(ctx), timeout]);

    // Stamp the source on every result (defensive — adapter may forget).
    const stamped = (results ?? []).map(r => ({ ...r, source: adapter.name }));
    return { source: adapter.name, results: stamped, ok: true, ms: Date.now() - start };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return {
      source: adapter.name,
      results: [],
      ok: false,
      ms: Date.now() - start,
      error: msg,
    };
  }
}

// ── Source-intent detection (Wael 2026-05-10) ────────────────────────────────
//
// When the user names a specific source ("email about X", "meeting about X",
// "note about X", "document about X"), Naavi must answer ONLY about that
// source. Ground rule from `project_naavi_truth_at_user_layer.md`. This
// function detects source intent and returns the adapter names to run.
// Returns null when the phrasing is open-ended ("what do we know about X")
// or when no clear source is named — in those cases ALL adapters run.
//
// Design choice: conservative. When ambiguous, return null (run all). The
// risk of over-filtering (hiding a legitimate hit) is worse than under-
// filtering (extra hits that the prompt's truth-at-user-layer rule then
// ignores). Defense-in-depth.
//
// Open-ended phrasings ALWAYS take precedence — even if they also contain
// a source noun. *"What do we know about my email"* → run all (open intent).
// Wael 2026-05-22 — map the user-facing source word Claude's tool
// emits (gmail / calendar / contacts / drive / notes / lists /
// reminders) to the internal adapter names. Returns null for
// unknown values so the caller falls back to regex detection.
function sourceHintToAdapterNames(hint: string): string[] | null {
  switch (hint.toLowerCase()) {
    case 'gmail':     return ['gmail', 'email_actions'];
    case 'calendar':  return ['calendar'];
    case 'contacts':  return ['contacts'];
    case 'drive':     return ['drive'];
    case 'notes':     return ['knowledge'];
    case 'reminders': return ['rules', 'reminders'];
    default:          return null;
  }
}

function detectSourceIntent(query: string): string[] | null {
  const lower = query.toLowerCase();

  // Open-ended phrasings → never filter.
  const OPEN_ENDED =
    /(?:what do (?:we|you) know|tell me about|anything (?:about|on)|what do you have on|do you know|stored about|find anything|search for|what(?:'s|\s+is)\s+stored)/i;
  if (OPEN_ENDED.test(lower)) return null;

  // Source nouns — first match wins. Word boundaries prevent partial matches.
  if (/\b(?:emails?|inbox|gmail|mailbox)\b/.test(lower)) return ['gmail', 'email_actions'];
  if (/\b(?:calendars?|meetings?|appointments?|events?)\b/.test(lower)) return ['calendar'];
  if (/\b(?:notes?|memor(?:y|ies))\b/.test(lower)) return ['knowledge'];
  if (/\b(?:drives?|documents?|files?|pdfs?|attachments?)\b/.test(lower)) return ['drive'];
  if (/\bcontacts?\b/.test(lower)) return ['contacts'];
  if (/\blists?\b/.test(lower)) return ['lists'];
  if (/\b(?:reminders?|alerts?|rules?)\b/.test(lower)) return ['rules', 'reminders'];

  return null;
}

// ── Temporal bounds detection ─────────────────────────────────────────────────
//
// When the user says "this month", "last week", "today", etc., detect it and
// return ISO date strings (YYYY-MM-DD) for the start and end of that window.
// Adapters then apply date filters so results stay within the asked period.
// Only "this month", "last month", "this week", "last week", "today",
// "yesterday" are handled — anything else returns empty bounds (no filter).
//
// All arithmetic is in UTC so the bounds are timezone-neutral at the date level;
// edge-function deployment is UTC, and the DB timestamps are UTC.
function detectTemporalBounds(query: string): { dateFrom?: string; dateTo?: string } {
  const lower = query.toLowerCase();
  const now   = new Date();
  const y     = now.getUTCFullYear();
  const m     = now.getUTCMonth();   // 0-indexed
  const d     = now.getUTCDate();

  const iso = (date: Date) => date.toISOString().slice(0, 10);

  if (/\bthis\s+month\b/.test(lower)) {
    return {
      dateFrom: iso(new Date(Date.UTC(y, m, 1))),
      dateTo:   iso(new Date(Date.UTC(y, m + 1, 0))),
    };
  }
  if (/\blast\s+month\b/.test(lower)) {
    const pm = m === 0 ? 11 : m - 1;
    const py = m === 0 ? y - 1 : y;
    return {
      dateFrom: iso(new Date(Date.UTC(py, pm, 1))),
      dateTo:   iso(new Date(Date.UTC(py, pm + 1, 0))),
    };
  }
  if (/\bthis\s+week\b/.test(lower)) {
    const dow     = now.getUTCDay(); // 0=Sun
    const monday  = new Date(Date.UTC(y, m, d - (dow === 0 ? 6 : dow - 1)));
    const sunday  = new Date(Date.UTC(monday.getUTCFullYear(), monday.getUTCMonth(), monday.getUTCDate() + 6));
    return { dateFrom: iso(monday), dateTo: iso(sunday) };
  }
  if (/\blast\s+week\b/.test(lower)) {
    const dow        = now.getUTCDay();
    const thisMonday = new Date(Date.UTC(y, m, d - (dow === 0 ? 6 : dow - 1)));
    const lastMonday = new Date(Date.UTC(thisMonday.getUTCFullYear(), thisMonday.getUTCMonth(), thisMonday.getUTCDate() - 7));
    const lastSunday = new Date(Date.UTC(lastMonday.getUTCFullYear(), lastMonday.getUTCMonth(), lastMonday.getUTCDate() + 6));
    return { dateFrom: iso(lastMonday), dateTo: iso(lastSunday) };
  }
  if (/\btoday\b/.test(lower)) {
    const today = iso(new Date(Date.UTC(y, m, d)));
    return { dateFrom: today, dateTo: today };
  }
  if (/\byesterday\b/.test(lower)) {
    const yesterday = iso(new Date(Date.UTC(y, m, d - 1)));
    return { dateFrom: yesterday, dateTo: yesterday };
  }
  return {};
}

// ── Merge + rank ─────────────────────────────────────────────────────────────

function mergeAndRank(allResults: SearchResult[]): SearchResult[] {
  return [...allResults].sort((a, b) => {
    if (b.score !== a.score) return b.score - a.score;
    // Tie-break: most recent first, then lexicographic title
    const aTime = a.createdAt ? Date.parse(a.createdAt) : 0;
    const bTime = b.createdAt ? Date.parse(b.createdAt) : 0;
    if (bTime !== aTime) return bTime - aTime;
    return a.title.localeCompare(b.title);
  });
}

// ── Main handler ─────────────────────────────────────────────────────────────

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });

  const t0 = Date.now();

  try {
    const { query, user_id: bodyUserId, limit, source_hint } =
      (await req.json()) as { query?: string; user_id?: string; limit?: number; source_hint?: string };

    if (!query || typeof query !== 'string' || query.trim().length === 0) {
      return json({ error: 'query is required' }, 400);
    }

    const perSourceLimit = Math.max(1, Math.min(limit ?? DEFAULT_LIMIT_PER_SOURCE, 20));

    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const supabase = createClient(supabaseUrl, serviceKey);

    const authHeader = req.headers.get('Authorization') ?? '';
    const token = authHeader.replace('Bearer ', '').trim();

    const userId = await resolveUserId(supabase, token, bodyUserId);
    if (!userId) {
      return json({ error: 'unable to resolve user' }, 401);
    }

    const trimmedQuery = query.trim();
    const queryVariants = expandQuery(trimmedQuery);
    const temporalBounds = detectTemporalBounds(trimmedQuery);

    const ctx: SearchContext = {
      userId,
      query: trimmedQuery,
      queryVariants,
      limit: perSourceLimit,
      supabase,
      ...temporalBounds,
    };

    if (temporalBounds.dateFrom) {
      console.log(`[global-search] temporal bounds: ${temporalBounds.dateFrom} → ${temporalBounds.dateTo}`);
    }

    // Wael 2026-05-10: detect source intent. When user names a source
    // ("email about X"), only run that adapter — the rest are irrelevant
    // and only confuse Claude's reply (truth-at-user-layer principle).
    //
    // Wael 2026-05-22: a typed `source_hint` from the caller (Claude's
    // global_search tool input) takes precedence over the regex
    // detection. The regex sees only the query string Claude passes,
    // which may have already had the source noun stripped — so a
    // contact query like "Do I have contact named Bob" arrives as
    // query="name Bob" and the regex misses the contacts intent.
    // The typed hint comes straight from Claude and is reliable.
    const hintedSources = source_hint ? sourceHintToAdapterNames(source_hint) : null;
    const allowedSources = hintedSources ?? detectSourceIntent(trimmedQuery);
    const adaptersToRun = allowedSources
      ? adapters.filter((a) => allowedSources.includes(a.name))
      : adapters;

    console.log(
      `[global-search] user=${userId} query="${ctx.query}" variants=${JSON.stringify(queryVariants)} adapters=${adaptersToRun.length}/${adapters.length}${allowedSources ? ` (source-intent: ${allowedSources.join(',')}${hintedSources ? ' via hint' : ''})` : ' (open-ended)'}`,
    );

    // Run filtered adapters in parallel. Each adapter is isolated — its
    // failure cannot sink another adapter's results.
    const runs = await Promise.all(adaptersToRun.map(a => runAdapter(a, ctx)));

    const byGroup: Record<
      string,
      { label: string; privacyTag: string; results: SearchResult[]; ms: number; ok: boolean }
    > = {};
    const flat: SearchResult[] = [];

    for (const run of runs) {
      const adapter = adapters.find(a => a.name === run.source);
      byGroup[run.source] = {
        label: adapter?.label ?? run.source,
        privacyTag: adapter?.privacyTag ?? 'general',
        results: run.results,
        ms: run.ms,
        ok: run.ok,
      };
      flat.push(...run.results);
      console.log(
        `[global-search] ${run.source}: ${run.results.length} results in ${run.ms}ms ${run.ok ? 'ok' : 'FAIL ' + run.error}`,
      );
    }

    const ranked = mergeAndRank(flat);
    const total = Date.now() - t0;
    console.log(
      `[global-search] total=${total}ms hits=${ranked.length} sources=${runs.filter(r => r.results.length > 0).length}`,
    );

    return json({
      query: ctx.query,
      user_id: userId,
      total_ms: total,
      groups: byGroup, // grouped-by-source for UI rendering
      ranked, // single ranked list for voice ("top N")
    });
  } catch (err) {
    console.error('[global-search] Error:', err);
    return json({ error: err instanceof Error ? err.message : String(err) }, 500);
  }
});

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
}
