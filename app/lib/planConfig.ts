/**
 * Single server-side feature matrix by plan (§13.7 UX Hardening).
 * UI must not duplicate these numbers; use `plan_feature_matrix` from bootstrap.
 */
import type { BillingPlanId } from "@/app/lib/billingPlan";

export type PlanFeatureMatrix = {
  plan: BillingPlanId | "unknown";
  max_projects: number | null;
  max_seats: number | null;
  max_ad_accounts: number | null;
  /** null = без лимита (Growth / Scale). */
  max_weekly_reports_per_month: number | null;
  ltv_full_history: boolean;
  attribution_heavy: boolean;
  marketing_summary: boolean;
};

/** Лимит мест: null = без лимита. Числа ниже 1 или нечисло → 1 (иначе при limit 0 один участник даёт ложный over-limit). */
export function normalizeMaxSeatsForEnforcement(maxSeats: number | null): number | null {
  if (maxSeats == null) return null;
  const n = Math.floor(Number(maxSeats));
  if (!Number.isFinite(n)) return 1;
  return n < 1 ? 1 : n;
}

function withSeatLimitSafeguards(m: PlanFeatureMatrix): PlanFeatureMatrix {
  return { ...m, max_seats: normalizeMaxSeatsForEnforcement(m.max_seats) };
}

const STARTER: PlanFeatureMatrix = {
  plan: "starter",
  max_projects: 1,
  max_seats: 1,
  max_ad_accounts: 3,
  max_weekly_reports_per_month: 10,
  ltv_full_history: false,
  attribution_heavy: false,
  marketing_summary: true,
};

const GROWTH: PlanFeatureMatrix = {
  plan: "growth",
  max_projects: 3,
  max_seats: 10,
  max_ad_accounts: 10,
  max_weekly_reports_per_month: null,
  ltv_full_history: true,
  attribution_heavy: true,
  marketing_summary: true,
};

/** Feature matrix for тарифа Scale. */
const SCALE: PlanFeatureMatrix = {
  plan: "scale",
  max_projects: null,
  max_seats: null,
  max_ad_accounts: null,
  max_weekly_reports_per_month: null,
  ltv_full_history: true,
  attribution_heavy: true,
  marketing_summary: true,
};

const UNKNOWN: PlanFeatureMatrix = {
  plan: "unknown",
  max_projects: null,
  max_seats: null,
  max_ad_accounts: null,
  max_weekly_reports_per_month: null,
  ltv_full_history: false,
  attribution_heavy: false,
  marketing_summary: false,
};

export function getPlanFeatureMatrix(plan: BillingPlanId | "unknown"): PlanFeatureMatrix {
  switch (plan) {
    case "starter":
      return withSeatLimitSafeguards({ ...STARTER });
    case "growth":
      return withSeatLimitSafeguards({ ...GROWTH });
    case "scale":
      return withSeatLimitSafeguards({ ...SCALE });
    default:
      return withSeatLimitSafeguards({ ...UNKNOWN });
  }
}
