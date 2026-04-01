/**
 * Resolve subscription plan (Starter / Growth / Agency) for TTL and entitlements.
 * Mirrors logic in /api/billing/current-plan — keep in sync when changing Paddle price env vars.
 */
import type { SupabaseClient } from "@supabase/supabase-js";

export type BillingPlanId = "starter" | "growth" | "agency" | "unknown";

const ACTIVE_STATUSES = new Set(["active", "trialing", "past_due"]);

export function detectPlanFromPriceId(priceId: string | null): { plan: BillingPlanId; billing: "monthly" | "yearly" | "unknown" } {
  if (!priceId) return { plan: "unknown", billing: "unknown" };
  const id = priceId.trim();
  const m = {
    starterMonthly: process.env.NEXT_PUBLIC_PADDLE_PRICE_STARTER,
    starterYearly: process.env.NEXT_PUBLIC_PADDLE_PRICE_STARTER_YEARLY,
    growthMonthly: process.env.NEXT_PUBLIC_PADDLE_PRICE_GROWTH,
    growthYearly: process.env.NEXT_PUBLIC_PADDLE_PRICE_GROWTH_YEARLY,
    agencyMonthly: process.env.NEXT_PUBLIC_PADDLE_PRICE_AGENCY,
    agencyYearly: process.env.NEXT_PUBLIC_PADDLE_PRICE_AGENCY_YEARLY,
  };
  if (id === m.starterMonthly) return { plan: "starter", billing: "monthly" };
  if (id === m.starterYearly) return { plan: "starter", billing: "yearly" };
  if (id === m.growthMonthly) return { plan: "growth", billing: "monthly" };
  if (id === m.growthYearly) return { plan: "growth", billing: "yearly" };
  if (id === m.agencyMonthly) return { plan: "agency", billing: "monthly" };
  if (id === m.agencyYearly) return { plan: "agency", billing: "yearly" };
  return { plan: "unknown", billing: "unknown" };
}

/**
 * Active plan for dashboard freshness TTL. Entitlements override Paddle snapshot.
 */
export async function resolveBillingPlanForUser(
  admin: SupabaseClient,
  userId: string,
  email: string | null
): Promise<BillingPlanId> {
  const nowIso = new Date().toISOString();
  const { data: entitlements } = await admin
    .from("billing_entitlements")
    .select("plan_override, status, starts_at, ends_at, updated_at")
    .eq("user_id", userId)
    .eq("status", "active")
    .order("updated_at", { ascending: false })
    .limit(10);

  const activeEntitlement = (entitlements ?? []).find((e: { starts_at?: string | null; ends_at?: string | null }) => {
    const startsAt = e.starts_at ? Date.parse(String(e.starts_at)) : 0;
    const endsAt = e.ends_at ? Date.parse(String(e.ends_at)) : null;
    const nowTs = Date.parse(nowIso);
    if (Number.isFinite(startsAt) && nowTs < startsAt) return false;
    if (endsAt != null && Number.isFinite(endsAt) && nowTs > endsAt) return false;
    return true;
  });
  if (activeEntitlement?.plan_override) {
    const plan = String(activeEntitlement.plan_override).toLowerCase();
    if (plan === "starter" || plan === "growth" || plan === "agency") return plan as BillingPlanId;
  }

  const customerIds = new Set<string>();
  const { data: byUser } = await admin
    .from("billing_customer_map")
    .select("provider_customer_id")
    .eq("provider", "paddle")
    .eq("user_id", userId)
    .order("updated_at", { ascending: false })
    .limit(5);
  for (const r of byUser ?? []) {
    if (r.provider_customer_id) customerIds.add(String(r.provider_customer_id));
  }

  const em = (email ?? "").trim().toLowerCase();
  if (customerIds.size === 0 && em) {
    const { data: byEmail } = await admin
      .from("billing_customer_map")
      .select("provider_customer_id")
      .eq("provider", "paddle")
      .eq("email", em)
      .order("updated_at", { ascending: false })
      .limit(5);
    for (const r of byEmail ?? []) {
      if (r.provider_customer_id) customerIds.add(String(r.provider_customer_id));
    }
  }

  if (customerIds.size === 0) return "unknown";

  const ids = Array.from(customerIds);
  const { data: subs, error: subsErr } = await admin
    .from("billing_subscriptions")
    .select(
      "provider_price_id, status, current_period_end, updated_at"
    )
    .eq("provider", "paddle")
    .in("provider_customer_id", ids)
    .order("updated_at", { ascending: false })
    .limit(20);

  if (subsErr || !subs?.length) return "unknown";

  const list = subs as Array<{
    provider_price_id: string | null;
    status: string | null;
    current_period_end: string | null;
    updated_at: string | null;
  }>;

  const activeFirst = [...list].sort((a, b) => {
    const aActive = ACTIVE_STATUSES.has(String(a.status ?? "").toLowerCase()) ? 1 : 0;
    const bActive = ACTIVE_STATUSES.has(String(b.status ?? "").toLowerCase()) ? 1 : 0;
    if (aActive !== bActive) return bActive - aActive;
    const aTs = Date.parse(String(a.current_period_end ?? a.updated_at ?? "")) || 0;
    const bTs = Date.parse(String(b.current_period_end ?? b.updated_at ?? "")) || 0;
    return bTs - aTs;
  });

  const top = activeFirst[0]!;
  const topStatus = String(top.status ?? "unknown").toLowerCase();
  const topPeriodEndTs = Date.parse(String(top.current_period_end ?? ""));
  const isExpiredByDate =
    Number.isFinite(topPeriodEndTs) && topStatus !== "canceled" && topStatus !== "inactive"
      ? Date.now() > topPeriodEndTs
      : false;
  if (isExpiredByDate) return "unknown";

  return detectPlanFromPriceId(top.provider_price_id ?? null).plan;
}
