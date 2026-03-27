-- Safe additive mapping: app user <-> Paddle customer
CREATE TABLE IF NOT EXISTS public.billing_customer_map (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  provider text NOT NULL DEFAULT 'paddle' CHECK (provider IN ('paddle')),
  provider_customer_id text NOT NULL,
  user_id uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  email text,
  source text NOT NULL DEFAULT 'webhook' CHECK (source IN ('webhook', 'checkout')),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_billing_customer_map_provider_customer
  ON public.billing_customer_map(provider, provider_customer_id);
CREATE INDEX IF NOT EXISTS idx_billing_customer_map_user_id
  ON public.billing_customer_map(user_id);
CREATE INDEX IF NOT EXISTS idx_billing_customer_map_email
  ON public.billing_customer_map(lower(email));

COMMENT ON TABLE public.billing_customer_map IS 'Maps app users/emails to Paddle customer IDs for billing status UI.';

