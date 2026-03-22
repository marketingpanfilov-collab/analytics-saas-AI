/**
 * GET /api/data-quality?project_id=...&days=30
 *
 * Returns data quality score (0–100) and breakdown from redirect clicks, visits, conversions.
 */
import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/app/lib/supabaseAdmin";
import { computeDataQualityScore } from "@/app/lib/dataQualityScore";

const DEFAULT_DAYS = 30;
const ALLOWED_DAYS = [7, 30, 90];

function parseDays(v: string | null): number {
  if (v == null) return DEFAULT_DAYS;
  const n = parseInt(v, 10);
  if (!Number.isFinite(n) || n < 1) return DEFAULT_DAYS;
  if (ALLOWED_DAYS.includes(n)) return n;
  if (n <= 7) return 7;
  if (n <= 30) return 30;
  return 90;
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
    const result = await computeDataQualityScore(admin, projectId, days);

    return NextResponse.json({
      success: true,
      has_data: result.has_data,
      score: result.score,
      label: result.label,
      breakdown: result.breakdown,
      stats: result.stats,
      issues: result.issues,
      recommendations: result.recommendations,
    });
  } catch (e) {
    console.error("[DATA_QUALITY_ERROR]", e);
    return NextResponse.json(
      { success: false, error: "Internal error" },
      { status: 500 }
    );
  }
}
