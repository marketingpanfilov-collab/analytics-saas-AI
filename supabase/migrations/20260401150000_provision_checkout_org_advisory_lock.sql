-- Idempotent owner org for login/signup Paddle checkout: serializes concurrent POSTs per user via advisory xact lock.

CREATE OR REPLACE FUNCTION public.provision_owner_organization_for_checkout(
  p_user_id uuid,
  p_org_label text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_org_id uuid;
  v_now timestamptz := now();
  v_slug text;
  v_name text;
  v_safe_label text;
BEGIN
  IF p_user_id IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'error', 'missing_user_id');
  END IF;

  PERFORM pg_advisory_xact_lock(
    942903,
    hashtext('checkout_org_provision:' || p_user_id::text)
  );

  SELECT om.organization_id INTO v_org_id
  FROM public.organization_members om
  WHERE om.user_id = p_user_id
  ORDER BY om.created_at ASC
  LIMIT 1;

  IF v_org_id IS NOT NULL THEN
    RETURN jsonb_build_object(
      'ok', true,
      'organization_id', v_org_id,
      'created', false
    );
  END IF;

  v_safe_label := coalesce(nullif(trim(p_org_label), ''), 'user');
  IF length(v_safe_label) > 48 THEN
    v_safe_label := left(v_safe_label, 48);
  END IF;

  v_name := 'Компания (' || v_safe_label || ')';
  v_slug :=
    'org-' || replace(p_user_id::text, '-', '') || '-' ||
    substr(md5(random()::text || clock_timestamp()::text), 1, 10);

  INSERT INTO public.organizations (name, slug, created_at, updated_at)
  VALUES (v_name, v_slug, v_now, v_now)
  RETURNING id INTO v_org_id;

  INSERT INTO public.organization_members (organization_id, user_id, role, created_at)
  VALUES (v_org_id, p_user_id, 'owner', v_now);

  RETURN jsonb_build_object(
    'ok', true,
    'organization_id', v_org_id,
    'created', true
  );
END;
$$;

COMMENT ON FUNCTION public.provision_owner_organization_for_checkout(uuid, text) IS
  'Serializes checkout org bootstrap per user; returns existing membership org or creates one owner org.';

REVOKE ALL ON FUNCTION public.provision_owner_organization_for_checkout(uuid, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.provision_owner_organization_for_checkout(uuid, text) TO service_role;
