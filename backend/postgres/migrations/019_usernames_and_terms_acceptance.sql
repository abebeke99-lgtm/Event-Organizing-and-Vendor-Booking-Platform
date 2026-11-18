ALTER TABLE users
  ADD COLUMN IF NOT EXISTS username VARCHAR(32),
  ADD COLUMN IF NOT EXISTS terms_accepted_at TIMESTAMPTZ;

CREATE UNIQUE INDEX IF NOT EXISTS uq_users_username_lower
  ON users (LOWER(username))
  WHERE username IS NOT NULL;
