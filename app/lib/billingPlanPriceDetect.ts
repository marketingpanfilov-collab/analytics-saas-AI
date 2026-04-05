/** Price id → plan (no DB); shared by billingPlan, orgBillingState, billingCurrentPlan. */

export type BillingPlanId = "starter" | "growth" | "scale" | "unknown";

export function detectPlanFromPriceId(priceId: string | null): {
  plan: BillingPlanId;
  billing: "monthly" | "yearly" | "unknown";
} {
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
  if (id === m.agencyMonthly) return { plan: "scale", billing: "monthly" };
  if (id === m.agencyYearly) return { plan: "scale", billing: "yearly" };
  return { plan: "unknown", billing: "unknown" };
}
