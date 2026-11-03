CREATE TABLE IF NOT EXISTS admin_email_change_otp_challenges (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  user_id BIGINT UNSIGNED NOT NULL,
  current_email VARCHAR(254) NOT NULL,
  pending_email VARCHAR(254) NOT NULL,
  otp_hash CHAR(128) NOT NULL,
  otp_salt CHAR(32) NOT NULL,
  expires_at DATETIME NOT NULL,
  failed_attempts TINYINT UNSIGNED NOT NULL DEFAULT 0,
  consumed_at DATETIME NULL,
  last_sent_at DATETIME NOT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY uq_admin_email_change_user (user_id),
  UNIQUE KEY uq_admin_email_change_pending_email (pending_email),
  INDEX idx_admin_email_change_expiry (expires_at),
  CONSTRAINT fk_admin_email_change_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
