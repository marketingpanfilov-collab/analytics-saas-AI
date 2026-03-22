/**
 * GET /api/executive-summary?project_id=...&days=30
 * V12: Executive Summary Layer. Aggregates Data Quality, Assistant, Anomalies,
 * Budget Optimization, and Chains/Journeys into a rule-based management summary.
 */
import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/app/lib/supabaseAdmin";
import { computeDataQualityScore } from "@/app/lib/dataQualityScore";
import { getAttributionAnomalies } from "@/app/lib/attributionAnomalies";
import { buildAttributionAssistant } from "@/app/lib/attributionAssistant";
import { buildAttributionChains } from "@/app/lib/attributionDebugger";
import { buildJourneysFromChains } from "@/app/lib/attributionJourney";
import { buildBudgetOptimization, type JourneyForBudget } from "@/app/lib/budgetOptimizationInsights";
import { buildExecutiveSummaryLayer } from "@/app/lib/executiveSummary";

const DEFAULT_DAYS = 30;
const JOURNEY_CHAINS_LIMIT = 400;

function parseDays(v: string | null): number {
  if (v == null) return DEFAULT_DAYS;
  const n = parseInt(v, 10);
  return Number.isFinite(n) && n >= 1 && n <= 90 ? n : DEFAULT_DAYS;
}

export async function GET(req: Request) {
  try {
    const { searchParams } = new URL(req.url);
    const projectId = searchParams.get("project_id")?.trim() ?? null;
    const days = parseDays(searchParams.get("days"));

    if (!projectId) {
      return NextResponse.json(
        { success: false, error: "project_id is required" },
        { status: 400 }
      );
    }

    const admin = supabaseAdmin();

    const [dataQuality, anomalies, chainResult] = await Promise.all([
      computeDataQualityScore(admin, projectId, days),
      getAttributionAnomalies(admin, {
        project_id: projectId,
        current_window_hours: 24,
        baseline_days: 7,
      }),
      buildAttributionChains(admin, {
        project_id: projectId,
        days,
        page: 1,
        page_size: JOURNEY_CHAINS_LIMIT,
      }),
    ]);

    const assistant = buildAttributionAssistant({ anomalies, dataQuality });

    const journeys = buildJourneysFromChains(chainResult.chains);
    const forBudget: JourneyForBudget[] = journeys.map((j) => ({
      attribution_models: j.attribution_models,
      touchpoints: j.touchpoints.map((t) => ({ type: t.type, source: t.source })),
      summary: { revenue_total: j.summary.revenue_total, purchases_count: j.summary.purchases_count },
    }));
    const budgetOptimization = buildBudgetOptimization(forBudget, null);

    const repeatPurchaseJourneysCount = journeys.filter((j) => j.summary.purchases_count > 1).length;

    const result = buildExecutiveSummaryLayer({
      dataQuality,
      assistant: {
        summary: assistant.summary,
        diagnoses: assistant.diagnoses,
        priority_actions: assistant.priority_actions,
      },
      anomalies,
      budgetOptimization,
      totalChains: chainResult.total,
      repeatPurchaseJourneysCount,
    });

    return NextResponse.json({
      success: true,
      has_sufficient_data: result.has_sufficient_data,
      summary: result.summary,
      key_findings: result.key_findings,
      key_risks: result.key_risks,
      growth_opportunities: result.growth_opportunities,
      priority_actions: result.priority_actions,
    });
  } catch (e) {
    console.error("[EXECUTIVE_SUMMARY_ERROR]", e);
    return NextResponse.json(
      { success: false, error: e instanceof Error ? e.message : "Internal error" },
      { status: 500 }
    );
  }
}
