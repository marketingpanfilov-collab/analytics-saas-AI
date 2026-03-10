-- Ensure ad_accounts has a unique constraint on (integration_id, external_account_id)
-- so that upsert with onConflict: "integration_id,external_account_id" works (Meta OAuth callback).
-- Idempotent: IF NOT EXISTS.

CREATE UNIQUE INDEX IF NOT EXISTS idx_ad_accounts_integration_external
  ON public.ad_accounts (integration_id, external_account_id);
