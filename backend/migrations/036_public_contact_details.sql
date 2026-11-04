INSERT INTO system_settings (setting_key, setting_value, updated_by)
VALUES
  ('support_email', 'abebeke99@gmail.com', NULL),
  ('support_phone', '+251986481821', NULL),
  ('social_links', '[{"label":"Telegram","url":"https://t.me/የአንተ_ቻናል"},{"label":"YouTube","url":"https://youtube.com/@የአንተ_ቻናል"},{"label":"Facebook","url":"https://facebook.com/የአንተ_ገጽ"},{"label":"LinkedIn","url":"https://linkedin.com/company/የአንተ_ገጽ"}]', NULL)
ON DUPLICATE KEY UPDATE
  setting_value = CASE
    WHEN setting_value = '' OR setting_value = '[]' THEN VALUES(setting_value)
    ELSE setting_value
  END;
