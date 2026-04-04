import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/app/lib/supabaseAdmin";
import {
  buildClassOnlyTimeseriesBody,
  buildTimeseriesPayload,
  isNonPlatformSourcesOnly,
  parseDashboardRangeParams,
} from "@/app/lib/dashboardPayloads";
import { requireProjectAccessOrInternal } from "@/app/lib/auth/requireProjectAccessOrInternal";
import { billingAnalyticsReadGateFromAccess } from "@/app/lib/auth/requireBillingAccess";
import { ensureBackfill } from "@/app/lib/dashboardBackfill";

export async function GET(req: Request) {
  try {
    const params = parseDashboardRangeParams(new URL(req.url).searchParams);
    if (!params) {
      return NextResponse.json(
        { success: false, error: "project_id обязателен; start и end обязательны (YYYY-MM-DD)" },
        { status: 400 }
      );
    }
    const { projectId, start, end, sources } = params;

    if (isNonPlatformSourcesOnly(sources)) {
      const body = buildClassOnlyTimeseriesBody();
      console.log("[TIMESERIES_RETURN_CLASS_ONLY]", {
        sources,
        pointsCount: (body.points as unknown[])?.length ?? 0,
      });
      return NextResponse.json(body);
    }

    const access = await requireProjectAccessOrInternal(req, projectId);
    if (!access.allowed) {
      console.log("[TIMESERIES_ACCESS_DENIED]", { projectId, status: access.status });
      return NextResponse.json(access.body, { status: access.status });
    }

    const billing = await billingAnalyticsReadGateFromAccess(access);
    if (!billing.ok) return billing.response;

    console.log("[ROUTE_BACKFILL_ENTER]", { projectId, start, end, access_source: access.source });
    const admin = supabaseAdmin();
    const backfillResult = await ensureBackfill(admin, projectId, start, end, req.url);
    const didSync = backfillResult.triggered;

    const body = await buildTimeseriesPayload(admin, params, backfillResult, didSync);
    const pts = body.points as { spend: number }[];
    console.log("[TIMESERIES_RETURN]", {
      branch: "canonical",
      pointsCount: pts?.length ?? 0,
      firstSpend: pts?.[0]?.spend,
      totalsSpend: Array.isArray(pts) ? pts.reduce((s, p) => s + p.spend, 0) : 0,
    });
    return NextResponse.json(body);
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    return NextResponse.json({ success: false, error: msg }, { status: 500 });
  }
}
