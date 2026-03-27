import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/app/lib/supabaseAdmin";
import { buildKpiPayload, parseDashboardRangeParams } from "@/app/lib/dashboardPayloads";
import { requireProjectAccessOrInternal } from "@/app/lib/auth/requireProjectAccessOrInternal";

export async function GET(req: Request) {
  const params = parseDashboardRangeParams(new URL(req.url).searchParams);
  if (!params) {
    return NextResponse.json({ success: false, error: "project_id required" }, { status: 400 });
  }
  const { projectId, start, end, sources } = params;

  const access = await requireProjectAccessOrInternal(req, projectId);
  if (!access.allowed) {
    console.log("[KPI_ACCESS_DENIED]", { projectId, status: access.status });
    return NextResponse.json(access.body, { status: access.status });
  }

  const admin = supabaseAdmin();

  try {
    const body = await buildKpiPayload(admin, projectId, start, end, sources);
    return NextResponse.json(body);
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
