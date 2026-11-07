export const publicEventOwnerFrom = `
  FROM events e
  JOIN users u ON u.id = e.organizer_id`;

export const publicEventFrom = `${publicEventOwnerFrom}
  LEFT JOIN (
    SELECT tt.event_id,
           MIN(CASE
             WHEN (tt.sales_start IS NULL OR tt.sales_start <= NOW())
               AND (tt.sales_end IS NULL OR tt.sales_end >= NOW())
             THEN tt.price
           END) AS starting_price,
           SUM(CASE
             WHEN (tt.sales_start IS NULL OR tt.sales_start <= NOW())
               AND (tt.sales_end IS NULL OR tt.sales_end >= NOW())
             THEN GREATEST(tt.capacity - tt.sold_quantity - COALESCE(reserved.quantity, 0), 0)
             ELSE 0
           END) AS available_quantity,
           SUM(CASE
              WHEN tt.price = 0
                AND (tt.sales_start IS NULL OR tt.sales_start <= NOW())
                AND (tt.sales_end IS NULL OR tt.sales_end >= NOW())
              THEN GREATEST(tt.capacity - tt.sold_quantity - COALESCE(reserved.quantity, 0), 0)
              ELSE 0
           END) AS free_available_quantity
    FROM event_ticket_types tt
    LEFT JOIN (
      SELECT ticket_type_id, SUM(quantity) AS quantity
      FROM event_ticket_bookings
      WHERE booking_status = 'pending_payment'
        AND created_at >= NOW() - INTERVAL 15 MINUTE
      GROUP BY ticket_type_id
    ) reserved ON reserved.ticket_type_id = tt.id
    WHERE tt.status = 'active'
    GROUP BY tt.event_id
  ) t ON t.event_id = e.id`;

export const publicEventSelect = `
  SELECT e.id, e.title, e.event_type, e.description, e.notes, e.city, e.venue, e.cover_image_url,
         e.gallery_images, e.start_date, e.end_date, e.budget, e.capacity, e.status,
         e.published_at, e.created_at, u.full_name AS organizer_name,
         e.is_featured,
         COALESCE((SELECT SUM(etb.quantity) FROM event_ticket_bookings etb
                   WHERE etb.event_id = e.id AND etb.booking_status = 'confirmed'), 0) AS popularity_count,
         t.starting_price,
         COALESCE(t.available_quantity, 0) AS available_quantity,
         COALESCE(t.free_available_quantity, 0) AS free_available_quantity
  ${publicEventFrom}`;

export const publicEventWhere = `WHERE (e.status IN ('active', 'published', 'upcoming', 'open', 'booked', 'in_progress')
  OR (e.status = 'completed' AND e.published_at IS NOT NULL))`;

export const upcomingPublicEventWhere = `WHERE e.start_date >= NOW() AND (e.status IN ('active', 'published', 'upcoming', 'open', 'booked', 'in_progress')
  OR (e.status = 'completed' AND e.published_at IS NOT NULL))`;
