ALTER TABLE users ADD COLUMN IF NOT EXISTS last_login_at TIMESTAMPTZ;
ALTER TABLE users ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMPTZ;

-- Add index for soft-delete queries
CREATE INDEX IF NOT EXISTS idx_users_deleted_at ON users(deleted_at);

-- Update the set_updated_at trigger to also handle deleted_at if needed (already handled by explicit updates)
COMMENT ON COLUMN users.last_login_at IS 'Timestamp of the user\'s last successful login';
COMMENT ON COLUMN users.deleted_at IS 'Timestamp of soft deletion; NULL means active';