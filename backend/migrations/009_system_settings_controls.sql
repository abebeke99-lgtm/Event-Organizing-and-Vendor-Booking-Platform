INSERT INTO system_settings (setting_key, setting_value, updated_by)
VALUES
  ('platform_name', 'EventHub', NULL),
  ('platform_description', 'Event organizing and vendor booking platform.', NULL),
  ('support_email', '', NULL),
  ('support_phone', '', NULL),
  ('support_address', '', NULL),
  ('support_hours', '', NULL),
  ('social_links', '[]', NULL),
  ('public_registration_enabled', 'true', NULL),
  ('default_registration_role', 'customer', NULL),
  ('platform_status', 'open', NULL),
  ('maintenance_mode', 'false', NULL),
  ('maintenance_message', 'We are performing scheduled maintenance. Please check back soon.', NULL)
ON DUPLICATE KEY UPDATE setting_key = setting_key;
