import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/app/lib/supabaseAdmin";
import { buildTimeseriesConversionsPayload, parseDashboardRangeParams } from "@/app/lib/dashboardPayloads";
import { requireProjectAccessOrInternal } from "@/app/lib/auth/requireProjectAccessOrInternal";
import { billingAnalyticsReadGateFromAccess } from "@/app/lib/auth/requireBillingAccess";

/**
 * GET /api/dashboard/timeseries-conversions
 * Returns daily registrations and sales with same filtering as /api/dashboard/kpi.
 * Used by dashboard "Динамика расхода" multi-metric chart.
 */
export async function GET(req: Request) {
  const params = parseDashboardRangeParams(new URL(req.url).searchParams);
  if (!params) {
    return NextResponse.json({ success: false, error: "project_id required" }, { status: 400 });
  }
  const { projectId, start, end, sources } = params;

  const access = await requireProjectAccessOrInternal(req, projectId);
  if (!access.allowed) {
    console.log("[TIMESERIES_CONVERSIONS_ACCESS_DENIED]", { projectId, status: access.status });
    return NextResponse.json(access.body, { status: access.status });
  }

  const billing = await billingAnalyticsReadGateFromAccess(access);
  if (!billing.ok) return billing.response;

  const admin = supabaseAdmin();

  try {
    const body = await buildTimeseriesConversionsPayload(admin, projectId, start, end, sources);
    return NextResponse.json(body);
  } catch (e: unknown) {
    console.error("[TIMESERIES_CONVERSIONS_FATAL]", e);
    return NextResponse.json(
      { success: false, error: e instanceof Error ? e.message : "Internal error" },
      { status: 500 }
    );
  }
}
