-- F25 Stage 2 — the FAQ matcher's rate limit becomes per-person, and its
-- counter becomes correct. (2026-09-04)
--
-- Two changes, both approved at Phase 3 as mandatory:
--
--   A3 — the key stops being an IP. Mobile traffic arrives behind carrier NAT,
--        so many customers share one address; keying on it would put them in
--        one bucket. From here the subject is the signed-in user where there
--        is one, and the IP where there is not. The column is renamed rather
--        than reused, because `ip_hash` holding a user hash is a name that
--        misdescribes its contents — the failure class this project already
--        paid for in the Architecture Reference's §2d ("cron-driven", one
--        wrong word, four months) and §0b (a service name that resolved to
--        nothing).
--
--   A2 — the counter stops losing updates. It was select -> compute -> upsert
--        across three network operations, so two concurrent requests both read
--        5 and both wrote 6. That is the S1 voice-PIN defect exactly: §2c
--        records "3 concurrent failures recorded 2, and 5 recorded 2". The
--        remedy is the same one, for the same reason — when correctness needs
--        atomicity, only the owner of the data can provide it.
--
-- Safe to run against a live project: the table holds rate-limit counters
-- keyed by a 5-minute window, so every row is worthless within 5 minutes.
-- Nothing reads it but match-faq, and RLS denies every client role.

-- ── A3 — the key is a subject, not an address ───────────────────────────────
ALTER TABLE faq_rate_limit RENAME COLUMN ip_hash TO subject_hash;

COMMENT ON COLUMN faq_rate_limit.subject_hash IS
  'sha256 of the rate-limit subject: "user:<uuid>" for a verified caller, '
  '"ip:<address>" otherwise. Never a bare address — the prefix keeps the two '
  'namespaces from colliding.';

-- ── A2 — one statement that increments and reports the result ───────────────
--
-- Returns the count AFTER this request is counted, so "did this one cross the
-- threshold" is answered by the same statement that produced the number,
-- rather than by a second read that could itself race.
--
-- It counts first and lets the caller decide. A request that is over the limit
-- still increments, which is deliberate: the window is 5 minutes and the count
-- is a measure of demand, not a budget to be preserved.
CREATE OR REPLACE FUNCTION count_faq_match_request(
  p_subject_hash text,
  p_window_start timestamptz
)
RETURNS integer
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  INSERT INTO faq_rate_limit (subject_hash, window_start, request_count)
  VALUES (p_subject_hash, p_window_start, 1)
  ON CONFLICT (subject_hash, window_start)
  DO UPDATE SET request_count = faq_rate_limit.request_count + 1
  RETURNING request_count;
$$;

-- Postgres makes functions executable by everyone by default. This one writes
-- to a table no client may touch, so it is granted to service_role alone —
-- the same reasoning recorded for record_voice_pin_failure() in Architecture
-- Reference §2c.
REVOKE ALL ON FUNCTION count_faq_match_request(text, timestamptz) FROM PUBLIC;
REVOKE ALL ON FUNCTION count_faq_match_request(text, timestamptz) FROM anon;
REVOKE ALL ON FUNCTION count_faq_match_request(text, timestamptz) FROM authenticated;
GRANT EXECUTE ON FUNCTION count_faq_match_request(text, timestamptz) TO service_role;

COMMENT ON FUNCTION count_faq_match_request(text, timestamptz) IS
  'F25 Stage 2 (A2). Atomically counts one match-faq request and returns the '
  'resulting count for this subject and window. Replaces a select-then-upsert '
  'that lost updates under concurrency — the same defect S1 fixed in voice-PIN '
  'failure counting.';
