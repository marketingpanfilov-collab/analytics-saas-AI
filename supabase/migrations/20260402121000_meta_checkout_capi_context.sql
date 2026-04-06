-- Контекст браузера с InitiateCheckout → для CAPI Purchase из webhook (client_user_agent / event_source_url по доке Meta).
CREATE TABLE IF NOT EXISTS public.meta_checkout_capi_context (
  checkout_attempt_id text PRIMARY KEY,
  client_user_agent text,
  event_source_url text,
  client_ip text,
  fbp text,
  fbc text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS meta_checkout_capi_context_created_at_idx
  ON public.meta_checkout_capi_context (created_at DESC);

ALTER TABLE public.meta_checkout_capi_context ENABLE ROW LEVEL SECURITY;

COMMENT ON TABLE public.meta_checkout_capi_context IS 'Снимок UA/URL/IP/fbp/fbc при открытии Paddle checkout для последующего CAPI Purchase (service role).';
