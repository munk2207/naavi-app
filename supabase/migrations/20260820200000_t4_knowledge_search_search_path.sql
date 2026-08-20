-- T4 — staging's knowledge-search function is missing production's search_path.
--
-- Of the ten differences flagged as unresolved risk last night — three function
-- bodies and seven cron jobs — this is the only real one. The other nine were
-- formatting, truncation, or a broken diagnostic query. See
-- docs/SESSION_HANDOFF_2026-08-20_PM_*.md §4.
--
-- What SET search_path does: it pins the schemas this function resolves names
-- through. Without it the function resolves `knowledge_fragments` through
-- whatever search_path the caller happens to have, so a caller who can create a
-- table earlier in that path can decide which table this function actually
-- reads. Postgres flags mutable search_path on SECURITY-relevant functions for
-- exactly this reason. Production has the setting; staging did not.
--
-- The 12-column return shape is left EXACTLY as it is. Production returns 7,
-- and all three callers read only `similarity` and `content`
-- (search-knowledge/index.ts, global-search/adapters/knowledge.ts,
-- _shared/resolve_relationship_contact.ts), so the extra five are read by
-- nobody. Narrowing staging to match would remove something for no gain, and
-- Wael's instruction stands: nothing is deleted from any platform. The two
-- environments therefore still differ on the return shape, which is recorded as
-- an accepted difference rather than quietly reconciled.
--
-- ⚠️ The path is 'public', 'extensions', 'pg_temp' — NOT production's
-- 'public', 'pg_temp'. The first attempt used production's exactly and failed:
--
--   ERROR: operator does not exist: extensions.vector <=> extensions.vector
--
-- pgvector is installed in the `extensions` schema on staging, so pinning the
-- path to public alone makes the <=> similarity operator invisible and knowledge
-- search stops working altogether. That is WHY staging's function had no
-- search_path: production's could not have been copied across as written.
--
-- Inference, not verified: production must have vector reachable from public,
-- since its version of this function pins public/pg_temp and uses <=>. The
-- fingerprint records extension NAMES and VERSIONS but not the schema they live
-- in, so this difference was invisible to every comparison run today. Worth
-- adding to the fingerprint.
--
-- Body is otherwise byte-identical to what staging already runs — only the
-- STABLE line gains a SET clause beneath it.

BEGIN;

CREATE OR REPLACE FUNCTION public.search_knowledge_fragments(
  query_embedding vector,
  match_count     integer,
  p_user_id       uuid
)
RETURNS TABLE(
  id                uuid,
  user_id           uuid,
  type              text,
  content           text,
  classification    text,
  confidence        double precision,
  source            text,
  is_priority       boolean,
  created_at        timestamp with time zone,
  updated_at        timestamp with time zone,
  last_retrieved_at timestamp with time zone,
  similarity        double precision
)
LANGUAGE sql
STABLE
SET search_path TO 'public', 'extensions', 'pg_temp'
AS $function$
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
$function$;

COMMIT;
