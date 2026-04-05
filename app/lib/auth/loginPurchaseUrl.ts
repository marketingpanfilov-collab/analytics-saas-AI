/** Slug тарифа для query-параметра `plan` на /login и после редиректа в приложение. */
export const PRICING_PLAN_IDS = ["starter", "growth", "scale"] as const;
export type PricingPlanId = (typeof PRICING_PLAN_IDS)[number];

/** Нормализует slug; legacy `agency` (старое имя тарифа Scale) → `scale`. */
export function parsePricingPlanId(v: string | null | undefined): PricingPlanId | null {
  if (v == null) return null;
  const x = String(v).trim().toLowerCase();
  if (x === "agency") return "scale";
  if ((PRICING_PLAN_IDS as readonly string[]).includes(x)) return x as PricingPlanId;
  return null;
}

export function isValidPricingPlanId(v: string | null): boolean {
  return parsePricingPlanId(v) !== null;
}

export function buildLoginPurchaseHref(planId: PricingPlanId, billing: "monthly" | "yearly"): string {
  const p = new URLSearchParams();
  p.set("plan", planId);
  p.set("billing", billing);
  p.set("signup", "1");
  return `/login?${p.toString()}`;
}

/** Кнопка «Приобрести» в хедере героя — без выбранного тарифа, открываем регистрацию. */
export const LOGIN_PURCHASE_NO_PLAN_HREF = "/login?signup=1";
