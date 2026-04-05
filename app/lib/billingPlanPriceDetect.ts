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

/**
 * Webhook иногда кладёт в snapshot только `product_id` (или price id из другого окружения не совпадает с env).
 * Сначала price id, затем product id — те же env, что в `paddlePriceMap` (NEXT_PUBLIC_PADDLE_PRODUCT_*).
 */
export function detectPlanFromPaddleSnapshot(
  priceId: string | null,
  productId: string | null
): {
  plan: BillingPlanId;
  billing: "monthly" | "yearly" | "unknown";
} {
  const fromPrice = detectPlanFromPriceId(priceId);
  if (fromPrice.plan !== "unknown") return fromPrice;
  const pid = (productId ?? "").trim();
  if (!pid) return fromPrice;
  const pairs: { plan: BillingPlanId; monthly?: string; yearly?: string }[] = [
    {
      plan: "starter",
      monthly: process.env.NEXT_PUBLIC_PADDLE_PRODUCT_STARTER,
      yearly: process.env.NEXT_PUBLIC_PADDLE_PRODUCT_STARTER_YEARLY,
    },
    {
      plan: "growth",
      monthly: process.env.NEXT_PUBLIC_PADDLE_PRODUCT_GROWTH,
      yearly: process.env.NEXT_PUBLIC_PADDLE_PRODUCT_GROWTH_YEARLY,
    },
    {
      plan: "scale",
      monthly: process.env.NEXT_PUBLIC_PADDLE_PRODUCT_AGENCY,
      yearly: process.env.NEXT_PUBLIC_PADDLE_PRODUCT_AGENCY_YEARLY,
    },
  ];
  for (const row of pairs) {
    if (pid === (row.monthly ?? "").trim()) return { plan: row.plan, billing: "monthly" };
    if (pid === (row.yearly ?? "").trim()) return { plan: row.plan, billing: "yearly" };
  }
  return fromPrice;
}
