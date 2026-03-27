import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/app/lib/supabaseAdmin";
import { requireProjectAccessOrInternal } from "@/app/lib/auth/requireProjectAccessOrInternal";
import {
  convertMoneyStrict,
  createCurrencyDiagnostics,
  getLatestUsdToKztRate,
  getUsdToKztRateMapForDays,
  normalizeCurrencyCode,
  pushCurrencyReason,
  resolveUsdToKztRateForDay,
} from "@/app/lib/currencyNormalization";

function toISODate(s: string | null) {
  if (!s) return null;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return null;
  return s;
}

const PLATFORM_SOURCE_VALUES = ["meta", "google", "tiktok", "yandex"] as const;

/** Only real ad platforms count as platform source. "pixel" etc. are ingestion channels, not traffic source. */
function normalizePlatformSource(raw: string | null): string | null {
  const v = (raw ?? "").trim().toLowerCase();
  if (!v) return null;
  return PLATFORM_SOURCE_VALUES.includes(v as (typeof PLATFORM_SOURCE_VALUES)[number]) ? v : null;
}

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const projectId = searchParams.get("project_id")?.trim() ?? "";
  const start = toISODate(searchParams.get("start"));
  const end = toISODate(searchParams.get("end"));
  const sourcesRaw = searchParams.get("sources");

  const sources = sourcesRaw
    ? sourcesRaw
        .split(",")
        .map((s) => s.trim().toLowerCase())
        .filter(Boolean)
    : undefined;

  if (!projectId) {
    return NextResponse.json({ success: false, error: "project_id required" }, { status: 400 });
  }
  if (!start || !end) {
    return NextResponse.json(
      { success: false, error: "start and end are required (YYYY-MM-DD)" },
      { status: 400 }
    );
  }

  const access = await requireProjectAccessOrInternal(req, projectId);
  if (!access.allowed) {
    console.log("[KPI_ACCESS_DENIED]", { projectId, status: access.status });
    return NextResponse.json(access.body, { status: access.status });
  }

  const admin = supabaseAdmin();
  const from = `${start}T00:00:00.000Z`;
  const to = `${end}T23:59:59.999Z`;

  try {
    const { data, error } = await admin
      .from("conversion_events")
      .select("event_name, value, currency, source, traffic_source, visitor_id, created_at, event_time")
      .eq("project_id", projectId)
      .gte("created_at", from)
      .lte("created_at", to)
      .in("event_name", ["registration", "purchase"]);

    if (error) {
      console.error("[DASHBOARD_KPI_CONVERSION_ERROR]", error);
      return NextResponse.json({ success: false, error: error.message }, { status: 500 });
    }

    type ConversionRow = {
      event_name: string;
      value: number | null;
      currency?: string | null;
      source: string | null;
      traffic_source: string | null;
      visitor_id: string | null;
      created_at: string;
      event_time: string | null;
    };

    const rows = (data ?? []) as ConversionRow[];

    // Preload visit_source_events to attach source_classification per conversion.
    const visitorIds = Array.from(
      new Set(rows.map((r) => r.visitor_id).filter((v): v is string => !!v))
    );

    type VisitRow = {
      visitor_id: string | null;
      source_classification: string | null;
      created_at: string;
    };

    const lookupFrom = new Date(`${start}T00:00:00.000Z`);
    lookupFrom.setUTCDate(lookupFrom.getUTCDate() - 30);
    const lookupFromIso = lookupFrom.toISOString();

    const visitsByVisitor = new Map<string, VisitRow[]>();
    if (visitorIds.length > 0) {
      const { data: visitData, error: visitError } = await admin
        .from("visit_source_events")
        .select("visitor_id, source_classification, created_at")
        .eq("site_id", projectId)
        .in("visitor_id", visitorIds)
        .gte("created_at", lookupFromIso)
        .lte("created_at", to);

      if (visitError) {
        console.warn("[DASHBOARD_KPI_VISITS_ERROR]", visitError);
      } else {
        for (const v of (visitData ?? []) as VisitRow[]) {
          if (!v.visitor_id) continue;
          const list = visitsByVisitor.get(v.visitor_id) ?? [];
          list.push(v);
          visitsByVisitor.set(v.visitor_id, list);
        }
        // Sort visits per visitor by created_at ascending for efficient "last before conversion" lookup.
        for (const [key, list] of visitsByVisitor.entries()) {
          list.sort((a, b) => (a.created_at < b.created_at ? -1 : a.created_at > b.created_at ? 1 : 0));
          visitsByVisitor.set(key, list);
        }
      }
    }

    const enriched = rows.map((r) => {
      // Only real platforms (meta/google/tiktok/yandex). source="pixel" is ingestion channel, not traffic source.
      const platformSource =
        normalizePlatformSource(r.traffic_source) ?? normalizePlatformSource(r.source);

      let sourceClass: string | null = null;
      if (r.visitor_id) {
        const visits = visitsByVisitor.get(r.visitor_id) ?? [];
        if (visits.length) {
          // Find last visit where created_at <= conversion.created_at
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
        }
      }

      // Direct rule: if we have no detected source (platform or class), treat as direct.
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
        pushCurrencyReason(currencyDiagnostics, "currency_unsupported", `Unsupported currency '${String(r.currency)}'; fallback used.`);
      }
      const day = String(r.event_time ?? r.created_at ?? "").slice(0, 10);
      const dayRate = resolveUsdToKztRateForDay(
        day,
        usdToKztRateByDay,
        latestUsdToKztRate,
        currencyDiagnostics
      );
      return sum + convertMoneyStrict(amount, fromCurrency, projectCurrency, dayRate, currencyDiagnostics);
    }, 0);
    if (currencyDiagnostics.reason_codes.length > 0) {
      console.warn("[KPI_CURRENCY_DIAGNOSTICS]", {
        projectId,
        reason_codes: currencyDiagnostics.reason_codes,
        warnings: currencyDiagnostics.warnings,
      });
    }

    return NextResponse.json({
      success: true,
      registrations: registrationsCount,
      sales: salesCount,
      revenue,
      has_direct: hasDirect,
      currency_diagnostics: currencyDiagnostics,
    });
  } catch (e: unknown) {
    console.error("[DASHBOARD_KPI_CONVERSION_FATAL]", e);
    return NextResponse.json(
      {
        success: false,
        error: e instanceof Error ? e.message : "Internal error",
      },
      { status: 500 }
    );
  }
}

