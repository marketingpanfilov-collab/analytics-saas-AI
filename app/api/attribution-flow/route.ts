import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/app/lib/supabaseAdmin";
import { buildAttributionFlow } from "@/app/lib/attributionFlow";
import { requireProjectAccessOrInternal } from "@/app/lib/auth/requireProjectAccessOrInternal";
import { billingAnalyticsReadGateFromAccess } from "@/app/lib/auth/requireBillingAccess";

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
    const limitRaw = searchParams.get("limit");
    const limit = limitRaw ? Math.min(200, Math.max(1, Math.round(Number(limitRaw) || 50))) : 50;

    if (!projectId) {
      return NextResponse.json(
        { success: false, error: "project_id обязателен" },
        { status: 400 }
      );
    }
    const access = await requireProjectAccessOrInternal(req, projectId);
    if (!access.allowed) return NextResponse.json(access.body, { status: access.status });

    const billing = await billingAnalyticsReadGateFromAccess(access);
    if (!billing.ok) return billing.response;

    const admin = supabaseAdmin();
    const paths = await buildAttributionFlow(admin, {
      project_id: projectId,
      days,
      start,
      end,
      sources,
      account_ids,
      limit,
    });

    return NextResponse.json({
      success: true,
      paths,
      diagnostics: {
        source_filter_applied: Boolean(sources && sources.length > 0),
        account_filter_supported: true,
      },
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

