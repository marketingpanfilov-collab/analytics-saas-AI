/** Slug тарифа для query-параметра `plan` на /login и после редиректа в приложение. */
export const PRICING_PLAN_IDS = ["starter", "growth", "agency"] as const;
export type PricingPlanId = (typeof PRICING_PLAN_IDS)[number];

export function isValidPricingPlanId(v: string | null): v is PricingPlanId {
  return v != null && (PRICING_PLAN_IDS as readonly string[]).includes(v);
}

export function buildLoginPurchaseHref(planId: PricingPlanId, billing: "monthly" | "yearly"): string {
  const p = new URLSearchParams();
  p.set("plan", planId);
  p.set("billing", billing);
  return `/register?${p.toString()}`;
}

/** Кнопка «Приобрести» в хедере героя — без выбранного тарифа, открываем регистрацию. */
export const LOGIN_PURCHASE_NO_PLAN_HREF = "/register";
