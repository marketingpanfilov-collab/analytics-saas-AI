-- Идемпотентность Meta CAPI (InitiateCheckout / Purchase), ключи не дублируются при повторной доставке webhook или повторных запросах.
CREATE TABLE IF NOT EXISTS public.meta_marketing_dispatch (
  idempotency_key text PRIMARY KEY,
  event_name text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS meta_marketing_dispatch_created_at_idx
  ON public.meta_marketing_dispatch (created_at DESC);

ALTER TABLE public.meta_marketing_dispatch ENABLE ROW LEVEL SECURITY;

COMMENT ON TABLE public.meta_marketing_dispatch IS 'Meta Conversions API: один раз на idempotency_key (service role).';
