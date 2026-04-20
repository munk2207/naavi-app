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
    const { query, user_id: bodyUserId, limit } =
      (await req.json()) as { query?: string; user_id?: string; limit?: number };

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

    const ctx: SearchContext = {
      userId,
      query: trimmedQuery,
      queryVariants,
      limit: perSourceLimit,
      supabase,
    };

    console.log(
      `[global-search] user=${userId} query="${ctx.query}" variants=${JSON.stringify(queryVariants)} adapters=${adapters.length}`,
    );

    // Run every adapter in parallel. Each adapter is isolated — its failure
    // cannot sink another adapter's results.
    const runs = await Promise.all(adapters.map(a => runAdapter(a, ctx)));

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
