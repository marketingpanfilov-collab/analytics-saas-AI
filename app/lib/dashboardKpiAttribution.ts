/**
 * KPI attribution for the main dashboard: same rules as /api/dashboard/kpi (visits + traffic fields).
 * Used by marketing reports for ROAS / revenue alignment with the dashboard source filter.
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import {
  convertMoneyStrict,
  createCurrencyDiagnostics,
  getLatestUsdToKztRate,
  getUsdToKztRateMapForDays,
  normalizeCurrencyCode,
  pushCurrencyReason,
  resolveUsdToKztRateForDay,
  type CurrencyDiagnostics,
} from "@/app/lib/currencyNormalization";
import { fetchConversionEventsPaginated, fetchVisitSourceEventsForVisitors } from "@/app/lib/dashboardConversionQueries";

const PLATFORM_SOURCE_VALUES = ["meta", "google", "tiktok", "yandex"] as const;

export function normalizePlatformSource(raw: string | null): string | null {
  const v = (raw ?? "").trim().toLowerCase();
  if (!v) return null;
  return PLATFORM_SOURCE_VALUES.includes(v as (typeof PLATFORM_SOURCE_VALUES)[number]) ? v : null;
}

/** DB stores e.g. facebook_ads / google_ads on traffic_platform; dashboard filters use meta / google / … */
export function platformForDashboardFilter(row: {
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

export type KpiConversionRow = {
  id: string;
  event_name: string;
  value?: number | null;
  currency?: string | null;
  source: string | null;
  traffic_source: string | null;
  traffic_platform: string | null;
  visitor_id: string | null;
  user_external_id?: string | null;
  session_id?: string | null;
  created_at: string;
  event_time: string | null;
};

export type EnrichedKpiRow = KpiConversionRow & {
  _platform_source: string | null;
  _source_class: string | null;
};

function rangeDayCountInclusive(start: string, end: string): number {
  const a = new Date(start + "T12:00:00.000Z").getTime();
  const b = new Date(end + "T12:00:00.000Z").getTime();
  return Math.floor((b - a) / 86400000) + 1;
}

function shouldSkipVisitAttributionForKpi(start: string, end: string): boolean {
  if (process.env.DASHBOARD_KPI_FAST_CONVERSIONS !== "1") return false;
  return rangeDayCountInclusive(start, end) >= 90;
}

/** One row for reporting: paid platform key wins, else visit/source class. */
export function reportChannelKey(row: EnrichedKpiRow): string {
  if (row._platform_source) return row._platform_source;
  return row._source_class ?? "direct";
}

export function filterEnrichedRowsByDashboardSources(
  rows: EnrichedKpiRow[],
  sources: string[] | undefined
): EnrichedKpiRow[] {
  if (!sources?.length) return rows;
  return rows.filter((r) => {
    const platformHit = Boolean(r._platform_source && sources.includes(r._platform_source));
    const classHit = Boolean(r._source_class && sources.includes(r._source_class));
    return platformHit || classHit;
  });
}

export async function fetchAndEnrichKpiConversionRows(
  admin: SupabaseClient,
  projectId: string,
  start: string,
  end: string,
  select: string
): Promise<{ rows: EnrichedKpiRow[]; pagesFetched: number }> {
  const from = `${start}T00:00:00.000Z`;
  const to = `${end}T23:59:59.999Z`;
  const skipVisits = shouldSkipVisitAttributionForKpi(start, end);

  const { rows: convRows, pagesFetched: convPages } = await fetchConversionEventsPaginated(
    admin,
    projectId,
    from,
    to,
    select
  );

  type VisitRow = {
    visitor_id: string | null;
    source_classification: string | null;
    traffic_source: string | null;
    traffic_platform: string | null;
    created_at: string;
  };

  const raw = convRows as KpiConversionRow[];
  const visitorIds = Array.from(new Set(raw.map((r) => r.visitor_id).filter((v): v is string => !!v)));

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

  const enriched: EnrichedKpiRow[] = raw.map((r) => {
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

  return { rows: enriched, pagesFetched: convPages };
}

export async function sumPurchaseRevenueProjectCurrency(
  admin: SupabaseClient,
  projectId: string,
  purchases: EnrichedKpiRow[]
): Promise<{ revenue: number; projectCurrency: "USD" | "KZT"; currency_diagnostics: CurrencyDiagnostics }> {
  const projectCurrency = await resolveProjectDisplayCurrency(admin, projectId);

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
  let revenue = 0;
  for (const r of purchases) {
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
    revenue += convertMoneyStrict(amount, fromCurrency, projectCurrency, dayRate, currencyDiagnostics);
  }

  if (currencyDiagnostics.reason_codes.length > 0) {
    console.warn("[KPI_CURRENCY_DIAGNOSTICS]", {
      projectId,
      reason_codes: currencyDiagnostics.reason_codes,
      warnings: currencyDiagnostics.warnings,
    });
  }

  return { revenue, projectCurrency, currency_diagnostics: currencyDiagnostics };
}

export async function resolveProjectDisplayCurrency(
  admin: SupabaseClient,
  projectId: string
): Promise<"USD" | "KZT"> {
  const { data: projectRow } = await admin
    .from("projects")
    .select("currency")
    .eq("id", projectId)
    .maybeSingle();
  return String((projectRow as { currency?: string | null } | null)?.currency ?? "USD")
    .trim()
    .toUpperCase() === "KZT"
    ? "KZT"
    : "USD";
}

/** Sum converted purchase revenue per reportChannelKey (full KPI methodology). */
export async function aggregatePurchaseRevenueByReportChannel(
  admin: SupabaseClient,
  projectId: string,
  purchases: EnrichedKpiRow[]
): Promise<Record<string, number>> {
  if (purchases.length === 0) return {};
  const projectCurrency = await resolveProjectDisplayCurrency(admin, projectId);
  const days = purchases.map((r) => String(r.created_at ?? "").slice(0, 10));
  const [usdToKztRateByDay, latestUsdToKztRate] =
    projectCurrency === "KZT"
      ? await Promise.all([getUsdToKztRateMapForDays(admin, days), getLatestUsdToKztRate(admin)])
      : [new Map<string, number>(), null];

  const currencyDiagnostics = createCurrencyDiagnostics();
  const byChannel: Record<string, number> = {};

  for (const r of purchases) {
    const amount = Number(r.value ?? 0) || 0;
    const normalized = normalizeCurrencyCode(r.currency);
    const fromCurrency = normalized ?? projectCurrency;
    const day = String(r.event_time ?? r.created_at ?? "").slice(0, 10);
    const dayRate = resolveUsdToKztRateForDay(day, usdToKztRateByDay, latestUsdToKztRate, currencyDiagnostics);
    const converted = convertMoneyStrict(amount, fromCurrency, projectCurrency, dayRate, currencyDiagnostics);
    const key = reportChannelKey(r);
    byChannel[key] = (byChannel[key] ?? 0) + converted;
  }

  return byChannel;
}
