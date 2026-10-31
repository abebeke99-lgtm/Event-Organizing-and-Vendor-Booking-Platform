ALTER TABLE users
  ADD COLUMN profile_photo MEDIUMBLOB NULL,
  ADD COLUMN profile_photo_mime ENUM('image/jpeg','image/png','image/webp') NULL;
