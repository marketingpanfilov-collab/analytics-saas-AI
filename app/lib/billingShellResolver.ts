/**
 * Priority resolver for shell UI (UX Hardening §28 + §2.3 + §13.1).
 * Billing-critical states always dominate pending_plan_change.
 * Branch order: billing/access_state and product gates before org/project membership edges (P0-LOG-01).
 */
import type { AccessState } from "@/app/lib/accessState";
import {
  ActionId,
  CtaKey,
  ReasonCode,
  RESOLVED_UI_CONTRACT_VERSION,
  ScreenId,
  type ResolvedUiStateV1,
} from "@/app/lib/billingUiContract";

function isGreenForPlanChangeOverlay(access: AccessState): boolean {
  return access === "active" || access === "trialing" || access === "canceled_until_end";
}

function paidLike(access: AccessState): boolean {
  return (
    access === "active" ||
    access === "trialing" ||
    access === "canceled_until_end" ||
    access === "grace_past_due" ||
    access === "past_due"
  );
}

function firstOverLimitReason(
  violations: NonNullable<ResolvedUiStateV1["over_limit_details"]>
): ReasonCode {
  const t = violations[0]?.type;
  if (t === "seats") return ReasonCode.OVER_LIMIT_SEATS;
  if (t === "ad_accounts") return ReasonCode.OVER_LIMIT_AD_ACCOUNTS;
  return ReasonCode.OVER_LIMIT_PROJECTS;
}

export type InvitePendingShell = "none" | "waiting" | "timeout";

export function resolveBillingShell(input: {
  access_state: AccessState;
  requires_post_checkout_onboarding: boolean;
  invite_pending: InvitePendingShell;
  has_org_membership: boolean;
  has_any_accessible_project: boolean;
  pending_plan_change_db: boolean;
  over_limit_violations: NonNullable<ResolvedUiStateV1["over_limit_details"]>;
  demo_mode: boolean;
  request_id: string;
}): ResolvedUiStateV1 {
  const base = {
    version: RESOLVED_UI_CONTRACT_VERSION,
    request_id: input.request_id,
    intended_route: null as string | null,
  };

  if (input.demo_mode) {
    return {
      ...base,
      screen: ScreenId.DEMO_SHELL,
      reason: ReasonCode.BILLING_DEMO_MODE,
      cta: null,
      allowed_actions: [ActionId.navigate_app, ActionId.navigate_settings],
      blocking_level: "soft",
      pending_plan_change: false,
      data_state_default: "EMPTY",
    };
  }

  if (input.requires_post_checkout_onboarding) {
    return {
      ...base,
      screen: ScreenId.POST_CHECKOUT_MODAL,
      reason: ReasonCode.POST_CHECKOUT_REQUIRED,
      cta: null,
      allowed_actions: [],
      blocking_level: "hard",
      pending_plan_change: false,
    };
  }

  if (input.invite_pending === "timeout") {
    return {
      ...base,
      screen: ScreenId.INVITE_FALLBACK,
      reason: ReasonCode.INVITE_TIMEOUT,
      cta: CtaKey.retry_bootstrap,
      allowed_actions: [ActionId.retry_bootstrap, ActionId.support, ActionId.sign_out],
      blocking_level: "hard",
      pending_plan_change: false,
    };
  }

  if (input.invite_pending === "waiting") {
    return {
      ...base,
      screen: ScreenId.INVITE_LOADING,
      reason: ReasonCode.INVITE_PENDING,
      cta: null,
      allowed_actions: [],
      blocking_level: "hard",
      pending_plan_change: false,
    };
  }

  if (input.access_state === "no_subscription") {
    return {
      ...base,
      screen: ScreenId.PAYWALL,
      reason: ReasonCode.BILLING_NO_SUBSCRIPTION,
      cta: CtaKey.subscribe,
      allowed_actions: [ActionId.billing_checkout, ActionId.sign_out, ActionId.navigate_settings],
      blocking_level: "hard",
      pending_plan_change: false,
    };
  }

  if (input.access_state === "refunded") {
    return {
      ...base,
      screen: ScreenId.BILLING_REFUNDED,
      reason: ReasonCode.BILLING_REFUNDED,
      cta: CtaKey.support,
      allowed_actions: [ActionId.support, ActionId.sign_out],
      blocking_level: "hard",
      pending_plan_change: false,
    };
  }

  if (input.access_state === "unpaid" || input.access_state === "expired") {
    return {
      ...base,
      screen: ScreenId.READ_ONLY_SHELL,
      reason:
        input.access_state === "expired" ? ReasonCode.BILLING_EXPIRED : ReasonCode.BILLING_UNPAID,
      cta: CtaKey.subscribe,
      allowed_actions: [
        ActionId.navigate_app,
        ActionId.navigate_settings,
        ActionId.navigate_projects,
        ActionId.billing_manage,
      ],
      blocking_level: "soft",
      pending_plan_change: false,
      data_state_default: "BLOCKED",
    };
  }

  if (input.access_state === "past_due") {
    return {
      ...base,
      screen: ScreenId.DASHBOARD,
      reason: ReasonCode.BILLING_PAST_DUE,
      cta: null,
      allowed_actions: [
        ActionId.navigate_app,
        ActionId.navigate_settings,
        ActionId.navigate_projects,
        ActionId.billing_manage,
        ActionId.sync_refresh,
      ],
      blocking_level: "soft",
      pending_plan_change: false,
    };
  }

  if (input.access_state === "grace_past_due") {
    return {
      ...base,
      screen: ScreenId.DASHBOARD,
      reason: ReasonCode.BILLING_GRACE,
      cta: null,
      allowed_actions: [
        ActionId.navigate_app,
        ActionId.navigate_settings,
        ActionId.navigate_projects,
        ActionId.billing_manage,
        ActionId.sync_refresh,
      ],
      blocking_level: "soft",
      pending_plan_change: false,
    };
  }

  if (input.access_state === "paused") {
    return {
      ...base,
      screen: ScreenId.READ_ONLY_SHELL,
      reason: ReasonCode.BILLING_UNPAID,
      cta: CtaKey.support,
      allowed_actions: [ActionId.navigate_settings, ActionId.billing_manage, ActionId.support],
      blocking_level: "soft",
      pending_plan_change: false,
    };
  }

  if (input.over_limit_violations.length > 0) {
    return {
      ...base,
      screen: ScreenId.OVER_LIMIT_FULLSCREEN,
      reason: firstOverLimitReason(input.over_limit_violations),
      cta: CtaKey.upgrade,
      allowed_actions: [ActionId.billing_manage, ActionId.navigate_settings, ActionId.support],
      blocking_level: "hard",
      pending_plan_change: false,
      over_limit_details: input.over_limit_violations,
    };
  }

  if (!input.has_org_membership) {
    return {
      ...base,
      screen: ScreenId.NO_ORG_ACCESS,
      reason: ReasonCode.NO_ACCESS_TO_ORG,
      cta: CtaKey.support,
      allowed_actions: [ActionId.support, ActionId.sign_out, ActionId.retry_bootstrap],
      blocking_level: "hard",
      pending_plan_change: false,
    };
  }

  if (paidLike(input.access_state) && !input.has_any_accessible_project) {
    return {
      ...base,
      screen: ScreenId.NO_PROJECT,
      reason: ReasonCode.PAID_NO_PROJECT,
      cta: CtaKey.create_project,
      allowed_actions: [
        ActionId.create_project,
        ActionId.navigate_settings,
        ActionId.billing_manage,
        ActionId.navigate_app,
      ],
      blocking_level: "soft",
      pending_plan_change: false,
    };
  }

  if (input.has_org_membership && !input.has_any_accessible_project) {
    return {
      ...base,
      screen: ScreenId.NO_ACCESS,
      reason: ReasonCode.NO_ACTIVE_PROJECT,
      cta: CtaKey.support,
      allowed_actions: [ActionId.navigate_projects, ActionId.navigate_settings, ActionId.support],
      blocking_level: "soft",
      pending_plan_change: false,
    };
  }

  const pendingEffective =
    input.pending_plan_change_db &&
    isGreenForPlanChangeOverlay(input.access_state);

  if (pendingEffective) {
    return {
      ...base,
      screen: ScreenId.DASHBOARD,
      reason: ReasonCode.PLAN_CHANGE_PENDING,
      cta: CtaKey.retry_bootstrap,
      allowed_actions: [
        ActionId.navigate_app,
        ActionId.navigate_settings,
        ActionId.retry_bootstrap,
      ],
      blocking_level: "soft",
      pending_plan_change: true,
    };
  }

  return {
    ...base,
    screen: ScreenId.DASHBOARD,
    reason: ReasonCode.OK,
    cta: null,
    allowed_actions: [ActionId.wildcard],
    blocking_level: "none",
    pending_plan_change: false,
  };
}
