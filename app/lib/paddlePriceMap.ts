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

/** Каталог Paddle: product (`pro_…`) — для customData и учёта; в checkout по-прежнему нужен price id (`pri_…`). */
const PRODUCT_BY_PLAN_AND_BILLING: Record<PricingPlanId, Record<BillingPeriod, string | undefined>> = {
  starter: {
    monthly: process.env.NEXT_PUBLIC_PADDLE_PRODUCT_STARTER,
    yearly: process.env.NEXT_PUBLIC_PADDLE_PRODUCT_STARTER_YEARLY,
  },
  growth: {
    monthly: process.env.NEXT_PUBLIC_PADDLE_PRODUCT_GROWTH,
    yearly: process.env.NEXT_PUBLIC_PADDLE_PRODUCT_GROWTH_YEARLY,
  },
  agency: {
    monthly: process.env.NEXT_PUBLIC_PADDLE_PRODUCT_AGENCY,
    yearly: process.env.NEXT_PUBLIC_PADDLE_PRODUCT_AGENCY_YEARLY,
  },
};

export function getPaddlePriceId(plan: PricingPlanId, billing: BillingPeriod): string | null {
  const planPrices = PRICE_BY_PLAN_AND_BILLING[plan];
  const value = planPrices?.[billing];
  return value && value.trim().length > 0 ? value : null;
}

export function getPaddleProductId(plan: PricingPlanId, billing: BillingPeriod): string | null {
  const row = PRODUCT_BY_PLAN_AND_BILLING[plan];
  const value = row?.[billing];
  return value && value.trim().length > 0 ? value.trim() : null;
}
