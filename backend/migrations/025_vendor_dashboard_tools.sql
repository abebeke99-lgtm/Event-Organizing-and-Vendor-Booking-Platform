ALTER TABLE vendor_profiles
  ADD COLUMN IF NOT EXISTS address VARCHAR(255) NULL AFTER city,
  ADD COLUMN IF NOT EXISTS service_areas JSON NULL AFTER address,
  ADD COLUMN IF NOT EXISTS operating_hours JSON NULL AFTER service_areas,
  ADD COLUMN IF NOT EXISTS website VARCHAR(255) NULL AFTER operating_hours,
  ADD COLUMN IF NOT EXISTS notification_preferences JSON NULL AFTER website,
  ADD COLUMN IF NOT EXISTS booking_preferences JSON NULL AFTER notification_preferences;

CREATE TABLE IF NOT EXISTS service_packages (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  service_id BIGINT UNSIGNED NOT NULL,
  name VARCHAR(120) NOT NULL,
  description VARCHAR(1000) NULL,
  price DECIMAL(12,2) NOT NULL,
  currency CHAR(3) NOT NULL DEFAULT 'ETB',
  included_features JSON NOT NULL,
  extras JSON NOT NULL,
  minimum_booking INT UNSIGNED NOT NULL DEFAULT 1,
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  FOREIGN KEY (service_id) REFERENCES services(id) ON DELETE CASCADE,
  INDEX idx_service_packages_active (service_id, is_active),
  CHECK (price >= 0),
  CHECK (minimum_booking > 0)
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS vendor_media (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  vendor_id BIGINT UNSIGNED NOT NULL,
  service_id BIGINT UNSIGNED NULL,
  media_type ENUM('logo','cover','portfolio','service') NOT NULL,
  original_name VARCHAR(180) NOT NULL,
  content_type ENUM('image/jpeg','image/png','image/webp') NOT NULL,
  file_size INT UNSIGNED NOT NULL,
  content MEDIUMBLOB NOT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (vendor_id) REFERENCES vendor_profiles(id) ON DELETE RESTRICT,
  FOREIGN KEY (service_id) REFERENCES services(id) ON DELETE CASCADE,
  INDEX idx_vendor_media_vendor_type (vendor_id, media_type, created_at),
  INDEX idx_vendor_media_service (service_id, created_at)
) ENGINE=InnoDB;