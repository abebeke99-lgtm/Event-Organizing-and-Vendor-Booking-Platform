ALTER TABLE vendor_profiles
  MODIFY verification_status ENUM(
    'pending',
    'under_review',
    'information_requested',
    'verified',
    'rejected',
    'suspended'
  ) NOT NULL DEFAULT 'pending';

CREATE TABLE IF NOT EXISTS vendor_verification_history (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  vendor_id BIGINT UNSIGNED NOT NULL,
  actor_id BIGINT UNSIGNED NULL,
  from_status VARCHAR(40) NULL,
  to_status VARCHAR(40) NOT NULL,
  reason VARCHAR(1000) NOT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (vendor_id) REFERENCES vendor_profiles(id) ON DELETE RESTRICT,
  FOREIGN KEY (actor_id) REFERENCES users(id) ON DELETE SET NULL,
  INDEX idx_vendor_verification_history_vendor (vendor_id, created_at)
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS vendor_verification_documents (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  vendor_id BIGINT UNSIGNED NOT NULL,
  uploaded_by BIGINT UNSIGNED NOT NULL,
  original_name VARCHAR(180) NOT NULL,
  content_type VARCHAR(80) NOT NULL,
  file_size INT UNSIGNED NOT NULL,
  content MEDIUMBLOB NOT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (vendor_id) REFERENCES vendor_profiles(id) ON DELETE RESTRICT,
  FOREIGN KEY (uploaded_by) REFERENCES users(id) ON DELETE RESTRICT,
  INDEX idx_vendor_verification_documents_vendor (vendor_id, created_at)
) ENGINE=InnoDB;
