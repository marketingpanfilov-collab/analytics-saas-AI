"use client";

import type { PricingPlanId } from "@/app/lib/auth/loginPurchaseUrl";
import type { BillingBootstrapApiOk } from "@/app/lib/billingBootstrapClient";
import type { BillingPeriod } from "@/app/lib/paddlePriceMap";
import {
  isSubscriptionUpgradeAllowed,
  parseBootstrapBillingPeriod,
  parseBootstrapPlanId,
} from "@/app/lib/subscriptionUpgradeEligibility";

export type PaddleUpgradeSource = {
  subscriptionId: string;
  plan: PricingPlanId;
  billing: BillingPeriod;
};

export function readPaddleUpgradeSource(
  sub: BillingBootstrapApiOk["subscription"]
): PaddleUpgradeSource | null {
  if (!sub || String(sub.provider) !== "paddle") return null;
  const id = (sub as { provider_subscription_id?: string | null }).provider_subscription_id;
  if (!id || typeof id !== "string" || !id.startsWith("sub_")) return null;
  const st = String(sub.status ?? "").toLowerCase();
  if (!["active", "trialing", "past_due"].includes(st)) return null;
  const plan = parseBootstrapPlanId(sub.plan);
  const billing = parseBootstrapBillingPeriod((sub as { billing_period?: string }).billing_period);
  if (plan === "unknown" || billing === "unknown") return null;
  return { subscriptionId: id, plan, billing };
}

export function canUpgradeTo(
  src: PaddleUpgradeSource,
  targetPlan: PricingPlanId,
  targetBilling: BillingPeriod
): boolean {
  return isSubscriptionUpgradeAllowed(
    { plan: src.plan, billing: src.billing },
    { plan: targetPlan, billing: targetBilling }
  ).ok;
}
