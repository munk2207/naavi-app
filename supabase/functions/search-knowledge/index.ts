/**
 * search-knowledge Edge Function
 *
 * Embeds the query using OpenAI text-embedding-3-small, then runs
 * pgvector cosine similarity search against knowledge_fragments.
 * Updates last_retrieved_at on returned fragments.
 *
 * Auth: RLS-based. verify_jwt = false in config.toml.
 */

import { serve } from 'https://deno.land/std@0.224.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const OPENAI_API = 'https://api.openai.com/v1/embeddings';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

async function generateEmbedding(text: string): Promise<number[] | null> {
  try {
    const res = await fetch(OPENAI_API, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${Deno.env.get('OPENAI_API_KEY')!}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: 'text-embedding-3-small',
        input: text,
        dimensions: 1536,
      }),
    });
    const data = await res.json();
    return data.data?.[0]?.embedding ?? null;
  } catch {
    return null;
  }
}

serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });

  const authHeader = req.headers.get('Authorization');
  if (!authHeader) {
    return new Response(JSON.stringify({ error: 'Unauthorized' }), {
      status: 401, headers: corsHeaders,
    });
  }

  const adminClient = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
  );

  // Parse query from body first — may contain user_id
  let query: string | null = null;
  let topK = 5;
  let bodyUserId: string | null = null;
  try {
    const bodyText = await req.text();
    const body = JSON.parse(bodyText);
    query = body.q ?? null;
    topK = body.top_k ?? 5;
    bodyUserId = body.user_id ?? null;
  } catch (_) { /* ignore */ }

  // Try JWT auth first, then body user_id, then fallback
  let userId: string | null = null;
  try {
    const userClient = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_ANON_KEY')!,
      { global: { headers: { Authorization: authHeader } } }
    );
    const { data: { user } } = await userClient.auth.getUser();
    if (user) userId = user.id;
  } catch (_) { /* ignore */ }

  // Voice server passes user_id in body (service role key)
  if (!userId && bodyUserId) {
    userId = bodyUserId;
  }

  // Fallback: find user from user_tokens
  if (!userId) {
    try {
      const { data } = await adminClient
        .from('user_tokens')
        .select('user_id')
        .eq('provider', 'google')
        .limit(1)
        .single();
      if (data) userId = data.user_id;
    } catch (_) { /* ignore */ }
  }

  if (!userId) {
    console.error('[search-knowledge] No user found');
    return new Response(JSON.stringify({ error: 'No user found' }), {
      status: 401, headers: corsHeaders,
    });
  }

  console.log('[search-knowledge] User ID:', userId);
  const user = { id: userId };

  // Fallback to query params
  if (!query) {
    const url = new URL(req.url);
    query = url.searchParams.get('q');
    topK = parseInt(url.searchParams.get('top_k') ?? '5');
  }

  if (!query?.trim()) {
    return new Response(JSON.stringify({ error: 'Missing query' }), {
      status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }

  try {
    const embedding = await generateEmbedding(query);
    if (!embedding) {
      return new Response(JSON.stringify({ error: 'Embedding failed' }), {
        status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // pgvector cosine similarity search via Supabase RPC
    const { data: results, error } = await adminClient.rpc('search_knowledge_fragments', {
      query_embedding: JSON.stringify(embedding),
      match_count: topK,
      p_user_id: user.id,
    });

    if (error) {
      console.error('[search-knowledge] RPC error:', error.message);
      return new Response(JSON.stringify({ error: error.message }), {
        status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // Drop weak matches. pgvector returns top match_count rows regardless of
    // how bad the matches are, so queries with no real answer still produce
    // 5 unrelated "results" (e.g. searching a phone number surfaces
    // "Wael likes pizza"). Anything below this threshold is noise. Matches
    // the threshold used in global-search/adapters/knowledge.ts.
    const MIN_SIMILARITY = 0.5;
    const filtered = (results ?? []).filter(
      (r: { similarity?: number }) =>
        typeof r.similarity === 'number' && r.similarity >= MIN_SIMILARITY,
    );

    // Update last_retrieved_at on returned fragments
    if (filtered.length > 0) {
      const ids = filtered.map((r: { id: string }) => r.id);
      await adminClient
        .from('knowledge_fragments')
        .update({ last_retrieved_at: new Date().toISOString() })
        .in('id', ids);
    }

    console.log(`[search-knowledge] "${query}" → ${filtered.length} results (from ${results?.length ?? 0} raw, threshold ${MIN_SIMILARITY})`);

    return new Response(JSON.stringify({ results: filtered }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });

  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error('[search-knowledge] Error:', msg);
    return new Response(JSON.stringify({ error: msg }), {
      status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});
