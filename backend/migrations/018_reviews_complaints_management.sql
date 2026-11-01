CREATE TABLE IF NOT EXISTS review_history (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  review_id BIGINT UNSIGNED NOT NULL,
  actor_id BIGINT UNSIGNED NULL,
  action VARCHAR(80) NOT NULL,
  from_status VARCHAR(40) NULL,
  to_status VARCHAR(40) NULL,
  reason VARCHAR(500) NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT fk_review_history_review FOREIGN KEY (review_id) REFERENCES reviews(id) ON DELETE RESTRICT,
  CONSTRAINT fk_review_history_actor FOREIGN KEY (actor_id) REFERENCES users(id) ON DELETE SET NULL,
  INDEX idx_review_history_review_created (review_id, created_at)
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS complaint_history (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  complaint_id BIGINT UNSIGNED NOT NULL,
  actor_id BIGINT UNSIGNED NULL,
  action VARCHAR(80) NOT NULL,
  from_status VARCHAR(40) NULL,
  to_status VARCHAR(40) NULL,
  reason VARCHAR(500) NULL,
  details JSON NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT fk_complaint_history_complaint FOREIGN KEY (complaint_id) REFERENCES complaints(id) ON DELETE RESTRICT,
  CONSTRAINT fk_complaint_history_actor FOREIGN KEY (actor_id) REFERENCES users(id) ON DELETE SET NULL,
  INDEX idx_complaint_history_complaint_created (complaint_id, created_at)
) ENGINE=InnoDB;

ALTER TABLE complaints
  MODIFY COLUMN status ENUM('open','under_review','resolved','closed','investigating','dismissed') NOT NULL DEFAULT 'open',
  ADD COLUMN IF NOT EXISTS assigned_to BIGINT UNSIGNED NULL AFTER resolution,
  ADD INDEX IF NOT EXISTS idx_complaints_assigned_status (assigned_to, status);

UPDATE complaints SET status = 'under_review' WHERE status = 'investigating';
UPDATE complaints SET status = 'closed' WHERE status = 'dismissed';

ALTER TABLE complaints
  MODIFY COLUMN status ENUM('open','under_review','resolved','closed') NOT NULL DEFAULT 'open',
  ADD CONSTRAINT fk_complaints_assigned_to FOREIGN KEY (assigned_to) REFERENCES users(id) ON DELETE SET NULL;

CREATE TABLE IF NOT EXISTS complaint_attachments (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  complaint_id BIGINT UNSIGNED NOT NULL,
  uploaded_by BIGINT UNSIGNED NOT NULL,
  original_name VARCHAR(180) NOT NULL,
  content_type VARCHAR(80) NOT NULL,
  file_size INT UNSIGNED NOT NULL,
  sha256 CHAR(64) NOT NULL,
  file_data LONGBLOB NOT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT fk_complaint_attachment_complaint FOREIGN KEY (complaint_id) REFERENCES complaints(id) ON DELETE RESTRICT,
  CONSTRAINT fk_complaint_attachment_uploader FOREIGN KEY (uploaded_by) REFERENCES users(id) ON DELETE RESTRICT,
  INDEX idx_complaint_attachment_complaint (complaint_id, created_at)
) ENGINE=InnoDB;

INSERT INTO review_history (review_id, action, to_status, created_at)
SELECT r.id, 'created', r.status, r.created_at
FROM reviews r
WHERE NOT EXISTS (SELECT 1 FROM review_history h WHERE h.review_id = r.id);

INSERT INTO complaint_history (complaint_id, action, to_status, created_at)
SELECT c.id, 'created', c.status, c.created_at
FROM complaints c
WHERE NOT EXISTS (SELECT 1 FROM complaint_history h WHERE h.complaint_id = c.id);
