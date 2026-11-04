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
  ('support_email', 'abebeke99@gmail.com', NULL),
  ('support_phone', '+251986481821', NULL),
  ('support_address', '', NULL),
  ('support_hours', '', NULL),
  ('social_links', '[{"label":"Telegram","url":"https://t.me/የአንተ_ቻናል"},{"label":"YouTube","url":"https://youtube.com/@የአንተ_ቻናል"},{"label":"Facebook","url":"https://facebook.com/የአንተ_ገጽ"},{"label":"LinkedIn","url":"https://linkedin.com/company/የአንተ_ገጽ"}]', NULL)
ON DUPLICATE KEY UPDATE setting_key = setting_key;
