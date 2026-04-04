import type { PricingPlanId } from "@/app/lib/auth/loginPurchaseUrl";
import type { BillingPeriod } from "@/app/lib/paddlePriceMap";

export const BILLING_PLAN_LABELS: Record<PricingPlanId, string> = {
  starter: "Starter",
  growth: "Growth",
  agency: "Agency",
};

export const BILLING_MONTHLY_USD: Record<PricingPlanId, number> = {
  starter: 39,
  growth: 99,
  agency: 249,
};

export const BILLING_YEARLY_DISCOUNT_PERCENT: Record<PricingPlanId, number> = {
  starter: 10,
  growth: 15,
  agency: 20,
};

export function billingYearlyTotalUsd(plan: PricingPlanId): number {
  const monthly = BILLING_MONTHLY_USD[plan];
  const discountPercent = BILLING_YEARLY_DISCOUNT_PERCENT[plan];
  return Math.round(monthly * 12 * (1 - discountPercent / 100));
}

export function formatBillingPriceLabel(plan: PricingPlanId, billing: BillingPeriod): string {
  if (billing === "monthly") return `${BILLING_MONTHLY_USD[plan]} $ / мес`;
  return `${billingYearlyTotalUsd(plan)} $ / год`;
}

/** Next tier for upgrade CTA; Agency stays on Agency; unknown → Growth */
export function suggestUpgradePlanId(
  matrixPlan: PricingPlanId | "unknown" | undefined | null
): PricingPlanId {
  if (matrixPlan === "starter") return "growth";
  if (matrixPlan === "growth") return "agency";
  if (matrixPlan === "agency") return "agency";
  return "growth";
}

export function defaultInlinePlanId(
  matrixPlan: PricingPlanId | "unknown" | undefined | null
): PricingPlanId {
  return suggestUpgradePlanId(matrixPlan);
}

export function recommendedInlinePlanId(
  matrixPlan: PricingPlanId | "unknown" | undefined | null
): PricingPlanId {
  return suggestUpgradePlanId(matrixPlan);
}

export const INLINE_PLAN_TAGLINE: Record<PricingPlanId, string> = {
  starter: "До 3 источников · 1 проект · базовые отчёты",
  growth: "До 10 источников · до 3 проектов · полный DDA",
  agency: "Расширенные лимиты · API · приоритет",
};
