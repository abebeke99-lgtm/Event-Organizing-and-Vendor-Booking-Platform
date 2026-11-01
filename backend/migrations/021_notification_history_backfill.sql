INSERT INTO notification_history (notification_id, actor_id, action, details, created_at)
SELECT n.id, NULL, 'created', JSON_OBJECT('source', 'migration'), n.created_at
FROM notifications n
WHERE NOT EXISTS (
  SELECT 1
  FROM notification_history h
  WHERE h.notification_id = n.id AND h.action = 'created'
);
