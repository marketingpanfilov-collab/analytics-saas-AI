-- Ensure campaigns.created_at exists for deterministic dedupe (row_number() ORDER BY created_at, id).
-- Idempotent: safe to run multiple times.
ALTER TABLE public.campaigns
  ADD COLUMN IF NOT EXISTS created_at timestamptz DEFAULT now() NOT NULL;

COMMENT ON COLUMN public.campaigns.created_at IS 'Used for deterministic canonical row choice when deduping by (ad_accounts_id, trim(external_campaign_id)).';
