INSERT INTO service_categories (name, description, display_order)
SELECT incoming.name, NULL, incoming.display_order
FROM (
  SELECT 'Wedding' AS name, 1 AS display_order
  UNION ALL SELECT 'Birthday', 2
  UNION ALL SELECT 'Graduation', 3
  UNION ALL SELECT 'Conference', 4
  UNION ALL SELECT 'Corporate Events', 5
  UNION ALL SELECT 'Concerts & Music', 6
  UNION ALL SELECT 'Festivals', 7
  UNION ALL SELECT 'Religious Events', 8
  UNION ALL SELECT 'Cultural Events', 9
  UNION ALL SELECT 'Workshops & Training', 10
  UNION ALL SELECT 'Sports Events', 11
  UNION ALL SELECT 'Exhibitions', 12
) AS incoming
LEFT JOIN service_categories existing ON LOWER(existing.name) = LOWER(incoming.name)
WHERE existing.id IS NULL;

UPDATE service_categories
SET display_order = CASE LOWER(name)
  WHEN 'wedding' THEN 1
  WHEN 'birthday' THEN 2
  WHEN 'graduation' THEN 3
  WHEN 'conference' THEN 4
  WHEN 'corporate events' THEN 5
  WHEN 'concerts & music' THEN 6
  WHEN 'festivals' THEN 7
  WHEN 'religious events' THEN 8
  WHEN 'cultural events' THEN 9
  WHEN 'workshops & training' THEN 10
  WHEN 'sports events' THEN 11
  WHEN 'exhibitions' THEN 12
END
WHERE LOWER(name) IN (
  'wedding', 'birthday', 'graduation', 'conference', 'corporate events',
  'concerts & music', 'festivals', 'religious events', 'cultural events',
  'workshops & training', 'sports events', 'exhibitions'
);
