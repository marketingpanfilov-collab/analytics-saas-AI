/**
 * GET /api/top-attribution-paths?project_id=...&days=30&limit=5
 *
 * Returns top attribution paths (most frequent user journeys to conversion).
 */
import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/app/lib/supabaseAdmin";
import { buildTopAttributionPaths } from "@/app/lib/topAttributionPaths";

const DEFAULT_DAYS = 30;
const DEFAULT_LIMIT = 5;
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

function parseLimit(v: string | null): number {
  if (v == null) return DEFAULT_LIMIT;
  const n = parseInt(v, 10);
  return Number.isFinite(n) && n >= 1 && n <= 20 ? n : DEFAULT_LIMIT;
}

export async function GET(req: Request) {
  try {
    const { searchParams } = new URL(req.url);
    const projectId = searchParams.get("project_id")?.trim() ?? null;
    const days = parseDays(searchParams.get("days"));
    const limit = parseLimit(searchParams.get("limit"));

    if (!projectId) {
      return NextResponse.json(
        { success: false, error: "project_id is required" },
        { status: 400 }
      );
    }

    const admin = supabaseAdmin();
    const paths = await buildTopAttributionPaths(admin, {
      project_id: projectId,
      days,
      limit,
    });

    return NextResponse.json({
      success: true,
      paths,
    });
  } catch (e) {
    console.error("[TOP_ATTRIBUTION_PATHS_ERROR]", e);
    return NextResponse.json(
      { success: false, error: "Internal error" },
      { status: 500 }
    );
  }
}
