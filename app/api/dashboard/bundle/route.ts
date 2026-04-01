import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/app/lib/supabaseAdmin";
import {
  buildClassOnlySummaryBody,
  buildClassOnlyTimeseriesBody,
  buildKpiAndTimeseriesConversionsForBundle,
  buildSummaryAndTimeseriesForBundle,
  isNonPlatformSourcesOnly,
  parseDashboardRangeParams,
} from "@/app/lib/dashboardPayloads";
import { ensureBackfill } from "@/app/lib/dashboardBackfill";
import { isBundleReadOnlyMode } from "@/app/lib/bundleReadOnly";
import {
  dashboardCacheKey,
  dashboardCacheGet,
  dashboardCacheSet,
  DASHBOARD_CACHE_TTL,
} from "@/app/lib/dashboardCache";
import { requireProjectAccessOrInternal } from "@/app/lib/auth/requireProjectAccessOrInternal";
import { createServerSupabase } from "@/app/lib/supabaseServer";
import { buildDashboardFreshnessPayload } from "@/app/lib/dashboardFreshness";
import type { ProjectAccessCheckResult } from "@/app/lib/auth/requireProjectAccessOrInternal";
import type { SupabaseClient } from "@supabase/supabase-js";

async function attachFreshness(
  admin: SupabaseClient,
  projectId: string,
  access: Extract<ProjectAccessCheckResult, { allowed: true }>
) {
  if (access.source === "internal") {
    return buildDashboardFreshnessPayload(admin, projectId, {
      userId: null,
      userEmail: null,
      accessSource: "internal",
    });
  }
  const supabase = await createServerSupabase();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return buildDashboardFreshnessPayload(admin, projectId, {
      userId: null,
      userEmail: null,
      accessSource: "internal",
    });
  }
  return buildDashboardFreshnessPayload(admin, projectId, {
    userId: user.id,
    userEmail: user.email ?? null,
    accessSource: "user",
  });
}

function bundleBackfillIsIncomplete(
  summary: Record<string, unknown>,
  timeseries: Record<string, unknown>
): boolean {
  const pick = (b: unknown) => {
    const x = b as {
      historical_sync_started?: boolean;
      range_partially_covered?: boolean;
      read_only_no_sync?: boolean;
    } | undefined;
    return Boolean(
      x?.historical_sync_started || x?.range_partially_covered || x?.read_only_no_sync
    );
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
    const { kpi, timeseriesConversions } = await buildKpiAndTimeseriesConversionsForBundle(
      admin,
      projectId,
      start,
      end,
      sources
    );
    const body = {
      success: true,
      summary: buildClassOnlySummaryBody(),
      timeseries: buildClassOnlyTimeseriesBody(),
      kpi,
      timeseriesConversions,
    };
    dashboardCacheSet(bundleKey, body, DASHBOARD_CACHE_TTL.bundle);
    const freshness = await attachFreshness(admin, projectId, access);
    const bundleReadOnlyClass = isBundleReadOnlyMode();
    console.log("[BUNDLE_RETURN]", { branch: "class_only", bundle_read_only: bundleReadOnlyClass });
    return NextResponse.json({
      ...body,
      freshness,
      backfillIntent: {
        bundle_read_only: bundleReadOnlyClass,
        would_sync: false,
        reason: null,
      },
    });
  }

  const access = await requireProjectAccessOrInternal(req, projectId);
  if (!access.allowed) {
    return NextResponse.json(access.body, { status: access.status });
  }

  const admin = supabaseAdmin();
  const bundleReadOnly = isBundleReadOnlyMode();
  const backfillResult = await ensureBackfill(admin, projectId, start, end, req.url, {
    sources: params.sources ?? null,
    accountIds: params.accountIds ?? null,
    readOnly: bundleReadOnly,
  });
  /** Legacy path when `BUNDLE_READ_ONLY_MODE` is off: `true` skips cache short-circuit (sync may enqueue from bundle). Read-only mode always yields `false`. */
  const didSync = backfillResult.triggered;
  const wouldSync = Boolean(backfillResult.wouldSync ?? backfillResult.triggered);
  const wouldSyncReason =
    backfillResult.wouldSyncReason ?? (backfillResult.triggered ? backfillResult.reason : null);

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
      const freshness = await attachFreshness(admin, projectId, access);
      console.log("[BUNDLE_RETURN]", {
        branch: "cache",
        bundle_read_only: bundleReadOnly,
        would_sync: wouldSync,
        would_sync_reason: wouldSyncReason,
        didSync: false,
      });
      return NextResponse.json({
        ...cached,
        freshness,
        backfillIntent: {
          bundle_read_only: bundleReadOnly,
          would_sync: wouldSync,
          reason: wouldSyncReason,
        },
      });
    }
  }

  const [{ summary, timeseries }, { kpi, timeseriesConversions }] = await Promise.all([
    buildSummaryAndTimeseriesForBundle(admin, params, backfillResult, didSync),
    buildKpiAndTimeseriesConversionsForBundle(admin, projectId, start, end, sources),
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

  const freshness = await attachFreshness(admin, projectId, access);
  console.log("[BUNDLE_RETURN]", {
    branch: "fresh",
    didSync,
    bundle_read_only: bundleReadOnly,
    would_sync: wouldSync,
    would_sync_reason: wouldSyncReason,
  });
  return NextResponse.json({
    ...body,
    freshness,
    backfillIntent: {
      bundle_read_only: bundleReadOnly,
      would_sync: wouldSync,
      reason: wouldSyncReason,
    },
  });
}
