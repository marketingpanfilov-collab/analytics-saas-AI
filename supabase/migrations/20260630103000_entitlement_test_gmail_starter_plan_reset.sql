-- Dev: снова выставить Starter для test@gmail.com (после growth-миграции и т.п.).
-- В org-first биллинге entitlement читается у плательщика орг — строка должна быть на user_id того,
-- кто owner/admin payer; для аккаунта test@gmail.com как владельца орг этого достаточно.

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
    RAISE NOTICE 'billing_entitlement starter reset: no auth.users row for % — skip', target_email;
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
    'Dev: Starter plan reset for test@gmail.com (no fixed end)',
    'admin_grant',
    now()
  );

  RAISE NOTICE 'billing_entitlement starter reset: user % (id %) → starter', target_email, uid;
END $$;
