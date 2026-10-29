CREATE TABLE IF NOT EXISTS event_package_requests (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  event_id BIGINT UNSIGNED NULL,
  event_title VARCHAR(180) NOT NULL,
  event_type VARCHAR(80) NULL,
  requested_date DATETIME NULL,
  requested_location VARCHAR(120) NULL,
  requester_name VARCHAR(160) NOT NULL,
  requester_email VARCHAR(254) NOT NULL,
  service_category VARCHAR(80) NULL,
  guest_count INT UNSIGNED NULL,
  budget DECIMAL(12,2) NULL,
  notes TEXT NULL,
  status ENUM('new','reviewed','replied','closed') NOT NULL DEFAULT 'new',
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (event_id) REFERENCES events(id) ON DELETE RESTRICT,
  INDEX idx_package_requests_event_status (event_id, status),
  INDEX idx_package_requests_created (created_at)
) ENGINE=InnoDB;