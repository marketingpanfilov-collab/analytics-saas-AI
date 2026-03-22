import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/app/lib/supabaseAdmin";
import { buildRevenueAttributionMap } from "@/app/lib/revenueAttributionMap";

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

    if (!projectId) {
      return NextResponse.json(
        { success: false, error: "project_id обязателен" },
        { status: 400 }
      );
    }

    const admin = supabaseAdmin();

    const { summary, channels } = await buildRevenueAttributionMap(admin, {
      project_id: projectId,
      days,
    });

    return NextResponse.json({
      success: true,
      summary,
      channels,
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

