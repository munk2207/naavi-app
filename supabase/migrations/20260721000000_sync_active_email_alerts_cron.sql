-- Sync Active Email Alerts — every 5 minutes
--
-- Targeted, cost-bounded fast path for users with an active email-trigger
-- alert. Mirrors the cost-discipline already established for the live-Q&A
-- email read (naavi-chat's fetchLiveRecentEmails — "cost-tuned: not every
-- turn"): only pay the sync cost for users who actually need it, not
-- everyone. Users with no active email alert are unaffected — they stay on
-- the existing sync-gmail-every-30/60-minutes cadence.
--
-- B10q follow-up (2026-07-21) — a user who sets up "alert me when I get an
-- email from Bob" could otherwise wait up to 30 minutes for the general
-- sync-gmail cadence to notice it, a real UX gap for a feature framed as an
-- "alert." sync-active-email-alerts/index.ts queries action_rules for
-- trigger_type='email' AND enabled=true, and calls sync-gmail with
-- target_user_id set (existing, already-supported parameter) for just those
-- users.
--
-- STAGING ONLY — deployed and scheduled directly against xugvnfudofuskxoknhve
-- (2026-07-21). This migration documents that state in git; it has NOT been
-- applied to production and must not be without Wael's explicit approval,
-- per CLAUDE.md's staging-first rule. Update the project ref/URL below
-- before ever applying to production.
--
-- SECRET REDACTED — the live cron job on staging was registered directly
-- (not via this file) with the real service-role key, per this project's
-- existing pattern for cron migrations (see e.g. 20260407000001). Do not
-- commit a real key here — replace <SERVICE_ROLE_KEY> below before running
-- this file directly against any project.

SELECT cron.schedule(
  'sync-active-email-alerts-every-5-minutes',
  '*/5 * * * *',
  $$
    SELECT net.http_post(
      url     := 'https://xugvnfudofuskxoknhve.supabase.co/functions/v1/sync-active-email-alerts',
      headers := '{"Content-Type": "application/json", "Authorization": "Bearer <SERVICE_ROLE_KEY>"}'::jsonb,
      body    := '{}'::jsonb
    );
  $$
);
