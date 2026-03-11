-- Add average check fields for monthly sales plans (USD).
-- Safe: ADD COLUMN IF NOT EXISTS, nullable.

ALTER TABLE public.project_monthly_plans
  ADD COLUMN IF NOT EXISTS primary_avg_check numeric,
  ADD COLUMN IF NOT EXISTS repeat_avg_check numeric;
