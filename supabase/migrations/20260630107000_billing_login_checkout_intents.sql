-- Pending org for /login signup: checkout before Auth user; linked after payment + signUp + finalize.
CREATE TABLE IF NOT EXISTS public.billing_login_checkout_intents (
  email_normalized text PRIMARY KEY,
  organization_id uuid NOT NULL REFERENCES public.organizations (id) ON DELETE CASCADE,
  expires_at timestamptz NOT NULL,
  linked_at timestamptz,
  checkout_attempt_id text,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_billing_login_checkout_intents_org
  ON public.billing_login_checkout_intents (organization_id);

COMMENT ON TABLE public.billing_login_checkout_intents IS
  'Email → org reserved for Paddle checkout from /login before Auth user exists; cleared when owner membership is linked.';

ALTER TABLE public.billing_login_checkout_intents ENABLE ROW LEVEL SECURITY;
