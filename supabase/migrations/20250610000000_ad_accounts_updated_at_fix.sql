-- Ensure public.ad_accounts has updated_at column required by trg_ad_accounts_updated_at / set_updated_at().
-- Safe for existing installs: ADD COLUMN IF NOT EXISTS + defensive backfill.

ALTER TABLE public.ad_accounts
  ADD COLUMN IF NOT EXISTS updated_at timestamptz NOT NULL DEFAULT now();

UPDATE public.ad_accounts
SET updated_at = COALESCE(updated_at, created_at, now())
WHERE updated_at IS NULL;

