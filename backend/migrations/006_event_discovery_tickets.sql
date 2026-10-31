ALTER TABLE events ADD COLUMN IF NOT EXISTS description TEXT NULL AFTER event_type;
ALTER TABLE events ADD COLUMN IF NOT EXISTS venue VARCHAR(180) NULL AFTER city;
ALTER TABLE events ADD COLUMN IF NOT EXISTS cover_image_url VARCHAR(1000) NULL AFTER venue;
ALTER TABLE events ADD COLUMN IF NOT EXISTS gallery_images JSON NULL AFTER cover_image_url;
ALTER TABLE events ADD COLUMN IF NOT EXISTS capacity INT UNSIGNED NULL AFTER guest_count;
ALTER TABLE events ADD COLUMN IF NOT EXISTS published_at DATETIME NULL AFTER status;
ALTER TABLE events ADD INDEX IF NOT EXISTS idx_events_type_date (event_type, start_date);
ALTER TABLE events ADD INDEX IF NOT EXISTS idx_events_city_date (city, start_date);

UPDATE events
SET published_at = created_at
WHERE published_at IS NULL AND status IN ('active', 'published', 'upcoming', 'open');

CREATE TABLE IF NOT EXISTS event_ticket_types (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  event_id BIGINT UNSIGNED NOT NULL,
  name VARCHAR(120) NOT NULL,
  description VARCHAR(500) NULL,
  price DECIMAL(12,2) NOT NULL DEFAULT 0,
  capacity INT UNSIGNED NOT NULL,
  sold_quantity INT UNSIGNED NOT NULL DEFAULT 0,
  sales_start DATETIME NULL,
  sales_end DATETIME NULL,
  status ENUM('active','inactive') NOT NULL DEFAULT 'active',
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  FOREIGN KEY (event_id) REFERENCES events(id) ON DELETE CASCADE,
  INDEX idx_ticket_types_event_status (event_id, status)
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS event_ticket_bookings (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  booking_reference VARCHAR(32) NOT NULL UNIQUE,
  idempotency_key VARCHAR(64) NULL UNIQUE,
  event_id BIGINT UNSIGNED NOT NULL,
  ticket_type_id BIGINT UNSIGNED NOT NULL,
  customer_id BIGINT UNSIGNED NOT NULL,
  quantity INT UNSIGNED NOT NULL,
  unit_price DECIMAL(12,2) NOT NULL,
  total_amount DECIMAL(12,2) NOT NULL,
  payment_status ENUM('pending','paid','failed','refunded') NOT NULL DEFAULT 'pending',
  booking_status ENUM('pending_payment','confirmed','cancelled','refund_pending') NOT NULL DEFAULT 'pending_payment',
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  FOREIGN KEY (event_id) REFERENCES events(id) ON DELETE RESTRICT,
  FOREIGN KEY (ticket_type_id) REFERENCES event_ticket_types(id) ON DELETE RESTRICT,
  FOREIGN KEY (customer_id) REFERENCES users(id) ON DELETE RESTRICT,
  INDEX idx_ticket_bookings_customer (customer_id, created_at),
  INDEX idx_ticket_bookings_event_status (event_id, booking_status)
) ENGINE=InnoDB;
