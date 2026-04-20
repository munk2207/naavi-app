/**
 * Knowledge adapter — searches `knowledge_fragments` (REMEMBER items, notes,
 * stored facts) via OpenAI embeddings + pgvector cosine similarity.
 *
 * Mirrors the existing `search-knowledge` Edge Function so mobile Chat's
 * standalone "search my memory" flow and Global Search return consistent
 * results.
 */

import type { SearchAdapter, SearchContext, SearchResult } from './_interface.ts';

const OPENAI_API = 'https://api.openai.com/v1/embeddings';

// Identifier-shape queries (phone numbers, emails, UUIDs) are the wrong tool
// for semantic embedding search. text-embedding-3-small will happily return
// "Wael likes pizza" with similarity 0.12 when the query is "6137976679".
// Short-circuit before calling OpenAI — these queries belong to the
// source-of-truth adapters (contacts, sent_messages, gmail) only.
function isIdentifierQuery(raw: string): boolean {
  const q = raw.trim();
  if (!q) return false;

  if (q.includes('@')) return true;

  if (/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(q)) return true;

  const digits = q.replace(/\D/g, '');
  if (digits.length >= 7) {
    const nonSep = q.replace(/[\s\-().+]/g, '');
    if (nonSep === digits) return true;
  }

  return false;
}

async function generateEmbedding(text: string): Promise<number[] | null> {
  const key = Deno.env.get('OPENAI_API_KEY');
  if (!key) {
    console.error('[knowledge-adapter] OPENAI_API_KEY not configured');
    return null;
  }
  try {
    const res = await fetch(OPENAI_API, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${key}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: 'text-embedding-3-small',
        input: text,
        dimensions: 1536,
      }),
    });
    const data = await res.json();
    return data?.data?.[0]?.embedding ?? null;
  } catch (err) {
    console.error('[knowledge-adapter] embedding failed:', err);
    return null;
  }
}

export const knowledgeAdapter: SearchAdapter = {
  name: 'knowledge',
  label: 'Memory',
  icon: 'brain',
  privacyTag: 'general', // individual fragments may be re-tagged later

  // Knowledge is always "connected" — every user has the table. If they have
  // zero fragments, search just returns empty.
  isConnected: async () => true,

  search: async (ctx: SearchContext): Promise<SearchResult[]> => {
    if (isIdentifierQuery(ctx.query)) return [];

    const embedding = await generateEmbedding(ctx.query);
    if (!embedding) return [];

    const { data, error } = await ctx.supabase.rpc('search_knowledge_fragments', {
      query_embedding: JSON.stringify(embedding),
      match_count: ctx.limit,
      p_user_id: ctx.userId,
    });

    if (error) {
      console.error('[knowledge-adapter] RPC error:', error.message);
      return [];
    }

    type Row = {
      id: string;
      content: string;
      similarity: number;
      created_at?: string;
    };

    const rows = (data ?? []) as Row[];

    // Drop weak matches. pgvector returns top match_count rows regardless of
    // how bad the matches are, so a query with no real answer still yields
    // five unrelated "results" (e.g. searching "Bob" surfaced "Wael likes
    // pizza"). Anything below this threshold is noise, not a match.
    //
    // text-embedding-3-small cosine similarity rough guide:
    //   0.7+  strong semantic match
    //   0.5-0.7 plausible match
    //   <0.5  noise
    const MIN_SIMILARITY = 0.5;
    const filtered = rows.filter(
      r => typeof r.similarity === 'number' && r.similarity >= MIN_SIMILARITY,
    );

    return filtered.map((r): SearchResult => ({
      source: 'knowledge',
      title: r.content.length > 80 ? r.content.slice(0, 77) + '...' : r.content,
      snippet: r.content,
      // similarity is already 0 (unrelated) → 1 (identical). Use directly.
      score: typeof r.similarity === 'number' ? r.similarity : 0,
      createdAt: r.created_at,
      metadata: { fragment_id: r.id },
    }));
  },
};
