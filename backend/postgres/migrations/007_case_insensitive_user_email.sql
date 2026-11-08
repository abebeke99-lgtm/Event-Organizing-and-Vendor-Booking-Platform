CREATE UNIQUE INDEX IF NOT EXISTS uq_users_email_lower
  ON users (LOWER(email));
