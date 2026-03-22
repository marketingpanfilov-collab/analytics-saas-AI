import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/app/lib/supabaseAdmin";
import { buildAttributionFlow } from "@/app/lib/attributionFlow";

function parseDays(raw: string | null): number {
  if (!raw) return 30;
  const n = Number(raw);
  if (!Number.isFinite(n) || n <= 0) return 30;
  return Math.min(365, Math.max(1, Math.round(n)));
}

export async function GET(req: Request) {
  try {
    const { searchParams } = new URL(req.url);
    const projectId = searchParams.get("project_id")?.trim() ?? null;
    const days = parseDays(searchParams.get("days"));

    if (!projectId) {
      return NextResponse.json(
        { success: false, error: "project_id обязателен" },
        { status: 400 }
      );
    }

    const admin = supabaseAdmin();
    const paths = await buildAttributionFlow(admin, {
      project_id: projectId,
      days,
      limit: 5,
    });

    return NextResponse.json({
      success: true,
      paths,
    });
  } catch (e: any) {
    console.error("[ATTRIBUTION_FLOW_ERROR]", e);
    return NextResponse.json(
      {
        success: false,
        error:
          e?.message ||
          e?.error?.message ||
          "Ошибка при построении путей пользователей до покупки",
      },
      { status: 500 }
    );
  }
}

