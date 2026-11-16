ALTER TABLE users
  ADD COLUMN IF NOT EXISTS digital_id VARCHAR(40),
  ADD COLUMN IF NOT EXISTS fid_number VARCHAR(120);

UPDATE users
SET digital_id = 'EH-' || UPPER(REPLACE(gen_random_uuid()::text, '-', ''))
WHERE digital_id IS NULL;

ALTER TABLE users
  ALTER COLUMN digital_id SET NOT NULL,
  ALTER COLUMN digital_id SET DEFAULT (
    'EH-' || UPPER(REPLACE(gen_random_uuid()::text, '-', ''))
  );

CREATE UNIQUE INDEX IF NOT EXISTS uq_users_digital_id
  ON users (digital_id);
