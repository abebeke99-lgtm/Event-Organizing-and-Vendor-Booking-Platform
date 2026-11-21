CREATE INDEX IF NOT EXISTS idx_users_created_status
  ON users(created_at, status);
CREATE INDEX IF NOT EXISTS idx_users_status
  ON users(status);
CREATE INDEX IF NOT EXISTS idx_vendor_profiles_created_status
  ON vendor_profiles(created_at, verification_status);
