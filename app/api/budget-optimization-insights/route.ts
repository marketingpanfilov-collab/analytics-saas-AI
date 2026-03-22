/**
 * GET /api/budget-optimization-insights
 * Params: project_id, days
 * Builds journeys from chains, runs budget optimization (v11), returns channel metrics, insights, portfolio summary, priority actions.
 */
import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/app/lib/supabaseAdmin";
import { buildAttributionChains } from "@/app/lib/attributionDebugger";
import { buildJourneysFromChains } from "@/app/lib/attributionJourney";
import { buildBudgetOptimization, type JourneyForBudget } from "@/app/lib/budgetOptimizationInsights";

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
    const chainResult = await buildAttributionChains(admin, {
      project_id: projectId,
      days,
      page: 1,
      page_size: JOURNEY_CHAINS_LIMIT,
    });

    const journeys = buildJourneysFromChains(chainResult.chains);
    const forBudget: JourneyForBudget[] = journeys.map((j) => ({
      attribution_models: j.attribution_models,
      touchpoints: j.touchpoints.map((t) => ({ type: t.type, source: t.source })),
      summary: { revenue_total: j.summary.revenue_total, purchases_count: j.summary.purchases_count },
    }));

    // Optional: pass spend by source when available (e.g. from integrations)
    const spendBySource: Record<string, number> | null = null;

    const result = buildBudgetOptimization(forBudget, spendBySource);

    return NextResponse.json({
      success: true,
      ...result,
    });
  } catch (e) {
    console.error("[BUDGET_OPTIMIZATION_INSIGHTS_ERROR]", e);
    return NextResponse.json(
      { success: false, error: e instanceof Error ? e.message : "Internal error" },
      { status: 500 }
    );
  }
}
