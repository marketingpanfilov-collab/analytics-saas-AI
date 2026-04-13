/**
 * Product experience tier on top of billing `access_state` (Free tier UX / API policy).
 * Paddle truth stays in access_state; Free = `no_subscription` (нет активной подписки), в т.ч. до первой орг/проекта.
 * Состояния unpaid / expired / refunded / paused не считаются Free — см. canReadAnalytics.
 * All product gates must use canReadAnalytics / canRunSync — not accessStateAllows* directly.
 */
import type { AccessState } from "@/app/lib/accessState";

export type ExperienceTier = "free" | null;

export function computeExperienceTier(input: {
  access_state: AccessState;
  has_any_accessible_project: boolean;
  /** Участник организации (в т.ч. до первого проекта) — уже внутри продукта. */
  has_org_membership: boolean;
  demo_mode: boolean;
}): ExperienceTier {
  if (input.demo_mode) return null;
  if (input.access_state !== "no_subscription") return null;
  return "free";
}

/** Analytics GET (bundle, attribution reads, …): paid states OR explicit Free (never refunded). */
export function canReadAnalytics(input: {
  access_state: AccessState;
  experience_tier: ExperienceTier;
}): boolean {
  if (input.access_state === "refunded") return false;
  if (
    input.access_state === "unpaid" ||
    input.access_state === "expired" ||
    input.access_state === "paused"
  ) {
    return false;
  }
  if (input.access_state === "no_subscription") {
    return input.experience_tier === "free";
  }
  return true;
}

/** User-initiated sync / refresh / OAuth save paths: paid heavy window OR Free with same predicates as read. */
export function canRunSync(input: {
  access_state: AccessState;
  experience_tier: ExperienceTier;
}): boolean {
  if (input.access_state === "refunded") return false;
  const s = input.access_state;
  if (s === "active" || s === "trialing" || s === "canceled_until_end") return true;
  return input.experience_tier === "free";
}
