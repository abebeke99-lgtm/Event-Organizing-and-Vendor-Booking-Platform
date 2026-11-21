-- Create unique index on email for fast lookup and constraint
CREATE UNIQUE INDEX IF NOT EXISTS idx_users_email_lower ON users(LOWER(email));

-- Create index on role for role-based queries
CREATE INDEX IF NOT EXISTS idx_users_role ON users(role);

-- Create index on status for status-based filtering
CREATE INDEX IF NOT EXISTS idx_users_status ON users(status);

-- Create index on created_at for time-based sorting and pagination
CREATE INDEX IF NOT EXISTS idx_users_created_at ON users(created_at DESC);