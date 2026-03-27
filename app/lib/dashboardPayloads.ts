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
  convertMoneyStrict,
  createCurrencyDiagnostics,
  getLatestUsdToKztRate,
  getUsdToKztRateMapForDays,
  normalizeCurrencyCode,
  pushCurrencyReason,
  resolveUsdToKztRateForDay,
} from "@/app/lib/currencyNormalization";
import {
  fetchConversionEventsPaginated,
  fetchVisitSourceEventsForVisitors,
} from "@/app/lib/dashboardConversionQueries";

export const PLATFORM_SOURCES = ["meta", "google", "tiktok", "yandex"] as const;

export function toISODate(s: string | null) {
  if (!s) return null;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return null;
  return s;
}

export type DashboardRangeParams = {
  projectId: string;
  start: string;
  end: string;
  sources?: string[];
  accountIds?: string[];
  sourcesKey: string;
  accountIdsKey: string;
};

export function parseDashboardRangeParams(searchParams: URLSearchParams): DashboardRangeParams | null {
  const projectId = searchParams.get("project_id")?.trim() ?? searchParams.get("project_id");
  const start = toISODate(searchParams.get("start"));
  const end = toISODate(searchParams.get("end"));
  const sourcesRaw = searchParams.get("sources");
  const sources = sourcesRaw ? sourcesRaw.split(",").map((s) => s.trim()).filter(Boolean) : undefined;
  const accountIdsRaw = searchParams.get("account_ids");
  const accountIds = accountIdsRaw ? accountIdsRaw.split(",").map((s) => s.trim()).filter(Boolean) : undefined;
  if (!projectId || !start || !end) return null;
  const sourcesKey = sources?.length ? [...sources].sort().join(",") : "all";
  const accountIdsKey = accountIds?.length ? [...accountIds].sort().join(",") : "all";
  return { projectId, start, end, sources, accountIds, sourcesKey, accountIdsKey };
}

/** When user selected sources but none are ad platforms — paid spend series must be empty/zero. */
export function isNonPlatformSourcesOnly(sources: string[] | undefined): boolean {
  if (!sources?.length) return false;
  return !sources.some((s) => PLATFORM_SOURCES.includes(s.toLowerCase() as (typeof PLATFORM_SOURCES)[number]));
}

/** Match summary/timeseries routes: skip cache only when historical sync was started (not only range_partially_covered). */
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
  applyBackfillMetadata(body, backfillResult);
  if (!shouldSkipCanonicalCache(body)) {
    dashboardCacheSet(cacheKey, body, DASHBOARD_CACHE_TTL.summary);
  }
  return body;
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
    applyBackfillMetadata(body, backfillResult);
    if (!shouldSkipCanonicalCache(body)) {
      dashboardCacheSet(cacheKey, body, DASHBOARD_CACHE_TTL.timeseries);
    }
    return body;
  }

  const emptyBody: Record<string, unknown> = {
    success: true,
    source: "daily_ad_metrics (canonical)",
    points: [] as { date: string; spend: number; clicks: number; sales: number; revenue: number; roas: number }[],
  };
  return applyBackfillMetadata(emptyBody, backfillResult);
}

const PLATFORM_SOURCE_VALUES = ["meta", "google", "tiktok", "yandex"] as const;

function normalizePlatformSource(raw: string | null): string | null {
  const v = (raw ?? "").trim().toLowerCase();
  if (!v) return null;
  return PLATFORM_SOURCE_VALUES.includes(v as (typeof PLATFORM_SOURCE_VALUES)[number]) ? v : null;
}

/** DB stores e.g. facebook_ads / google_ads on traffic_platform; dashboard filters use meta / google / … */
function platformForDashboardFilter(row: {
  traffic_source?: string | null;
  traffic_platform?: string | null;
  source?: string | null;
}): string | null {
  const fromTs = normalizePlatformSource(row.traffic_source ?? null);
  if (fromTs) return fromTs;
  const tp = (row.traffic_platform ?? "").trim().toLowerCase();
  if (tp === "facebook_ads") return "meta";
  if (tp === "google_ads") return "google";
  if (tp === "tiktok_ads") return "tiktok";
  if (tp === "yandex_ads") return "yandex";
  return normalizePlatformSource(row.source ?? null);
}

function rangeDayCountInclusive(start: string, end: string): number {
  const a = new Date(start + "T12:00:00.000Z").getTime();
  const b = new Date(end + "T12:00:00.000Z").getTime();
  return Math.floor((b - a) / 86400000) + 1;
}

/** Optional: skip visit_source_events join for long ranges when DASHBOARD_KPI_FAST_CONVERSIONS=1 (faster, attribution from conversion fields only). */
function shouldSkipVisitAttributionForKpi(start: string, end: string): boolean {
  if (process.env.DASHBOARD_KPI_FAST_CONVERSIONS !== "1") return false;
  return rangeDayCountInclusive(start, end) >= 90;
}

export async function buildKpiPayload(
  admin: SupabaseClient,
  projectId: string,
  start: string,
  end: string,
  sources: string[] | undefined
): Promise<Record<string, unknown>> {
  const from = `${start}T00:00:00.000Z`;
  const to = `${end}T23:59:59.999Z`;
  const skipVisits = shouldSkipVisitAttributionForKpi(start, end);

  const convSelect =
    "event_name, value, currency, source, traffic_source, traffic_platform, visitor_id, created_at, event_time";
  const { rows: convRows, pagesFetched: convPages } = await fetchConversionEventsPaginated(
    admin,
    projectId,
    from,
    to,
    convSelect
  );
  if (convPages > 1) {
    console.log("[KPI_CONVERSION_ROWCAP]", {
      projectId,
      start,
      end,
      convPages,
      rowCount: convRows.length,
      note: "H3: KPI conversions required multiple PostgREST pages; pre-fix counts were capped at ~1000.",
    });
  }

  type ConversionRow = {
    event_name: string;
    value: number | null;
    currency?: string | null;
    source: string | null;
    traffic_source: string | null;
    traffic_platform: string | null;
    visitor_id: string | null;
    created_at: string;
    event_time: string | null;
  };

  const rows = convRows as ConversionRow[];

  const visitorIds = Array.from(new Set(rows.map((r) => r.visitor_id).filter((v): v is string => !!v)));

  type VisitRow = {
    visitor_id: string | null;
    source_classification: string | null;
    traffic_source: string | null;
    traffic_platform: string | null;
    created_at: string;
  };

  const lookupFrom = new Date(`${start}T00:00:00.000Z`);
  lookupFrom.setUTCDate(lookupFrom.getUTCDate() - 30);
  const lookupFromIso = lookupFrom.toISOString();

  const visitsByVisitor = new Map<string, VisitRow[]>();
  if (!skipVisits && visitorIds.length > 0) {
    try {
      const { rows: visitRows, batches: visitBatches } = await fetchVisitSourceEventsForVisitors(
        admin,
        projectId,
        visitorIds,
        lookupFromIso,
        to
      );
      if (visitBatches > 1) {
        console.log("[KPI_VISITS_BATCH]", { projectId, visitBatches, visitorIdCount: visitorIds.length });
      }
      for (const v of visitRows as VisitRow[]) {
        if (!v.visitor_id) continue;
        const list = visitsByVisitor.get(v.visitor_id) ?? [];
        list.push(v);
        visitsByVisitor.set(v.visitor_id, list);
      }
      for (const [key, list] of visitsByVisitor.entries()) {
        list.sort((a, b) => (a.created_at < b.created_at ? -1 : a.created_at > b.created_at ? 1 : 0));
        visitsByVisitor.set(key, list);
      }
    } catch (visitError) {
      console.warn("[DASHBOARD_KPI_VISITS_ERROR]", visitError);
    }
  } else if (skipVisits) {
    console.log("[KPI_FAST_CONVERSIONS]", { projectId, start, end, rangeDays: rangeDayCountInclusive(start, end) });
  }

  const enriched = rows.map((r) => {
    let platformSource = platformForDashboardFilter(r);

    let sourceClass: string | null = null;
    if (r.visitor_id) {
      const visits = visitsByVisitor.get(r.visitor_id) ?? [];
      if (visits.length) {
        const convTs = r.event_time ?? r.created_at;
        let chosen: VisitRow | null = null;
        for (const v of visits) {
          if (v.created_at <= convTs) {
            chosen = v;
          } else {
            break;
          }
        }
        sourceClass = (chosen?.source_classification ?? null)?.trim().toLowerCase() || null;
        if (!platformSource && chosen) {
          platformSource = platformForDashboardFilter({
            traffic_source: chosen.traffic_source,
            traffic_platform: chosen.traffic_platform,
            source: null,
          });
        }
      }
    }

    if (!sourceClass && !platformSource) {
      sourceClass = "direct";
    }

    return {
      ...r,
      _platform_source: platformSource,
      _source_class: sourceClass,
    };
  });

  const hasDirect = enriched.some((r) => r._source_class === "direct");

  const effectiveRows =
    sources && sources.length > 0
      ? enriched.filter((r) => {
          const platformHit = r._platform_source && sources.includes(r._platform_source);
          const classHit = r._source_class && sources.includes(r._source_class);
          return platformHit || classHit;
        })
      : enriched;

  const registrations = effectiveRows.filter((r) => r.event_name === "registration");
  const purchases = effectiveRows.filter((r) => r.event_name === "purchase");
  const registrationsCount = registrations.length;
  const salesCount = purchases.length;

  const { data: projectRow } = await admin
    .from("projects")
    .select("currency")
    .eq("id", projectId)
    .maybeSingle();
  const projectCurrency =
    String((projectRow as { currency?: string | null } | null)?.currency ?? "USD")
      .trim()
      .toUpperCase() === "KZT"
      ? "KZT"
      : "USD";
  let latestUsdToKztRate: number | null = null;
  let usdToKztRateByDay = new Map<string, number>();
  if (projectCurrency === "KZT") {
    const days = purchases.map((r) => String(r.created_at ?? "").slice(0, 10));
    [usdToKztRateByDay, latestUsdToKztRate] = await Promise.all([
      getUsdToKztRateMapForDays(admin, days),
      getLatestUsdToKztRate(admin),
    ]);
  }
  const currencyDiagnostics = createCurrencyDiagnostics();
  const revenue = purchases.reduce((sum, r) => {
    const amount = Number(r.value ?? 0) || 0;
    const normalized = normalizeCurrencyCode(r.currency);
    const fromCurrency = normalized ?? projectCurrency;
    if (!normalized && (r.currency == null || String(r.currency).trim() === "")) {
      pushCurrencyReason(currencyDiagnostics, "currency_missing", "conversion_events.currency missing; fallback used.");
    } else if (!normalized) {
      pushCurrencyReason(
        currencyDiagnostics,
        "currency_unsupported",
        `Unsupported currency '${String(r.currency)}'; fallback used.`
      );
    }
    const day = String(r.event_time ?? r.created_at ?? "").slice(0, 10);
    const dayRate = resolveUsdToKztRateForDay(day, usdToKztRateByDay, latestUsdToKztRate, currencyDiagnostics);
    return sum + convertMoneyStrict(amount, fromCurrency, projectCurrency, dayRate, currencyDiagnostics);
  }, 0);
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
  const from = `${start}T00:00:00.000Z`;
  const to = `${end}T23:59:59.999Z`;
  const skipVisits = shouldSkipVisitAttributionForKpi(start, end);

  const convSelect =
    "event_name, source, traffic_source, traffic_platform, visitor_id, created_at, event_time";
  const { rows: convRows, pagesFetched: convPages } = await fetchConversionEventsPaginated(
    admin,
    projectId,
    from,
    to,
    convSelect
  );
  if (convPages > 1) {
    console.log("[TIMESERIES_CONVERSIONS_ROWCAP]", {
      projectId,
      start,
      end,
      convPages,
      rowCount: convRows.length,
      note: "H3: timeseries conversions required multiple PostgREST pages; pre-fix series were capped at ~1000.",
    });
  }

  type ConversionRow = {
    event_name: string;
    source: string | null;
    traffic_source: string | null;
    traffic_platform: string | null;
    visitor_id: string | null;
    created_at: string;
    event_time: string | null;
  };

  const rows = convRows as ConversionRow[];

  const visitorIds = Array.from(new Set(rows.map((r) => r.visitor_id).filter((v): v is string => !!v)));

  type VisitRow = {
    visitor_id: string | null;
    source_classification: string | null;
    traffic_source: string | null;
    traffic_platform: string | null;
    created_at: string;
  };

  const lookupFrom = new Date(`${start}T00:00:00.000Z`);
  lookupFrom.setUTCDate(lookupFrom.getUTCDate() - 30);
  const lookupFromIso = lookupFrom.toISOString();

  const visitsByVisitor = new Map<string, VisitRow[]>();
  if (!skipVisits && visitorIds.length > 0) {
    try {
      const { rows: visitRows, batches: visitBatches } = await fetchVisitSourceEventsForVisitors(
        admin,
        projectId,
        visitorIds,
        lookupFromIso,
        to
      );
      if (visitBatches > 1) {
        console.log("[TIMESERIES_VISITS_BATCH]", { projectId, visitBatches, visitorIdCount: visitorIds.length });
      }
      for (const v of visitRows as VisitRow[]) {
        if (!v.visitor_id) continue;
        const list = visitsByVisitor.get(v.visitor_id) ?? [];
        list.push(v);
        visitsByVisitor.set(v.visitor_id, list);
      }
      for (const [key, list] of visitsByVisitor.entries()) {
        list.sort((a, b) => (a.created_at < b.created_at ? -1 : a.created_at > b.created_at ? 1 : 0));
        visitsByVisitor.set(key, list);
      }
    } catch (visitError) {
      console.warn("[TIMESERIES_CONVERSIONS_VISITS_ERROR]", visitError);
    }
  }

  const enriched = rows.map((r) => {
    let platformSource = platformForDashboardFilter(r);
    let sourceClass: string | null = null;
    if (r.visitor_id) {
      const visits = visitsByVisitor.get(r.visitor_id) ?? [];
      if (visits.length) {
        const convTs = r.event_time ?? r.created_at;
        let chosen: VisitRow | null = null;
        for (const v of visits) {
          if (v.created_at <= convTs) chosen = v;
          else break;
        }
        sourceClass = (chosen?.source_classification ?? null)?.trim().toLowerCase() || null;
        if (!platformSource && chosen) {
          platformSource = platformForDashboardFilter({
            traffic_source: chosen.traffic_source,
            traffic_platform: chosen.traffic_platform,
            source: null,
          });
        }
      }
    }
    if (!sourceClass && !platformSource) sourceClass = "direct";
    return {
      ...r,
      _platform_source: platformSource,
      _source_class: sourceClass,
    };
  });

  const effectiveRows =
    sources && sources.length > 0
      ? enriched.filter((r) => {
          const platformHit = r._platform_source && sources.includes(r._platform_source);
          const classHit = r._source_class && sources.includes(r._source_class);
          return platformHit || classHit;
        })
      : enriched;

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
