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

    console.log("[ROUTE_BACKFILL_ENTER]", { projectId, start, end });
    const admin = supabaseAdmin();
    const didSync = await ensureBackfill(admin, projectId, start, end, req.url);

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
      const body = {
        success: true,
        source: "daily_ad_metrics (canonical)",
        points,
      };
      dashboardCacheSet(cacheKey, body, DASHBOARD_CACHE_TTL.timeseries);
      console.log("[TIMESERIES_RETURN]", { branch: "canonical", pointsCount: body.points.length, firstSpend: body.points[0]?.spend, totalsSpend: body.points.reduce((s, p) => s + p.spend, 0) });
      return NextResponse.json(body);
    }

    // Fallback: RPC (when canonical returns no rows)
    const { data, error } = await admin.rpc("dashboard_meta_timeseries", {
      p_project_id: projectId,
      p_start: start,
      p_end: end,
    });

    if (error) {
      return NextResponse.json(
        { success: false, error: error.message ?? error },
        { status: 500 }
      );
    }

    const points = (data ?? []).map((r: any) => {
      const spend = Number(r.spend ?? 0) || 0;
      const purchases = Number(r.purchases ?? 0) || 0;

      return {
        date: String(r.day),
        spend,
        clicks: Number(r.clicks ?? 0) || 0,
        sales: purchases,
        revenue: Number(r.revenue ?? 0) || 0,
        roas: spend > 0 ? (Number(r.revenue ?? 0) || 0) / spend : 0,
      };
    });

    const body = {
      success: true,
      source: "dashboard_meta_timeseries (rpc)",
      points,
    };
    dashboardCacheSet(cacheKey, body, DASHBOARD_CACHE_TTL.timeseries);
    console.log("[TIMESERIES_RETURN]", { branch: "rpc", pointsCount: body.points.length, firstSpend: body.points[0]?.spend });
    return NextResponse.json(body);
  } catch (e: any) {
    return NextResponse.json(
      { success: false, error: e?.message ?? String(e) },
      { status: 500 }
    );
  }
}