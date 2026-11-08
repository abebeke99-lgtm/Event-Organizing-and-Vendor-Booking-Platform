ALTER TABLE users
  ADD COLUMN IF NOT EXISTS preferred_language VARCHAR(10) NOT NULL DEFAULT 'en',
  ADD COLUMN IF NOT EXISTS profile_photo BYTEA,
  ADD COLUMN IF NOT EXISTS profile_photo_mime VARCHAR(80),
  ADD COLUMN IF NOT EXISTS last_login_at TIMESTAMP;

ALTER TABLE service_categories
  ADD COLUMN IF NOT EXISTS display_order INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS service_menu_order INTEGER,
  ADD COLUMN IF NOT EXISTS service_menu_name VARCHAR(120),
  ADD COLUMN IF NOT EXISTS image BYTEA,
  ADD COLUMN IF NOT EXISTS image_mime VARCHAR(80),
  ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP;

ALTER TABLE vendor_profiles
  ADD COLUMN IF NOT EXISTS is_featured BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS address VARCHAR(255),
  ADD COLUMN IF NOT EXISTS service_areas JSONB,
  ADD COLUMN IF NOT EXISTS operating_hours JSONB,
  ADD COLUMN IF NOT EXISTS website VARCHAR(255),
  ADD COLUMN IF NOT EXISTS notification_preferences JSONB,
  ADD COLUMN IF NOT EXISTS booking_preferences JSONB;
ALTER TABLE vendor_profiles DROP CONSTRAINT IF EXISTS vendor_profiles_verification_status_check;
ALTER TABLE vendor_profiles ADD CONSTRAINT vendor_profiles_verification_status_check
  CHECK (verification_status IN ('pending', 'under_review', 'information_requested', 'verified', 'rejected', 'suspended'));

ALTER TABLE events
  ADD COLUMN IF NOT EXISTS description TEXT,
  ADD COLUMN IF NOT EXISTS venue VARCHAR(180),
  ADD COLUMN IF NOT EXISTS cover_image_url VARCHAR(1000),
  ADD COLUMN IF NOT EXISTS gallery_images JSONB,
  ADD COLUMN IF NOT EXISTS guest_count INTEGER,
  ADD COLUMN IF NOT EXISTS capacity INTEGER,
  ADD COLUMN IF NOT EXISTS is_featured BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS published_at TIMESTAMP,
  ADD COLUMN IF NOT EXISTS rejection_reason VARCHAR(1000);
ALTER TABLE events DROP CONSTRAINT IF EXISTS events_status_check;
ALTER TABLE events ADD CONSTRAINT events_status_check
  CHECK (status IN ('draft','pending_approval','active','published','booked','in_progress','completed','rejected','cancelled','upcoming','open'));
CREATE INDEX IF NOT EXISTS idx_events_type_date ON events(event_type, start_date);
CREATE INDEX IF NOT EXISTS idx_events_city_date ON events(city, start_date);
CREATE INDEX IF NOT EXISTS idx_events_featured_status_date ON events(is_featured, status, start_date);

ALTER TABLE bookings
  ADD COLUMN IF NOT EXISTS scheduled_date TIMESTAMP;
CREATE INDEX IF NOT EXISTS idx_bookings_vendor_status ON bookings(vendor_id, status);
CREATE INDEX IF NOT EXISTS idx_bookings_created_status ON bookings(created_at, status);

ALTER TABLE payments
  ADD COLUMN IF NOT EXISTS payment_method VARCHAR(80),
  ADD COLUMN IF NOT EXISTS idempotency_key VARCHAR(120),
  ADD COLUMN IF NOT EXISTS verified_at TIMESTAMP;
ALTER TABLE payments DROP CONSTRAINT IF EXISTS payments_status_check;
ALTER TABLE payments ADD CONSTRAINT payments_status_check
  CHECK (status IN ('pending', 'authorized', 'paid', 'failed', 'cancelled', 'refunded', 'partially_refunded', 'refund_pending'));
CREATE UNIQUE INDEX IF NOT EXISTS uq_payments_idempotency_key ON payments(idempotency_key);
CREATE UNIQUE INDEX IF NOT EXISTS uq_payments_provider_reference ON payments(provider, provider_reference);
CREATE INDEX IF NOT EXISTS idx_payments_created_status_currency ON payments(created_at, status, currency);

ALTER TABLE complaints
  ADD COLUMN IF NOT EXISTS assigned_to BIGINT REFERENCES users(id) ON DELETE SET NULL;
ALTER TABLE complaints DROP CONSTRAINT IF EXISTS complaints_status_check;
ALTER TABLE complaints ADD CONSTRAINT complaints_status_check
  CHECK (status IN ('open', 'under_review', 'resolved', 'closed', 'investigating', 'dismissed'));
CREATE INDEX IF NOT EXISTS idx_complaints_assigned_status ON complaints(assigned_to, status);
CREATE INDEX IF NOT EXISTS idx_complaints_created_status ON complaints(created_at, status);
CREATE INDEX IF NOT EXISTS idx_reviews_created_status ON reviews(created_at, status);

ALTER TABLE notifications
  ADD COLUMN IF NOT EXISTS notification_type VARCHAR(60) NOT NULL DEFAULT 'system',
  ADD COLUMN IF NOT EXISTS related_entity_type VARCHAR(60),
  ADD COLUMN IF NOT EXISTS related_entity_id VARCHAR(80),
  ADD COLUMN IF NOT EXISTS idempotency_key VARCHAR(190),
  ADD COLUMN IF NOT EXISTS read_at TIMESTAMP,
  ADD COLUMN IF NOT EXISTS delivery_channel VARCHAR(16) NOT NULL DEFAULT 'in_app',
  ADD COLUMN IF NOT EXISTS delivery_status VARCHAR(24) NOT NULL DEFAULT 'delivered',
  ADD COLUMN IF NOT EXISTS delivery_attempts INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS last_delivery_error VARCHAR(500);
CREATE UNIQUE INDEX IF NOT EXISTS uq_notifications_idempotency_key ON notifications(idempotency_key);
CREATE INDEX IF NOT EXISTS idx_notifications_recipient_created ON notifications(user_id, created_at, id);
CREATE INDEX IF NOT EXISTS idx_notifications_recipient_unread ON notifications(user_id, status, created_at);

ALTER TABLE audit_logs
  ADD COLUMN IF NOT EXISTS request_id CHAR(36),
  ADD COLUMN IF NOT EXISTS outcome VARCHAR(16) NOT NULL DEFAULT 'success',
  ADD COLUMN IF NOT EXISTS severity VARCHAR(16) NOT NULL DEFAULT 'info';
ALTER TABLE audit_logs ADD CONSTRAINT audit_logs_outcome_check CHECK (outcome IN ('success', 'failure'));
ALTER TABLE audit_logs ADD CONSTRAINT audit_logs_severity_check CHECK (severity IN ('info', 'warning', 'critical'));
CREATE INDEX IF NOT EXISTS idx_audit_request ON audit_logs(request_id);
CREATE INDEX IF NOT EXISTS idx_audit_action_date ON audit_logs(action, created_at);
CREATE INDEX IF NOT EXISTS idx_audit_severity_date ON audit_logs(severity, created_at);

ALTER TABLE system_settings DROP CONSTRAINT IF EXISTS system_settings_updated_by_fkey;
ALTER TABLE system_settings ADD CONSTRAINT system_settings_updated_by_fkey
  FOREIGN KEY (updated_by) REFERENCES users(id) ON DELETE SET NULL;

CREATE TABLE IF NOT EXISTS user_sessions (
  id BIGINT GENERATED BY DEFAULT AS IDENTITY PRIMARY KEY,
  user_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  token_hash CHAR(64) NOT NULL UNIQUE,
  expires_at TIMESTAMP NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_user_sessions_user ON user_sessions(user_id);
CREATE INDEX IF NOT EXISTS idx_user_sessions_expiry ON user_sessions(expires_at);

CREATE TABLE IF NOT EXISTS password_reset_tokens (
  id BIGINT GENERATED BY DEFAULT AS IDENTITY PRIMARY KEY,
  user_id BIGINT NOT NULL UNIQUE REFERENCES users(id) ON DELETE CASCADE,
  token_hash CHAR(64) NOT NULL UNIQUE,
  expires_at TIMESTAMP NOT NULL,
  used_at TIMESTAMP,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_password_reset_expiry ON password_reset_tokens(expires_at);

CREATE TABLE IF NOT EXISTS password_reset_otp_challenges (
  id BIGINT GENERATED BY DEFAULT AS IDENTITY PRIMARY KEY,
  user_id BIGINT NOT NULL UNIQUE REFERENCES users(id) ON DELETE CASCADE,
  otp_hash CHAR(128) NOT NULL,
  otp_salt CHAR(32) NOT NULL,
  expires_at TIMESTAMP NOT NULL,
  failed_attempts SMALLINT NOT NULL DEFAULT 0 CHECK (failed_attempts BETWEEN 0 AND 255),
  consumed_at TIMESTAMP,
  reset_token_hash CHAR(64) UNIQUE,
  reset_token_expires_at TIMESTAMP,
  reset_token_used_at TIMESTAMP,
  last_sent_at TIMESTAMP NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_password_reset_otp_expiry ON password_reset_otp_challenges(expires_at);

CREATE TABLE IF NOT EXISTS admin_email_change_otp_challenges (
  id BIGINT GENERATED BY DEFAULT AS IDENTITY PRIMARY KEY,
  user_id BIGINT NOT NULL UNIQUE REFERENCES users(id) ON DELETE CASCADE,
  current_email VARCHAR(254) NOT NULL,
  pending_email VARCHAR(254) NOT NULL UNIQUE,
  otp_hash CHAR(128) NOT NULL,
  otp_salt CHAR(32) NOT NULL,
  expires_at TIMESTAMP NOT NULL,
  failed_attempts SMALLINT NOT NULL DEFAULT 0 CHECK (failed_attempts BETWEEN 0 AND 255),
  consumed_at TIMESTAMP,
  last_sent_at TIMESTAMP NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_admin_email_change_expiry ON admin_email_change_otp_challenges(expires_at);

CREATE TABLE IF NOT EXISTS module_locks (
  module_key VARCHAR(120) PRIMARY KEY,
  is_locked BOOLEAN NOT NULL DEFAULT FALSE,
  lock_reason VARCHAR(255),
  locked_by BIGINT REFERENCES users(id) ON DELETE SET NULL,
  locked_at TIMESTAMPTZ,
  updated_by BIGINT REFERENCES users(id) ON DELETE SET NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS site_content (
  id BIGINT GENERATED BY DEFAULT AS IDENTITY PRIMARY KEY,
  page_key VARCHAR(80) NOT NULL,
  page_title VARCHAR(160) NOT NULL DEFAULT 'About EventHub',
  content JSONB,
  is_published BOOLEAN NOT NULL DEFAULT TRUE,
  language VARCHAR(10) NOT NULL DEFAULT 'en',
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE (page_key, language)
);

CREATE TABLE IF NOT EXISTS contact_messages (
  id BIGINT GENERATED BY DEFAULT AS IDENTITY PRIMARY KEY,
  reference_id VARCHAR(32) NOT NULL UNIQUE,
  user_id BIGINT REFERENCES users(id) ON DELETE SET NULL,
  full_name VARCHAR(160) NOT NULL,
  email VARCHAR(254) NOT NULL,
  phone VARCHAR(40),
  subject VARCHAR(200) NOT NULL,
  inquiry_type VARCHAR(40) NOT NULL DEFAULT 'general_inquiry',
  message TEXT NOT NULL,
  status VARCHAR(24) NOT NULL DEFAULT 'new',
  admin_reply TEXT,
  reviewed_by BIGINT REFERENCES users(id) ON DELETE SET NULL,
  reviewed_at TIMESTAMP,
  read_at TIMESTAMP,
  archived_at TIMESTAMP,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CHECK (inquiry_type IN ('general_inquiry','event_booking_support','vendor_support','service_request','payment_billing','technical_support','account_assistance','partnership_inquiry','feedback','other')),
  CHECK (status IN ('new','reviewed','in_progress','replied','resolved','closed'))
);
CREATE INDEX IF NOT EXISTS idx_contact_status ON contact_messages(status);
CREATE INDEX IF NOT EXISTS idx_contact_created ON contact_messages(created_at);
CREATE INDEX IF NOT EXISTS idx_contact_archived_created ON contact_messages(archived_at, created_at);

CREATE TABLE IF NOT EXISTS event_package_requests (
  id BIGINT GENERATED BY DEFAULT AS IDENTITY PRIMARY KEY,
  event_id BIGINT REFERENCES events(id) ON DELETE SET NULL,
  event_title VARCHAR(180) NOT NULL,
  event_type VARCHAR(80),
  requested_date TIMESTAMP,
  requested_location VARCHAR(120),
  requester_name VARCHAR(160) NOT NULL,
  requester_email VARCHAR(254) NOT NULL,
  service_category VARCHAR(120),
  guest_count INTEGER,
  budget NUMERIC(12,2),
  notes TEXT,
  status VARCHAR(16) NOT NULL DEFAULT 'new' CHECK (status IN ('new','reviewed','replied','closed')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_package_requests_event_status ON event_package_requests(event_id, status);
CREATE INDEX IF NOT EXISTS idx_package_requests_created ON event_package_requests(created_at);

CREATE TABLE IF NOT EXISTS services (
  id BIGINT GENERATED BY DEFAULT AS IDENTITY PRIMARY KEY,
  vendor_id BIGINT NOT NULL REFERENCES vendor_profiles(id) ON DELETE RESTRICT,
  category_id BIGINT REFERENCES service_categories(id) ON DELETE SET NULL,
  title VARCHAR(180) NOT NULL,
  description TEXT,
  price NUMERIC(12,2),
  currency CHAR(3) NOT NULL DEFAULT 'ETB',
  status VARCHAR(16) NOT NULL DEFAULT 'active' CHECK (status IN ('draft','active','archived')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_services_vendor_status ON services(vendor_id, status);
ALTER TABLE bookings
  ADD COLUMN IF NOT EXISTS service_id BIGINT;
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'bookings_service_id_fkey'
  ) THEN
    ALTER TABLE bookings ADD CONSTRAINT bookings_service_id_fkey
      FOREIGN KEY (service_id) REFERENCES services(id) ON DELETE SET NULL;
  END IF;
END $$;
CREATE INDEX IF NOT EXISTS idx_bookings_category_created ON bookings(service_id, created_at);

CREATE TABLE IF NOT EXISTS favorites (
  id BIGINT GENERATED BY DEFAULT AS IDENTITY PRIMARY KEY,
  user_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  vendor_id BIGINT NOT NULL REFERENCES vendor_profiles(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT uq_favorite_user_vendor UNIQUE(user_id, vendor_id)
);

CREATE TABLE IF NOT EXISTS customer_service_favorites (
  id BIGINT GENERATED BY DEFAULT AS IDENTITY PRIMARY KEY,
  user_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  service_id BIGINT NOT NULL REFERENCES services(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT uq_customer_service_favorite UNIQUE(user_id, service_id)
);
CREATE INDEX IF NOT EXISTS idx_customer_service_favorites_created ON customer_service_favorites(user_id, created_at);

CREATE TABLE IF NOT EXISTS quotations (
  id BIGINT GENERATED BY DEFAULT AS IDENTITY PRIMARY KEY,
  vendor_id BIGINT NOT NULL REFERENCES vendor_profiles(id) ON DELETE RESTRICT,
  customer_id BIGINT REFERENCES users(id) ON DELETE SET NULL,
  event_id BIGINT REFERENCES events(id) ON DELETE SET NULL,
  service_id BIGINT REFERENCES services(id) ON DELETE SET NULL,
  request_key VARCHAR(120) UNIQUE,
  requested_event_name VARCHAR(180),
  requested_date TIMESTAMP,
  requested_location VARCHAR(120),
  guest_count INTEGER,
  budget NUMERIC(12,2),
  requested_event_type VARCHAR(80),
  requested_phone VARCHAR(30),
  required_services TEXT,
  additional_requirements TEXT,
  request_message TEXT,
  service_description VARCHAR(255) NOT NULL,
  amount NUMERIC(12,2) NOT NULL,
  currency CHAR(3) NOT NULL DEFAULT 'ETB',
  status VARCHAR(24) NOT NULL DEFAULT 'sent' CHECK (status IN ('draft','sent','revision_requested','accepted','declined','expired','cancelled')),
  valid_until DATE,
  notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_quotations_vendor_status ON quotations(vendor_id, status);
CREATE INDEX IF NOT EXISTS idx_quotations_customer_status ON quotations(customer_id, status);
CREATE INDEX IF NOT EXISTS idx_quotations_service_status ON quotations(service_id, status);
ALTER TABLE quotations
  ADD COLUMN IF NOT EXISTS requested_event_name VARCHAR(180),
  ADD COLUMN IF NOT EXISTS requested_date TIMESTAMP,
  ADD COLUMN IF NOT EXISTS requested_location VARCHAR(120),
  ADD COLUMN IF NOT EXISTS guest_count INTEGER,
  ADD COLUMN IF NOT EXISTS budget NUMERIC(12,2),
  ADD COLUMN IF NOT EXISTS requested_event_type VARCHAR(80),
  ADD COLUMN IF NOT EXISTS requested_phone VARCHAR(30),
  ADD COLUMN IF NOT EXISTS required_services TEXT,
  ADD COLUMN IF NOT EXISTS additional_requirements TEXT,
  ADD COLUMN IF NOT EXISTS request_message TEXT;

CREATE TABLE IF NOT EXISTS messages (
  id BIGINT GENERATED BY DEFAULT AS IDENTITY PRIMARY KEY,
  sender_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  recipient_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  booking_id BIGINT REFERENCES bookings(id) ON DELETE SET NULL,
  subject VARCHAR(180),
  body TEXT NOT NULL,
  read_at TIMESTAMP,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_messages_recipient_read ON messages(recipient_id, read_at);
CREATE INDEX IF NOT EXISTS idx_messages_sender ON messages(sender_id);

CREATE TABLE IF NOT EXISTS vendor_availability (
  id BIGINT GENERATED BY DEFAULT AS IDENTITY PRIMARY KEY,
  vendor_id BIGINT NOT NULL REFERENCES vendor_profiles(id) ON DELETE CASCADE,
  available_date DATE NOT NULL,
  status VARCHAR(16) NOT NULL DEFAULT 'available' CHECK (status IN ('available','booked','blocked')),
  note VARCHAR(255),
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT uq_vendor_availability_date UNIQUE(vendor_id, available_date)
);
CREATE INDEX IF NOT EXISTS idx_vendor_availability_date_status_vendor ON vendor_availability(available_date, status, vendor_id);

CREATE TABLE IF NOT EXISTS event_ticket_types (
  id BIGINT GENERATED BY DEFAULT AS IDENTITY PRIMARY KEY,
  event_id BIGINT NOT NULL REFERENCES events(id) ON DELETE CASCADE,
  name VARCHAR(120) NOT NULL,
  description VARCHAR(500),
  price NUMERIC(12,2) NOT NULL DEFAULT 0,
  capacity INTEGER NOT NULL CHECK (capacity >= 0),
  sold_quantity INTEGER NOT NULL DEFAULT 0 CHECK (sold_quantity >= 0),
  sales_start TIMESTAMP,
  sales_end TIMESTAMP,
  status VARCHAR(16) NOT NULL DEFAULT 'active' CHECK (status IN ('active','inactive')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_ticket_types_event_status ON event_ticket_types(event_id, status);

CREATE TABLE IF NOT EXISTS event_ticket_bookings (
  id BIGINT GENERATED BY DEFAULT AS IDENTITY PRIMARY KEY,
  booking_reference VARCHAR(32) NOT NULL UNIQUE,
  idempotency_key VARCHAR(64) UNIQUE,
  event_id BIGINT NOT NULL REFERENCES events(id) ON DELETE RESTRICT,
  ticket_type_id BIGINT NOT NULL REFERENCES event_ticket_types(id) ON DELETE RESTRICT,
  customer_id BIGINT NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  quantity INTEGER NOT NULL CHECK (quantity > 0),
  unit_price NUMERIC(12,2) NOT NULL,
  total_amount NUMERIC(12,2) NOT NULL,
  payment_status VARCHAR(16) NOT NULL DEFAULT 'pending' CHECK (payment_status IN ('pending','paid','failed','refunded')),
  booking_status VARCHAR(24) NOT NULL DEFAULT 'pending_payment' CHECK (booking_status IN ('pending_payment','confirmed','cancelled','refund_pending')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_ticket_bookings_customer ON event_ticket_bookings(customer_id, created_at);
CREATE INDEX IF NOT EXISTS idx_ticket_bookings_event_status ON event_ticket_bookings(event_id, booking_status);

CREATE TABLE IF NOT EXISTS booking_history (
  id BIGINT GENERATED BY DEFAULT AS IDENTITY PRIMARY KEY,
  booking_id BIGINT NOT NULL REFERENCES bookings(id) ON DELETE RESTRICT,
  actor_id BIGINT REFERENCES users(id) ON DELETE SET NULL,
  action VARCHAR(80) NOT NULL,
  from_status VARCHAR(40),
  to_status VARCHAR(40),
  reason VARCHAR(500),
  details JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_booking_history_booking_created ON booking_history(booking_id, created_at);

CREATE TABLE IF NOT EXISTS event_history (
  id BIGINT GENERATED BY DEFAULT AS IDENTITY PRIMARY KEY,
  event_id BIGINT NOT NULL REFERENCES events(id) ON DELETE RESTRICT,
  actor_id BIGINT REFERENCES users(id) ON DELETE SET NULL,
  action VARCHAR(80) NOT NULL,
  from_status VARCHAR(40),
  to_status VARCHAR(40),
  reason VARCHAR(500),
  details JSONB NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_event_history_event_created ON event_history(event_id, created_at);

CREATE TABLE IF NOT EXISTS event_budget_categories (
  id BIGINT GENERATED BY DEFAULT AS IDENTITY PRIMARY KEY,
  event_id BIGINT NOT NULL REFERENCES events(id) ON DELETE RESTRICT,
  name VARCHAR(100) NOT NULL,
  budget_limit NUMERIC(12,2) NOT NULL DEFAULT 0 CHECK (budget_limit >= 0),
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT uq_event_budget_category_name UNIQUE(event_id, name)
);

CREATE TABLE IF NOT EXISTS event_expenses (
  id BIGINT GENERATED BY DEFAULT AS IDENTITY PRIMARY KEY,
  event_id BIGINT NOT NULL REFERENCES events(id) ON DELETE RESTRICT,
  category_id BIGINT REFERENCES event_budget_categories(id) ON DELETE SET NULL,
  booking_id BIGINT REFERENCES bookings(id) ON DELETE SET NULL,
  vendor_id BIGINT REFERENCES vendor_profiles(id) ON DELETE SET NULL,
  description VARCHAR(255) NOT NULL,
  planned_amount NUMERIC(12,2) CHECK (planned_amount IS NULL OR planned_amount >= 0),
  actual_amount NUMERIC(12,2) CHECK (actual_amount IS NULL OR actual_amount >= 0),
  expense_date DATE,
  created_by BIGINT NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CHECK (planned_amount IS NOT NULL OR actual_amount IS NOT NULL)
);
CREATE INDEX IF NOT EXISTS idx_event_expenses_event_date ON event_expenses(event_id, expense_date);
CREATE INDEX IF NOT EXISTS idx_event_expenses_booking ON event_expenses(booking_id);

CREATE TABLE IF NOT EXISTS event_vendor_tasks (
  id BIGINT GENERATED BY DEFAULT AS IDENTITY PRIMARY KEY,
  event_id BIGINT NOT NULL REFERENCES events(id) ON DELETE RESTRICT,
  booking_id BIGINT NOT NULL REFERENCES bookings(id) ON DELETE RESTRICT,
  title VARCHAR(160) NOT NULL,
  details VARCHAR(2000),
  due_at TIMESTAMP,
  status VARCHAR(16) NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','in_progress','completed','blocked')),
  created_by BIGINT NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_event_vendor_tasks_event_due ON event_vendor_tasks(event_id, due_at);
CREATE INDEX IF NOT EXISTS idx_event_vendor_tasks_booking_status ON event_vendor_tasks(booking_id, status);

CREATE TABLE IF NOT EXISTS payment_provider_events (
  id BIGINT GENERATED BY DEFAULT AS IDENTITY PRIMARY KEY,
  provider VARCHAR(40) NOT NULL,
  event_id VARCHAR(190) NOT NULL,
  event_type VARCHAR(80) NOT NULL,
  received_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT uq_provider_event UNIQUE(provider, event_id)
);

CREATE TABLE IF NOT EXISTS refund_requests (
  id BIGINT GENERATED BY DEFAULT AS IDENTITY PRIMARY KEY,
  payment_id BIGINT NOT NULL REFERENCES payments(id) ON DELETE RESTRICT,
  requester_id BIGINT NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  amount NUMERIC(12,2) NOT NULL,
  currency CHAR(3) NOT NULL DEFAULT 'ETB',
  reason VARCHAR(500) NOT NULL,
  status VARCHAR(16) NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','processing','succeeded','failed','rejected')),
  idempotency_key VARCHAR(120) NOT NULL UNIQUE,
  decided_by BIGINT REFERENCES users(id) ON DELETE SET NULL,
  decision_reason VARCHAR(500),
  provider_refund_reference VARCHAR(190),
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  decided_at TIMESTAMP,
  processed_at TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_refund_status_created ON refund_requests(status, created_at);
CREATE INDEX IF NOT EXISTS idx_refund_payment_status ON refund_requests(payment_id, status);
CREATE INDEX IF NOT EXISTS idx_refunds_processed_status_currency ON refund_requests(processed_at, status, currency);
CREATE INDEX IF NOT EXISTS idx_refunds_created_status ON refund_requests(created_at, status);

CREATE TABLE IF NOT EXISTS payment_history (
  id BIGINT GENERATED BY DEFAULT AS IDENTITY PRIMARY KEY,
  payment_id BIGINT NOT NULL REFERENCES payments(id) ON DELETE RESTRICT,
  refund_id BIGINT REFERENCES refund_requests(id) ON DELETE RESTRICT,
  actor_id BIGINT REFERENCES users(id) ON DELETE SET NULL,
  action VARCHAR(80) NOT NULL,
  from_status VARCHAR(40),
  to_status VARCHAR(40),
  details JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_payment_history_payment_created ON payment_history(payment_id, created_at);
CREATE INDEX IF NOT EXISTS idx_payment_history_refund_created ON payment_history(refund_id, created_at);

CREATE TABLE IF NOT EXISTS review_history (
  id BIGINT GENERATED BY DEFAULT AS IDENTITY PRIMARY KEY,
  review_id BIGINT NOT NULL REFERENCES reviews(id) ON DELETE RESTRICT,
  actor_id BIGINT REFERENCES users(id) ON DELETE SET NULL,
  action VARCHAR(80) NOT NULL,
  from_status VARCHAR(40),
  to_status VARCHAR(40),
  reason VARCHAR(500),
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_review_history_review_created ON review_history(review_id, created_at);

CREATE TABLE IF NOT EXISTS complaint_history (
  id BIGINT GENERATED BY DEFAULT AS IDENTITY PRIMARY KEY,
  complaint_id BIGINT NOT NULL REFERENCES complaints(id) ON DELETE RESTRICT,
  actor_id BIGINT REFERENCES users(id) ON DELETE SET NULL,
  action VARCHAR(80) NOT NULL,
  from_status VARCHAR(40),
  to_status VARCHAR(40),
  reason VARCHAR(500),
  details JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_complaint_history_complaint_created ON complaint_history(complaint_id, created_at);

CREATE TABLE IF NOT EXISTS complaint_attachments (
  id BIGINT GENERATED BY DEFAULT AS IDENTITY PRIMARY KEY,
  complaint_id BIGINT NOT NULL REFERENCES complaints(id) ON DELETE RESTRICT,
  uploaded_by BIGINT NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  original_name VARCHAR(180) NOT NULL,
  content_type VARCHAR(80) NOT NULL,
  file_size INTEGER NOT NULL CHECK (file_size >= 0),
  sha256 CHAR(64) NOT NULL,
  file_data BYTEA NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_complaint_attachment_complaint ON complaint_attachments(complaint_id, created_at);

CREATE TABLE IF NOT EXISTS notification_history (
  id BIGINT GENERATED BY DEFAULT AS IDENTITY PRIMARY KEY,
  notification_id BIGINT NOT NULL REFERENCES notifications(id) ON DELETE RESTRICT,
  actor_id BIGINT REFERENCES users(id) ON DELETE SET NULL,
  action VARCHAR(60) NOT NULL,
  details JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_notification_history_notification_created ON notification_history(notification_id, created_at);

CREATE TABLE IF NOT EXISTS service_packages (
  id BIGINT GENERATED BY DEFAULT AS IDENTITY PRIMARY KEY,
  service_id BIGINT NOT NULL REFERENCES services(id) ON DELETE CASCADE,
  name VARCHAR(120) NOT NULL,
  description VARCHAR(1000),
  price NUMERIC(12,2) NOT NULL CHECK (price >= 0),
  currency CHAR(3) NOT NULL DEFAULT 'ETB',
  included_features JSONB NOT NULL,
  extras JSONB NOT NULL,
  minimum_booking INTEGER NOT NULL DEFAULT 1 CHECK (minimum_booking > 0),
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_service_packages_active ON service_packages(service_id, is_active);

CREATE TABLE IF NOT EXISTS vendor_media (
  id BIGINT GENERATED BY DEFAULT AS IDENTITY PRIMARY KEY,
  vendor_id BIGINT NOT NULL REFERENCES vendor_profiles(id) ON DELETE RESTRICT,
  service_id BIGINT REFERENCES services(id) ON DELETE CASCADE,
  media_type VARCHAR(16) NOT NULL CHECK (media_type IN ('logo','cover','portfolio','service')),
  original_name VARCHAR(180) NOT NULL,
  content_type VARCHAR(80) NOT NULL CHECK (content_type IN ('image/jpeg','image/png','image/webp')),
  file_size INTEGER NOT NULL CHECK (file_size >= 0),
  content BYTEA NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_vendor_media_vendor_type ON vendor_media(vendor_id, media_type, created_at);
CREATE INDEX IF NOT EXISTS idx_vendor_media_service ON vendor_media(service_id, created_at);

CREATE TABLE IF NOT EXISTS vendor_verification_history (
  id BIGINT GENERATED BY DEFAULT AS IDENTITY PRIMARY KEY,
  vendor_id BIGINT NOT NULL REFERENCES vendor_profiles(id) ON DELETE RESTRICT,
  actor_id BIGINT REFERENCES users(id) ON DELETE SET NULL,
  from_status VARCHAR(40),
  to_status VARCHAR(40) NOT NULL,
  reason VARCHAR(1000) NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_vendor_verification_history_vendor ON vendor_verification_history(vendor_id, created_at);

CREATE TABLE IF NOT EXISTS vendor_verification_documents (
  id BIGINT GENERATED BY DEFAULT AS IDENTITY PRIMARY KEY,
  vendor_id BIGINT NOT NULL REFERENCES vendor_profiles(id) ON DELETE RESTRICT,
  uploaded_by BIGINT NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  original_name VARCHAR(180) NOT NULL,
  content_type VARCHAR(80) NOT NULL,
  file_size INTEGER NOT NULL CHECK (file_size >= 0),
  content BYTEA NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_vendor_verification_documents_vendor ON vendor_verification_documents(vendor_id, created_at);

CREATE TABLE IF NOT EXISTS hero_slides (
  id BIGINT GENERATED BY DEFAULT AS IDENTITY PRIMARY KEY,
  image_path VARCHAR(255) NOT NULL,
  image_mime VARCHAR(32) NOT NULL,
  alt_text VARCHAR(150) NOT NULL,
  link_url VARCHAR(2048),
  sort_order SMALLINT NOT NULL CHECK (sort_order BETWEEN 1 AND 5),
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS ai_conversations (
  id BIGINT GENERATED BY DEFAULT AS IDENTITY PRIMARY KEY,
  user_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  title VARCHAR(160) NOT NULL DEFAULT 'New chat',
  model VARCHAR(120) NOT NULL,
  is_archived BOOLEAN NOT NULL DEFAULT FALSE,
  is_pinned BOOLEAN NOT NULL DEFAULT FALSE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_ai_conversations_owner_updated ON ai_conversations(user_id, is_archived, updated_at);

CREATE TABLE IF NOT EXISTS ai_messages (
  id BIGINT GENERATED BY DEFAULT AS IDENTITY PRIMARY KEY,
  conversation_id BIGINT NOT NULL REFERENCES ai_conversations(id) ON DELETE CASCADE,
  role VARCHAR(16) NOT NULL CHECK (role IN ('user','assistant')),
  content TEXT NOT NULL,
  model VARCHAR(120),
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_ai_messages_conversation_created ON ai_messages(conversation_id, created_at, id);

CREATE OR REPLACE FUNCTION set_updated_at() RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = CURRENT_TIMESTAMP;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DO $$
DECLARE
  table_name TEXT;
BEGIN
  FOREACH table_name IN ARRAY ARRAY[
    'service_categories', 'quotations', 'site_content', 'contact_messages',
    'event_ticket_types', 'event_ticket_bookings', 'event_budget_categories',
    'event_expenses', 'event_vendor_tasks', 'service_packages', 'ai_conversations',
    'hero_slides'
  ]
  LOOP
    EXECUTE format('DROP TRIGGER IF EXISTS %I_set_updated_at ON %I', table_name, table_name);
    EXECUTE format(
      'CREATE TRIGGER %I_set_updated_at BEFORE UPDATE ON %I FOR EACH ROW EXECUTE FUNCTION set_updated_at()',
      table_name, table_name
    );
  END LOOP;
END $$;
