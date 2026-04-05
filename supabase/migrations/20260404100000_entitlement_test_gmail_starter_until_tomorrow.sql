-- Dev / staging: grant Scale (max plan) via billing_entitlements for test@gmail.com until end of tomorrow (UTC).
-- loadBillingCurrentPlan checks entitlements first; no Paddle rows required.

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
    RAISE NOTICE 'billing_entitlement seed: no auth.users row for % — skip', target_email;
    RETURN;
  END IF;

  -- End of "tomorrow" in UTC: start of calendar day +2 in UTC, minus 1 second.
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
    'Seed: Scale (max) until end of next UTC day (test@gmail.com)',
    'admin_grant',
    now()
  );

  RAISE NOTICE 'billing_entitlement seed: user % (id %) scale active until %', target_email, uid, ends_at_utc;
END $$;
