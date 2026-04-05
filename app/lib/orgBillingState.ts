/**
 * Organization-first billing resolution (entitlements → Paddle customer map → subscriptions).
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import { detectPlanFromPriceId, type BillingPlanId } from "@/app/lib/billingPlanPriceDetect";

const ACTIVE_STATUSES = new Set(["active", "trialing", "past_due"]);

export type EntitlementRow = {
  id: string;
  plan_override: string | null;
  status: string;
  starts_at: string | null;
  ends_at: string | null;
  source: string | null;
  reason: string | null;
  updated_at: string | null;
};

export function pickTimeValidEntitlement(
  rows: EntitlementRow[] | null | undefined,
  nowIso: string
): EntitlementRow | null {
  const nowTs = Date.parse(nowIso);
  for (const e of rows ?? []) {
    const startsAt = e.starts_at ? Date.parse(String(e.starts_at)) : 0;
    const endsAt = e.ends_at ? Date.parse(String(e.ends_at)) : null;
    if (Number.isFinite(startsAt) && nowTs < startsAt) continue;
    if (endsAt != null && Number.isFinite(endsAt) && nowTs > endsAt) continue;
    return e;
  }
  return null;
}

/** Parallel load of org-scoped entitlement rows and Paddle customer ids (single entry point for org billing reads). */
export async function loadOrgBillingState(
  admin: SupabaseClient,
  organizationId: string
): Promise<{
  organizationId: string;
  entitlementsActive: EntitlementRow[];
  paddleCustomerIds: string[];
}> {
  const [entitlementsActive, paddleCustomerIds] = await Promise.all([
    loadActiveEntitlementsForOrganization(admin, organizationId),
    collectPaddleCustomerIdsForOrganization(admin, organizationId),
  ]);
  return { organizationId, entitlementsActive, paddleCustomerIds };
}

export async function loadActiveEntitlementsForOrganization(
  admin: SupabaseClient,
  organizationId: string
): Promise<EntitlementRow[]> {
  const { data, error } = await admin
    .from("billing_entitlements")
    .select("id, plan_override, status, starts_at, ends_at, source, reason, updated_at")
    .eq("organization_id", organizationId)
    .eq("status", "active")
    .order("updated_at", { ascending: false })
    .limit(10);
  if (error) return [];
  return (data ?? []) as EntitlementRow[];
}

export async function resolveActiveEntitlementForBillingContext(
  admin: SupabaseClient,
  nowIso: string,
  billingOrganizationId: string | null
): Promise<EntitlementRow | null> {
  if (!billingOrganizationId) return null;
  const orgRows = await loadActiveEntitlementsForOrganization(admin, billingOrganizationId);
  return pickTimeValidEntitlement(orgRows, nowIso);
}

export async function collectPaddleCustomerIdsForOrganization(
  admin: SupabaseClient,
  organizationId: string
): Promise<string[]> {
  const { data, error } = await admin
    .from("billing_customer_map")
    .select("provider_customer_id")
    .eq("provider", "paddle")
    .eq("organization_id", organizationId)
    .order("updated_at", { ascending: false })
    .limit(20);
  if (error) return [];
  const out: string[] = [];
  for (const r of data ?? []) {
    const id = r?.provider_customer_id != null ? String(r.provider_customer_id) : "";
    if (id) out.push(id);
  }
  return [...new Set(out)];
}

/** Org-scoped Paddle customer ids only (no user-level reads). */
export async function collectPaddleCustomerIdsForBillingContext(
  admin: SupabaseClient,
  billingOrganizationId: string | null
): Promise<string[]> {
  if (!billingOrganizationId) return [];
  return collectPaddleCustomerIdsForOrganization(admin, billingOrganizationId);
}

type SubPickRow = {
  provider_price_id: string | null;
  status: string | null;
  current_period_end: string | null;
  updated_at: string | null;
};

function pickTopSubscriptionRow(list: SubPickRow[]): SubPickRow | null {
  if (!list.length) return null;
  const sorted = [...list].sort((a, b) => {
    const aActive = ACTIVE_STATUSES.has(String(a.status ?? "").toLowerCase()) ? 1 : 0;
    const bActive = ACTIVE_STATUSES.has(String(b.status ?? "").toLowerCase()) ? 1 : 0;
    if (aActive !== bActive) return bActive - aActive;
    const aTs = Date.parse(String(a.current_period_end ?? a.updated_at ?? "")) || 0;
    const bTs = Date.parse(String(b.current_period_end ?? b.updated_at ?? "")) || 0;
    return bTs - aTs;
  });
  return sorted[0] ?? null;
}

/** Resolve plan from Paddle subscription rows (shared by current-plan and org plan resolution). */
export async function resolveBillingPlanFromPaddleCustomerIds(
  admin: SupabaseClient,
  customerIds: string[]
): Promise<BillingPlanId> {
  if (customerIds.length === 0) return "unknown";

  const { data: subs, error: subsErr } = await admin
    .from("billing_subscriptions")
    .select("provider_price_id, status, current_period_end, updated_at")
    .eq("provider", "paddle")
    .in("provider_customer_id", customerIds)
    .order("updated_at", { ascending: false })
    .limit(20);

  if (subsErr || !subs?.length) return "unknown";

  const list = subs as SubPickRow[];
  const top = pickTopSubscriptionRow(list);
  if (!top) return "unknown";

  const topStatus = String(top.status ?? "unknown").toLowerCase();
  const topPeriodEndTs = Date.parse(String(top.current_period_end ?? ""));
  const isExpiredByDate =
    Number.isFinite(topPeriodEndTs) && topStatus !== "canceled" && topStatus !== "inactive"
      ? Date.now() > topPeriodEndTs
      : false;
  if (isExpiredByDate) return "unknown";

  return detectPlanFromPriceId(top.provider_price_id ?? null).plan;
}

/** Effective tariff for an organization: org entitlement → org Paddle customers. */
export async function resolveBillingPlanForOrganization(
  admin: SupabaseClient,
  organizationId: string
): Promise<BillingPlanId> {
  const nowIso = new Date().toISOString();
  const entRows = await loadActiveEntitlementsForOrganization(admin, organizationId);
  const ent = pickTimeValidEntitlement(entRows, nowIso);
  if (ent?.plan_override) {
    const plan = String(ent.plan_override).toLowerCase();
    if (plan === "agency") return "scale";
    if (plan === "starter" || plan === "growth" || plan === "scale") return plan;
  }

  const orgCustomerIds = await collectPaddleCustomerIdsForOrganization(admin, organizationId);
  const paddlePlan = await resolveBillingPlanFromPaddleCustomerIds(admin, orgCustomerIds);
  if (paddlePlan !== "unknown") return paddlePlan;

  return "unknown";
}
