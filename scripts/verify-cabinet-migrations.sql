-- Cabinet / schema checks (Supabase SQL Editor)
--
-- IMPORTANT: Do NOT select a filename from a comment and click Run (e.g. 20260331130000_postgrest...).
-- That text is NOT SQL → error "trailing junk after numeric literal".
--
-- How to use:
--   Step A: Run sections 1 + 2 + 3 only (diagnostics).
--   Step B: If section 2 returns no rows → open fix-ad-accounts-currency.sql and run it (or uncomment block 2A below).
--   Step C: If section 2 shows currency but API still errors → run fix-postgrest-reload.sql (or uncomment one line in 2B below).

-- =============================================================================
-- 1) RPC for POST /api/oauth/meta/connections/save
-- =============================================================================
SELECT proname, pg_get_function_identity_arguments(oid) AS identity_args
FROM pg_proc
WHERE proname = 'save_meta_ad_account_selection';

-- =============================================================================
-- 2) ad_accounts.currency present?
-- =============================================================================
SELECT column_name, data_type
FROM information_schema.columns
WHERE table_schema = 'public'
  AND table_name = 'ad_accounts'
  AND column_name = 'currency';

-- =============================================================================
-- 3) Recent applied migrations
-- =============================================================================
SELECT version, name
FROM supabase_migrations.schema_migrations
ORDER BY version DESC
LIMIT 40;

-- =============================================================================
-- 2A) ONLY if block (2) returned zero rows — uncomment and run:
-- =============================================================================
-- ALTER TABLE public.ad_accounts
--   ADD COLUMN IF NOT EXISTS currency text;
-- COMMENT ON COLUMN public.ad_accounts.currency IS 'Account reporting currency when known (e.g. USD, KZT); used for canonical spend/revenue normalization.';

-- =============================================================================
-- 2B) ONLY if column exists but PostgREST still complains — uncomment and run this ONE line:
-- =============================================================================
-- NOTIFY pgrst, 'reload schema';
