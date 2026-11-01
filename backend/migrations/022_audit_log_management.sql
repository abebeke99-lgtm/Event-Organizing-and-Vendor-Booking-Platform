ALTER TABLE audit_logs
  ADD COLUMN request_id CHAR(36) NULL AFTER ip_address,
  ADD COLUMN outcome ENUM('success', 'failure') NOT NULL DEFAULT 'success' AFTER request_id,
  ADD COLUMN severity ENUM('info', 'warning', 'critical') NOT NULL DEFAULT 'info' AFTER outcome,
  ADD INDEX idx_audit_request (request_id),
  ADD INDEX idx_audit_action_date (action, created_at),
  ADD INDEX idx_audit_severity_date (severity, created_at);

UPDATE audit_logs
SET severity = CASE
  WHEN action LIKE 'system.%'
    OR action LIKE 'settings.%'
    OR action LIKE '%permission%'
    OR action LIKE 'payment.%'
    OR action LIKE 'payments.%'
    OR action LIKE 'refund.%'
    OR action LIKE 'user.status_changed'
    OR action LIKE 'user.role_changed'
    OR action LIKE 'role.%'
  THEN 'critical'
  WHEN action LIKE '%cancel%'
    OR action LIKE '%reject%'
    OR action LIKE '%moderation%'
    OR action LIKE '%reschedul%'
    OR action LIKE '%suspend%'
    OR action LIKE 'vendor.%'
    OR action LIKE 'event.approve'
    OR action LIKE 'event.reject'
    OR action LIKE 'event.cancel'
  THEN 'warning'
  ELSE 'info'
END;

INSERT IGNORE INTO permissions (permission_key, description) VALUES
  ('audit_logs.view', 'View and search administrator audit logs'),
  ('audit_logs.export', 'Export filtered administrator audit logs');
