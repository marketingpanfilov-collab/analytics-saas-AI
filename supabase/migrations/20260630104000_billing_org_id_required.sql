-- Organization-first billing: organization_id is mandatory on entitlements, customer map, and subscription snapshots.
-- Re-runs org backfills, dedupes multiple active entitlements per org, then enforces NOT NULL + one-active-per-org.

-- ---------------------------------------------------------------------------
-- 1) Backfill billing_entitlements.organization_id (owner membership → any membership)
-- ---------------------------------------------------------------------------
UPDATE public.billing_entitlements e
SET organization_id = sub.org_id
FROM (
  SELECT e2.id,
    COALESCE(
      (
        SELECT om.organization_id
        FROM public.organization_members om
        WHERE om.user_id = e2.user_id AND om.role = 'owner'
        ORDER BY om.created_at ASC NULLS LAST
        LIMIT 1
      ),
      (
        SELECT om.organization_id
        FROM public.organization_members om
        WHERE om.user_id = e2.user_id
        ORDER BY om.created_at ASC NULLS LAST
        LIMIT 1
      )
    ) AS org_id
  FROM public.billing_entitlements e2
  WHERE e2.organization_id IS NULL AND e2.user_id IS NOT NULL
) sub
WHERE e.id = sub.id AND sub.org_id IS NOT NULL;

-- ---------------------------------------------------------------------------
-- 2) Backfill billing_customer_map.organization_id (user membership → email → auth.users)
-- ---------------------------------------------------------------------------
UPDATE public.billing_customer_map m
SET organization_id = sub.org_id
FROM (
  SELECT m2.id,
    COALESCE(
      (
        SELECT om.organization_id
        FROM public.organization_members om
        WHERE om.user_id = m2.user_id AND om.role = 'owner'
        ORDER BY om.created_at ASC NULLS LAST
        LIMIT 1
      ),
      (
        SELECT om.organization_id
        FROM public.organization_members om
        WHERE om.user_id = m2.user_id
        ORDER BY om.created_at ASC NULLS LAST
        LIMIT 1
      )
    ) AS org_id
  FROM public.billing_customer_map m2
  WHERE m2.organization_id IS NULL AND m2.user_id IS NOT NULL
) sub
WHERE m.id = sub.id AND sub.org_id IS NOT NULL;

UPDATE public.billing_customer_map m
SET organization_id = sub.org_id
FROM (
  SELECT m2.id,
    COALESCE(
      (
        SELECT om.organization_id
        FROM auth.users u
        JOIN public.organization_members om ON om.user_id = u.id AND om.role = 'owner'
        WHERE m2.email IS NOT NULL
          AND trim(m2.email) <> ''
          AND lower(trim(u.email::text)) = lower(trim(m2.email::text))
        ORDER BY om.created_at ASC NULLS LAST
        LIMIT 1
      ),
      (
        SELECT om.organization_id
        FROM auth.users u
        JOIN public.organization_members om ON om.user_id = u.id
        WHERE m2.email IS NOT NULL
          AND trim(m2.email) <> ''
          AND lower(trim(u.email::text)) = lower(trim(m2.email::text))
        ORDER BY om.created_at ASC NULLS LAST
        LIMIT 1
      )
    ) AS org_id
  FROM public.billing_customer_map m2
  WHERE m2.organization_id IS NULL
    AND m2.email IS NOT NULL
    AND trim(m2.email) <> ''
) sub
WHERE m.id = sub.id AND sub.org_id IS NOT NULL;

-- ---------------------------------------------------------------------------
-- 2c) billing_customer_map: organization from latest webhook custom_data (same Paddle customer_id)
-- ---------------------------------------------------------------------------
UPDATE public.billing_customer_map m
SET organization_id = picked.org_id
FROM (
  SELECT DISTINCT ON (m_inner.id)
    m_inner.id AS map_pk,
    org_uuid.org_id
  FROM public.billing_customer_map m_inner
  CROSS JOIN LATERAL (
    SELECT
      COALESCE(
        NULLIF(trim(both ' ' FROM we.payload #>> '{data,custom_data,app_organization_id}'), ''),
        NULLIF(trim(both ' ' FROM we.payload #>> '{data,custom_data,primary_org_id}'), '')
      ) AS org_raw
    FROM public.billing_webhook_events we
    WHERE we.provider = 'paddle'
      AND (
        we.payload #>> '{data,customer_id}' IS NOT DISTINCT FROM m_inner.provider_customer_id
        OR we.payload #>> '{data,customer,id}' IS NOT DISTINCT FROM m_inner.provider_customer_id
      )
    ORDER BY we.received_at DESC NULLS LAST
    LIMIT 1
  ) raw
  CROSS JOIN LATERAL (
    SELECT
      CASE
        WHEN lower(trim(both ' ' FROM raw.org_raw)) ~ '^[0-9a-f-]{36}$'
          THEN lower(trim(both ' ' FROM raw.org_raw))::uuid
        ELSE NULL
      END AS org_id
  ) org_uuid
  WHERE m_inner.organization_id IS NULL
    AND m_inner.provider = 'paddle'
    AND m_inner.provider_customer_id IS NOT NULL
    AND org_uuid.org_id IS NOT NULL
) picked
WHERE m.id = picked.map_pk;

-- ---------------------------------------------------------------------------
-- 3) Subscriptions: copy organization_id from customer map
-- ---------------------------------------------------------------------------
UPDATE public.billing_subscriptions s
SET organization_id = m.organization_id
FROM public.billing_customer_map m
WHERE s.provider = 'paddle'
  AND m.provider = 'paddle'
  AND s.provider_customer_id IS NOT NULL
  AND s.provider_customer_id = m.provider_customer_id
  AND m.organization_id IS NOT NULL
  AND s.organization_id IS NULL;

-- ---------------------------------------------------------------------------
-- 3b) Subscriptions: same provider_customer_id as a row that already has organization_id
-- ---------------------------------------------------------------------------
UPDATE public.billing_subscriptions s
SET organization_id = src.organization_id
FROM (
  SELECT DISTINCT ON (s2.provider_customer_id)
    s2.provider_customer_id AS cid,
    s2.organization_id
  FROM public.billing_subscriptions s2
  WHERE s2.provider = 'paddle'
    AND s2.provider_customer_id IS NOT NULL
    AND s2.organization_id IS NOT NULL
  ORDER BY s2.provider_customer_id, s2.updated_at DESC NULLS LAST
) src
WHERE s.provider = 'paddle'
  AND s.organization_id IS NULL
  AND s.provider_customer_id = src.cid;

-- ---------------------------------------------------------------------------
-- 3c) Subscriptions: organization from webhook payload (match subscription id in event data)
-- ---------------------------------------------------------------------------
UPDATE public.billing_subscriptions s
SET organization_id = picked.org_id
FROM (
  SELECT DISTINCT ON (s_inner.id)
    s_inner.id AS sub_pk,
    org_uuid.org_id
  FROM public.billing_subscriptions s_inner
  CROSS JOIN LATERAL (
    SELECT
      COALESCE(
        NULLIF(trim(both ' ' FROM we.payload #>> '{data,custom_data,app_organization_id}'), ''),
        NULLIF(trim(both ' ' FROM we.payload #>> '{data,custom_data,primary_org_id}'), '')
      ) AS org_raw
    FROM public.billing_webhook_events we
    WHERE we.provider = 'paddle'
      AND (
        we.payload #>> '{data,subscription_id}' IS NOT DISTINCT FROM s_inner.provider_subscription_id
        OR we.payload #>> '{data,id}' IS NOT DISTINCT FROM s_inner.provider_subscription_id
        OR we.payload #>> '{data,subscription,id}' IS NOT DISTINCT FROM s_inner.provider_subscription_id
      )
    ORDER BY we.received_at DESC NULLS LAST
    LIMIT 1
  ) raw
  CROSS JOIN LATERAL (
    SELECT
      CASE
        WHEN lower(trim(both ' ' FROM raw.org_raw)) ~ '^[0-9a-f-]{36}$'
          THEN lower(trim(both ' ' FROM raw.org_raw))::uuid
        ELSE NULL
      END AS org_id
  ) org_uuid
  WHERE s_inner.provider = 'paddle'
    AND s_inner.organization_id IS NULL
    AND org_uuid.org_id IS NOT NULL
) picked
WHERE s.id = picked.sub_pk;

-- ---------------------------------------------------------------------------
-- 3d) billing_customer_map: fill from subscription rows that now have organization_id
-- ---------------------------------------------------------------------------
UPDATE public.billing_customer_map m
SET organization_id = sub.organization_id
FROM (
  SELECT DISTINCT ON (provider_customer_id)
    provider_customer_id,
    organization_id
  FROM public.billing_subscriptions
  WHERE provider = 'paddle'
    AND organization_id IS NOT NULL
    AND provider_customer_id IS NOT NULL
  ORDER BY provider_customer_id, updated_at DESC NULLS LAST
) sub
WHERE m.provider = 'paddle'
  AND m.organization_id IS NULL
  AND m.provider_customer_id = sub.provider_customer_id;

-- ---------------------------------------------------------------------------
-- 3e) Subscriptions again from customer map (after 3d)
-- ---------------------------------------------------------------------------
UPDATE public.billing_subscriptions s
SET organization_id = m.organization_id
FROM public.billing_customer_map m
WHERE s.provider = 'paddle'
  AND m.provider = 'paddle'
  AND s.provider_customer_id IS NOT NULL
  AND s.provider_customer_id = m.provider_customer_id
  AND m.organization_id IS NOT NULL
  AND s.organization_id IS NULL;

-- ---------------------------------------------------------------------------
-- 3f) billing_customer_map: org from webhook payload TEXT (Paddle shape may differ from #>> paths)
-- ---------------------------------------------------------------------------
UPDATE public.billing_customer_map m
SET organization_id = sub.org_id
FROM (
  SELECT
    map.id AS map_id,
    orgs.org_id
  FROM public.billing_customer_map map
  CROSS JOIN LATERAL (
    SELECT
      coalesce(
        (regexp_match(we.payload::text, '"app_organization_id"\s*:\s*"([0-9a-f-]{36})"', 'i'))[1],
        (regexp_match(we.payload::text, '"primary_org_id"\s*:\s*"([0-9a-f-]{36})"', 'i'))[1],
        (regexp_match(we.payload::text, 'app_organization_id[^0-9a-f-]{0,12}([0-9a-f-]{36})', 'i'))[1],
        (regexp_match(we.payload::text, 'primary_org_id[^0-9a-f-]{0,12}([0-9a-f-]{36})', 'i'))[1]
      ) AS org_text
    FROM public.billing_webhook_events we
    WHERE we.provider = 'paddle'
      AND map.organization_id IS NULL
      AND map.provider = 'paddle'
      AND map.provider_customer_id IS NOT NULL
      AND position(map.provider_customer_id in we.payload::text) > 0
    ORDER BY we.received_at DESC NULLS LAST
    LIMIT 1
  ) extracted
  CROSS JOIN LATERAL (
    SELECT
      CASE
        WHEN extracted.org_text IS NOT NULL AND lower(extracted.org_text) ~ '^[0-9a-f-]{36}$'
          THEN lower(extracted.org_text)::uuid
        ELSE NULL
      END AS org_id
  ) orgs
  WHERE map.organization_id IS NULL
    AND orgs.org_id IS NOT NULL
) sub
WHERE m.id = sub.map_id;

-- ---------------------------------------------------------------------------
-- 3g) Subscriptions: org from webhook payload TEXT (subscription id appears anywhere in JSON)
-- ---------------------------------------------------------------------------
UPDATE public.billing_subscriptions s
SET organization_id = sub.org_id
FROM (
  SELECT
    s_inner.id AS sub_pk,
    orgs.org_id
  FROM public.billing_subscriptions s_inner
  CROSS JOIN LATERAL (
    SELECT
      coalesce(
        (regexp_match(we.payload::text, '"app_organization_id"\s*:\s*"([0-9a-f-]{36})"', 'i'))[1],
        (regexp_match(we.payload::text, '"primary_org_id"\s*:\s*"([0-9a-f-]{36})"', 'i'))[1],
        (regexp_match(we.payload::text, 'app_organization_id[^0-9a-f-]{0,12}([0-9a-f-]{36})', 'i'))[1],
        (regexp_match(we.payload::text, 'primary_org_id[^0-9a-f-]{0,12}([0-9a-f-]{36})', 'i'))[1]
      ) AS org_text
    FROM public.billing_webhook_events we
    WHERE we.provider = 'paddle'
      AND s_inner.organization_id IS NULL
      AND s_inner.provider = 'paddle'
      AND position(s_inner.provider_subscription_id in we.payload::text) > 0
    ORDER BY we.received_at DESC NULLS LAST
    LIMIT 1
  ) extracted
  CROSS JOIN LATERAL (
    SELECT
      CASE
        WHEN extracted.org_text IS NOT NULL AND lower(extracted.org_text) ~ '^[0-9a-f-]{36}$'
          THEN lower(extracted.org_text)::uuid
        ELSE NULL
      END AS org_id
  ) orgs
  WHERE s_inner.organization_id IS NULL
    AND orgs.org_id IS NOT NULL
) sub
WHERE s.id = sub.sub_pk;

-- ---------------------------------------------------------------------------
-- 3h) Subscriptions: org from webhook when payload mentions provider_customer_id (no map row / old events)
-- ---------------------------------------------------------------------------
UPDATE public.billing_subscriptions s
SET organization_id = sub.org_id
FROM (
  SELECT
    s_inner.id AS sub_pk,
    orgs.org_id
  FROM public.billing_subscriptions s_inner
  CROSS JOIN LATERAL (
    SELECT
      coalesce(
        (regexp_match(we.payload::text, '"app_organization_id"\s*:\s*"([0-9a-f-]{36})"', 'i'))[1],
        (regexp_match(we.payload::text, '"primary_org_id"\s*:\s*"([0-9a-f-]{36})"', 'i'))[1],
        (regexp_match(we.payload::text, 'app_organization_id[^0-9a-f-]{0,12}([0-9a-f-]{36})', 'i'))[1],
        (regexp_match(we.payload::text, 'primary_org_id[^0-9a-f-]{0,12}([0-9a-f-]{36})', 'i'))[1]
      ) AS org_text
    FROM public.billing_webhook_events we
    WHERE we.provider = 'paddle'
      AND s_inner.organization_id IS NULL
      AND s_inner.provider = 'paddle'
      AND s_inner.provider_customer_id IS NOT NULL
      AND position(s_inner.provider_customer_id in we.payload::text) > 0
    ORDER BY we.received_at DESC NULLS LAST
    LIMIT 1
  ) extracted
  CROSS JOIN LATERAL (
    SELECT
      CASE
        WHEN extracted.org_text IS NOT NULL AND lower(extracted.org_text) ~ '^[0-9a-f-]{36}$'
          THEN lower(extracted.org_text)::uuid
        ELSE NULL
      END AS org_id
  ) orgs
  WHERE s_inner.organization_id IS NULL
    AND orgs.org_id IS NOT NULL
) sub
WHERE s.id = sub.sub_pk;

-- ---------------------------------------------------------------------------
-- 3i) Map ↔ subscriptions sync again after 3f–3h
-- ---------------------------------------------------------------------------
UPDATE public.billing_customer_map m
SET organization_id = sub.organization_id
FROM (
  SELECT DISTINCT ON (provider_customer_id)
    provider_customer_id,
    organization_id
  FROM public.billing_subscriptions
  WHERE provider = 'paddle'
    AND organization_id IS NOT NULL
    AND provider_customer_id IS NOT NULL
  ORDER BY provider_customer_id, updated_at DESC NULLS LAST
) sub
WHERE m.provider = 'paddle'
  AND m.organization_id IS NULL
  AND m.provider_customer_id = sub.provider_customer_id;

UPDATE public.billing_subscriptions s
SET organization_id = m.organization_id
FROM public.billing_customer_map m
WHERE s.provider = 'paddle'
  AND m.provider = 'paddle'
  AND s.provider_customer_id IS NOT NULL
  AND s.provider_customer_id = m.provider_customer_id
  AND m.organization_id IS NOT NULL
  AND s.organization_id IS NULL;

-- ---------------------------------------------------------------------------
-- 3j) billing_customer_map: user_post_checkout_onboarding.organization_id (кто платил за какую org)
-- ---------------------------------------------------------------------------
UPDATE public.billing_customer_map m
SET organization_id = pco.organization_id
FROM public.user_post_checkout_onboarding pco
WHERE m.organization_id IS NULL
  AND m.user_id IS NOT NULL
  AND pco.user_id = m.user_id
  AND pco.organization_id IS NOT NULL;

-- ---------------------------------------------------------------------------
-- 3k) billing_customer_map: любая billing_entitlements строка этого user_id с заполненной org
-- ---------------------------------------------------------------------------
UPDATE public.billing_customer_map m
SET organization_id = sub.org_id
FROM (
  SELECT DISTINCT ON (m2.id)
    m2.id AS map_pk,
    e.organization_id AS org_id
  FROM public.billing_customer_map m2
  INNER JOIN public.billing_entitlements e
    ON e.user_id = m2.user_id AND e.organization_id IS NOT NULL
  WHERE m2.organization_id IS NULL
    AND m2.user_id IS NOT NULL
  ORDER BY m2.id, e.updated_at DESC NULLS LAST
) sub
WHERE m.id = sub.map_pk AND sub.org_id IS NOT NULL;

-- ---------------------------------------------------------------------------
-- 3l) billing_customer_map: project-only пользователи → organization_id проекта
-- ---------------------------------------------------------------------------
UPDATE public.billing_customer_map m
SET organization_id = sub.org_id
FROM (
  SELECT DISTINCT ON (m2.id)
    m2.id AS map_pk,
    p.organization_id AS org_id
  FROM public.billing_customer_map m2
  INNER JOIN public.project_members pm ON pm.user_id = m2.user_id
  INNER JOIN public.projects p
    ON p.id = pm.project_id
    AND p.organization_id IS NOT NULL
    AND coalesce(p.archived, false) = false
  WHERE m2.organization_id IS NULL
    AND m2.user_id IS NOT NULL
  ORDER BY m2.id, p.updated_at DESC NULLS LAST
) sub
WHERE m.id = sub.map_pk AND sub.org_id IS NOT NULL;

-- ---------------------------------------------------------------------------
-- 3m) Снова map ↔ subscriptions после 3j–3l
-- ---------------------------------------------------------------------------
UPDATE public.billing_customer_map m
SET organization_id = sub.organization_id
FROM (
  SELECT DISTINCT ON (provider_customer_id)
    provider_customer_id,
    organization_id
  FROM public.billing_subscriptions
  WHERE provider = 'paddle'
    AND organization_id IS NOT NULL
    AND provider_customer_id IS NOT NULL
  ORDER BY provider_customer_id, updated_at DESC NULLS LAST
) sub
WHERE m.provider = 'paddle'
  AND m.organization_id IS NULL
  AND m.provider_customer_id = sub.provider_customer_id;

UPDATE public.billing_subscriptions s
SET organization_id = m.organization_id
FROM public.billing_customer_map m
WHERE s.provider = 'paddle'
  AND m.provider = 'paddle'
  AND s.provider_customer_id IS NOT NULL
  AND s.provider_customer_id = m.provider_customer_id
  AND m.organization_id IS NOT NULL
  AND s.organization_id IS NULL;

-- ---------------------------------------------------------------------------
-- 3n) Последний шаг: служебная org для строк без источника org (переназначьте вручную при необходимости)
-- ---------------------------------------------------------------------------
INSERT INTO public.organizations (name, slug, created_at, updated_at)
SELECT 'Unassigned billing (migration)', 'billing-orphans-migration', now(), now()
WHERE NOT EXISTS (
  SELECT 1 FROM public.organizations o WHERE o.slug = 'billing-orphans-migration'
);

UPDATE public.billing_customer_map m
SET organization_id = o.id
FROM public.organizations o
WHERE m.organization_id IS NULL
  AND o.slug = 'billing-orphans-migration';

UPDATE public.billing_subscriptions s
SET organization_id = o.id
FROM public.organizations o
WHERE s.organization_id IS NULL
  AND o.slug = 'billing-orphans-migration';

-- ---------------------------------------------------------------------------
-- 4) At most one active entitlement per organization (keep latest by updated_at)
-- ---------------------------------------------------------------------------
UPDATE public.billing_entitlements e
SET
  status = 'revoked',
  updated_at = now()
FROM (
  SELECT id
  FROM (
    SELECT
      id,
      row_number() OVER (
        PARTITION BY organization_id
        ORDER BY updated_at DESC NULLS LAST, created_at DESC NULLS LAST, id
      ) AS rn
    FROM public.billing_entitlements
    WHERE status = 'active' AND organization_id IS NOT NULL
  ) t
  WHERE rn > 1
) dup
WHERE e.id = dup.id;

-- ---------------------------------------------------------------------------
-- 5) Abort if any row still lacks organization_id (inspect and fix manually)
-- ---------------------------------------------------------------------------
DO $$
DECLARE
  n_ent int;
  n_map int;
  n_sub int;
BEGIN
  SELECT count(*)::int INTO n_ent FROM public.billing_entitlements WHERE organization_id IS NULL;
  SELECT count(*)::int INTO n_map FROM public.billing_customer_map WHERE organization_id IS NULL;
  SELECT count(*)::int INTO n_sub FROM public.billing_subscriptions WHERE organization_id IS NULL;

  IF n_ent > 0 OR n_map > 0 OR n_sub > 0 THEN
    RAISE EXCEPTION
      'billing_org_id_required: backfill incomplete — entitlements=%, customer_map=%, subscriptions=%. Sample map ids: [%]. Sample subscription ids: [%]. Fix rows or extend backfill, then re-run migration.',
      n_ent,
      n_map,
      n_sub,
      coalesce(
        (
          SELECT string_agg(m.id::text, ', ' ORDER BY m.id)
          FROM (SELECT id FROM public.billing_customer_map WHERE organization_id IS NULL LIMIT 8) m
        ),
        ''
      ),
      coalesce(
        (
          SELECT string_agg(s.id::text, ', ' ORDER BY s.id)
          FROM (SELECT id FROM public.billing_subscriptions WHERE organization_id IS NULL LIMIT 8) s
        ),
        ''
      );
  END IF;
END $$;

-- ---------------------------------------------------------------------------
-- 6) FK: SET NULL is incompatible with NOT NULL — use CASCADE for org deletes
-- ---------------------------------------------------------------------------
ALTER TABLE public.billing_customer_map
  DROP CONSTRAINT IF EXISTS billing_customer_map_organization_id_fkey;

ALTER TABLE public.billing_subscriptions
  DROP CONSTRAINT IF EXISTS billing_subscriptions_organization_id_fkey;

ALTER TABLE public.billing_entitlements
  ALTER COLUMN organization_id SET NOT NULL;

ALTER TABLE public.billing_customer_map
  ALTER COLUMN organization_id SET NOT NULL;

ALTER TABLE public.billing_subscriptions
  ALTER COLUMN organization_id SET NOT NULL;

ALTER TABLE public.billing_customer_map
  ADD CONSTRAINT billing_customer_map_organization_id_fkey
  FOREIGN KEY (organization_id) REFERENCES public.organizations(id) ON DELETE CASCADE;

ALTER TABLE public.billing_subscriptions
  ADD CONSTRAINT billing_subscriptions_organization_id_fkey
  FOREIGN KEY (organization_id) REFERENCES public.organizations(id) ON DELETE CASCADE;

-- ---------------------------------------------------------------------------
-- 7) One active entitlement per organization
-- ---------------------------------------------------------------------------
CREATE UNIQUE INDEX IF NOT EXISTS idx_billing_entitlements_one_active_per_org
  ON public.billing_entitlements(organization_id)
  WHERE status = 'active';

COMMENT ON COLUMN public.billing_entitlements.organization_id IS
  'Canonical billing scope; required. Plan override applies to the whole organization.';

COMMENT ON COLUMN public.billing_customer_map.organization_id IS
  'Organization that owns this Paddle customer; required.';

COMMENT ON COLUMN public.billing_subscriptions.organization_id IS
  'Organization for this subscription snapshot; required; aligned with billing_customer_map.';
