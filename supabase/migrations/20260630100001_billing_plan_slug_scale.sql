-- Tariff slug: agency -> scale in billing_entitlements.plan_override.
-- (organization_members.role 'agency' is unrelated and unchanged.)
--
-- 1) Сначала снимаем ВСЕ CHECK на plan_override: иначе UPDATE на 'scale'
--    упирается в старый список (starter, growth, agency), а ADD может оставить
--    двойной CHECK, если имя constraint в БД не совпало с DROP IF EXISTS.
-- 2) Потом данные, потом одно новое ограничение.

DO $$
DECLARE
  r RECORD;
BEGIN
  FOR r IN
    SELECT c.oid, c.conname
    FROM pg_constraint c
    JOIN pg_class t ON c.conrelid = t.oid
    JOIN pg_namespace n ON t.relnamespace = n.oid
    WHERE n.nspname = 'public'
      AND t.relname = 'billing_entitlements'
      AND c.contype = 'c'
      AND pg_get_constraintdef(c.oid) ILIKE '%plan_override%'
  LOOP
    EXECUTE format('ALTER TABLE public.billing_entitlements DROP CONSTRAINT %I', r.conname);
  END LOOP;
END $$;

UPDATE public.billing_entitlements
SET plan_override = 'scale'
WHERE plan_override = 'agency';

ALTER TABLE public.billing_entitlements
  DROP CONSTRAINT IF EXISTS billing_entitlements_plan_override_check;

ALTER TABLE public.billing_entitlements
  ADD CONSTRAINT billing_entitlements_plan_override_check
  CHECK (plan_override IN ('starter', 'growth', 'scale'));
