/**
 * Unified product access_state for UI and API (BoardIQ billing lifecycle).
 * Derived from Paddle snapshot + entitlements, not stored redundantly in DB.
 */

export type AccessState =
  | "no_subscription"
  | "active"
  | "trialing"
  | "past_due"
  | "grace_past_due"
  | "unpaid"
  | "paused"
  | "canceled_until_end"
  | "expired"
  | "refunded";

export type EffectivePlan = "starter" | "growth" | "agency" | null;

export type SubscriptionLike = {
  status: string;
  plan: string;
  canceled_at?: string | null;
  current_period_end?: string | null;
  last_event_type?: string | null;
  /** When set and in the future, past_due maps to grace_past_due (product layer). */
  grace_until?: string | null;
};

const ACTIVE_LIKE = new Set(["active", "trialing", "past_due"]);

/**
 * Maps provider subscription row (+ computed expired flag) to access_state.
 * Entitlement-only subscriptions should pass status "active" and plan from override.
 */
export function resolveAccessState(
  subscription: SubscriptionLike | null,
  options?: { isEntitlement?: boolean; isExpiredByPeriodEnd?: boolean }
): AccessState {
  if (!subscription) return "no_subscription";

  const status = String(subscription.status ?? "unknown").toLowerCase();
  const isEntitlement = options?.isEntitlement === true;
  const expiredByDate = options?.isExpiredByPeriodEnd === true;

  if (isEntitlement && status === "active") return "active";

  const lastEv = String(subscription.last_event_type ?? "").toLowerCase();
  if (lastEv.includes("refund") || status === "refunded") return "refunded";

  if (expiredByDate && status !== "canceled" && status !== "inactive") {
    return "expired";
  }

  switch (status) {
    case "trialing":
      return "trialing";
    case "active":
      return "active";
    case "past_due": {
      const gu = subscription.grace_until ? Date.parse(String(subscription.grace_until)) : NaN;
      if (Number.isFinite(gu) && Date.now() < gu) return "grace_past_due";
      return "past_due";
    }
    case "unpaid":
      return "unpaid";
    case "paused":
      return "paused";
    case "canceled":
    case "cancelled": {
      const endTs = subscription.current_period_end
        ? Date.parse(String(subscription.current_period_end))
        : NaN;
      if (Number.isFinite(endTs) && Date.now() <= endTs) return "canceled_until_end";
      return "expired";
    }
    case "expired":
      return "expired";
    default:
      if (ACTIVE_LIKE.has(status)) return status === "past_due" ? "past_due" : "active";
      return "no_subscription";
  }
}

export function resolveEffectivePlan(plan: string | null | undefined): EffectivePlan {
  const p = String(plan ?? "").toLowerCase();
  if (p === "starter" || p === "growth" || p === "agency") return p;
  return null;
}

/** Whether POST sync / refresh should be allowed (full pipe, not internal cron). */
export function accessStateAllowsHeavySync(state: AccessState): boolean {
  return state === "active" || state === "trialing" || state === "canceled_until_end";
}

/** Soft read-only: grace / past_due may allow limited sync via separate policy — here we block heavy sync for safety. */
export function accessStateAllowsLimitedSync(state: AccessState): boolean {
  return (
    accessStateAllowsHeavySync(state) || state === "past_due" || state === "grace_past_due"
  );
}

/** Heavy report pages: block only hard no-access states. */
export function accessStateAllowsAnalyticsRead(state: AccessState): boolean {
  return state !== "no_subscription" && state !== "refunded";
}
