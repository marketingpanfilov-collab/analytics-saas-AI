import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/app/lib/supabaseAdmin";
import {
  buildClassOnlySummaryBody,
  buildClassOnlyTimeseriesBody,
  buildKpiPayload,
  buildSummaryPayload,
  buildTimeseriesConversionsPayload,
  buildTimeseriesPayload,
  isNonPlatformSourcesOnly,
  parseDashboardRangeParams,
} from "@/app/lib/dashboardPayloads";
import { ensureBackfill } from "@/app/lib/dashboardBackfill";
import {
  dashboardCacheKey,
  dashboardCacheGet,
  dashboardCacheSet,
  DASHBOARD_CACHE_TTL,
} from "@/app/lib/dashboardCache";
import { requireProjectAccessOrInternal } from "@/app/lib/auth/requireProjectAccessOrInternal";

function bundleBackfillIsIncomplete(
  summary: Record<string, unknown>,
  timeseries: Record<string, unknown>
): boolean {
  const pick = (b: unknown) => {
    const x = b as { historical_sync_started?: boolean; range_partially_covered?: boolean } | undefined;
    return Boolean(x?.historical_sync_started || x?.range_partially_covered);
  };
  return pick(summary.backfill) || pick(timeseries.backfill);
}

/**
 * GET /api/dashboard/bundle
 * Single response: summary + timeseries + kpi + timeseries-conversions (same JSON shapes as individual routes).
 * One access check, one ensureBackfill; KPI payloads built in parallel with ads payloads.
 */
export async function GET(req: Request) {
  const params = parseDashboardRangeParams(new URL(req.url).searchParams);
  if (!params) {
    return NextResponse.json(
      { success: false, error: "project_id обязателен; start и end обязательны (YYYY-MM-DD)" },
      { status: 400 }
    );
  }

  const { projectId, start, end, sources, sourcesKey, accountIdsKey } = params;
  const bundleKey = dashboardCacheKey("bundle", projectId, start, end, sourcesKey, accountIdsKey);

  if (isNonPlatformSourcesOnly(sources)) {
    // Match individual routes: summary/timeseries class-only do not require auth; KPI/conversions do.
    const access = await requireProjectAccessOrInternal(req, projectId);
    if (!access.allowed) {
      return NextResponse.json(access.body, { status: access.status });
    }
    const admin = supabaseAdmin();
    const [kpi, timeseriesConversions] = await Promise.all([
      buildKpiPayload(admin, projectId, start, end, sources),
      buildTimeseriesConversionsPayload(admin, projectId, start, end, sources),
    ]);
    const body = {
      success: true,
      summary: buildClassOnlySummaryBody(),
      timeseries: buildClassOnlyTimeseriesBody(),
      kpi,
      timeseriesConversions,
    };
    dashboardCacheSet(bundleKey, body, DASHBOARD_CACHE_TTL.bundle);
    console.log("[BUNDLE_RETURN]", { branch: "class_only" });
    return NextResponse.json(body);
  }

  const access = await requireProjectAccessOrInternal(req, projectId);
  if (!access.allowed) {
    return NextResponse.json(access.body, { status: access.status });
  }

  const admin = supabaseAdmin();
  const backfillResult = await ensureBackfill(admin, projectId, start, end, req.url, {
    sources: params.sources ?? null,
    accountIds: params.accountIds ?? null,
  });
  const didSync = backfillResult.triggered;

  if (!didSync) {
    const cached = dashboardCacheGet(bundleKey) as
      | {
          success?: boolean;
          summary?: Record<string, unknown>;
          timeseries?: Record<string, unknown>;
          kpi?: unknown;
          timeseriesConversions?: unknown;
        }
      | null;
    if (
      cached?.success &&
      cached.summary &&
      cached.timeseries &&
      cached.kpi &&
      cached.timeseriesConversions &&
      !bundleBackfillIsIncomplete(cached.summary, cached.timeseries)
    ) {
      console.log("[BUNDLE_RETURN]", { branch: "cache" });
      return NextResponse.json(cached);
    }
  }

  const [summary, timeseries, kpi, timeseriesConversions] = await Promise.all([
    buildSummaryPayload(admin, params, backfillResult, didSync),
    buildTimeseriesPayload(admin, params, backfillResult, didSync),
    buildKpiPayload(admin, projectId, start, end, sources),
    buildTimeseriesConversionsPayload(admin, projectId, start, end, sources),
  ]);

  const body = {
    success: true,
    summary,
    timeseries,
    kpi,
    timeseriesConversions,
  };

  if (!didSync && !bundleBackfillIsIncomplete(summary, timeseries)) {
    dashboardCacheSet(bundleKey, body, DASHBOARD_CACHE_TTL.bundle);
  }

  console.log("[BUNDLE_RETURN]", { branch: "fresh", didSync });
  return NextResponse.json(body);
}
