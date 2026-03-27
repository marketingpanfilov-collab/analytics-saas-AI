/**
 * GET /api/weekly-board-report?project_id=...&period_end_iso=... (optional)
 * V13: Weekly Board Report. Current 7 days vs previous 7 days.
 * Optional period_end_iso: end of report week (for share/snapshot). Default: now.
 */
import { NextResponse } from "next/server";
import type { SupabaseClient } from "@supabase/supabase-js";
import { supabaseAdmin } from "@/app/lib/supabaseAdmin";
import { computeDataQualityScore } from "@/app/lib/dataQualityScore";
import { getAttributionAnomalies } from "@/app/lib/attributionAnomalies";
import { buildAttributionAssistant } from "@/app/lib/attributionAssistant";
import { buildAttributionChains } from "@/app/lib/attributionDebugger";
import { buildJourneysFromChains } from "@/app/lib/attributionJourney";
import { buildBudgetOptimization, type JourneyForBudget } from "@/app/lib/budgetOptimizationInsights";
import { buildWeeklyBoardReport } from "@/app/lib/weeklyBoardReport";
import { requireProjectAccessOrInternal } from "@/app/lib/auth/requireProjectAccessOrInternal";
import {
  convertMoneyStrict,
  createCurrencyDiagnostics,
  getLatestUsdToKztRate,
  getUsdToKztRateMapForDays,
  normalizeCurrencyCode,
  pushCurrencyReason,
  resolveUsdToKztRateForDay,
} from "@/app/lib/currencyNormalization";

const JOURNEY_CHAINS_LIMIT = 400;
const DAYS_CURRENT = 7;
const DAYS_PREVIOUS = 7;

async function getRevenueForPeriod(
  admin: SupabaseClient,
  projectId: string,
  sinceIso: string,
  untilIso?: string
): Promise<{ revenue: number; currency: string }> {
  const { data: projectRow } = await admin
    .from("projects")
    .select("currency")
    .eq("id", projectId)
    .maybeSingle();
  const displayCurrency =
    String((projectRow as { currency?: string | null } | null)?.currency ?? "USD")
      .trim()
      .toUpperCase() === "KZT"
      ? "KZT"
      : "USD";
  const latestUsdToKztRate = displayCurrency === "KZT" ? await getLatestUsdToKztRate(admin) : null;
  const diagnostics = createCurrencyDiagnostics();

  let q = admin
    .from("conversion_events")
    .select("value, currency, created_at")
    .eq("project_id", projectId)
    .eq("event_name", "purchase")
    .gte("created_at", sinceIso);
  if (untilIso) q = q.lte("created_at", untilIso);
  const { data } = await q;
  const rows = data ?? [];
  const rateByDay =
    displayCurrency === "KZT"
      ? await getUsdToKztRateMapForDays(
          admin,
          rows.map((r) => String((r as { created_at?: string | null }).created_at ?? "").slice(0, 10))
        )
      : new Map<string, number>();
  let revenue = 0;
  for (const r of rows) {
    const v = (r as { value?: number | null; currency?: string | null }).value;
    if (typeof v !== "number" || Number.isNaN(v)) continue;
    const c = (r as { currency?: string | null }).currency;
    const normalized = normalizeCurrencyCode(c);
    const fromCurrency = normalized ?? displayCurrency;
    if (!normalized && (c == null || String(c).trim() === "")) {
      pushCurrencyReason(diagnostics, "currency_missing", "weekly-board-report: conversion_events.currency missing.");
    } else if (!normalized) {
      pushCurrencyReason(diagnostics, "currency_unsupported", `weekly-board-report: unsupported currency '${String(c)}'.`);
    }
    const day = String((r as { created_at?: string | null }).created_at ?? "").slice(0, 10);
    const dayRate = resolveUsdToKztRateForDay(day, rateByDay, latestUsdToKztRate, diagnostics);
    revenue += convertMoneyStrict(v, fromCurrency, displayCurrency, dayRate, diagnostics);
  }
  if (diagnostics.reason_codes.length > 0) {
    console.warn("[WEEKLY_REPORT_CURRENCY_DIAGNOSTICS]", {
      projectId,
      period_since: sinceIso,
      period_until: untilIso ?? null,
      reason_codes: diagnostics.reason_codes,
      warnings: diagnostics.warnings,
    });
  }
  return { revenue, currency: displayCurrency };
}

/** Build weekly report for a given period end (used by GET and by share public fetch). */
export async function buildWeeklyReportPayload(
  admin: ReturnType<typeof supabaseAdmin>,
  projectId: string,
  periodEnd: Date
): Promise<{
  success: true;
  has_sufficient_data: boolean;
  summary: string;
  kpis: unknown;
  attribution_highlights: string[];
  data_quality_highlights: string[];
  risks: string[];
  growth_opportunities: string[];
  priority_actions: string[];
}> {
  const currentWeekEnd = new Date(periodEnd);
  const currentWeekStart = new Date(periodEnd.getTime() - DAYS_CURRENT * 24 * 60 * 60 * 1000);
  const previousWeekEnd = new Date(currentWeekStart.getTime());
  const previousWeekStart = new Date(previousWeekEnd.getTime() - DAYS_PREVIOUS * 24 * 60 * 60 * 1000);

  const currentSince = currentWeekStart.toISOString();
  const currentUntil = currentWeekEnd.toISOString();
  const previousSince = previousWeekStart.toISOString();
  const previousUntil = previousWeekEnd.toISOString();

  const [
    dataQualityCurrent,
    dataQualityPrevious,
    revenueCurrent,
    revenuePrevious,
    anomalies,
    chainResult,
  ] = await Promise.all([
    computeDataQualityScore(admin, projectId, DAYS_CURRENT, { rangeEndIso: currentUntil }),
    computeDataQualityScore(admin, projectId, DAYS_PREVIOUS, {
      rangeEndIso: previousUntil,
    }),
    getRevenueForPeriod(admin, projectId, currentSince, currentUntil),
    getRevenueForPeriod(admin, projectId, previousSince, previousUntil),
    getAttributionAnomalies(admin, {
      project_id: projectId,
      current_window_hours: 24 * 7,
      baseline_days: 7,
    }),
    buildAttributionChains(admin, {
      project_id: projectId,
      days: DAYS_CURRENT,
      page: 1,
      page_size: JOURNEY_CHAINS_LIMIT,
    }),
  ]);

  const assistant = buildAttributionAssistant({ anomalies, dataQuality: dataQualityCurrent });

  const journeys = buildJourneysFromChains(chainResult.chains);
  const forBudget: JourneyForBudget[] = journeys.map((j) => ({
    attribution_models: j.attribution_models,
    touchpoints: j.touchpoints.map((t) => ({ type: t.type, source: t.source })),
    summary: { revenue_total: j.summary.revenue_total, purchases_count: j.summary.purchases_count },
  }));
  const budgetOptimization = buildBudgetOptimization(forBudget, null);

  const repeatPurchaseJourneysCount = journeys.filter((j) => j.summary.purchases_count > 1).length;

  const result = buildWeeklyBoardReport({
    current_week: {
      stats: dataQualityCurrent.stats,
      revenue: revenueCurrent.revenue,
      revenue_currency: revenueCurrent.currency,
      data_quality_score: dataQualityCurrent.score,
      data_quality_label: dataQualityCurrent.label,
      data_quality_full: dataQualityCurrent,
    },
    previous_week: {
      stats: dataQualityPrevious.stats,
      revenue: revenuePrevious.revenue,
      data_quality_score: dataQualityPrevious.score,
    },
    assistant: {
      summary: assistant.summary,
      diagnoses: assistant.diagnoses,
      priority_actions: assistant.priority_actions,
    },
    anomalies,
    budgetOptimization,
    repeatPurchaseJourneysCount,
  });

  return {
    success: true,
    has_sufficient_data: result.has_sufficient_data,
    summary: result.summary,
    kpis: result.kpis,
    attribution_highlights: result.attribution_highlights,
    data_quality_highlights: result.data_quality_highlights,
    risks: result.risks,
    growth_opportunities: result.growth_opportunities,
    priority_actions: result.priority_actions,
  };
}

export async function GET(req: Request) {
  try {
    const { searchParams } = new URL(req.url);
    const projectId = searchParams.get("project_id")?.trim() ?? null;
    const periodEndIso = searchParams.get("period_end_iso")?.trim() ?? null;

    if (!projectId) {
      return NextResponse.json(
        { success: false, error: "project_id is required" },
        { status: 400 }
      );
    }
    const access = await requireProjectAccessOrInternal(req, projectId, { allowInternalBypass: false });
    if (!access.allowed) {
      return NextResponse.json(access.body, { status: access.status });
    }

    const admin = supabaseAdmin();
    const periodEnd = periodEndIso ? new Date(periodEndIso) : new Date();
    if (Number.isNaN(periodEnd.getTime())) {
      return NextResponse.json(
        { success: false, error: "Invalid period_end_iso" },
        { status: 400 }
      );
    }

    const payload = await buildWeeklyReportPayload(admin, projectId, periodEnd);
    return NextResponse.json(payload);
  } catch (e) {
    console.error("[WEEKLY_BOARD_REPORT_ERROR]", e);
    return NextResponse.json(
      { success: false, error: e instanceof Error ? e.message : "Internal error" },
      { status: 500 }
    );
  }
}
