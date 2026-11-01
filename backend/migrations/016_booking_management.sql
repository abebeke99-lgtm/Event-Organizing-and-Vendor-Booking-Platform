ALTER TABLE bookings
  ADD COLUMN IF NOT EXISTS scheduled_date DATETIME NULL AFTER service_id,
  ADD INDEX IF NOT EXISTS idx_bookings_vendor_status (vendor_id, status);

CREATE TABLE IF NOT EXISTS booking_history (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  booking_id BIGINT UNSIGNED NOT NULL,
  actor_id BIGINT UNSIGNED NULL,
  action VARCHAR(80) NOT NULL,
  from_status VARCHAR(40) NULL,
  to_status VARCHAR(40) NULL,
  reason VARCHAR(500) NULL,
  details JSON NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (booking_id) REFERENCES bookings(id) ON DELETE RESTRICT,
  FOREIGN KEY (actor_id) REFERENCES users(id) ON DELETE SET NULL,
  INDEX idx_booking_history_booking_created (booking_id, created_at)
) ENGINE=InnoDB;
