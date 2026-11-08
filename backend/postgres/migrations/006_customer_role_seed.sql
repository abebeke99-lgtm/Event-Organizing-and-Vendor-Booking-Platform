INSERT INTO roles (name, description, is_admin, is_active)
SELECT 'Customer', 'Platform customer', FALSE, TRUE
WHERE NOT EXISTS (
  SELECT 1 FROM roles WHERE LOWER(name) = 'customer'
)
ON CONFLICT (name) DO NOTHING;
