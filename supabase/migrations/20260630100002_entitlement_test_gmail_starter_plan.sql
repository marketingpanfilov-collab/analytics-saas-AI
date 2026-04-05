-- Dev / staging: выставить тариф Starter для test@gmail.com через billing_entitlements.
-- Отзывает активные entitlements этого пользователя и вставляет одну строку starter.
-- ends_at = NULL — без срока (удобно для проверки лимитов Starter).

DO $$
DECLARE
  target_email constant text := 'test@gmail.com';
  uid uuid;
BEGIN
  SELECT id
  INTO uid
  FROM auth.users
  WHERE lower(trim(email)) = lower(trim(target_email))
  LIMIT 1;

  IF uid IS NULL THEN
    RAISE NOTICE 'billing_entitlement starter: no auth.users row for % — skip', target_email;
    RETURN;
  END IF;

  UPDATE public.billing_entitlements
  SET status = 'revoked', updated_at = now()
  WHERE user_id = uid AND status = 'active';

  INSERT INTO public.billing_entitlements (
    user_id,
    plan_override,
    status,
    starts_at,
    ends_at,
    reason,
    source,
    updated_at
  )
  VALUES (
    uid,
    'starter',
    'active',
    timezone('UTC', now()),
    NULL,
    'Dev: Starter plan for test@gmail.com (no fixed end)',
    'admin_grant',
    now()
  );

  RAISE NOTICE 'billing_entitlement starter: user % (id %) → starter', target_email, uid;
END $$;
