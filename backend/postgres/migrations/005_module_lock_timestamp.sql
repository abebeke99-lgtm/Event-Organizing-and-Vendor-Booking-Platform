DROP TRIGGER IF EXISTS module_locks_set_updated_at ON module_locks;
CREATE TRIGGER module_locks_set_updated_at
  BEFORE UPDATE ON module_locks
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();
