ALTER TABLE events
  MODIFY status ENUM('draft','pending_approval','active','published','booked','in_progress','completed','rejected','cancelled','upcoming','open') NOT NULL DEFAULT 'draft',
  ADD COLUMN IF NOT EXISTS rejection_reason VARCHAR(1000) NULL AFTER published_at;

CREATE TABLE IF NOT EXISTS event_history (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  event_id BIGINT UNSIGNED NOT NULL,
  actor_id BIGINT UNSIGNED NULL,
  action VARCHAR(120) NOT NULL,
  from_status VARCHAR(40) NULL,
  to_status VARCHAR(40) NULL,
  reason VARCHAR(1000) NULL,
  details JSON NOT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (event_id) REFERENCES events(id) ON DELETE RESTRICT,
  FOREIGN KEY (actor_id) REFERENCES users(id) ON DELETE SET NULL,
  INDEX idx_event_history_event_created (event_id, created_at)
) ENGINE=InnoDB;
