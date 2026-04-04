-- test@gmail.com: срок тарифа закончился ~1 час назад (UTC) — expired / unpaid сценарии в UI.

WITH uid AS (
  SELECT id
  FROM auth.users
  WHERE lower(trim(email)) = lower(trim('test@gmail.com'))
  LIMIT 1
),
target AS (
  SELECT e.id
  FROM public.billing_entitlements e
  CROSS JOIN uid
  WHERE e.user_id = uid.id
  ORDER BY e.updated_at DESC NULLS LAST, e.created_at DESC NULLS LAST
  LIMIT 1
)
UPDATE public.billing_entitlements e
SET
  ends_at = timezone('UTC', now()) - interval '1 hour',
  status = 'expired',
  updated_at = now(),
  reason = 'Test: period ended 1 hour ago (UTC)'
FROM target t
WHERE e.id = t.id;
