INSERT INTO permissions (permission_key, description)
VALUES
  ('dashboard.view', 'View the customer dashboard'),
  ('bookings.create', 'Create and manage customer booking requests'),
  ('bookings.view_own', 'View bookings owned by the current customer'),
  ('bookings.cancel_own', 'Cancel eligible bookings owned by the current customer'),
  ('vendors.view', 'Browse public vendors'),
  ('events.view_own', 'View events owned by the current customer'),
  ('payments.view_own', 'View payments for bookings owned by the current customer'),
  ('favorites.manage_own', 'Manage vendors and services saved by the current customer'),
  ('messages.view_own', 'View and send messages for the current customer bookings'),
  ('notifications.view_own', 'View notifications for the current customer account'),
  ('reviews.create', 'Submit reviews for completed customer bookings'),
  ('reviews.view', 'View reviews submitted by the current customer')
ON CONFLICT (permission_key) DO NOTHING;

INSERT INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id
FROM roles r
CROSS JOIN permissions p
WHERE LOWER(r.name) = 'customer'
  AND r.is_active = TRUE
  AND p.permission_key IN (
    'dashboard.view',
    'bookings.create',
    'bookings.view_own',
    'bookings.cancel_own',
    'vendors.view',
    'events.view_own',
    'payments.view_own',
    'favorites.manage_own',
    'messages.view_own',
    'notifications.view_own',
    'reviews.create',
    'reviews.view'
  )
ON CONFLICT (role_id, permission_id) DO NOTHING;