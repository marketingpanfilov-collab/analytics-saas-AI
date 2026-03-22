/**
 * GET /api/attribution-anomalies
 * Params: project_id (required), window (optional, e.g. 24h), baseline_days (optional, default 7)
 * Returns detected attribution anomalies (current vs baseline).
 */
import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/app/lib/supabaseAdmin";
import { getAttributionAnomalies } from "@/app/lib/attributionAnomalies";

const DEFAULT_WINDOW_HOURS = 24;
const DEFAULT_BASELINE_DAYS = 7;

function parseWindowHours(v: string | null): number {
  if (v == null) return DEFAULT_WINDOW_HOURS;
  const m = v.toLowerCase().match(/^(\d+)\s*h/i);
  if (m) return Math.min(168, Math.max(1, parseInt(m[1], 10)));
  const n = parseInt(v, 10);
  if (Number.isFinite(n) && n >= 1 && n <= 168) return n;
  return DEFAULT_WINDOW_HOURS;
}

function parseBaselineDays(v: string | null): number {
  if (v == null) return DEFAULT_BASELINE_DAYS;
  const n = parseInt(v, 10);
  if (Number.isFinite(n) && n >= 1 && n <= 30) return n;
  return DEFAULT_BASELINE_DAYS;
}

export async function GET(req: Request) {
  try {
    const { searchParams } = new URL(req.url);
    const projectId = searchParams.get("project_id")?.trim() ?? null;
    const windowHours = parseWindowHours(searchParams.get("window") ?? searchParams.get("current_window_hours"));
    const baselineDays = parseBaselineDays(searchParams.get("baseline_days"));

    if (!projectId) {
      return NextResponse.json(
        { success: false, error: "project_id is required" },
        { status: 400 }
      );
    }

    const admin = supabaseAdmin();
    const anomalies = await getAttributionAnomalies(admin, {
      project_id: projectId,
      current_window_hours: windowHours,
      baseline_days: baselineDays,
    });

    return NextResponse.json({
      success: true,
      anomalies,
    });
  } catch (e) {
    console.error("attribution-anomalies", e);
    return NextResponse.json(
      { success: false, error: e instanceof Error ? e.message : "Internal error" },
      { status: 500 }
    );
  }
}
