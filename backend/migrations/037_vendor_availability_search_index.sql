CREATE INDEX idx_vendor_availability_date_status_vendor
  ON vendor_availability (available_date, status, vendor_id);
