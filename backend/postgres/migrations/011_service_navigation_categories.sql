CREATE TEMP TABLE service_navigation_seed (
  menu_order INTEGER PRIMARY KEY,
  category_name VARCHAR(120) NOT NULL,
  aliases TEXT[] NOT NULL
) ON COMMIT DROP;

INSERT INTO service_navigation_seed (menu_order, category_name, aliases) VALUES
  (1, 'Photography', ARRAY['Photography Services', 'Photography and Videography', 'Photography & Videography']),
  (2, 'Videography', ARRAY['Videography Services', 'Video Services']),
  (3, 'Catering', ARRAY['Catering Services', 'Catering Service']),
  (4, 'Decoration', ARRAY['Decoration Services', 'Event Decoration', 'Decoration & Florists', 'Decoration and Florists']),
  (5, 'Wedding Venues', ARRAY['Wedding Venue', 'Venues', 'Venue & Event Spaces', 'Event Venues']),
  (6, 'Event Halls', ARRAY['Event Hall', 'Halls']),
  (7, 'Entertainment', ARRAY['Event Entertainment', 'Music & Entertainment']),
  (8, 'DJs and Music', ARRAY['DJ', 'DJs', 'DJ and Music', 'DJ & Music', 'Music and DJ', 'Music & DJ', 'DJ Services']),
  (9, 'Transportation', ARRAY['Transportation Services', 'Event Transportation', 'Wedding Cars and Transport']),
  (10, 'Makeup and Beauty', ARRAY['Makeup & Beauty', 'Makeup and Beauty Services', 'Makeup & Beauty Services']),
  (11, 'Florists', ARRAY['Florist', 'Floral Services', 'Flower Services']),
  (12, 'Event Planning', ARRAY['Event Planner', 'Event Planners', 'Wedding Planning']),
  (13, 'Equipment Rental', ARRAY['Equipment Rentals', 'Rental Equipment', 'Equipment Hire']),
  (14, 'Lighting and Sound', ARRAY['Lighting & Sound', 'Sound & Lighting', 'Sound and Lighting']),
  (15, 'Security Services', ARRAY['Security', 'Security Service']);

INSERT INTO service_categories (name, display_order, service_menu_order, service_menu_name, is_active)
SELECT seed.category_name, seed.menu_order, seed.menu_order, seed.category_name, TRUE
FROM service_navigation_seed AS seed
WHERE NOT EXISTS (
  SELECT 1
  FROM service_categories AS category
  WHERE LOWER(BTRIM(category.name)) = ANY (
    ARRAY[LOWER(BTRIM(seed.category_name))]
      || ARRAY(SELECT LOWER(BTRIM(alias_name)) FROM UNNEST(seed.aliases) AS alias(alias_name))
  )
    OR LOWER(BTRIM(COALESCE(category.service_menu_name, ''))) = ANY (
      ARRAY[LOWER(BTRIM(seed.category_name))]
        || ARRAY(SELECT LOWER(BTRIM(alias_name)) FROM UNNEST(seed.aliases) AS alias(alias_name))
    )
)
ON CONFLICT (name) DO NOTHING;

CREATE TEMP TABLE service_navigation_selected ON COMMIT DROP AS
WITH candidates AS (
  SELECT category.id, seed.menu_order, seed.category_name,
         ROW_NUMBER() OVER (
           PARTITION BY seed.menu_order
           ORDER BY
             CASE
               WHEN LOWER(BTRIM(category.name)) = LOWER(seed.category_name) THEN 0
               WHEN LOWER(BTRIM(COALESCE(category.service_menu_name, ''))) = LOWER(seed.category_name) THEN 1
               ELSE 2
             END,
             category.id
         ) AS candidate_rank
  FROM service_navigation_seed AS seed
  JOIN service_categories AS category
    ON LOWER(BTRIM(category.name)) = ANY (
      ARRAY[LOWER(BTRIM(seed.category_name))]
        || ARRAY(SELECT LOWER(BTRIM(alias_name)) FROM UNNEST(seed.aliases) AS alias(alias_name))
    )
    OR LOWER(BTRIM(COALESCE(category.service_menu_name, ''))) = ANY (
      ARRAY[LOWER(BTRIM(seed.category_name))]
        || ARRAY(SELECT LOWER(BTRIM(alias_name)) FROM UNNEST(seed.aliases) AS alias(alias_name))
    )
)
SELECT id, menu_order, category_name
FROM candidates
WHERE candidate_rank = 1;

UPDATE service_categories AS category
SET service_menu_order = NULL,
    service_menu_name = NULL
WHERE (category.service_menu_order IS NOT NULL OR category.service_menu_name IS NOT NULL)
  AND NOT EXISTS (
    SELECT 1
    FROM service_navigation_selected AS selected
    WHERE selected.id = category.id
  );

UPDATE service_categories AS category
SET service_menu_order = selected.menu_order,
    service_menu_name = selected.category_name,
    is_active = TRUE
FROM service_navigation_selected AS selected
WHERE selected.id = category.id;
