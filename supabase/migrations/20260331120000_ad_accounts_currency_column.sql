-- App expects ad_accounts.currency (TikTok/Google discover upserts, dashboard canonical FX).
-- Some DBs drifted without this column → PostgREST: "Could not find the 'currency' column ... in the schema cache"
ALTER TABLE public.ad_accounts
  ADD COLUMN IF NOT EXISTS currency text;

COMMENT ON COLUMN public.ad_accounts.currency IS 'Account reporting currency when known (e.g. USD, KZT); used for canonical spend/revenue normalization.';
