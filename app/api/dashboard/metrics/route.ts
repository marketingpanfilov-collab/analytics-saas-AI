import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/app/lib/supabaseAdmin";
import { getCanonicalMetrics } from "@/app/lib/dashboardCanonical";
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

function defaultDateRange(): { start: string; end: string } {
  const end = new Date();
  const start = new Date(end);
  start.setDate(start.getDate() - 30);
  return {
    start: start.toISOString().slice(0, 10),
    end: end.toISOString().slice(0, 10),
  };
}

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const projectId = searchParams.get("project_id") ?? "";
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

  const access = await requireProjectAccessOrInternal(req, projectId);
  if (!access.allowed) {
    console.log("[METRICS_ACCESS_DENIED]", { projectId, status: access.status });
    return NextResponse.json(access.body, { status: access.status });
  }

  const range = start && end ? { start, end } : defaultDateRange();
  const admin = supabaseAdmin();

  let didSync = false;
  console.log("[ROUTE_BACKFILL_ENTER]", { projectId, start: range.start, end: range.end, access_source: access.source });
  const backfillResult = await ensureBackfill(admin, projectId, range.start, range.end, req.url);
  didSync = backfillResult.triggered;

  const cacheKey = dashboardCacheKey(
    "metrics",
    projectId,
    range.start,
    range.end,
    sourcesKey,
    accountIdsKey
  );
  if (!didSync) {
    const cached = dashboardCacheGet(cacheKey);
    if (cached != null) {
      console.log("[METRICS_RESPONSE_RAW]", { branch: "cache", rowCount: Array.isArray(cached) ? cached.length : 0 });
      return NextResponse.json(cached);
    }
  }

  const canonical = await getCanonicalMetrics(admin, projectId, range.start, range.end, { sources, accountIds });
  if (canonical && canonical.length > 0) {
    if (!didSync) {
      dashboardCacheSet(cacheKey, canonical, DASHBOARD_CACHE_TTL.metrics);
    }
    console.log("[METRICS_RESPONSE_RAW]", { branch: "canonical", rowCount: canonical.length });
    return NextResponse.json(canonical);
  }

  // No legacy fallback: dashboard_meta_metrics has no project filter and could leak data. Return empty.
  console.log("[METRICS_RESPONSE_RAW]", { branch: "canonical", fallback_reason: "no_canonical_rows", rowCount: 0 });
  return NextResponse.json([]);
}