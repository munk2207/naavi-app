ALTER TABLE support_staff ADD COLUMN IF NOT EXISTS role TEXT NOT NULL DEFAULT 'staff'
  CHECK (role IN ('staff', 'admin'));

UPDATE support_staff SET role = 'admin' WHERE email = 'mynaavi2207@gmail.com';
