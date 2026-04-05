import type { SupabaseClient } from "@supabase/supabase-js";
import type { PricingPlanId } from "@/app/lib/auth/loginPurchaseUrl";
import { detectPlanFromPriceId } from "@/app/lib/billingPlanPriceDetect";
import { getAccessibleProjectIds, resolveBillingOrganizationId } from "@/app/lib/billingOrganizationContext";
import { collectPaddleCustomerIdsForBillingContext } from "@/app/lib/orgBillingState";
import type { BillingPeriod } from "@/app/lib/paddlePriceMap";

const ACTIVE_STATUSES = new Set(["active", "trialing", "past_due"]);

type SubRow = {
  provider_subscription_id: string;
  provider_customer_id: string | null;
  provider_price_id: string | null;
  status: string | null;
  current_period_end: string | null;
  updated_at: string | null;
};

function pickTopSubscription(list: SubRow[]): SubRow | null {
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

export type PaddleSubscriptionUpgradeContext = {
  provider_subscription_id: string;
  provider_customer_id: string | null;
  provider_price_id: string | null;
  status: string;
  plan: PricingPlanId | "unknown";
  billing: BillingPeriod | "unknown";
};

/**
 * Активная Paddle-подписка организации (org customer map + dual-read fallback).
 */
export async function loadPaddleSubscriptionUpgradeContext(
  admin: SupabaseClient,
  userId: string,
  email: string | null,
  options?: { projectId?: string | null }
): Promise<PaddleSubscriptionUpgradeContext | null> {
  const projectIds = await getAccessibleProjectIds(admin, userId);
  const billingOrgId = await resolveBillingOrganizationId(
    admin,
    userId,
    options?.projectId ?? null,
    projectIds
  );
  const customerIds = await collectPaddleCustomerIdsForBillingContext(admin, billingOrgId);
  if (!customerIds.length) return null;

  const { data: subs, error } = await admin
    .from("billing_subscriptions")
    .select(
      "provider_subscription_id, provider_customer_id, provider_price_id, status, current_period_end, updated_at"
    )
    .eq("provider", "paddle")
    .in("provider_customer_id", customerIds)
    .order("updated_at", { ascending: false })
    .limit(20);

  if (error || !subs?.length) return null;

  const top = pickTopSubscription(subs as SubRow[]);
  if (!top?.provider_subscription_id) return null;

  const st = String(top.status ?? "").toLowerCase();
  if (!ACTIVE_STATUSES.has(st)) return null;

  const meta = detectPlanFromPriceId(top.provider_price_id ?? null);
  return {
    provider_subscription_id: top.provider_subscription_id,
    provider_customer_id: top.provider_customer_id,
    provider_price_id: top.provider_price_id,
    status: st,
    plan: meta.plan,
    billing: meta.billing,
  };
}
