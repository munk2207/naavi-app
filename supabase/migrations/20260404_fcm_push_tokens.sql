-- Add FCM (Android native push) support to push_subscriptions
-- Existing rows keep platform = 'web' and use endpoint/p256dh/auth
-- New Android rows use platform = 'android' and only fcm_token

ALTER TABLE push_subscriptions
  ADD COLUMN IF NOT EXISTS platform  text NOT NULL DEFAULT 'web',
  ADD COLUMN IF NOT EXISTS fcm_token text;

-- Mark existing rows as web platform
UPDATE push_subscriptions SET platform = 'web' WHERE platform = 'web';

-- Index for fast lookup by user + platform
CREATE INDEX IF NOT EXISTS idx_push_subscriptions_user_platform
  ON push_subscriptions (user_id, platform);
