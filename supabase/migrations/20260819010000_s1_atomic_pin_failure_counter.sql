-- S1 Phase 6 remediation (2026-08-19) — make the voice-PIN failure counter
-- atomic. Mandatory issue 1 from the Phase 6 technical review.
--
-- THE DEFECT THIS REPLACES: the voice server did read -> calculate -> PATCH as
-- three separate operations. Two failures arriving together both read the same
-- count and both wrote the same next value, so increments were lost.
--
-- Measured against staging before this fix, NOT theorised:
--     3 concurrent failures -> counter recorded 2
--     5 concurrent failures -> counter recorded 2
--
-- That is a security bypass, not a lost statistic. The alert fires when the
-- count reaches the threshold, so an attacker issuing attempts in PARALLEL
-- rather than in sequence could hold the counter below it indefinitely and
-- never be reported. The whole detection half of Track D was defeatable by
-- concurrency alone, with no guessing advantage required.
--
-- It had already happened in live testing and was recorded as unexplained:
-- Wael's three wrong attempts in one call advanced the counter by one. The
-- bumps were fire-and-forget, so a later read began before an earlier write
-- landed — the race did not even need two callers.

-- One statement. The window decision and the increment happen under the same
-- row lock, so there is no read-modify-write gap for a second caller to land
-- in. Returning the resulting count matters as much as the increment: it means
-- "did this attempt cross the threshold" is answered by the same atomic
-- operation that produced the count, rather than by a second read that could
-- itself race.
CREATE OR REPLACE FUNCTION public.record_voice_pin_failure(
  p_user_id uuid,
  p_window  interval DEFAULT interval '7 days'
)
RETURNS TABLE (failed_count integer, owner_phone text)
LANGUAGE sql
VOLATILE
AS $$
  UPDATE public.user_settings
     SET voice_pin_failed_count = CASE
           -- Stale failures do not accumulate: someone who failed twice months
           -- ago and once today is not under attack, and alerting on that is
           -- crying wolf. Window is 7 days (Wael): a short one is evaded by
           -- pacing and does not survive someone who reads SMS every couple of
           -- days.
           WHEN voice_pin_failed_at IS NULL
             OR voice_pin_failed_at < now() - p_window THEN 1
           ELSE voice_pin_failed_count + 1
         END,
         voice_pin_failed_at = now()
   WHERE user_id = p_user_id
  RETURNING voice_pin_failed_count, phone;
$$;

COMMENT ON FUNCTION public.record_voice_pin_failure(uuid, interval) IS
  'S1 Phase 6 — atomically records one failed voice-PIN attempt and returns the '
  'resulting count plus the owner''s phone. Replaces a read-calculate-write '
  'sequence in the voice server that lost increments under concurrency (3 '
  'concurrent failures recorded 2; 5 recorded 2), which allowed the alert '
  'threshold to be held down indefinitely by issuing attempts in parallel. '
  'Callers must NOT re-read the count to decide whether to alert — use the '
  'returned value, or the race returns by the back door.';

-- Not callable by clients. This mutates security state, so it is reachable
-- only through Shared Core (`manage-voice-pin`), which runs as service_role.
-- Functions are executable by PUBLIC by default, so the revoke is required —
-- leaving it off would hand any authenticated client the ability to inflate
-- another user's failure count and trigger alerts on their account.
REVOKE ALL ON FUNCTION public.record_voice_pin_failure(uuid, interval) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.record_voice_pin_failure(uuid, interval) FROM anon;
REVOKE ALL ON FUNCTION public.record_voice_pin_failure(uuid, interval) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.record_voice_pin_failure(uuid, interval) TO service_role;
