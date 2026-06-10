CREATE TABLE IF NOT EXISTS support_staff (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  email      TEXT UNIQUE NOT NULL,
  name       TEXT NOT NULL,
  active     BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE support_staff ENABLE ROW LEVEL SECURITY;
CREATE POLICY "service_role_all" ON support_staff FOR ALL USING (auth.role() = 'service_role');

INSERT INTO support_staff (email, name) VALUES
  ('mynaavi2207@gmail.com', 'Naavi Support')
ON CONFLICT (email) DO NOTHING;
