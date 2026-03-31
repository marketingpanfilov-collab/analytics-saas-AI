/**
 * GET /api/assisted-attribution?project_id=...&days=30&source=meta
 *
 * Returns assisted attribution: conversions with full visit path and channel roles
 * (first_touch, assist, last_touch), plus aggregated channels table.
 */
import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/app/lib/supabaseAdmin";
import { buildAssistedAttribution } from "@/app/lib/assistedAttribution";
import { requireProjectAccessOrInternal } from "@/app/lib/auth/requireProjectAccessOrInternal";

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
    const start = searchParams.get("start")?.trim() ?? null;
    const end = searchParams.get("end")?.trim() ?? null;
    const sourcesRaw = searchParams.get("sources")?.trim() ?? "";
    const sources = sourcesRaw
      ? sourcesRaw
          .split(",")
          .map((s) => s.trim().toLowerCase())
          .filter(Boolean)
      : null;
    const accountIdsRaw = searchParams.get("account_ids")?.trim() ?? "";
    const account_ids = accountIdsRaw
      ? accountIdsRaw
          .split(",")
          .map((s) => s.trim())
          .filter(Boolean)
      : null;

    if (!projectId) {
      return NextResponse.json(
        { success: false, error: "project_id is required" },
        { status: 400 }
      );
    }
    const access = await requireProjectAccessOrInternal(req, projectId);
    if (!access.allowed) return NextResponse.json(access.body, { status: access.status });

    const admin = supabaseAdmin();
    const { conversions, channels, diagnostics } = await buildAssistedAttribution(admin, {
      project_id: projectId,
      days,
      start,
      end,
      sources,
      account_ids,
      source: source || undefined,
    });

    return NextResponse.json({
      success: true,
      conversions,
      channels,
      diagnostics: {
        ...diagnostics,
        source_filter_applied: Boolean(source || (sources && sources.length > 0)),
        account_filter_supported: true,
      },
    });
  } catch (e) {
    console.error("[ASSISTED_ATTRIBUTION_ERROR]", e);
    return NextResponse.json(
      { success: false, error: "Internal error" },
      { status: 500 }
    );
  }
}
