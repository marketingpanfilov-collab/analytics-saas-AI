-- Project currency and exchange rates

-- 1) Add currency column to projects (UI display only; values stored in USD).
ALTER TABLE public.projects
  ADD COLUMN IF NOT EXISTS currency text NOT NULL DEFAULT 'USD';

ALTER TABLE public.projects
  ADD CONSTRAINT projects_currency_check
  CHECK (currency IN ('USD', 'KZT'));

-- 2) Exchange rates table (e.g. USD -> KZT).
CREATE TABLE IF NOT EXISTS public.exchange_rates (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  base_currency text NOT NULL,
  quote_currency text NOT NULL,
  rate numeric NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (base_currency, quote_currency)
);

