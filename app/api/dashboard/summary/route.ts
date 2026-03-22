import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/app/lib/supabaseAdmin";
import { getCanonicalSummary } from "@/app/lib/dashboardCanonical";
import { applyBackfillMetadata, ensureBackfill } from "@/app/lib/dashboardBackfill";
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

  // If only class sources (direct / organic / referral) are selected, there is no paid spend.
  // In that case we should return zero spend instead of "all" spend.
  const PLATFORM_SOURCES = ["meta", "google", "tiktok", "yandex"];
  const hasSources = sources && sources.length > 0;
  const hasAnyPlatformSource =
    hasSources && sources!.some((s) => PLATFORM_SOURCES.includes(s.toLowerCase()));
  if (hasSources && !hasAnyPlatformSource) {
    const body = {
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
    console.log("[SUMMARY_RETURN_CLASS_ONLY]", {
      sources,
      totals: body.totals,
    });
    return NextResponse.json(body);
  }

  const access = await requireProjectAccessOrInternal(req, projectId);
  if (!access.allowed) {
    console.log("[SUMMARY_ACCESS_DENIED]", { projectId, status: access.status });
    return NextResponse.json(access.body, { status: access.status });
  }

  console.log("[ROUTE_BACKFILL_ENTER]", { projectId, start, end, access_source: access.source });
  const admin = supabaseAdmin();
  const backfillResult = await ensureBackfill(admin, projectId, start, end, req.url);
  const didSync = backfillResult.triggered;

  const cacheKey = dashboardCacheKey("summary", projectId, start!, end!, sourcesKey, accountIdsKey);
  // Use cache only when we have a canonical response with non-zero data (avoid stale/zero cache)
  if (!didSync) {
    const cached = dashboardCacheGet(cacheKey) as { totals?: { spend?: number; impressions?: number; clicks?: number }; source?: string } | null;
    if (cached != null) {
      const t = cached?.totals ?? {};
      const hasData = Number(t?.spend ?? 0) !== 0 || Number(t?.impressions ?? 0) !== 0 || Number(t?.clicks ?? 0) !== 0;
      const fromCanonical = cached?.source === "daily_ad_metrics (canonical)";
      if (hasData && fromCanonical) {
        const merged = applyBackfillMetadata({ ...cached } as Record<string, unknown>, backfillResult);
        console.log("[SUMMARY_RETURN]", { branch: "cache", totals: t, spend: t?.spend, impressions: t?.impressions, clicks: t?.clicks });
        return NextResponse.json(merged);
      }
      console.log("[SUMMARY_SKIP_CACHE]", { reason: !fromCanonical ? "non-canonical source" : "no data", source: cached?.source, totals: t });
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
  const isHistoricalPartial =
    body.backfill && (body.backfill as { historical_sync_started?: boolean; range_partially_covered?: boolean }).historical_sync_started;
  if (!isHistoricalPartial) {
    dashboardCacheSet(cacheKey, body, DASHBOARD_CACHE_TTL.summary);
  }
  const totals = body.totals as { spend: number; impressions: number; clicks: number };
  console.log("[SUMMARY_RETURN]", { branch: "canonical", totals, spend: totals.spend, impressions: totals.impressions, clicks: totals.clicks });
  return NextResponse.json(body);
}