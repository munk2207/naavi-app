-- search_knowledge_fragments RPC + knowledge_fragments.last_retrieved_at
--
-- Both existed on production (created manually, never captured as a
-- migration) but were missing on staging, causing search-knowledge and
-- global-search's knowledge adapter to fail with a schema-cache error on
-- staging only. Reconstructed here from the two call sites' exact contract
-- (supabase/functions/search-knowledge/index.ts and
-- supabase/functions/global-search/adapters/knowledge.ts), not from the
-- original SQL (which was never in git history to begin with).
--
-- Contract required by both callers:
--   rpc('search_knowledge_fragments', { query_embedding, match_count, p_user_id })
--   → rows with at least: id, content, similarity, created_at.
--   Both callers additionally filter on similarity >= 0.5 client-side, so
--   the function itself does not need its own threshold.

ALTER TABLE knowledge_fragments
  ADD COLUMN IF NOT EXISTS last_retrieved_at timestamptz;

CREATE OR REPLACE FUNCTION search_knowledge_fragments(
  query_embedding vector(1536),
  match_count     int,
  p_user_id       uuid
)
RETURNS TABLE (
  id              uuid,
  user_id         uuid,
  type            text,
  content         text,
  classification  text,
  confidence      float,
  source          text,
  is_priority     boolean,
  created_at      timestamptz,
  updated_at      timestamptz,
  last_retrieved_at timestamptz,
  similarity      float
)
LANGUAGE sql STABLE
AS $$
  SELECT
    id,
    user_id,
    type,
    content,
    classification,
    confidence,
    source,
    is_priority,
    created_at,
    updated_at,
    last_retrieved_at,
    1 - (embedding <=> query_embedding) AS similarity
  FROM knowledge_fragments
  WHERE user_id = p_user_id
    AND embedding IS NOT NULL
  ORDER BY embedding <=> query_embedding
  LIMIT match_count;
$$;
