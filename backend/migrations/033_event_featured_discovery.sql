ALTER TABLE events
  ADD COLUMN IF NOT EXISTS is_featured BOOLEAN NOT NULL DEFAULT FALSE AFTER published_at;

ALTER TABLE events
  ADD INDEX IF NOT EXISTS idx_events_featured_status_date (is_featured, status, start_date);
