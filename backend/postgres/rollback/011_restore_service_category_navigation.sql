UPDATE service_categories AS category
SET service_menu_order = backup.service_menu_order,
    service_menu_name = backup.service_menu_name,
    is_active = backup.is_active
FROM service_category_navigation_backup AS backup
WHERE category.id = backup.category_id;
