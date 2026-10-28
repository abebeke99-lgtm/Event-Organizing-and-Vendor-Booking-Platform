CREATE TABLE IF NOT EXISTS contact_messages (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  user_id BIGINT UNSIGNED NULL,
  full_name VARCHAR(160) NOT NULL,
  email VARCHAR(254) NOT NULL,
  phone VARCHAR(40) NULL,
  subject VARCHAR(200) NOT NULL,
  inquiry_type ENUM('general_inquiry','technical_support','vendor_support','booking_assistance','partnership','feedback','other') NOT NULL DEFAULT 'general_inquiry',
  message TEXT NOT NULL,
  status ENUM('new','reviewed','replied','closed') NOT NULL DEFAULT 'new',
  admin_reply TEXT NULL,
  reviewed_by BIGINT UNSIGNED NULL,
  reviewed_at DATETIME NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE SET NULL,
  FOREIGN KEY (reviewed_by) REFERENCES users(id) ON DELETE SET NULL,
  INDEX idx_contact_status (status),
  INDEX idx_contact_created (created_at)
) ENGINE=InnoDB;

INSERT INTO system_settings (setting_key, setting_value, updated_by)
SELECT 'support_email', 'support@eventhub.example', u.id
FROM users u
ORDER BY u.id ASC
LIMIT 1
ON DUPLICATE KEY UPDATE setting_value = VALUES(setting_value), updated_by = VALUES(updated_by);

INSERT INTO system_settings (setting_key, setting_value, updated_by)
SELECT 'support_phone', '+251 911 000 000', u.id
FROM users u
ORDER BY u.id ASC
LIMIT 1
ON DUPLICATE KEY UPDATE setting_value = VALUES(setting_value), updated_by = VALUES(updated_by);

INSERT INTO system_settings (setting_key, setting_value, updated_by)
SELECT 'support_address', 'Addis Ababa, Ethiopia', u.id
FROM users u
ORDER BY u.id ASC
LIMIT 1
ON DUPLICATE KEY UPDATE setting_value = VALUES(setting_value), updated_by = VALUES(updated_by);

INSERT INTO system_settings (setting_key, setting_value, updated_by)
SELECT 'support_hours', 'Monday to Friday, 8:00 AM - 6:00 PM', u.id
FROM users u
ORDER BY u.id ASC
LIMIT 1
ON DUPLICATE KEY UPDATE setting_value = VALUES(setting_value), updated_by = VALUES(updated_by);

INSERT INTO system_settings (setting_key, setting_value, updated_by)
SELECT 'social_links', '[{"label":"Instagram","url":"https://instagram.com/eventhub"},{"label":"LinkedIn","url":"https://linkedin.com/company/eventhub"}]', u.id
FROM users u
ORDER BY u.id ASC
LIMIT 1
ON DUPLICATE KEY UPDATE setting_value = VALUES(setting_value), updated_by = VALUES(updated_by);
