INSERT INTO system_settings (setting_key, setting_value)
VALUES
  ('branding_logo_url', ''),
  ('platform_locale', 'en'),
  ('booking_cancellation_cutoff_hours', '24'),
  ('booking_rescheduling_enabled', 'true'),
  ('booking_reschedule_cutoff_hours', '24'),
  ('booking_confirmation_workflow', 'vendor_acceptance'),
  ('vendor_require_category', 'true'),
  ('vendor_require_city', 'false'),
  ('vendor_require_description', 'false'),
  ('notify_admin_user_registrations', 'true'),
  ('notify_admin_vendor_applications', 'true'),
  ('notify_admin_complaints', 'true'),
  ('refund_request_window_days', '30')
ON DUPLICATE KEY UPDATE setting_key = VALUES(setting_key);
