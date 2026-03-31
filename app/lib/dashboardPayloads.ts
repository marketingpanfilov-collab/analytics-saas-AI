/**
 * Shared dashboard JSON payloads for /api/dashboard/* routes and /api/dashboard/bundle.
 * Keeps one ensureBackfill + one access check in bundle while preserving per-route behavior.
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import { getCanonicalSummary, getCanonicalTimeseries } from "@/app/lib/dashboardCanonical";
import { applyBackfillMetadata, type EnsureBackfillResult } from "@/app/lib/dashboardBackfill";
import {
  dashboardCacheKey,
  dashboardCacheGet,
  dashboardCacheSet,
  DASHBOARD_CACHE_TTL,
} from "@/app/lib/dashboardCache";
import {
  fetchAndEnrichKpiConversionRows,
  filterEnrichedRowsByDashboardSources,
  sumPurchaseRevenueProjectCurrency,
} from "@/app/lib/dashboardKpiAttribution";
import type { DashboardRangeParams } from "@/app/lib/dashboardRangeParams";

export type { DashboardRangeParams } from "@/app/lib/dashboardRangeParams";
export {
  PLATFORM_SOURCES,
  toISODate,
  parseDashboardRangeParams,
  isNonPlatformSourcesOnly,
} from "@/app/lib/dashboardRangeParams";

/** Skip writing cache when historical gap sync is in progress (body carries historical_sync_started). */
function shouldSkipCanonicalCache(body: Record<string, unknown>): boolean {
  const b = body.backfill as { historical_sync_started?: boolean } | undefined;
  return Boolean(b?.historical_sync_started);
}

export function buildClassOnlySummaryBody(): Record<string, unknown> {
  return {
    success: true,
    source: "daily_ad_metrics (canonical)",
    updated_at: null,
    totals: {
      spend: 0,
      impressions: 0,
      clicks: 0,
    },
    debug: {
      min_day: null,
      max_day: null,
      campaigns_cnt: null,
      ad_account_id: null,
      account_rows: 0,
      campaign_rows: 0,
    },
  };
}

export function buildClassOnlyTimeseriesBody(): Record<string, unknown> {
  return {
    success: true,
    source: "daily_ad_metrics (canonical)",
    points: [] as { date: string; spend: number; clicks: number; sales: number; revenue: number; roas: number }[],
  };
}

export async function buildSummaryPayload(
  admin: SupabaseClient,
  params: DashboardRangeParams,
  backfillResult: EnsureBackfillResult,
  didSync: boolean
): Promise<Record<string, unknown>> {
  const { projectId, start, end, sources, accountIds, sourcesKey, accountIdsKey } = params;
  const cacheKey = dashboardCacheKey("summary", projectId, start, end, sourcesKey, accountIdsKey);
  if (!didSync) {
    const cached = dashboardCacheGet(cacheKey) as
      | { totals?: { spend?: number; impressions?: number; clicks?: number }; source?: string }
      | null;
    if (cached != null) {
      const t = cached?.totals ?? {};
      const hasData =
        Number(t?.spend ?? 0) !== 0 || Number(t?.impressions ?? 0) !== 0 || Number(t?.clicks ?? 0) !== 0;
      const fromCanonical = cached?.source === "daily_ad_metrics (canonical)";
      if (hasData && fromCanonical) {
        return applyBackfillMetadata({ ...cached } as Record<string, unknown>, backfillResult);
      }
    }
  }

  const canonical = await getCanonicalSummary(admin, projectId, start, end, { sources, accountIds });
  const d = canonical?.data;
  const body: Record<string, unknown> = {
    success: true,
    source: "daily_ad_metrics (canonical)",
    updated_at: null,
    totals: {
      spend: d?.spend ?? 0,
      impressions: d?.impressions ?? 0,
      clicks: d?.clicks ?? 0,
    },
    debug: {
      min_day: d?.min_day ?? null,
      max_day: d?.max_day ?? null,
      campaigns_cnt: d?.campaigns_cnt ?? null,
      ad_account_id: null,
      account_rows: 0,
      campaign_rows: canonical?.rowCount ?? 0,
    },
  };
  const withBackfill = applyBackfillMetadata(body, backfillResult);
  if (!didSync && !shouldSkipCanonicalCache(withBackfill)) {
    dashboardCacheSet(cacheKey, withBackfill, DASHBOARD_CACHE_TTL.summary);
  }
  return withBackfill;
}

export async function buildTimeseriesPayload(
  admin: SupabaseClient,
  params: DashboardRangeParams,
  backfillResult: EnsureBackfillResult,
  didSync: boolean
): Promise<Record<string, unknown>> {
  const { projectId, start, end, sources, accountIds, sourcesKey, accountIdsKey } = params;
  const cacheKey = dashboardCacheKey("timeseries", projectId, start, end, sourcesKey, accountIdsKey);
  if (!didSync) {
    const cached = dashboardCacheGet(cacheKey);
    if (cached != null) {
      return applyBackfillMetadata({ ...(cached as Record<string, unknown>) }, backfillResult);
    }
  }

  const canonicalPoints = await getCanonicalTimeseries(admin, projectId, start, end, { sources, accountIds });
  if (canonicalPoints && canonicalPoints.length > 0) {
    const points = canonicalPoints.map((p) => ({
      date: p.day,
      spend: p.spend,
      clicks: p.clicks,
      sales: p.purchases,
      revenue: p.revenue,
      roas: p.roas,
    }));
    const body: Record<string, unknown> = {
      success: true,
      source: "daily_ad_metrics (canonical)",
      points,
    };
    const withBackfill = applyBackfillMetadata(body, backfillResult);
    if (!didSync && !shouldSkipCanonicalCache(withBackfill)) {
      dashboardCacheSet(cacheKey, withBackfill, DASHBOARD_CACHE_TTL.timeseries);
    }
    return withBackfill;
  }

  const emptyBody: Record<string, unknown> = {
    success: true,
    source: "daily_ad_metrics (canonical)",
    points: [] as { date: string; spend: number; clicks: number; sales: number; revenue: number; roas: number }[],
  };
  return applyBackfillMetadata(emptyBody, backfillResult);
}

export async function buildKpiPayload(
  admin: SupabaseClient,
  projectId: string,
  start: string,
  end: string,
  sources: string[] | undefined
): Promise<Record<string, unknown>> {
  const convSelect =
    "id, event_name, value, currency, source, traffic_source, traffic_platform, visitor_id, user_external_id, created_at, event_time";
  const { rows: enriched, pagesFetched: convPages } = await fetchAndEnrichKpiConversionRows(
    admin,
    projectId,
    start,
    end,
    convSelect
  );
  if (convPages > 1) {
    console.log("[KPI_CONVERSION_ROWCAP]", {
      projectId,
      start,
      end,
      convPages,
      rowCount: enriched.length,
      note: "H3: KPI conversions required multiple PostgREST pages; pre-fix counts were capped at ~1000.",
    });
  }

  const hasDirect = enriched.some((r) => r._source_class === "direct");
  const effectiveRows = filterEnrichedRowsByDashboardSources(enriched, sources);

  const registrations = effectiveRows.filter((r) => r.event_name === "registration");
  const purchases = effectiveRows.filter((r) => r.event_name === "purchase");
  const registrationsCount = registrations.length;
  const salesCount = purchases.length;

  const { revenue, currency_diagnostics: currencyDiagnostics } = await sumPurchaseRevenueProjectCurrency(
    admin,
    projectId,
    purchases
  );
  if (currencyDiagnostics.reason_codes.length > 0) {
    console.warn("[KPI_CURRENCY_DIAGNOSTICS]", {
      projectId,
      reason_codes: currencyDiagnostics.reason_codes,
      warnings: currencyDiagnostics.warnings,
    });
  }

  return {
    success: true,
    registrations: registrationsCount,
    sales: salesCount,
    revenue,
    has_direct: hasDirect,
    currency_diagnostics: currencyDiagnostics,
  };
}

export async function buildTimeseriesConversionsPayload(
  admin: SupabaseClient,
  projectId: string,
  start: string,
  end: string,
  sources: string[] | undefined
): Promise<Record<string, unknown>> {
  const convSelect =
    "id, event_name, source, traffic_source, traffic_platform, visitor_id, created_at, event_time";
  const { rows: enriched, pagesFetched: convPages } = await fetchAndEnrichKpiConversionRows(
    admin,
    projectId,
    start,
    end,
    convSelect
  );
  if (convPages > 1) {
    console.log("[TIMESERIES_CONVERSIONS_ROWCAP]", {
      projectId,
      start,
      end,
      convPages,
      rowCount: enriched.length,
      note: "H3: timeseries conversions required multiple PostgREST pages; pre-fix series were capped at ~1000.",
    });
  }

  const effectiveRows = filterEnrichedRowsByDashboardSources(enriched, sources);

  const byDate = new Map<string, { registrations: number; sales: number }>();
  for (const r of effectiveRows) {
    const day = (r.event_time ?? r.created_at).slice(0, 10);
    const cur = byDate.get(day) ?? { registrations: 0, sales: 0 };
    if (r.event_name === "registration") cur.registrations += 1;
    if (r.event_name === "purchase") cur.sales += 1;
    byDate.set(day, cur);
  }

  const points = Array.from(byDate.entries())
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([date, agg]) => ({
      date,
      registrations: agg.registrations,
      sales: agg.sales,
    }));

  return { success: true, points };
}
