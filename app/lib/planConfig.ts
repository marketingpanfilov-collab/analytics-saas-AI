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
  ltv_full_history: boolean;
  attribution_heavy: boolean;
  marketing_summary: boolean;
};

const STARTER: PlanFeatureMatrix = {
  plan: "starter",
  max_projects: 3,
  max_seats: 5,
  max_ad_accounts: 10,
  ltv_full_history: false,
  attribution_heavy: false,
  marketing_summary: true,
};

const GROWTH: PlanFeatureMatrix = {
  plan: "growth",
  max_projects: 15,
  max_seats: 25,
  max_ad_accounts: 50,
  ltv_full_history: true,
  attribution_heavy: true,
  marketing_summary: true,
};

const AGENCY: PlanFeatureMatrix = {
  plan: "agency",
  max_projects: null,
  max_seats: null,
  max_ad_accounts: null,
  ltv_full_history: true,
  attribution_heavy: true,
  marketing_summary: true,
};

const UNKNOWN: PlanFeatureMatrix = {
  plan: "unknown",
  max_projects: null,
  max_seats: null,
  max_ad_accounts: null,
  ltv_full_history: false,
  attribution_heavy: false,
  marketing_summary: false,
};

export function getPlanFeatureMatrix(plan: BillingPlanId | "unknown"): PlanFeatureMatrix {
  switch (plan) {
    case "starter":
      return { ...STARTER };
    case "growth":
      return { ...GROWTH };
    case "agency":
      return { ...AGENCY };
    default:
      return { ...UNKNOWN };
  }
}
