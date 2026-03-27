-- Historical daily rates for deterministic currency conversion by spend day.
-- Keep one USD->KZT value per day (rate_date), updated multiple times intraday.

ALTER TABLE public.exchange_rates
  ADD COLUMN IF NOT EXISTS rate_date date;

UPDATE public.exchange_rates
SET rate_date = COALESCE(rate_date, (updated_at AT TIME ZONE 'UTC')::date)
WHERE rate_date IS NULL;

ALTER TABLE public.exchange_rates
  ALTER COLUMN rate_date SET NOT NULL;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM information_schema.table_constraints
    WHERE table_schema = 'public'
      AND table_name = 'exchange_rates'
      AND constraint_name = 'exchange_rates_base_currency_quote_currency_key'
  ) THEN
    ALTER TABLE public.exchange_rates
      DROP CONSTRAINT exchange_rates_base_currency_quote_currency_key;
  END IF;
END $$;

ALTER TABLE public.exchange_rates
  ADD CONSTRAINT exchange_rates_base_quote_rate_date_key
  UNIQUE (base_currency, quote_currency, rate_date);

CREATE INDEX IF NOT EXISTS exchange_rates_pair_rate_date_idx
  ON public.exchange_rates (base_currency, quote_currency, rate_date DESC, updated_at DESC);

