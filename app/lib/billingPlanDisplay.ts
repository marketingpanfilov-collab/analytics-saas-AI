import type { PricingPlanId } from "@/app/lib/auth/loginPurchaseUrl";
import type { BillingPeriod } from "@/app/lib/paddlePriceMap";

export const BILLING_PLAN_LABELS: Record<PricingPlanId, string> = {
  starter: "Starter",
  growth: "Growth",
  scale: "Scale",
};

export const BILLING_MONTHLY_USD: Record<PricingPlanId, number> = {
  starter: 39,
  growth: 99,
  scale: 249,
};

export const BILLING_YEARLY_DISCOUNT_PERCENT: Record<PricingPlanId, number> = {
  starter: 10,
  growth: 15,
  scale: 20,
};

export function billingYearlyTotalUsd(plan: PricingPlanId): number {
  const monthly = BILLING_MONTHLY_USD[plan];
  const discountPercent = BILLING_YEARLY_DISCOUNT_PERCENT[plan];
  return Math.round(monthly * 12 * (1 - discountPercent / 100));
}

/** Разница между полной годовой суммой (12× мес) и ценой со скидкой за год. */
export function billingYearlySavingsUsd(plan: PricingPlanId): number {
  const monthly = BILLING_MONTHLY_USD[plan];
  const full = monthly * 12;
  return Math.round(full - billingYearlyTotalUsd(plan));
}

export function formatBillingPriceLabel(plan: PricingPlanId, billing: BillingPeriod): string {
  if (billing === "monthly") return `${BILLING_MONTHLY_USD[plan]} $ / мес`;
  return `${billingYearlyTotalUsd(plan)} $ / год`;
}

/** Next tier for upgrade CTA; Scale stays on Scale; unknown → Growth */
export function suggestUpgradePlanId(
  matrixPlan: PricingPlanId | "unknown" | undefined | null
): PricingPlanId {
  if (matrixPlan === "starter") return "growth";
  if (matrixPlan === "growth") return "scale";
  if (matrixPlan === "scale") return "scale";
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
  starter: "До 3 источников · 1 проект · 1 участник · базовые отчёты",
  growth: "До 10 источников · до 3 проектов · до 10 участников · полный DDA",
  scale: "Расширенные лимиты · API · приоритет",
};
