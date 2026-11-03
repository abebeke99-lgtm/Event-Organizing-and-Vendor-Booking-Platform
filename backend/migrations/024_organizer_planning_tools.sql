CREATE TABLE IF NOT EXISTS event_budget_categories (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  event_id BIGINT UNSIGNED NOT NULL,
  name VARCHAR(100) NOT NULL,
  budget_limit DECIMAL(12,2) NOT NULL DEFAULT 0,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY uq_event_budget_category_name (event_id, name),
  FOREIGN KEY (event_id) REFERENCES events(id) ON DELETE RESTRICT,
  CHECK (budget_limit >= 0)
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS event_expenses (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  event_id BIGINT UNSIGNED NOT NULL,
  category_id BIGINT UNSIGNED NULL,
  booking_id BIGINT UNSIGNED NULL,
  vendor_id BIGINT UNSIGNED NULL,
  description VARCHAR(255) NOT NULL,
  planned_amount DECIMAL(12,2) NULL,
  actual_amount DECIMAL(12,2) NULL,
  expense_date DATE NULL,
  created_by BIGINT UNSIGNED NOT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  FOREIGN KEY (event_id) REFERENCES events(id) ON DELETE RESTRICT,
  FOREIGN KEY (category_id) REFERENCES event_budget_categories(id) ON DELETE SET NULL,
  FOREIGN KEY (booking_id) REFERENCES bookings(id) ON DELETE SET NULL,
  FOREIGN KEY (vendor_id) REFERENCES vendor_profiles(id) ON DELETE SET NULL,
  FOREIGN KEY (created_by) REFERENCES users(id) ON DELETE RESTRICT,
  INDEX idx_event_expenses_event_date (event_id, expense_date),
  INDEX idx_event_expenses_booking (booking_id),
  CHECK (planned_amount IS NULL OR planned_amount >= 0),
  CHECK (actual_amount IS NULL OR actual_amount >= 0),
  CHECK (planned_amount IS NOT NULL OR actual_amount IS NOT NULL)
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS event_vendor_tasks (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  event_id BIGINT UNSIGNED NOT NULL,
  booking_id BIGINT UNSIGNED NOT NULL,
  title VARCHAR(160) NOT NULL,
  details VARCHAR(2000) NULL,
  due_at DATETIME NULL,
  status ENUM('pending','in_progress','completed','blocked') NOT NULL DEFAULT 'pending',
  created_by BIGINT UNSIGNED NOT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  FOREIGN KEY (event_id) REFERENCES events(id) ON DELETE RESTRICT,
  FOREIGN KEY (booking_id) REFERENCES bookings(id) ON DELETE RESTRICT,
  FOREIGN KEY (created_by) REFERENCES users(id) ON DELETE RESTRICT,
  INDEX idx_event_vendor_tasks_event_due (event_id, due_at),
  INDEX idx_event_vendor_tasks_booking_status (booking_id, status)
) ENGINE=InnoDB;