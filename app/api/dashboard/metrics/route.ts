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

  const range = start && end ? { start, end } : defaultDateRange();
  const admin = supabaseAdmin();

  let didSync = false;
  if (projectId) {
    console.log("[ROUTE_BACKFILL_ENTER]", { projectId, start: range.start, end: range.end });
    didSync = await ensureBackfill(admin, projectId, range.start, range.end, req.url);
  }

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
      console.log("[METRICS_RESPONSE_RAW]", { from: "cache", rowCount: Array.isArray(cached) ? cached.length : 0 });
      return NextResponse.json(cached);
    }
  }

  // Canonical: when project_id provided
  if (projectId) {
    const canonical = await getCanonicalMetrics(admin, projectId, range.start, range.end, { sources, accountIds });
    if (canonical && canonical.length > 0) {
      dashboardCacheSet(cacheKey, canonical, DASHBOARD_CACHE_TTL.metrics);
      console.log("[METRICS_RESPONSE_RAW]", { from: "canonical", rowCount: canonical.length });
      return NextResponse.json(canonical);
    }
  }

  // Legacy: dashboard_meta_metrics table (no project filter)
  const { data, error } = await admin
    .from("dashboard_meta_metrics")
    .select("*")
    .order("day", { ascending: true });

  if (error) {
    return NextResponse.json({ error }, { status: 500 });
  }

  const result = data ?? [];
  dashboardCacheSet(cacheKey, result, DASHBOARD_CACHE_TTL.metrics);
  console.log("[METRICS_RESPONSE_RAW]", { from: "legacy", rowCount: result.length });
  return NextResponse.json(result);
}