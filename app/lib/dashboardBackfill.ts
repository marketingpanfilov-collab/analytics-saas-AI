/**
 * Dashboard backfill: ensure daily_ad_metrics has campaign-level coverage for the requested range.
 * Used by summary/timeseries/metrics routes so Apply triggers sync when data is missing.
 * Coverage is checked per platform (Meta, Google); sync runs for both when either needs data.
 */
import type { SupabaseClient } from "@supabase/supabase-js";

export type Platform = "meta" | "google";

async function getAdAccountIdsForProjectByPlatform(
  admin: SupabaseClient,
  projectId: string,
  platform: Platform
): Promise<string[]> {
  let integrationIds: string[] = [];
  if (platform === "meta") {
    const { data: imRows } = await admin
      .from("integrations_meta")
      .select("integrations_id")
      .eq("project_id", projectId);
    integrationIds = [...new Set((imRows ?? []).map((r: { integrations_id: string | null }) => r.integrations_id).filter(Boolean))] as string[];
  } else {
    const { data: intRows } = await admin
      .from("integrations")
      .select("id")
      .eq("project_id", projectId)
      .eq("platform", "google");
    integrationIds = (intRows ?? []).map((r: { id: string }) => r.id);
  }
  if (!integrationIds.length) return [];

  const { data: adAccounts } = await admin
    .from("ad_accounts")
    .select("id")
    .in("integration_id", integrationIds);
  if (!adAccounts?.length) return [];
  return adAccounts.map((a: { id: string }) => a.id);
}

export type CoverageResult = {
  covered: boolean;
  rowCount: number;
  minDate: string | null;
  maxDate: string | null;
};

/**
 * Check if campaign-level rows (campaign_id IS NOT NULL) for the given platform cover the requested range.
 * When platform is omitted, checks Meta only (backward compat).
 */
export async function isRangeCovered(
  admin: SupabaseClient,
  projectId: string,
  start: string,
  end: string,
  platform?: Platform
): Promise<CoverageResult> {
  const effectivePlatform = platform ?? "meta";
  const adAccountIds = await getAdAccountIdsForProjectByPlatform(admin, projectId, effectivePlatform);
  if (!adAccountIds.length) {
    return { covered: true, rowCount: 0, minDate: null, maxDate: null };
  }

  let query = admin
    .from("daily_ad_metrics")
    .select("date")
    .in("ad_account_id", adAccountIds)
    .not("campaign_id", "is", null)
    .eq("platform", effectivePlatform)
    .gte("date", start)
    .lte("date", end);
  const { data: rows, error } = await query;

  if (error) {
    return { covered: false, rowCount: 0, minDate: null, maxDate: null };
  }
  const dates = (rows ?? []).map((r: { date: string }) => String(r.date).slice(0, 10));
  const rowCount = dates.length;
  if (rowCount === 0) {
    return { covered: false, rowCount: 0, minDate: null, maxDate: null };
  }
  const minDate = dates.reduce((a, b) => (a < b ? a : b));
  const maxDate = dates.reduce((a, b) => (a > b ? a : b));
  const covered = minDate <= start && maxDate >= end;
  return { covered, rowCount, minDate, maxDate };
}

const syncPromises = new Map<string, Promise<void>>();

/**
 * If campaign-level coverage for (projectId, start, end) is incomplete for Meta or Google,
 * trigger sync via POST /api/dashboard/sync (runs both Meta and Google for the range).
 * Dedupes in-flight sync per key. Returns true if sync was triggered.
 */
export async function ensureBackfill(
  admin: SupabaseClient,
  projectId: string,
  start: string,
  end: string,
  requestUrl: string
): Promise<boolean> {
  console.log("[BACKFILL_ENTER]", { projectId, start, end });
  const metaAccountIds = await getAdAccountIdsForProjectByPlatform(admin, projectId, "meta");
  const googleAccountIds = await getAdAccountIdsForProjectByPlatform(admin, projectId, "google");
  const metaCoverage = await isRangeCovered(admin, projectId, start, end, "meta");
  const googleCoverage = await isRangeCovered(admin, projectId, start, end, "google");
  const metaNeedsSync = metaAccountIds.length > 0 && !metaCoverage.covered;
  const googleNeedsSync = googleAccountIds.length > 0 && !googleCoverage.covered;
  console.log("[BACKFILL_COVERAGE_RESULT]", {
    metaCovered: metaCoverage.covered,
    googleCovered: googleCoverage.covered,
    metaNeedsSync,
    googleNeedsSync,
    level: "campaign",
  });
  if (!metaNeedsSync && !googleNeedsSync) return false;

  const syncUrl = new URL("/api/dashboard/sync", requestUrl);
  syncUrl.searchParams.set("project_id", projectId);
  syncUrl.searchParams.set("start", start);
  syncUrl.searchParams.set("end", end);
  const syncUrlStr = syncUrl.toString();
  console.log("[BACKFILL_SYNC_CALL]", { url: syncUrlStr, projectId, start, end });

  const key = `${projectId}:${start}:${end}`;
  let promise = syncPromises.get(key);
  if (!promise) {
    promise = (async () => {
      try {
        const r = await fetch(syncUrlStr, { method: "POST" });
        const body = await r.json().catch(() => ({}));
        console.log("[BACKFILL_SYNC_RESPONSE]", { status: r.status, ok: r.ok, body });
        if (!r.ok || !body?.success) {
          console.error("[BACKFILL_SYNC_FAILED]", {
            projectId,
            start,
            end,
            status: r.status,
            error: body?.error ?? "Backfill sync failed",
            body,
          });
        }
      } finally {
        syncPromises.delete(key);
      }
    })();
    syncPromises.set(key, promise);
  }
  await promise;
  return true;
}
