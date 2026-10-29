INSERT IGNORE INTO service_categories (name, description, is_active) VALUES
  ('Wedding Venues', 'Ceremony and reception venues for weddings and private celebrations.', TRUE),
  ('Catering', 'Food and beverage services for events of every size.', TRUE),
  ('Photography', 'Event photography and visual storytelling coverage.', TRUE),
  ('Decoration', 'Floral design, venue styling, and ambient decor.', TRUE),
  ('Entertainment', 'Live performances, DJs, and master of ceremonies support.', TRUE);

INSERT INTO system_settings (setting_key, setting_value, updated_by)
VALUES
  ('platform_status', 'open', NULL),
  ('maintenance_mode', 'false', NULL),
  ('support_email', 'support@eventhub.example', NULL),
  ('support_phone', '+251 911 000 000', NULL),
  ('support_address', 'Addis Ababa, Ethiopia', NULL),
  ('support_hours', 'Monday to Friday, 8:00 AM - 6:00 PM', NULL),
  ('social_links', '[]', NULL)
ON DUPLICATE KEY UPDATE setting_key = setting_key;
