-- Organization-first billing: anchor entitlements, customer map, and subscription rows to organizations.
-- user_id on entitlements becomes optional (audit / legacy); canonical plan resolution uses organization_id.

-- 1) billing_entitlements
ALTER TABLE public.billing_entitlements
  ADD COLUMN IF NOT EXISTS organization_id uuid REFERENCES public.organizations(id) ON DELETE CASCADE;

ALTER TABLE public.billing_entitlements
  ALTER COLUMN user_id DROP NOT NULL;

CREATE INDEX IF NOT EXISTS idx_billing_entitlements_organization_id
  ON public.billing_entitlements(organization_id);
CREATE INDEX IF NOT EXISTS idx_billing_entitlements_org_status_updated
  ON public.billing_entitlements(organization_id, status, updated_at DESC)
  WHERE organization_id IS NOT NULL;

COMMENT ON COLUMN public.billing_entitlements.organization_id IS
  'Canonical billing scope; plan override applies to the whole organization.';

-- 2) billing_customer_map
ALTER TABLE public.billing_customer_map
  ADD COLUMN IF NOT EXISTS organization_id uuid REFERENCES public.organizations(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_billing_customer_map_organization_id
  ON public.billing_customer_map(organization_id)
  WHERE organization_id IS NOT NULL;

COMMENT ON COLUMN public.billing_customer_map.organization_id IS
  'Organization that owns this Paddle customer; dual-read falls back to user_id while backfilling.';

-- 3) billing_subscriptions (denormalized link for ops / webhook)
ALTER TABLE public.billing_subscriptions
  ADD COLUMN IF NOT EXISTS organization_id uuid REFERENCES public.organizations(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_billing_subscriptions_organization_id
  ON public.billing_subscriptions(organization_id)
  WHERE organization_id IS NOT NULL;

COMMENT ON COLUMN public.billing_subscriptions.organization_id IS
  'Copied from billing_customer_map when webhook resolves organization.';

-- 4) Post-checkout: optional org context (who paid for which org)
ALTER TABLE public.user_post_checkout_onboarding
  ADD COLUMN IF NOT EXISTS organization_id uuid REFERENCES public.organizations(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_user_post_checkout_organization_id
  ON public.user_post_checkout_onboarding(organization_id)
  WHERE organization_id IS NOT NULL;

-- 5) Audit log: optional org target
ALTER TABLE public.billing_entitlement_audit_log
  ADD COLUMN IF NOT EXISTS target_organization_id uuid REFERENCES public.organizations(id) ON DELETE SET NULL;

-- 6) Backfill organization_id from legacy user_id (best-effort)
-- Entitlements: first organization where user is owner, else first membership.
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

-- Customer map: same strategy
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

-- Subscriptions: inherit from customer map
UPDATE public.billing_subscriptions s
SET organization_id = m.organization_id
FROM public.billing_customer_map m
WHERE s.provider = 'paddle'
  AND m.provider = 'paddle'
  AND s.provider_customer_id = m.provider_customer_id
  AND m.organization_id IS NOT NULL
  AND s.organization_id IS NULL;
