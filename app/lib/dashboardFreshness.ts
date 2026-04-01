/**
 * Server-driven dashboard freshness for stale-check (tariff-based TTL).
 * stale ⇔ now - last_sync_at > effective_ttl_ms (per plan).
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import { resolveEnabledAdAccountIdsForProject } from "@/app/lib/dashboardCanonical";
import { getLastSyncFinishedAtForProject } from "@/app/lib/dashboardBackfill";
import { type BillingPlanId, resolveBillingPlanForUser } from "@/app/lib/billingPlan";

const MS_HOUR = 60 * 60 * 1000;

/** Tariff-based dashboard data TTL (refresh policy). */
export function getEffectiveDashboardTtlMs(plan: BillingPlanId): number {
  switch (plan) {
    case "starter":
      return 6 * MS_HOUR;
    case "growth":
      return 3 * MS_HOUR;
    case "agency":
      return 15 * 60 * 1000;
    default:
      return 3 * MS_HOUR;
  }
}

export type DashboardFreshnessPayload = {
  is_stale: boolean;
  last_sync_at: string | null;
  effective_ttl_ms: number;
  plan: BillingPlanId;
  /** internal = no user session, default TTL */
  source: "user" | "internal";
};

export async function buildDashboardFreshnessPayload(
  admin: SupabaseClient,
  projectId: string,
  opts: { userId: string | null; userEmail: string | null; accessSource: "user" | "internal" }
): Promise<DashboardFreshnessPayload> {
  const enabledIds = await resolveEnabledAdAccountIdsForProject(admin, projectId, null, null);
  const lastSync = await getLastSyncFinishedAtForProject(admin, projectId, enabledIds);
  const lastMs = lastSync ? lastSync.getTime() : 0;

  let plan: BillingPlanId = "growth";
  if (opts.accessSource === "user" && opts.userId) {
    plan = await resolveBillingPlanForUser(admin, opts.userId, opts.userEmail);
  }

  const effective_ttl_ms = getEffectiveDashboardTtlMs(plan);
  const now = Date.now();
  const is_stale = !lastMs || now - lastMs > effective_ttl_ms;

  return {
    is_stale,
    last_sync_at: lastSync ? lastSync.toISOString() : null,
    effective_ttl_ms,
    plan,
    source: opts.accessSource === "internal" ? "internal" : "user",
  };
}
