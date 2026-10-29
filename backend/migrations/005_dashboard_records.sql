CREATE TABLE IF NOT EXISTS services (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  vendor_id BIGINT UNSIGNED NOT NULL,
  category_id BIGINT UNSIGNED NULL,
  title VARCHAR(180) NOT NULL,
  description TEXT NULL,
  price DECIMAL(12,2) NULL,
  currency CHAR(3) NOT NULL DEFAULT 'ETB',
  status ENUM('draft','active','archived') NOT NULL DEFAULT 'active',
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (vendor_id) REFERENCES vendor_profiles(id) ON DELETE RESTRICT,
  FOREIGN KEY (category_id) REFERENCES service_categories(id) ON DELETE SET NULL,
  INDEX idx_services_vendor_status (vendor_id, status)
) ENGINE=InnoDB;

ALTER TABLE events ADD COLUMN IF NOT EXISTS guest_count INT UNSIGNED NULL AFTER budget;
ALTER TABLE users ADD COLUMN IF NOT EXISTS last_login_at DATETIME NULL AFTER status;
ALTER TABLE bookings ADD COLUMN IF NOT EXISTS service_id BIGINT UNSIGNED NULL AFTER vendor_id;

ALTER TABLE system_settings MODIFY updated_by BIGINT UNSIGNED NULL;

CREATE TABLE IF NOT EXISTS favorites (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  user_id BIGINT UNSIGNED NOT NULL,
  vendor_id BIGINT UNSIGNED NOT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY uq_favorite_user_vendor (user_id, vendor_id),
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
  FOREIGN KEY (vendor_id) REFERENCES vendor_profiles(id) ON DELETE CASCADE
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS quotations (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  vendor_id BIGINT UNSIGNED NOT NULL,
  customer_id BIGINT UNSIGNED NULL,
  event_id BIGINT UNSIGNED NULL,
  service_description VARCHAR(255) NOT NULL,
  amount DECIMAL(12,2) NOT NULL,
  currency CHAR(3) NOT NULL DEFAULT 'ETB',
  status ENUM('draft','sent','revision_requested','accepted','declined','expired') NOT NULL DEFAULT 'sent',
  valid_until DATE NULL,
  notes TEXT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  FOREIGN KEY (vendor_id) REFERENCES vendor_profiles(id) ON DELETE RESTRICT,
  FOREIGN KEY (customer_id) REFERENCES users(id) ON DELETE SET NULL,
  FOREIGN KEY (event_id) REFERENCES events(id) ON DELETE SET NULL,
  INDEX idx_quotations_vendor_status (vendor_id, status),
  INDEX idx_quotations_customer_status (customer_id, status)
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS messages (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  sender_id BIGINT UNSIGNED NOT NULL,
  recipient_id BIGINT UNSIGNED NOT NULL,
  booking_id BIGINT UNSIGNED NULL,
  subject VARCHAR(180) NULL,
  body TEXT NOT NULL,
  read_at DATETIME NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (sender_id) REFERENCES users(id) ON DELETE CASCADE,
  FOREIGN KEY (recipient_id) REFERENCES users(id) ON DELETE CASCADE,
  FOREIGN KEY (booking_id) REFERENCES bookings(id) ON DELETE SET NULL,
  INDEX idx_messages_recipient_read (recipient_id, read_at),
  INDEX idx_messages_sender (sender_id)
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS vendor_availability (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  vendor_id BIGINT UNSIGNED NOT NULL,
  available_date DATE NOT NULL,
  status ENUM('available','booked','blocked') NOT NULL DEFAULT 'available',
  note VARCHAR(255) NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY uq_vendor_availability_date (vendor_id, available_date),
  FOREIGN KEY (vendor_id) REFERENCES vendor_profiles(id) ON DELETE CASCADE
) ENGINE=InnoDB;

INSERT IGNORE INTO permissions (permission_key, description)
VALUES ('reviews.view_own', 'View reviews linked to owned bookings');

INSERT IGNORE INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id
FROM roles r
JOIN permissions p ON p.permission_key = 'reviews.view_own'
WHERE r.name IN ('Vendor', 'Organizer', 'Customer');

INSERT IGNORE INTO system_settings (setting_key, setting_value, updated_by)
VALUES
  ('support_email', 'support@eventhub.example', NULL),
  ('support_phone', '+251 911 000 000', NULL),
  ('support_address', 'Addis Ababa, Ethiopia', NULL),
  ('support_hours', 'Monday to Friday, 8:00 AM - 6:00 PM', NULL),
  ('social_links', '[]', NULL);
