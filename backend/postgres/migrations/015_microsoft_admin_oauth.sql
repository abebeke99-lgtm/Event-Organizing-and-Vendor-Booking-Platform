ALTER TABLE oauth_identities
  DROP CONSTRAINT IF EXISTS oauth_identities_provider_check;
ALTER TABLE oauth_identities
  ADD CONSTRAINT oauth_identities_provider_check
  CHECK (provider IN ('google', 'facebook', 'apple', 'microsoft'));

ALTER TABLE oauth_login_states
  DROP CONSTRAINT IF EXISTS oauth_login_states_provider_check;
ALTER TABLE oauth_login_states
  ADD CONSTRAINT oauth_login_states_provider_check
  CHECK (provider IN ('google', 'facebook', 'apple', 'microsoft'));
ALTER TABLE oauth_login_states
  DROP CONSTRAINT IF EXISTS oauth_login_states_intent_check;
ALTER TABLE oauth_login_states
  DROP CONSTRAINT IF EXISTS oauth_login_states_check;
ALTER TABLE oauth_login_states
  ALTER COLUMN intent TYPE VARCHAR(16);
ALTER TABLE oauth_login_states
  ADD COLUMN IF NOT EXISTS remember_me BOOLEAN NOT NULL DEFAULT FALSE;
ALTER TABLE oauth_login_states
  ADD CONSTRAINT oauth_login_states_intent_check
  CHECK (intent IN ('login', 'link', 'register', 'admin-login'));
ALTER TABLE oauth_login_states
  ADD CONSTRAINT oauth_login_states_check
  CHECK ((intent = 'link' AND user_id IS NOT NULL)
    OR (intent IN ('login', 'register', 'admin-login') AND user_id IS NULL));

CREATE TABLE IF NOT EXISTS oauth_pending_admin_links (
  token_hash CHAR(64) PRIMARY KEY,
  user_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  provider VARCHAR(16) NOT NULL
    CHECK (provider IN ('google', 'microsoft')),
  provider_subject VARCHAR(255) NOT NULL,
  provider_email VARCHAR(254) NOT NULL,
  remember_me BOOLEAN NOT NULL DEFAULT FALSE,
  expires_at TIMESTAMPTZ NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE (provider, provider_subject)
);
CREATE INDEX IF NOT EXISTS idx_oauth_pending_admin_links_expiry
  ON oauth_pending_admin_links(expires_at);
