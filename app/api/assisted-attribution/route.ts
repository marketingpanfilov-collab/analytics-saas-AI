/**
 * GET /api/assisted-attribution?project_id=...&days=30&source=meta
 *
 * Returns assisted attribution: conversions with full visit path and channel roles
 * (first_touch, assist, last_touch), plus aggregated channels table.
 */
import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/app/lib/supabaseAdmin";
import { buildAssistedAttribution } from "@/app/lib/assistedAttribution";

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
    const source = searchParams.get("source")?.trim() ?? null;

    if (!projectId) {
      return NextResponse.json(
        { success: false, error: "project_id is required" },
        { status: 400 }
      );
    }

    const admin = supabaseAdmin();
    const { conversions, channels } = await buildAssistedAttribution(admin, {
      project_id: projectId,
      days,
      source: source || undefined,
    });

    return NextResponse.json({
      success: true,
      conversions,
      channels,
    });
  } catch (e) {
    console.error("[ASSISTED_ATTRIBUTION_ERROR]", e);
    return NextResponse.json(
      { success: false, error: "Internal error" },
      { status: 500 }
    );
  }
}
