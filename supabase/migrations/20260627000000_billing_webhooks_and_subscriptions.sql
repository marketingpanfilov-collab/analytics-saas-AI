-- Billing foundation (additive-only):
-- 1) Store all incoming Paddle webhook events (idempotent by provider_event_id)
-- 2) Maintain current subscription snapshot for app-level access checks

CREATE TABLE IF NOT EXISTS public.billing_webhook_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  provider text NOT NULL DEFAULT 'paddle' CHECK (provider IN ('paddle')),
  provider_event_id text NOT NULL,
  event_type text NOT NULL,
  occurred_at timestamptz,
  received_at timestamptz NOT NULL DEFAULT now(),
  payload jsonb NOT NULL,
  process_status text NOT NULL DEFAULT 'processed' CHECK (process_status IN ('processed', 'ignored', 'error')),
  process_error text
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_billing_webhook_events_provider_event
  ON public.billing_webhook_events(provider, provider_event_id);
CREATE INDEX IF NOT EXISTS idx_billing_webhook_events_event_type
  ON public.billing_webhook_events(event_type);
CREATE INDEX IF NOT EXISTS idx_billing_webhook_events_received_at
  ON public.billing_webhook_events(received_at DESC);

COMMENT ON TABLE public.billing_webhook_events IS 'Raw billing webhooks (Paddle) for audit and idempotent processing.';

CREATE TABLE IF NOT EXISTS public.billing_subscriptions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  provider text NOT NULL DEFAULT 'paddle' CHECK (provider IN ('paddle')),
  provider_subscription_id text NOT NULL,
  provider_customer_id text,
  provider_transaction_id text,
  provider_price_id text,
  provider_product_id text,
  status text,
  currency_code text,
  current_period_start timestamptz,
  current_period_end timestamptz,
  canceled_at timestamptz,
  last_event_id text,
  last_event_type text,
  last_event_at timestamptz,
  updated_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_billing_subscriptions_provider_subscription
  ON public.billing_subscriptions(provider, provider_subscription_id);
CREATE INDEX IF NOT EXISTS idx_billing_subscriptions_customer
  ON public.billing_subscriptions(provider_customer_id);
CREATE INDEX IF NOT EXISTS idx_billing_subscriptions_status
  ON public.billing_subscriptions(status);

COMMENT ON TABLE public.billing_subscriptions IS 'Latest subscription state snapshot from billing provider events.';

