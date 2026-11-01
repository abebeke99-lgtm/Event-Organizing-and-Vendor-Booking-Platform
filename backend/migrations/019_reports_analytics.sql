INSERT IGNORE INTO permissions (permission_key, description) VALUES
  ('reports.export', 'Export filtered administrator reports');

INSERT INTO system_settings (setting_key, setting_value)
VALUES
  ('platform_currency', 'ETB'),
  ('report_timezone', 'Africa/Addis_Ababa')
ON DUPLICATE KEY UPDATE setting_key = VALUES(setting_key);

ALTER TABLE payments
  ADD INDEX IF NOT EXISTS idx_payments_created_status_currency (created_at, status, currency);

ALTER TABLE refund_requests
  ADD INDEX IF NOT EXISTS idx_refunds_processed_status_currency (processed_at, status, currency),
  ADD INDEX IF NOT EXISTS idx_refunds_created_status (created_at, status);

ALTER TABLE reviews
  ADD INDEX IF NOT EXISTS idx_reviews_created_status (created_at, status);

ALTER TABLE complaints
  ADD INDEX IF NOT EXISTS idx_complaints_created_status (created_at, status);

ALTER TABLE events
  ADD INDEX IF NOT EXISTS idx_events_created_status (created_at, status);

ALTER TABLE bookings
  ADD INDEX IF NOT EXISTS idx_bookings_created_status (created_at, status),
  ADD INDEX IF NOT EXISTS idx_bookings_category_created (service_id, created_at);

ALTER TABLE booking_history
  ADD INDEX IF NOT EXISTS idx_booking_history_outcome_date (booking_id, to_status, created_at);
