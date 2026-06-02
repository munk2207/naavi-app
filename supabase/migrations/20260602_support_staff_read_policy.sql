-- Allow authenticated staff to read their own row — needed for staff portal login check.
-- Without this, the portal can't verify the user is staff using their JWT.
CREATE POLICY "staff_read_own" ON support_staff
  FOR SELECT USING (email = auth.email());
