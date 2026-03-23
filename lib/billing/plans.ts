export type BillingPeriod = "monthly" | "yearly";
export type BillingPlanId = "starter" | "growth" | "agency";

export const PLAN_PRICE_MAP: Record<BillingPlanId, Record<BillingPeriod, string>> = {
  starter: {
    monthly: process.env.NEXT_PUBLIC_PADDLE_PRICE_STARTER ?? "",
    yearly: process.env.NEXT_PUBLIC_PADDLE_PRICE_STARTER_YEARLY ?? "",
  },
  growth: {
    monthly: process.env.NEXT_PUBLIC_PADDLE_PRICE_GROWTH ?? "",
    yearly: process.env.NEXT_PUBLIC_PADDLE_PRICE_GROWTH_YEARLY ?? "",
  },
  agency: {
    monthly: process.env.NEXT_PUBLIC_PADDLE_PRICE_AGENCY ?? "",
    yearly: process.env.NEXT_PUBLIC_PADDLE_PRICE_AGENCY_YEARLY ?? "",
  },
};

const PLAN_ALIASES: Record<string, BillingPlanId> = {
  starter: "starter",
  growth: "growth",
  pro: "growth",
  agency: "agency",
  business: "agency",
};

export function normalizePlanId(plan: string | null): BillingPlanId | null {
  if (!plan) return null;
  return PLAN_ALIASES[plan.toLowerCase()] ?? null;
}

export function getPriceIdByPlan(plan: string | null, billing: BillingPeriod = "monthly") {
  const normalized = normalizePlanId(plan);
  if (!normalized) return null;
  const priceId = PLAN_PRICE_MAP[normalized]?.[billing];
  return priceId || null;
}
