-- Correlate Paddle webhook subscription rows with a specific login checkout open (custom_data.checkout_attempt_id).
ALTER TABLE public.billing_subscriptions
  ADD COLUMN IF NOT EXISTS checkout_attempt_id text;

CREATE INDEX IF NOT EXISTS idx_billing_subscriptions_org_checkout_attempt
  ON public.billing_subscriptions (organization_id, checkout_attempt_id)
  WHERE organization_id IS NOT NULL AND checkout_attempt_id IS NOT NULL;

COMMENT ON COLUMN public.billing_subscriptions.checkout_attempt_id IS
  'Last known checkout_attempt_id from Paddle custom_data for this subscription row (login checkout polling).';
