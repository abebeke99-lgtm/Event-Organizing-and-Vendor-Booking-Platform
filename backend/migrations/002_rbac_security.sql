CREATE TABLE IF NOT EXISTS module_locks (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  module_key VARCHAR(80) NOT NULL UNIQUE,
  is_locked BOOLEAN NOT NULL DEFAULT FALSE,
  lock_reason VARCHAR(255) NULL,
  locked_by BIGINT UNSIGNED NULL,
  locked_at TIMESTAMP NULL,
  FOREIGN KEY (locked_by) REFERENCES users(id) ON DELETE SET NULL
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS user_sessions (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  user_id BIGINT UNSIGNED NOT NULL,
  token_hash CHAR(64) NOT NULL UNIQUE,
  expires_at DATETIME NOT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
  INDEX idx_user_sessions_user (user_id),
  INDEX idx_user_sessions_expiry (expires_at)
) ENGINE=InnoDB;

INSERT IGNORE INTO roles (name, description, is_admin, is_active)
VALUES ('Customer', 'End-user customer', FALSE, TRUE);

INSERT IGNORE INTO permissions (permission_key, description) VALUES
  ('admin:*', 'Full platform administrator access'),
  ('users.view', 'View user directory records'),
  ('users.manage', 'Create or update user records'),
  ('users.lock', 'Lock or unlock user accounts'),
  ('roles.manage', 'Manage role definitions'),
  ('roles.permissions.manage', 'Edit role permissions and matrix'),
  ('vendors.view', 'View vendor records and marketplace profiles'),
  ('vendors.verify', 'Verify or reject vendor applications'),
  ('vendors.manage', 'Manage vendor directory and approvals'),
  ('vendors.view_own', 'View vendor records owned by the current user'),
  ('vendors.manage_own', 'Manage owned vendor profile details'),
  ('services.manage_own', 'Create, edit, and publish owned services'),
  ('events.create', 'Create a new event record'),
  ('events.manage_own', 'Manage owned event records'),
  ('events.view_own', 'View owned event records'),
  ('bookings.create', 'Create a booking'),
  ('bookings.view_own', 'View personal booking records'),
  ('bookings.manage', 'Manage booking workflows and states'),
  ('bookings.accept_own', 'Accept bookings for owned vendor services'),
  ('bookings.cancel_own', 'Cancel owned booking records'),
  ('bookings.moderate', 'Moderate booking decisions'),
  ('quotes.manage_own', 'Manage quotations for owned records'),
  ('payments.view', 'View all payment records'),
  ('payments.view_own', 'View personal payment records'),
  ('reports.view', 'Access platform reports and summaries'),
  ('notifications.manage', 'Send and manage platform notifications'),
  ('notifications.view_own', 'View personal notifications'),
  ('messages.view_own', 'View direct messages and threads'),
  ('favorites.manage_own', 'Manage saved vendors and favorites'),
  ('system.settings.manage', 'Update platform settings'),
  ('system.modules.manage', 'Manage system module locks and restrictions'),
  ('system.security.manage', 'Manage security and access-control configuration');

INSERT IGNORE INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id
FROM roles r
JOIN permissions p ON p.permission_key = 'admin:*'
WHERE r.name = 'Admin';

INSERT IGNORE INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id
FROM roles r
JOIN permissions p ON p.permission_key IN (
  'events.create', 'events.manage_own', 'events.view_own',
  'bookings.create', 'bookings.view_own', 'bookings.cancel_own',
  'vendors.view', 'quotes.manage_own', 'notifications.view_own', 'payments.view_own'
)
WHERE r.name = 'Organizer';

INSERT IGNORE INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id
FROM roles r
JOIN permissions p ON p.permission_key IN (
  'vendors.view_own', 'vendors.manage_own', 'services.manage_own',
  'bookings.view_own', 'bookings.accept_own', 'payments.view_own',
  'reviews.view_own', 'notifications.view_own'
)
WHERE r.name = 'Vendor';

INSERT IGNORE INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id
FROM roles r
JOIN permissions p ON p.permission_key IN (
  'bookings.create', 'bookings.view_own', 'bookings.cancel_own',
  'vendors.view', 'events.view_own', 'payments.view_own',
  'favorites.manage_own', 'messages.view_own', 'notifications.view_own'
)
WHERE r.name = 'Customer';
