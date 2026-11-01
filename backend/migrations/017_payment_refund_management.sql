ALTER TABLE payments
  MODIFY COLUMN status ENUM('pending','authorized','paid','failed','cancelled','refunded','partially_refunded','refund_pending') NOT NULL DEFAULT 'pending',
  ADD COLUMN payment_method VARCHAR(80) NULL AFTER provider,
  ADD COLUMN idempotency_key VARCHAR(120) NULL AFTER provider_reference,
  ADD COLUMN verified_at DATETIME NULL AFTER created_at,
  ADD UNIQUE KEY uq_payments_idempotency_key (idempotency_key),
  ADD UNIQUE KEY uq_payments_provider_reference (provider, provider_reference);

CREATE TABLE IF NOT EXISTS refund_requests (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  payment_id BIGINT UNSIGNED NOT NULL,
  requester_id BIGINT UNSIGNED NOT NULL,
  amount DECIMAL(12,2) NOT NULL,
  currency CHAR(3) NOT NULL,
  reason VARCHAR(500) NOT NULL,
  status ENUM('pending','processing','succeeded','failed','rejected') NOT NULL DEFAULT 'pending',
  idempotency_key VARCHAR(120) NOT NULL,
  decided_by BIGINT UNSIGNED NULL,
  decision_reason VARCHAR(500) NULL,
  provider_refund_reference VARCHAR(190) NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  decided_at DATETIME NULL,
  processed_at DATETIME NULL,
  UNIQUE KEY uq_refund_idempotency_key (idempotency_key),
  INDEX idx_refund_status_created (status, created_at),
  INDEX idx_refund_payment_status (payment_id, status),
  CONSTRAINT fk_refund_payment FOREIGN KEY (payment_id) REFERENCES payments(id) ON DELETE RESTRICT,
  CONSTRAINT fk_refund_requester FOREIGN KEY (requester_id) REFERENCES users(id) ON DELETE RESTRICT,
  CONSTRAINT fk_refund_decider FOREIGN KEY (decided_by) REFERENCES users(id) ON DELETE SET NULL
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS payment_history (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  payment_id BIGINT UNSIGNED NOT NULL,
  refund_id BIGINT UNSIGNED NULL,
  actor_id BIGINT UNSIGNED NULL,
  action VARCHAR(80) NOT NULL,
  from_status VARCHAR(40) NULL,
  to_status VARCHAR(40) NULL,
  details JSON NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_payment_history_payment_created (payment_id, created_at),
  INDEX idx_payment_history_refund_created (refund_id, created_at),
  CONSTRAINT fk_payment_history_payment FOREIGN KEY (payment_id) REFERENCES payments(id) ON DELETE RESTRICT,
  CONSTRAINT fk_payment_history_refund FOREIGN KEY (refund_id) REFERENCES refund_requests(id) ON DELETE RESTRICT,
  CONSTRAINT fk_payment_history_actor FOREIGN KEY (actor_id) REFERENCES users(id) ON DELETE SET NULL
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS payment_provider_events (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  provider VARCHAR(40) NOT NULL,
  event_id VARCHAR(190) NOT NULL,
  event_type VARCHAR(80) NOT NULL,
  received_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY uq_provider_event (provider, event_id)
) ENGINE=InnoDB;
