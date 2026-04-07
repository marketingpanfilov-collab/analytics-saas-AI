"use client";

import type { PricingPlanId } from "@/app/lib/auth/loginPurchaseUrl";
import type { BillingBootstrapApiOk } from "@/app/lib/billingBootstrapClient";
import { resolveBootstrapPlanTier } from "@/app/lib/billingBootstrapPlanLabel";
import type { BillingPeriod } from "@/app/lib/paddlePriceMap";
import {
  isSubscriptionUpgradeAllowed,
  parseBootstrapBillingPeriod,
  parseBootstrapPlanId,
} from "@/app/lib/subscriptionUpgradeEligibility";

/** When `subscription.plan` is unknown (price/env mismatch), use tier from effective_plan / matrix / subscription. */
function planWithBootstrapFallback(
  sub: BillingBootstrapApiOk["subscription"],
  bootstrap: BillingBootstrapApiOk | null | undefined
): PricingPlanId | "unknown" {
  const parsed = parseBootstrapPlanId(sub?.plan);
  if (parsed !== "unknown") return parsed;
  if (!bootstrap) return "unknown";
  return resolveBootstrapPlanTier(bootstrap) ?? "unknown";
}

/** Если API отдал `billing_period: unknown` или нестандартную строку — подставляем период из UI-тоггла (последняя линия защиты). */
function billingWithBootstrapFallback(
  sub: BillingBootstrapApiOk["subscription"],
  billingHint?: BillingPeriod | null
): BillingPeriod | "unknown" {
  const raw = parseBootstrapBillingPeriod((sub as { billing_period?: string }).billing_period);
  if (raw !== "unknown") return raw;
  if (billingHint === "monthly" || billingHint === "yearly") return billingHint;
  return "unknown";
}

export type PaddleUpgradeSource = {
  subscriptionId: string;
  plan: PricingPlanId;
  billing: BillingPeriod;
};

/** Plan + billing from bootstrap when upgrade rules apply, without requiring Paddle `sub_` id. */
export type SubscriptionUpgradeSlice = {
  plan: PricingPlanId;
  billing: BillingPeriod;
};

const UPGRADE_ELIGIBLE_STATUSES = new Set(["active", "trialing", "past_due"]);
const UI_VISIBLE_SUBSCRIPTION_STATUSES = new Set([
  "active",
  "trialing",
  "past_due",
  "paused",
  "grace_past_due",
  "expired",
  "canceled",
  "cancelled",
  "inactive",
]);

export function readPaddleUpgradeSource(
  sub: BillingBootstrapApiOk["subscription"],
  bootstrap?: BillingBootstrapApiOk | null,
  billingHint?: BillingPeriod | null
): PaddleUpgradeSource | null {
  if (!sub) return null;
  const prov = String(sub.provider ?? "").toLowerCase();
  if (prov && prov !== "paddle") return null;
  const id = (sub as { provider_subscription_id?: string | null }).provider_subscription_id;
  if (!id || typeof id !== "string" || !id.startsWith("sub_")) return null;
  const st = String(sub.status ?? "").toLowerCase();
  if (!["active", "trialing", "past_due"].includes(st)) return null;
  const plan = planWithBootstrapFallback(sub, bootstrap);
  const billing = billingWithBootstrapFallback(sub, billingHint);
  if (plan === "unknown" || billing === "unknown") return null;
  return { subscriptionId: id, plan, billing };
}

/**
 * Active subscription with known plan + billing (same status gate as `readPaddleUpgradeSource`),
 * but does not require Paddle customer id / `sub_` — used for UI blocks when `readPaddleUpgradeSource` is null.
 */
export function readSubscriptionUpgradeSlice(
  sub: BillingBootstrapApiOk["subscription"],
  bootstrap?: BillingBootstrapApiOk | null,
  billingHint?: BillingPeriod | null
): SubscriptionUpgradeSlice | null {
  if (!sub) return null;
  const st = String(sub.status ?? "").toLowerCase();
  if (!UPGRADE_ELIGIBLE_STATUSES.has(st)) return null;
  const plan = planWithBootstrapFallback(sub, bootstrap);
  const billing = billingWithBootstrapFallback(sub, billingHint);
  if (plan === "unknown" || billing === "unknown") return null;
  return { plan, billing };
}

/**
 * Plan/billing for UI state (current card + disabled downgrade CTA), including non-active
 * statuses that still represent an existing subscription in shell/paywall screens.
 */
export function readSubscriptionUiSlice(
  sub: BillingBootstrapApiOk["subscription"],
  bootstrap?: BillingBootstrapApiOk | null,
  billingHint?: BillingPeriod | null
): SubscriptionUpgradeSlice | null {
  if (!sub) return null;
  const st = String(sub.status ?? "").toLowerCase();
  if (!UI_VISIBLE_SUBSCRIPTION_STATUSES.has(st)) return null;
  const plan = planWithBootstrapFallback(sub, bootstrap);
  const billing = billingWithBootstrapFallback(sub, billingHint);
  if (plan === "unknown" || billing === "unknown") return null;
  return { plan, billing };
}

export function canUpgradeFromSlice(
  slice: SubscriptionUpgradeSlice,
  targetPlan: PricingPlanId,
  targetBilling: BillingPeriod
): boolean {
  return isSubscriptionUpgradeAllowed(
    { plan: slice.plan, billing: slice.billing },
    { plan: targetPlan, billing: targetBilling }
  ).ok;
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
