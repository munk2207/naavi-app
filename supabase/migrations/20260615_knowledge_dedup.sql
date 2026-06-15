-- F5b fix: similarity-based dedup helper for ingest-note.
-- Before inserting a new knowledge_fragment, ingest-note calls this function
-- to find the closest existing fragment for the user. If cosine distance < 0.10
-- (similarity > 0.90), it updates the existing row instead of inserting a new one.

CREATE OR REPLACE FUNCTION match_knowledge_for_dedup(
  p_user_id  uuid,
  p_embedding vector(1536),
  p_limit     int DEFAULT 1
)
RETURNS TABLE (id uuid, content text, distance float)
LANGUAGE sql
STABLE
AS $$
  SELECT
    id,
    content,
    (embedding <=> p_embedding)::float AS distance
  FROM knowledge_fragments
  WHERE user_id = p_user_id
    AND embedding IS NOT NULL
  ORDER BY embedding <=> p_embedding
  LIMIT p_limit;
$$;
