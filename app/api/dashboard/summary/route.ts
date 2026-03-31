import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/app/lib/supabaseAdmin";
import {
  buildClassOnlySummaryBody,
  buildSummaryPayload,
  isNonPlatformSourcesOnly,
  parseDashboardRangeParams,
} from "@/app/lib/dashboardPayloads";
import { requireProjectAccessOrInternal } from "@/app/lib/auth/requireProjectAccessOrInternal";
import { ensureBackfill } from "@/app/lib/dashboardBackfill";

export async function GET(req: Request) {
  const params = parseDashboardRangeParams(new URL(req.url).searchParams);
  if (!params) {
    return NextResponse.json(
      { success: false, error: "project_id обязателен; start и end обязательны (YYYY-MM-DD)" },
      { status: 400 }
    );
  }
  const { projectId, start, end, sources } = params;

  if (isNonPlatformSourcesOnly(sources)) {
    const body = buildClassOnlySummaryBody();
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
  const backfillResult = await ensureBackfill(admin, projectId, start, end, req.url, {
    sources: params.sources ?? null,
    accountIds: params.accountIds ?? null,
  });
  const didSync = backfillResult.triggered;

  const body = await buildSummaryPayload(admin, params, backfillResult, didSync);
  const totals = body.totals as { spend: number; impressions: number; clicks: number };
  console.log("[SUMMARY_RETURN]", { branch: "canonical", totals, spend: totals.spend, impressions: totals.impressions, clicks: totals.clicks });
  return NextResponse.json(body);
}
