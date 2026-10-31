ALTER TABLE contact_messages
  MODIFY inquiry_type ENUM(
    'general_inquiry',
    'technical_support',
    'vendor_support',
    'booking_assistance',
    'partnership',
    'feedback',
    'other',
    'event_booking_support',
    'service_request',
    'payment_billing',
    'account_assistance',
    'partnership_inquiry'
  ) NOT NULL DEFAULT 'general_inquiry',
  MODIFY status ENUM('new','reviewed','in_progress','replied','resolved','closed') NOT NULL DEFAULT 'new';

UPDATE contact_messages
SET inquiry_type = CASE inquiry_type
  WHEN 'booking_assistance' THEN 'event_booking_support'
  WHEN 'partnership' THEN 'partnership_inquiry'
  ELSE inquiry_type
END
WHERE inquiry_type IN ('booking_assistance','partnership');

ALTER TABLE contact_messages
  MODIFY inquiry_type ENUM(
    'general_inquiry',
    'event_booking_support',
    'vendor_support',
    'service_request',
    'payment_billing',
    'technical_support',
    'account_assistance',
    'partnership_inquiry',
    'feedback',
    'other'
  ) NOT NULL DEFAULT 'general_inquiry';

UPDATE system_settings
SET setting_value = ''
WHERE setting_key = 'support_email' AND setting_value = 'support@eventhub.example';

UPDATE system_settings
SET setting_value = ''
WHERE setting_key = 'support_phone' AND setting_value = '+251 911 000 000';

UPDATE system_settings
SET setting_value = ''
WHERE setting_key = 'support_address' AND setting_value = 'Addis Ababa, Ethiopia';

UPDATE system_settings
SET setting_value = ''
WHERE setting_key = 'support_hours' AND setting_value = 'Monday to Friday, 8:00 AM - 6:00 PM';

UPDATE system_settings
SET setting_value = '[]'
WHERE setting_key = 'social_links'
  AND setting_value = '[{"label":"Instagram","url":"https://instagram.com/eventhub"},{"label":"LinkedIn","url":"https://linkedin.com/company/eventhub"}]';
