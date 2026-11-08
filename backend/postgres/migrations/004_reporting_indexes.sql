CREATE INDEX IF NOT EXISTS idx_events_created_status
  ON events(created_at, status);
CREATE INDEX IF NOT EXISTS idx_booking_history_outcome_date
  ON booking_history(booking_id, to_status, created_at);
