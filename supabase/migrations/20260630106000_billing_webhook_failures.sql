-- Production observability: persist skipped / failed billing webhook side-effects for alerts and triage.

CREATE TABLE IF NOT EXISTS public.billing_webhook_failures (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  created_at timestamptz NOT NULL DEFAULT now(),
  provider text NOT NULL DEFAULT 'paddle' CHECK (provider IN ('paddle')),
  provider_event_id text NOT NULL,
  event_type text NOT NULL,
  customer_id text,
  subscription_id text,
  failure_kind text NOT NULL CHECK (
    failure_kind IN (
      'skip_customer_map',
      'skip_subscription',
      'ambiguous_org',
      'recovery_failed',
      'customer_map_upsert_error',
      'subscription_upsert_error'
    )
  ),
  /** true = wire log/metric alerts (e.g. ambiguous_org) */
  metric_alert boolean NOT NULL DEFAULT false,
  details jsonb NOT NULL DEFAULT '{}'::jsonb
);

CREATE INDEX IF NOT EXISTS idx_billing_webhook_failures_created_at
  ON public.billing_webhook_failures(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_billing_webhook_failures_kind
  ON public.billing_webhook_failures(failure_kind);
CREATE INDEX IF NOT EXISTS idx_billing_webhook_failures_metric_alert
  ON public.billing_webhook_failures(metric_alert)
  WHERE metric_alert = true;
CREATE INDEX IF NOT EXISTS idx_billing_webhook_failures_provider_event
  ON public.billing_webhook_failures(provider, provider_event_id);

COMMENT ON TABLE public.billing_webhook_failures IS
  'Rows when Paddle webhook did not apply customer map / subscription snapshot or hit org ambiguity; for dashboards and alerts.';

ALTER TABLE public.billing_webhook_failures ENABLE ROW LEVEL SECURITY;
