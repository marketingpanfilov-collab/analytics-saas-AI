-- Unique index required for Meta OAuth callback upsert on public.ad_accounts.
-- Callback uses: .upsert(rows, { onConflict: "integration_id,external_account_id" })
-- Without this index: "there is no unique or exclusion constraint matching the ON CONFLICT specification"
-- Safe to run multiple times: IF NOT EXISTS.

CREATE UNIQUE INDEX IF NOT EXISTS idx_ad_accounts_integration_external
  ON public.ad_accounts (integration_id, external_account_id);
