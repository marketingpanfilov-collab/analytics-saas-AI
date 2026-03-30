-- Run in Supabase SQL Editor if DB already has the column but API still says "schema cache" / unknown column.
-- (same as supabase/migrations/20260331130000_postgrest_reload_schema.sql)

NOTIFY pgrst, 'reload schema';
