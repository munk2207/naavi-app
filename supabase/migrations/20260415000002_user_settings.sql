-- User settings table for configurable features (morning call, etc.)
CREATE TABLE IF NOT EXISTS user_settings (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid REFERENCES auth.users(id) ON DELETE CASCADE UNIQUE,
  morning_call_time time DEFAULT '08:00',
  morning_call_phone text DEFAULT '+16137697957',
  morning_call_enabled boolean DEFAULT true,
  timezone text DEFAULT 'America/Toronto',
  last_morning_call_date date,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

-- Seed Robert's row
INSERT INTO user_settings (user_id, morning_call_time, morning_call_phone, morning_call_enabled)
SELECT user_id, '08:00', '+16137697957', true
FROM gmail_messages
ORDER BY received_at DESC
LIMIT 1
ON CONFLICT (user_id) DO NOTHING;

-- RLS
ALTER TABLE user_settings ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users manage own settings" ON user_settings
  FOR ALL USING (auth.uid() = user_id);
