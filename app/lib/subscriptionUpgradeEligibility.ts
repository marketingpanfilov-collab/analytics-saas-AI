import type { PricingPlanId } from "@/app/lib/auth/loginPurchaseUrl";
import type { BillingPeriod } from "@/app/lib/paddlePriceMap";

export type PlanInterval = { plan: PricingPlanId; billing: BillingPeriod };

export type CurrentSubscriptionSlice = {
  plan: PricingPlanId | "unknown";
  billing: BillingPeriod | "unknown";
};

function tier(plan: PricingPlanId | "unknown"): number {
  if (plan === "starter") return 0;
  if (plan === "growth") return 1;
  if (plan === "scale") return 2;
  return -1;
}

/**
 * BoardIQ: только апгрейд плана и monthly→yearly внутри того же плана.
 * Даунгрейд и year→month запрещены.
 */
export function isSubscriptionUpgradeAllowed(
  current: CurrentSubscriptionSlice,
  target: PlanInterval
): { ok: true } | { ok: false; reason: string } {
  const ct = tier(current.plan);
  const tt = tier(target.plan);
  if (current.plan === "unknown" || current.billing === "unknown") {
    return { ok: false, reason: "unknown_current" };
  }
  if (tt < 0 || ct < 0) return { ok: false, reason: "invalid_plan" };

  if (target.billing === "monthly" && current.billing === "yearly") {
    return { ok: false, reason: "year_to_month_forbidden" };
  }

  if (current.plan === target.plan && current.billing === target.billing) {
    return { ok: false, reason: "no_change" };
  }

  if (tt > ct) return { ok: true };

  if (tt === ct) {
    if (current.plan === target.plan && current.billing === "monthly" && target.billing === "yearly") {
      return { ok: true };
    }
    return { ok: false, reason: "same_tier_not_allowed" };
  }

  return { ok: false, reason: "downgrade_forbidden" };
}

export function parseBootstrapBillingPeriod(v: string | undefined | null): BillingPeriod | "unknown" {
  const x = String(v ?? "")
    .trim()
    .toLowerCase();
  if (!x || x === "unknown") return "unknown";
  if (x === "monthly" || x === "month" || x === "mo") return "monthly";
  if (x === "yearly" || x === "year" || x === "annual" || x === "annually" || x === "yr") return "yearly";
  return "unknown";
}

export function parseBootstrapPlanId(v: string | undefined | null): PricingPlanId | "unknown" {
  const x = String(v ?? "").toLowerCase();
  if (x === "agency") return "scale";
  if (x === "starter" || x === "growth" || x === "scale") return x;
  return "unknown";
}
