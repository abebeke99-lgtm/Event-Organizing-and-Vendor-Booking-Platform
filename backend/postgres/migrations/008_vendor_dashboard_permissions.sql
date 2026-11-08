INSERT INTO permissions (permission_key, description)
VALUES
  ('vendors.view_own', 'View the current vendor profile and records'),
  ('vendors.manage_own', 'Manage the current vendor profile'),
  ('services.manage_own', 'Create, edit, publish, and archive owned services'),
  ('bookings.view_own', 'View bookings assigned to the current vendor'),
  ('bookings.accept_own', 'Update bookings assigned to the current vendor'),
  ('payments.view_own', 'View payment records for owned bookings'),
  ('reviews.view_own', 'View reviews for owned bookings'),
  ('notifications.view_own', 'View notifications for the current account'),
  ('messages.view', 'View and send messages for owned bookings')
ON CONFLICT (permission_key) DO NOTHING;

INSERT INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id
FROM roles r
JOIN permissions p ON p.permission_key IN (
  'vendors.view_own',
  'vendors.manage_own',
  'services.manage_own',
  'bookings.view_own',
  'bookings.accept_own',
  'payments.view_own',
  'reviews.view_own',
  'notifications.view_own',
  'messages.view'
)
WHERE LOWER(r.name) = 'vendor' AND r.is_active = TRUE
ON CONFLICT (role_id, permission_id) DO NOTHING;
