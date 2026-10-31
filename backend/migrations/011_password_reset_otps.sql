CREATE TABLE IF NOT EXISTS password_reset_otp_challenges (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  user_id BIGINT UNSIGNED NOT NULL,
  otp_hash CHAR(128) NOT NULL,
  otp_salt CHAR(32) NOT NULL,
  expires_at DATETIME NOT NULL,
  failed_attempts TINYINT UNSIGNED NOT NULL DEFAULT 0,
  consumed_at DATETIME NULL,
  reset_token_hash CHAR(64) NULL,
  reset_token_expires_at DATETIME NULL,
  reset_token_used_at DATETIME NULL,
  last_sent_at DATETIME NOT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY uq_password_reset_otp_user (user_id),
  UNIQUE KEY uq_password_reset_authorization_hash (reset_token_hash),
  INDEX idx_password_reset_otp_expiry (expires_at),
  CONSTRAINT fk_password_reset_otp_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
) ENGINE=InnoDB;
