UPDATE bookings
SET currency = 'ETB'
WHERE currency IS NULL OR TRIM(currency) = '';

ALTER TABLE bookings
  MODIFY COLUMN currency CHAR(3) NOT NULL DEFAULT 'ETB';

UPDATE quotations
SET currency = 'ETB'
WHERE currency IS NULL OR TRIM(currency) = '';

ALTER TABLE quotations
  MODIFY COLUMN currency CHAR(3) NOT NULL DEFAULT 'ETB';

UPDATE payments
SET currency = 'ETB'
WHERE currency IS NULL OR TRIM(currency) = '';

ALTER TABLE payments
  MODIFY COLUMN currency CHAR(3) NOT NULL DEFAULT 'ETB';

UPDATE refund_requests
SET currency = 'ETB'
WHERE currency IS NULL OR TRIM(currency) = '';

ALTER TABLE refund_requests
  MODIFY COLUMN currency CHAR(3) NOT NULL DEFAULT 'ETB';

UPDATE services
SET currency = 'ETB'
WHERE currency IS NULL OR TRIM(currency) = '';

ALTER TABLE services
  MODIFY COLUMN currency CHAR(3) NOT NULL DEFAULT 'ETB';

UPDATE service_packages
SET currency = 'ETB'
WHERE currency IS NULL OR TRIM(currency) = '';

ALTER TABLE service_packages
  MODIFY COLUMN currency CHAR(3) NOT NULL DEFAULT 'ETB';
