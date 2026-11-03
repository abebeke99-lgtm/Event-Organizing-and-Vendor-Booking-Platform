ALTER TABLE users
  ADD COLUMN IF NOT EXISTS preferred_language ENUM('en','am') NOT NULL DEFAULT 'en' AFTER phone;