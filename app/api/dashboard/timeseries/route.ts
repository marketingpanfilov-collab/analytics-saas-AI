import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/app/lib/supabaseAdmin";
import { getCanonicalTimeseries } from "@/app/lib/dashboardCanonical";
import { ensureBackfill } from "@/app/lib/dashboardBackfill";
import {
  dashboardCacheKey,
  dashboardCacheGet,
  dashboardCacheSet,
  DASHBOARD_CACHE_TTL,
} from "@/app/lib/dashboardCache";
import { requireProjectAccessOrInternal } from "@/app/lib/auth/requireProjectAccessOrInternal";

function toISODate(s: string | null) {
  if (!s) return null;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return null;
  return s;
}

export async function GET(req: Request) {
  try {
    const { searchParams } = new URL(req.url);
    const projectId = searchParams.get("project_id");
    const start = toISODate(searchParams.get("start"));
    const end = toISODate(searchParams.get("end"));
    const sourcesRaw = searchParams.get("sources");
    const sources = sourcesRaw ? sourcesRaw.split(",").map((s) => s.trim()).filter(Boolean) : undefined;
    const accountIdsRaw = searchParams.get("account_ids");
    const accountIds = accountIdsRaw ? accountIdsRaw.split(",").map((s) => s.trim()).filter(Boolean) : undefined;
    const sourcesKey = sources?.length ? [...sources].sort().join(",") : "all";
    const accountIdsKey = accountIds?.length ? [...accountIds].sort().join(",") : "all";

    if (!projectId) {
      return NextResponse.json(
        { success: false, error: "project_id обязателен" },
        { status: 400 }
      );
    }
    if (!start || !end) {
      return NextResponse.json(
        { success: false, error: "start и end обязательны (YYYY-MM-DD)" },
        { status: 400 }
      );
    }

    // If only class sources (direct / organic / referral) are selected, there is no paid spend timeseries.
    // In that case we should return an empty points array instead of "all" spend.
    const PLATFORM_SOURCES = ["meta", "google", "tiktok", "yandex"];
    const hasSources = sources && sources.length > 0;
    const hasAnyPlatformSource =
      hasSources && sources!.some((s) => PLATFORM_SOURCES.includes(s.toLowerCase()));
    if (hasSources && !hasAnyPlatformSource) {
      const body = {
        success: true,
        source: "daily_ad_metrics (canonical)",
        points: [] as { date: string; spend: number; clicks: number; sales: number; revenue: number; roas: number }[],
      };
      console.log("[TIMESERIES_RETURN_CLASS_ONLY]", {
        sources,
        pointsCount: body.points.length,
      });
      return NextResponse.json(body);
    }

    const access = await requireProjectAccessOrInternal(req, projectId);
    if (!access.allowed) {
      console.log("[TIMESERIES_ACCESS_DENIED]", { projectId, status: access.status });
      return NextResponse.json(access.body, { status: access.status });
    }

    console.log("[ROUTE_BACKFILL_ENTER]", { projectId, start, end, access_source: access.source });
    const admin = supabaseAdmin();
    const backfillResult = await ensureBackfill(admin, projectId, start, end, req.url);
    const didSync = backfillResult.triggered;

    const cacheKey = dashboardCacheKey("timeseries", projectId, start!, end!, sourcesKey, accountIdsKey);
    if (!didSync) {
      const cached = dashboardCacheGet(cacheKey);
      if (cached != null) {
        const pts = (cached as { points?: unknown[] })?.points ?? [];
        console.log("[TIMESERIES_RETURN]", { branch: "cache", pointsCount: pts.length, firstSpend: (pts[0] as { spend?: number })?.spend });
        return NextResponse.json(cached);
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
      if (backfillResult.triggered && backfillResult.reason === "historical") {
        body.backfill = {
          range_partially_covered: true,
          historical_sync_started: true,
          intervals: backfillResult.historicalSyncIntervals,
        };
      }
      const isHistoricalPartial =
        body.backfill && (body.backfill as { historical_sync_started?: boolean }).historical_sync_started;
      if (!isHistoricalPartial) {
        dashboardCacheSet(cacheKey, body, DASHBOARD_CACHE_TTL.timeseries);
      }
      const pts = body.points as { spend: number }[];
      console.log("[TIMESERIES_RETURN]", { branch: "canonical", pointsCount: pts.length, firstSpend: pts[0]?.spend, totalsSpend: pts.reduce((s, p) => s + p.spend, 0) });
      return NextResponse.json(body);
    }

    // No RPC fallback: dashboard_meta_timeseries does not respect sources/accountIds and can diverge from summary.
    // Return empty points so chart and summary stay consistent (both from canonical or both empty).
    const emptyBody = {
      success: true,
      source: "daily_ad_metrics (canonical)",
      points: [] as { date: string; spend: number; clicks: number; sales: number; revenue: number; roas: number }[],
    };
    console.log("[TIMESERIES_RETURN]", { branch: "canonical", fallback_reason: "no_canonical_rows", pointsCount: 0 });
    return NextResponse.json(emptyBody);
  } catch (e: any) {
    return NextResponse.json(
      { success: false, error: e?.message ?? String(e) },
      { status: 500 }
    );
  }
}