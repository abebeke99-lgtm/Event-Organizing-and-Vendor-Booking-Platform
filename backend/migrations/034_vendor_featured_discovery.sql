ALTER TABLE vendor_profiles
  ADD COLUMN IF NOT EXISTS is_featured BOOLEAN NOT NULL DEFAULT FALSE AFTER verification_status;

ALTER TABLE vendor_profiles
  ADD INDEX IF NOT EXISTS idx_vendor_featured_verified (is_featured, verification_status);
