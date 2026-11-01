ALTER TABLE notifications
  ADD COLUMN IF NOT EXISTS notification_type VARCHAR(60) NOT NULL DEFAULT 'system' AFTER message,
  ADD COLUMN IF NOT EXISTS related_entity_type VARCHAR(60) NULL AFTER notification_type,
  ADD COLUMN IF NOT EXISTS related_entity_id VARCHAR(80) NULL AFTER related_entity_type,
  ADD COLUMN IF NOT EXISTS idempotency_key VARCHAR(190) NULL AFTER related_entity_id,
  ADD COLUMN IF NOT EXISTS read_at DATETIME NULL AFTER status,
  ADD COLUMN IF NOT EXISTS delivery_channel ENUM('in_app','email') NOT NULL DEFAULT 'in_app' AFTER read_at,
  ADD COLUMN IF NOT EXISTS delivery_status ENUM('delivered','pending','failed','not_configured') NOT NULL DEFAULT 'delivered' AFTER delivery_channel,
  ADD COLUMN IF NOT EXISTS delivery_attempts INT UNSIGNED NOT NULL DEFAULT 0 AFTER delivery_status,
  ADD COLUMN IF NOT EXISTS last_delivery_error VARCHAR(500) NULL AFTER delivery_attempts,
  ADD UNIQUE KEY uq_notifications_idempotency_key (idempotency_key),
  ADD INDEX idx_notifications_recipient_created (user_id, created_at, id),
  ADD INDEX idx_notifications_recipient_unread (user_id, status, created_at);

CREATE TABLE IF NOT EXISTS notification_history (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  notification_id BIGINT UNSIGNED NOT NULL,
  actor_id BIGINT UNSIGNED NULL,
  action VARCHAR(60) NOT NULL,
  details JSON NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT fk_notification_history_notification FOREIGN KEY (notification_id) REFERENCES notifications(id) ON DELETE RESTRICT,
  CONSTRAINT fk_notification_history_actor FOREIGN KEY (actor_id) REFERENCES users(id) ON DELETE SET NULL,
  INDEX idx_notification_history_notification_created (notification_id, created_at)
) ENGINE=InnoDB;
