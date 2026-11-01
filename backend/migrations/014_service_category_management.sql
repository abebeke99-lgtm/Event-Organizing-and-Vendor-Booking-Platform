ALTER TABLE service_categories
  ADD COLUMN display_order INT UNSIGNED NOT NULL DEFAULT 0 AFTER description,
  ADD COLUMN image MEDIUMBLOB NULL AFTER display_order,
  ADD COLUMN image_mime ENUM('image/jpeg','image/png','image/webp') NULL AFTER image,
  ADD COLUMN updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP AFTER created_at;
