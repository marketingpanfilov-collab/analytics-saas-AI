import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/app/lib/supabaseAdmin";
import { buildRevenueAttributionMap } from "@/app/lib/revenueAttributionMap";
import { requireProjectAccessOrInternal } from "@/app/lib/auth/requireProjectAccessOrInternal";

function parseDays(raw: string | null): number {
  if (!raw) return 30;
  const n = Number(raw);
  if (!Number.isFinite(n) || n <= 0) return 30;
  return Math.min(365, Math.max(1, Math.round(n)));
}

export async function GET(req: Request) {
  try {
    const { searchParams } = new URL(req.url);
    const projectId = searchParams.get("project_id");
    const days = parseDays(searchParams.get("days"));
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
        { success: false, error: "project_id обязателен" },
        { status: 400 }
      );
    }
    const access = await requireProjectAccessOrInternal(req, projectId);
    if (!access.allowed) return NextResponse.json(access.body, { status: access.status });

    const admin = supabaseAdmin();

    const { summary, channels } = await buildRevenueAttributionMap(admin, {
      project_id: projectId,
      days,
      start,
      end,
      sources,
      account_ids,
    });

    return NextResponse.json({
      success: true,
      summary,
      channels,
      diagnostics: {
        source_filter_applied: Boolean(sources && sources.length > 0),
        account_filter_supported: true,
      },
    });
  } catch (e: any) {
    console.error("[REVENUE_ATTRIBUTION_MAP_ERROR]", e);
    return NextResponse.json(
      {
        success: false,
        error:
          e?.message ||
          e?.error?.message ||
          "Ошибка при построении карты выручки по атрибуции",
      },
      { status: 500 }
    );
  }
}

