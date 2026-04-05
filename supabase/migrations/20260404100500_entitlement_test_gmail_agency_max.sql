-- Upgrade test@gmail.com to Scale (max tier) if an older migration already granted Starter.
-- Idempotent: revokes active entitlements for that user, then inserts one Scale row (same window as seed).

DO $$
DECLARE
  target_email constant text := 'test@gmail.com';
  uid uuid;
  ends_at_utc timestamptz;
BEGIN
  SELECT id
  INTO uid
  FROM auth.users
  WHERE lower(trim(email)) = lower(trim(target_email))
  LIMIT 1;

  IF uid IS NULL THEN
    RAISE NOTICE 'billing_entitlement scale: no auth.users row for % — skip', target_email;
    RETURN;
  END IF;

  ends_at_utc := date_trunc('day', timezone('UTC', now())) + interval '2 days' - interval '1 second';

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
    'scale',
    'active',
    timezone('UTC', now()),
    ends_at_utc,
    'Upgrade to Scale (max) until end of next UTC day (test@gmail.com)',
    'admin_grant',
    now()
  );

  RAISE NOTICE 'billing_entitlement scale: user % scale until %', target_email, ends_at_utc;
END $$;
