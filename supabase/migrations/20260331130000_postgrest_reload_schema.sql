-- Best-effort: ask PostgREST to reload schema cache after ADD COLUMN (e.g. ad_accounts.currency).
-- If this NOTIFY is ignored by your role/plan, use Supabase Dashboard → Settings → API → restart or wait for cache TTL.
NOTIFY pgrst, 'reload schema';
