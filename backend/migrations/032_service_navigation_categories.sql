ALTER TABLE service_categories
  ADD COLUMN IF NOT EXISTS service_menu_order INT UNSIGNED NULL AFTER display_order,
  ADD COLUMN IF NOT EXISTS service_menu_name VARCHAR(120) NULL AFTER service_menu_order;

CREATE TEMPORARY TABLE service_menu_seed (
  service_menu_order INT UNSIGNED NOT NULL,
  service_menu_name VARCHAR(120) NOT NULL,
  legacy_name VARCHAR(120) NULL
) ENGINE=MEMORY;

INSERT INTO service_menu_seed (service_menu_order, service_menu_name, legacy_name) VALUES
  (1, 'Catering Services', 'Catering'),
  (2, 'Photography & Videography', 'Photography'),
  (3, 'Decoration & Florists', 'Decoration'),
  (4, 'Wedding Planning', NULL),
  (5, 'Venue & Event Spaces', 'Wedding Venues'),
  (6, 'Music & Entertainment', 'Entertainment'),
  (7, 'Sound & Lighting', NULL),
  (8, 'Transportation', NULL),
  (9, 'Makeup & Beauty', NULL),
  (10, 'Rental Equipment', NULL),
  (11, 'Cakes & Bakery', NULL),
  (12, 'Printing & Invitations', NULL),
  (13, 'Security Services', NULL),
  (14, 'Other Services', NULL);

UPDATE service_categories AS category
JOIN service_menu_seed AS menu
  ON LOWER(category.name) = LOWER(menu.service_menu_name)
SET category.service_menu_order = menu.service_menu_order,
    category.service_menu_name = menu.service_menu_name
WHERE category.is_active = TRUE;

UPDATE service_categories AS category
JOIN service_menu_seed AS menu
  ON LOWER(category.name) = LOWER(menu.legacy_name)
LEFT JOIN service_categories AS canonical
  ON LOWER(canonical.name) = LOWER(menu.service_menu_name)
SET category.service_menu_order = menu.service_menu_order,
    category.service_menu_name = menu.service_menu_name
WHERE category.is_active = TRUE
  AND menu.legacy_name IS NOT NULL
  AND canonical.id IS NULL;

INSERT INTO service_categories
  (name, description, display_order, is_active, service_menu_order, service_menu_name)
SELECT menu.service_menu_name, NULL, 0, TRUE, menu.service_menu_order, menu.service_menu_name
FROM service_menu_seed AS menu
LEFT JOIN service_categories AS canonical
  ON LOWER(canonical.name) = LOWER(menu.service_menu_name)
LEFT JOIN service_categories AS legacy
  ON LOWER(legacy.name) = LOWER(menu.legacy_name) AND legacy.is_active = TRUE
WHERE canonical.id IS NULL AND legacy.id IS NULL;

DROP TEMPORARY TABLE service_menu_seed;
