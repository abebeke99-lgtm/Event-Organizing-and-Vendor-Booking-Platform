import '../src/lib/environment.js';
const { createPostgresRuntimePool } = await import('../src/postgresPool.js');
const pool = createPostgresRuntimePool();
const ids = [3047,3048,3049,3050,3051];
const stmts = [
  "DELETE FROM notification_history WHERE notification_id IN (SELECT id FROM notifications WHERE user_id = ANY($1::bigint[]))",
  "DELETE FROM notifications WHERE user_id = ANY($1::bigint[])",
  "DELETE FROM admin_sessions WHERE user_id = ANY($1::bigint[])",
  "DELETE FROM user_sessions WHERE user_id = ANY($1::bigint[])",
  "DELETE FROM user_roles WHERE user_id = ANY($1::bigint[])",
  "DELETE FROM vendor_profiles WHERE user_id = ANY($1::bigint[])",
  "DELETE FROM audit_logs WHERE actor_id = ANY($1::bigint[])",
  "DELETE FROM oauth_identities WHERE user_id = ANY($1::bigint[])",
  "DELETE FROM oauth_login_states WHERE user_id = ANY($1::bigint[])",
  "DELETE FROM oauth_pending_admin_links WHERE user_id = ANY($1::bigint[])",
  "DELETE FROM password_reset_otp_challenges WHERE user_id = ANY($1::bigint[])",
  "DELETE FROM password_reset_otps WHERE user_id = ANY($1::bigint[])",
  "DELETE FROM password_reset_sessions WHERE user_id = ANY($1::bigint[])",
  "DELETE FROM password_reset_tokens WHERE user_id = ANY($1::bigint[])",
  "DELETE FROM ai_conversations WHERE user_id = ANY($1::bigint[])",
  "DELETE FROM favorites WHERE user_id = ANY($1::bigint[])",
  "DELETE FROM customer_service_favorites WHERE user_id = ANY($1::bigint[])",
  "DELETE FROM messages WHERE sender_id = ANY($1::bigint[]) OR recipient_id = ANY($1::bigint[])",
  "DELETE FROM complaints WHERE user_id = ANY($1::bigint[]) OR assigned_to = ANY($1::bigint[])",
  "DELETE FROM contact_messages WHERE user_id = ANY($1::bigint[]) OR reviewed_by = ANY($1::bigint[])",
  "DELETE FROM module_locks WHERE locked_by = ANY($1::bigint[]) OR updated_by = ANY($1::bigint[])",
  "DELETE FROM system_settings WHERE updated_by = ANY($1::bigint[])",
  "DELETE FROM users WHERE id = ANY($1::bigint[])",
];
for (const s of stmts) {
  try {
    await pool.query('BEGIN');
    await pool.query(s, [ids]);
    await pool.query('COMMIT');
    console.log('OK', s);
  } catch (e) {
    try { await pool.query('ROLLBACK'); } catch {}
    console.log('skip', s, '=>', e.message);
  }
}
await pool.end();
