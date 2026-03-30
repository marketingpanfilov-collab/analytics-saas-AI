/**
 * GET /api/reports/marketing-summary?project_id=...&start=...&end=...
 * Read-only: не вызываем ensureBackfill (синк и догрузка — на главном дашборде / bundle), чтобы отчёт не триггерил
 * фоновый sync и клиентский поллинг «догрузки».
 */
import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/app/lib/supabaseAdmin";
import { getMarketingSummary } from "@/app/lib/marketingReport";
import { parseDashboardRangeParams } from "@/app/lib/dashboardPayloads";
import { requireProjectAccessOrInternal } from "@/app/lib/auth/requireProjectAccessOrInternal";
import { applyBackfillMetadata, type EnsureBackfillResult } from "@/app/lib/dashboardBackfill";

export async function GET(req: Request) {
  try {
    const params = parseDashboardRangeParams(new URL(req.url).searchParams);
    if (!params) {
      return NextResponse.json(
        { success: false, error: "project_id обязателен; start и end обязательны (YYYY-MM-DD)" },
        { status: 400 }
      );
    }

    const { projectId, start, end, sources, accountIds } = params;

    const access = await requireProjectAccessOrInternal(req, projectId);
    if (!access.allowed) {
      return NextResponse.json(access.body, { status: access.status });
    }

    const { searchParams } = new URL(req.url);
    const targetCacRaw = searchParams.get("target_cac");
    const targetRoasRaw = searchParams.get("target_roas");
    const target_cac = targetCacRaw != null && targetCacRaw !== "" ? Number(targetCacRaw) : null;
    const target_roas = targetRoasRaw != null && targetRoasRaw !== "" ? Number(targetRoasRaw) : null;

    const admin = supabaseAdmin();

    const backfillResult: EnsureBackfillResult = { triggered: false, reason: null };

    const result = await getMarketingSummary(admin, {
      project_id: projectId,
      start,
      end,
      target_cac: Number.isFinite(target_cac) ? target_cac : null,
      target_roas: Number.isFinite(target_roas) ? target_roas : null,
      sources: sources?.length ? sources : null,
      account_ids: accountIds?.length ? accountIds : null,
    });

    const payload = applyBackfillMetadata(
      {
        success: true,
        plan: result.plan,
        kpi: result.kpi,
        budget: result.budget,
        platform_budget: result.platform_budget,
        campaign_alerts: result.campaign_alerts,
        campaign_table: result.campaign_table,
        forecast: result.forecast ?? null,
        marketing_score: result.marketing_score,
        marketing_score_detail: result.marketing_score_detail,
        canonical_ad_row_count: result.canonical_ad_row_count,
        revenue_by_acquisition_source: result.revenue_by_acquisition_source,
        source_options: result.source_options,
        channel_summary: result.channel_summary,
        backfill_status: {
          triggered: backfillResult.triggered,
          reason: backfillResult.reason,
          range_partially_covered: backfillResult.rangePartiallyCovered ?? false,
          historical_sync_intervals: backfillResult.historicalSyncIntervals ?? [],
        },
      },
      backfillResult
    );

    return NextResponse.json(payload);
  } catch (e) {
    console.error("[MARKETING_SUMMARY_ERROR]", e);
    return NextResponse.json(
      { success: false, error: "Internal error" },
      { status: 500 }
    );
  }
}
