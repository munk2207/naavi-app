-- Add home_address and work_address to user_settings.
--
-- Session 20 Option C: personal-place resolution. These feed into
-- resolve-place so "my home" / "my office" / "work" resolve to the user's
-- saved address (via Places API) instead of a random office building in
-- another province.
--
-- Also serve as the reference-anchor for disambiguating common place
-- names like "Costco" — if a user asks for "Costco" and home_address is
-- set, the resolver biases results toward that location.

ALTER TABLE user_settings
  ADD COLUMN IF NOT EXISTS home_address text,
  ADD COLUMN IF NOT EXISTS work_address text;

COMMENT ON COLUMN user_settings.home_address IS 'User''s home street address, free-form. Used by resolve-place for "home" keyword and as reference anchor.';
COMMENT ON COLUMN user_settings.work_address IS 'User''s work/office street address, free-form. Used by resolve-place for "office"/"work" keywords.';
