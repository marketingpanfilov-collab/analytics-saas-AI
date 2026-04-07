/** Price id → plan (no DB); shared by billingPlan, orgBillingState, billingCurrentPlan. */

export type BillingPlanId = "starter" | "growth" | "scale" | "unknown";

function normId(s: string | null | undefined): string {
  return String(s ?? "").trim();
}

export function detectPlanFromPriceId(priceId: string | null): {
  plan: BillingPlanId;
  billing: "monthly" | "yearly" | "unknown";
} {
  if (!priceId) return { plan: "unknown", billing: "unknown" };
  const id = normId(priceId);
  if (!id) return { plan: "unknown", billing: "unknown" };
  const pairs: { env: string | undefined; plan: BillingPlanId; billing: "monthly" | "yearly" }[] = [
    { env: process.env.NEXT_PUBLIC_PADDLE_PRICE_STARTER, plan: "starter", billing: "monthly" },
    { env: process.env.NEXT_PUBLIC_PADDLE_PRICE_STARTER_YEARLY, plan: "starter", billing: "yearly" },
    { env: process.env.NEXT_PUBLIC_PADDLE_PRICE_GROWTH, plan: "growth", billing: "monthly" },
    { env: process.env.NEXT_PUBLIC_PADDLE_PRICE_GROWTH_YEARLY, plan: "growth", billing: "yearly" },
    { env: process.env.NEXT_PUBLIC_PADDLE_PRICE_AGENCY, plan: "scale", billing: "monthly" },
    { env: process.env.NEXT_PUBLIC_PADDLE_PRICE_AGENCY_YEARLY, plan: "scale", billing: "yearly" },
  ];
  const idLower = id.toLowerCase();
  for (const { env, plan, billing } of pairs) {
    const e = normId(env);
    if (!e) continue;
    if (id === e || idLower === e.toLowerCase()) return { plan, billing };
  }
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
  const pid = normId(productId);
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
  const pidLower = pid.toLowerCase();
  for (const row of pairs) {
    const m = normId(row.monthly);
    const y = normId(row.yearly);
    if (m && (pid === m || pidLower === m.toLowerCase())) return { plan: row.plan, billing: "monthly" };
    if (y && (pid === y || pidLower === y.toLowerCase())) return { plan: row.plan, billing: "yearly" };
  }
  return fromPrice;
}
