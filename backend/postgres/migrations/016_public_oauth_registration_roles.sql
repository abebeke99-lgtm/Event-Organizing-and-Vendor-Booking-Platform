ALTER TABLE oauth_identities
  DROP CONSTRAINT IF EXISTS oauth_identities_provider_check;
ALTER TABLE oauth_identities
  ADD CONSTRAINT oauth_identities_provider_check
  CHECK (provider IN ('google', 'microsoft')) NOT VALID;

ALTER TABLE oauth_login_states
  DROP CONSTRAINT IF EXISTS oauth_login_states_provider_check;
ALTER TABLE oauth_login_states
  ADD CONSTRAINT oauth_login_states_provider_check
  CHECK (provider IN ('google', 'microsoft')) NOT VALID;

ALTER TABLE oauth_login_states
  ADD COLUMN IF NOT EXISTS registration_role VARCHAR(32);
ALTER TABLE oauth_login_states
  DROP CONSTRAINT IF EXISTS oauth_login_states_registration_role_check;
ALTER TABLE oauth_login_states
  ADD CONSTRAINT oauth_login_states_registration_role_check
  CHECK (registration_role IS NULL OR registration_role IN ('customer', 'organizer', 'vendor')) NOT VALID;
