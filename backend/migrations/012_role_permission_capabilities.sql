INSERT IGNORE INTO permissions (permission_key, description) VALUES
  ('payments.refund', 'Request payment refunds; administrator access only'),
  ('payments.export', 'Export payment records; administrator access only'),
  ('bookings.export', 'Export booking records; administrator access only'),
  ('reports.export', 'Export platform reports; administrator access only'),
  ('users.export', 'Export user records; administrator access only');
