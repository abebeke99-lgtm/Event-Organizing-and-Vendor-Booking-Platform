ALTER TABLE contact_messages
  ADD COLUMN reference_id VARCHAR(32) NULL AFTER id,
  ADD COLUMN read_at DATETIME NULL AFTER reviewed_at,
  ADD COLUMN archived_at DATETIME NULL AFTER reviewed_at,
  ADD INDEX idx_contact_archived_created (archived_at, created_at);

UPDATE contact_messages
SET reference_id = CONCAT('EH-', LPAD(HEX(id), 12, '0'))
WHERE reference_id IS NULL;

ALTER TABLE contact_messages
  MODIFY reference_id VARCHAR(32) NOT NULL,
  ADD UNIQUE KEY uq_contact_reference_id (reference_id);
