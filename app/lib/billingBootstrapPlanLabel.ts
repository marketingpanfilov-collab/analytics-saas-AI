import type { BillingBootstrapApiOk } from "@/app/lib/billingBootstrapClient";

/** Человекочитаемый нейтральный текст, если тир из bootstrap не удалось сопоставить (никогда не показывать raw `unknown`). */
export const BOOTSTRAP_PLAN_DISPLAY_FALLBACK = "Подписка активна";

export type BootstrapPlanTier = "starter" | "growth" | "scale";

function tierLabel(tier: BootstrapPlanTier): string {
  if (tier === "starter") return "Базовый";
  if (tier === "growth") return "Growth";
  return "Scale";
}

function tierFromSubscriptionPlan(raw: string | undefined | null): BootstrapPlanTier | null {
  const p = String(raw ?? "").trim().toLowerCase();
  if (!p || p === "unknown") return null;
  if (p === "agency") return "scale";
  if (p === "starter" || p === "growth" || p === "scale") return p;
  return null;
}

function tierFromMatrixPlan(raw: string | undefined | null): BootstrapPlanTier | null {
  const p = String(raw ?? "").trim().toLowerCase();
  if (p === "starter" || p === "growth" || p === "scale") return p;
  return null;
}

function tierFromEffectivePlan(raw: string | null | undefined): BootstrapPlanTier | null {
  const p = String(raw ?? "").trim().toLowerCase();
  if (p === "starter" || p === "growth" || p === "scale") return p;
  return null;
}

/**
 * Приоритет: effective_plan → subscription.plan → plan_feature_matrix.plan.
 * Не показывает строку "unknown" — только известный тир или нейтральный fallback.
 */
export function resolveBootstrapPlanDisplayLabel(
  b: BillingBootstrapApiOk | null | undefined
): string {
  if (!b) return BOOTSTRAP_PLAN_DISPLAY_FALLBACK;
  if (b.experience_tier === "free") return "Free";

  const fromEp = tierFromEffectivePlan(b.effective_plan ?? null);
  if (fromEp) return tierLabel(fromEp);

  const fromSub = tierFromSubscriptionPlan(b.subscription?.plan ?? null);
  if (fromSub) return tierLabel(fromSub);

  const fromMatrix = tierFromMatrixPlan(b.plan_feature_matrix?.plan ?? null);
  if (fromMatrix) return tierLabel(fromMatrix);

  return BOOTSTRAP_PLAN_DISPLAY_FALLBACK;
}

/**
 * Тот же приоритет, что и для подписи; для аналитики — только известный slug или null.
 */
export function resolveBootstrapPlanAnalyticsSlug(
  b: BillingBootstrapApiOk | null | undefined
): string | null {
  if (!b) return null;
  if (b.experience_tier === "free") return "free";
  const fromEp = tierFromEffectivePlan(b.effective_plan ?? null);
  if (fromEp) return fromEp;
  const fromSub = tierFromSubscriptionPlan(b.subscription?.plan ?? null);
  if (fromSub) return fromSub;
  const fromMatrix = tierFromMatrixPlan(b.plan_feature_matrix?.plan ?? null);
  if (fromMatrix) return fromMatrix;
  return null;
}

/** Для Topbar: приоритет ep → subscription.plan → matrix.plan. */
export function resolveBootstrapPlanTier(
  b: BillingBootstrapApiOk | null | undefined
): BootstrapPlanTier | null {
  if (!b) return null;
  const fromEp = tierFromEffectivePlan(b.effective_plan ?? null);
  if (fromEp) return fromEp;
  const fromSub = tierFromSubscriptionPlan(b.subscription?.plan ?? null);
  if (fromSub) return fromSub;
  return tierFromMatrixPlan(b.plan_feature_matrix?.plan ?? null);
}

/**
 * Free-тариф для UI-гейтов (дашборд, баннеры): как бейдж Free в Topbar (`experience_tier`),
 * плюс явные `effective_plan` / `plan_feature_matrix` с API.
 */
export function isFreeTierFromBootstrap(b: BillingBootstrapApiOk | null | undefined): boolean {
  if (!b) return false;
  if (b.experience_tier === "free") return true;
  const ep = String(b.effective_plan ?? "").trim().toLowerCase();
  if (ep === "free") return true;
  if (b.plan_feature_matrix?.plan === "free") return true;
  return false;
}

/** Есть строка подписки и статус похож на оплаченный/активный доступ (чтобы не показывать «No plan»). */
export function subscriptionStatusLooksPaid(status: string | undefined | null): boolean {
  const s = String(status ?? "").trim().toLowerCase();
  return (
    s === "active" ||
    s === "trialing" ||
    s === "past_due" ||
    s === "paused" ||
    s === "canceled" ||
    s === "cancelled" ||
    s === "grace_past_due"
  );
}
