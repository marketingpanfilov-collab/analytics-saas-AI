import type { PricingPlanId } from "./auth/loginPurchaseUrl";

export type BillingPeriod = "monthly" | "yearly";

const PRICE_BY_PLAN_AND_BILLING: Record<PricingPlanId, Record<BillingPeriod, string | undefined>> = {
  starter: {
    monthly: process.env.NEXT_PUBLIC_PADDLE_PRICE_STARTER,
    yearly: process.env.NEXT_PUBLIC_PADDLE_PRICE_STARTER_YEARLY,
  },
  growth: {
    monthly: process.env.NEXT_PUBLIC_PADDLE_PRICE_GROWTH,
    yearly: process.env.NEXT_PUBLIC_PADDLE_PRICE_GROWTH_YEARLY,
  },
  agency: {
    monthly: process.env.NEXT_PUBLIC_PADDLE_PRICE_AGENCY,
    yearly: process.env.NEXT_PUBLIC_PADDLE_PRICE_AGENCY_YEARLY,
  },
};

export function getPaddlePriceId(plan: PricingPlanId, billing: BillingPeriod): string | null {
  const planPrices = PRICE_BY_PLAN_AND_BILLING[plan];
  const value = planPrices?.[billing];
  return value && value.trim().length > 0 ? value : null;
}
