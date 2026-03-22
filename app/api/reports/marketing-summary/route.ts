/**
 * GET /api/reports/marketing-summary?project_id=...&start=...&end=...
 * Returns plan metrics, KPI, budget coverage, campaign alerts, campaign table for marketing reports page.
 */
import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/app/lib/supabaseAdmin";
import { getMarketingSummary } from "@/app/lib/marketingReport";

function toISODate(s: string | null): string | null {
  if (!s || !/^\d{4}-\d{2}-\d{2}$/.test(s)) return null;
  return s;
}

export async function GET(req: Request) {
  try {
    const { searchParams } = new URL(req.url);
    const projectId = searchParams.get("project_id");
    const start = toISODate(searchParams.get("start"));
    const end = toISODate(searchParams.get("end"));
    const targetCacRaw = searchParams.get("target_cac");
    const targetRoasRaw = searchParams.get("target_roas");

    if (!projectId) {
      return NextResponse.json(
        { success: false, error: "project_id обязателен" },
        { status: 400 }
      );
    }

    const endDate = end ? new Date(end) : new Date();
    const startDate = start ? new Date(start) : (() => { const d = new Date(); d.setMonth(d.getMonth() - 1); return d; })();
    const startStr = start ?? startDate.toISOString().slice(0, 10);
    const endStr = end ?? endDate.toISOString().slice(0, 10);

    const target_cac = targetCacRaw != null && targetCacRaw !== "" ? Number(targetCacRaw) : null;
    const target_roas = targetRoasRaw != null && targetRoasRaw !== "" ? Number(targetRoasRaw) : null;

    const admin = supabaseAdmin();
    const result = await getMarketingSummary(admin, {
      project_id: projectId,
      start: startStr,
      end: endStr,
      target_cac: Number.isFinite(target_cac) ? target_cac : null,
      target_roas: Number.isFinite(target_roas) ? target_roas : null,
    });

    return NextResponse.json({
      success: true,
      plan: result.plan,
      kpi: result.kpi,
      budget: result.budget,
      campaign_alerts: result.campaign_alerts,
      campaign_table: result.campaign_table,
      forecast: result.forecast ?? null,
    });
  } catch (e) {
    console.error("[MARKETING_SUMMARY_ERROR]", e);
    return NextResponse.json(
      { success: false, error: "Internal error" },
      { status: 500 }
    );
  }
}
