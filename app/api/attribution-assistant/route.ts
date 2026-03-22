/**
 * GET /api/attribution-assistant?project_id=...&days=30
 * Product-facing API. Returns summary, diagnoses, priority_actions from
 * anomalies + data quality (rule-based, no LLM).
 */
import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/app/lib/supabaseAdmin";
import { getAttributionAnomalies } from "@/app/lib/attributionAnomalies";
import { computeDataQualityScore } from "@/app/lib/dataQualityScore";
import { buildAttributionAssistant } from "@/app/lib/attributionAssistant";

const DEFAULT_DAYS = 30;

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

    const [anomalies, dataQuality] = await Promise.all([
      getAttributionAnomalies(admin, {
        project_id: projectId,
        current_window_hours: 24,
        baseline_days: 7,
      }),
      computeDataQualityScore(admin, projectId, days),
    ]);

    const result = buildAttributionAssistant({
      anomalies,
      dataQuality,
    });

    return NextResponse.json({
      success: true,
      summary: result.summary,
      diagnoses: result.diagnoses,
      priority_actions: result.priority_actions,
    });
  } catch (e) {
    console.error("attribution-assistant", e);
    return NextResponse.json(
      { success: false, error: e instanceof Error ? e.message : "Internal error" },
      { status: 500 }
    );
  }
}
