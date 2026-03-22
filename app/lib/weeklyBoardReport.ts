/**
 * BoardIQ V13: Auto-generated Weekly Board Report
 * Rule-based weekly report (no LLM). Compares current 7 days vs previous 7 days,
 * reuses Executive Summary, Data Quality, Budget Optimization, Assistant, Anomalies.
 */

import type { DataQualityResult, DataQualityIssue } from "./dataQualityScore";
import type { AttributionAnomaly } from "./attributionAnomalies";
import type { AttributionDiagnosis } from "./attributionAssistant";
import type { BudgetOptimizationResult, BudgetInsight } from "./budgetOptimizationInsights";

export type WeeklyKpiValue = {
  value: number;
  delta_percent?: number;
};

export type WeeklyKpiScore = {
  value: number;
  delta_pp?: number; // percentage points
};

export type WeeklyKpis = {
  clicks: WeeklyKpiValue;
  visits: WeeklyKpiValue;
  registrations: WeeklyKpiValue;
  purchases: WeeklyKpiValue;
  revenue: { value: number; currency: string; delta_percent?: number };
  data_quality_score: WeeklyKpiScore;
};

export type WeeklyBoardReportInput = {
  /** Current week (last 7 days) */
  current_week: {
    stats: { clicks_total: number; visits_total: number; registrations_total: number; purchases_total: number };
    revenue: number;
    revenue_currency: string;
    data_quality_score: number | null;
    data_quality_label: string | null;
    data_quality_full: DataQualityResult | null;
  };
  /** Previous week (7 days before that) */
  previous_week: {
    stats: { clicks_total: number; visits_total: number; registrations_total: number; purchases_total: number };
    revenue: number;
    data_quality_score: number | null;
  };
  /** For highlights/risks/opportunities/actions (current week only) */
  assistant: { summary: string; diagnoses: AttributionDiagnosis[]; priority_actions: string[] };
  anomalies: AttributionAnomaly[];
  budgetOptimization: BudgetOptimizationResult | null;
  repeatPurchaseJourneysCount: number;
};

export type WeeklyBoardReportOutput = {
  has_sufficient_data: boolean;
  summary: string;
  kpis: WeeklyKpis;
  attribution_highlights: string[];
  data_quality_highlights: string[];
  risks: string[];
  growth_opportunities: string[];
  priority_actions: string[];
};

function deltaPercent(current: number, previous: number): number | undefined {
  if (previous === 0) return current > 0 ? 100 : undefined;
  const d = ((current - previous) / previous) * 100;
  return Math.round(d * 10) / 10;
}

function deltaPp(current: number | null, previous: number | null): number | undefined {
  if (current == null || previous == null) return undefined;
  const d = current - previous;
  return Math.round(d * 10) / 10;
}

function capitalize(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1).toLowerCase();
}

function hasIssue(dq: DataQualityResult | null, code: string): boolean {
  return dq?.issues?.some((i) => i.code === code) ?? false;
}

function getIssue(dq: DataQualityResult | null, code: string): DataQualityIssue | undefined {
  return dq?.issues?.find((i) => i.code === code);
}

function hasBudgetInsight(insights: BudgetInsight[] | undefined, type: string): boolean {
  return (insights ?? []).some((i) => i.type === type);
}

function hasAnomaly(anomalies: AttributionAnomaly[], type: string): boolean {
  return anomalies.some((a) => a.type === type);
}

function dedupe(list: string[]): string[] {
  const seen = new Set<string>();
  return list.filter((s) => {
    const k = s.toLowerCase().trim();
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });
}

/** 2–4 sentences: what happened this week, what matters, what to do next. */
export function buildWeeklySummary(input: WeeklyBoardReportInput): string {
  const { current_week, previous_week, budgetOptimization, assistant } = input;
  const parts: string[] = [];

  const portfolio = budgetOptimization?.portfolio_summary;
  const topCloser = portfolio?.top_closing_channel;
  const topUnder = portfolio?.top_underattributed_channel;
  const dqCurrent = current_week.data_quality_score ?? 0;
  const dqPrev = previous_week.data_quality_score ?? 0;
  const dqImproved = dqPrev > 0 && dqCurrent > dqPrev;

  if (topCloser) {
    parts.push(
      `Over the past week ${capitalize(topCloser)} remained the strongest closing channel.`
    );
  }
  if (topUnder) {
    parts.push(
      `${capitalize(topUnder)} showed a higher contribution in multi-touch attribution than in last-click.`
    );
  }
  if (hasIssue(current_week.data_quality_full, "conversions_without_click_id")) {
    parts.push(
      "Attribution quality remains limited by missing click_id on a share of conversion events."
    );
  }
  if (dqImproved) {
    parts.push(
      "Data quality score improved compared to the previous week."
    );
  }
  parts.push(
    "Priority for the coming week: improve click_id pass-through and review channel evaluation using multi-touch attribution."
  );

  return dedupe(parts).slice(0, 4).join(" ");
}

/** KPI snapshot with week-over-week deltas. */
export function buildWeeklyKpis(input: WeeklyBoardReportInput): WeeklyKpis {
  const { current_week, previous_week } = input;
  const c = current_week.stats;
  const p = previous_week.stats;

  return {
    clicks: {
      value: c.clicks_total,
      delta_percent: deltaPercent(c.clicks_total, p.clicks_total),
    },
    visits: {
      value: c.visits_total,
      delta_percent: deltaPercent(c.visits_total, p.visits_total),
    },
    registrations: {
      value: c.registrations_total,
      delta_percent: deltaPercent(c.registrations_total, p.registrations_total),
    },
    purchases: {
      value: c.purchases_total,
      delta_percent: deltaPercent(c.purchases_total, p.purchases_total),
    },
    revenue: {
      value: current_week.revenue,
      currency: current_week.revenue_currency || "USD",
      delta_percent: deltaPercent(current_week.revenue, previous_week.revenue),
    },
    data_quality_score: {
      value: Math.round(current_week.data_quality_score ?? 0),
      delta_pp: deltaPp(current_week.data_quality_score, previous_week.data_quality_score),
    },
  };
}

/** 3–5 attribution highlights for the week. */
export function buildWeeklyAttributionHighlights(input: WeeklyBoardReportInput): string[] {
  const { budgetOptimization, repeatPurchaseJourneysCount } = input;
  const list: string[] = [];
  const portfolio = budgetOptimization?.portfolio_summary;
  const insights = budgetOptimization?.insights ?? [];

  if (portfolio?.top_closing_channel) {
    list.push(`${capitalize(portfolio.top_closing_channel)} remained the strongest closing channel.`);
  }
  if (hasBudgetInsight(insights, "under_attributed_channel")) {
    const ch = insights.find((i) => i.type === "under_attributed_channel")?.channel;
    if (ch) list.push(`${capitalize(ch)} contributed more in multi-touch attribution than in last-click.`);
  }
  if (hasBudgetInsight(insights, "weak_channel")) {
    const ch = insights.find((i) => i.type === "weak_channel")?.channel;
    if (ch) list.push(`${capitalize(ch)} drove visits but showed weak purchase contribution.`);
  }
  if (repeatPurchaseJourneysCount > 0) {
    list.push(`Repeat purchase activity was present this week (${repeatPurchaseJourneysCount} journey(s)).`);
  }
  if (hasBudgetInsight(insights, "over_attributed_channel")) {
    const ch = insights.find((i) => i.type === "over_attributed_channel")?.channel;
    if (ch) list.push(`First-touch and last-touch models diverged significantly for ${capitalize(ch)}.`);
  }
  if (portfolio?.top_first_touch_channel) {
    list.push(`${capitalize(portfolio.top_first_touch_channel)} led in first-touch influence.`);
  }

  return dedupe(list).slice(0, 5);
}

/** Data quality highlights: score movement, top issues. */
export function buildWeeklyDataQualityHighlights(input: WeeklyBoardReportInput): string[] {
  const { current_week, previous_week } = input;
  const list: string[] = [];
  const dq = current_week.data_quality_full;
  const curr = current_week.data_quality_score ?? 0;
  const prev = previous_week.data_quality_score ?? 0;

  if (prev > 0 && curr > prev) {
    const pp = Math.round((curr - prev) * 10) / 10;
    list.push(`Data quality improved from ${prev}% to ${curr}% (+${pp} pp).`);
  } else if (prev > 0 && curr < prev) {
    list.push(`Data quality decreased from ${prev}% to ${curr}% this week.`);
  } else if (curr > 0) {
    list.push(`Data quality score for the week: ${curr}%.`);
  }

  if (hasIssue(dq, "conversions_without_click_id")) {
    const i = getIssue(dq, "conversions_without_click_id");
    list.push("Missing click_id remains the main attribution issue.");
  }
  if (hasIssue(dq, "purchases_without_currency") || hasIssue(dq, "purchases_without_value")) {
    list.push("Purchase event completeness needs improvement (currency/value).");
  }
  if (hasIssue(dq, "visits_without_traffic_source")) {
    list.push("Some visits still arrive without traffic_source.");
  }
  if (dq?.label && dq.label !== "No data") {
    list.push(`Overall data quality rating: ${dq.label}.`);
  }

  return dedupe(list).slice(0, 5);
}

/** 3–5 weekly risks. */
export function buildWeeklyRisks(input: WeeklyBoardReportInput): string[] {
  const { current_week, anomalies, assistant } = input;
  const list: string[] = [];
  const dq = current_week.data_quality_full;

  if (hasIssue(dq, "conversions_without_click_id")) {
    list.push("Conversions without click_id continue to limit attribution accuracy.");
  }
  if (hasAnomaly(anomalies, "orphan_spike")) {
    list.push("Orphan purchases increased significantly this week.");
  }
  if (hasIssue(dq, "visits_without_traffic_source")) {
    list.push("Part of visits still arrives without traffic_source.");
  }
  if (hasIssue(dq, "purchases_without_currency") || hasIssue(dq, "purchases_without_value")) {
    list.push("Revenue tracking is incomplete for some purchase events.");
  }
  if (hasAnomaly(anomalies, "missing_click_id_conversions")) {
    list.push("A significant share of conversions is missing click_id.");
  }
  if (hasAnomaly(anomalies, "click_to_visit_drop")) {
    list.push("Click-to-visit linkage dropped; landing or pixel may need review.");
  }

  assistant.diagnoses.slice(0, 2).forEach((d) => {
    if (d.code === "missing_click_id_on_conversions" && !list.some((r) => r.toLowerCase().includes("click_id"))) {
      list.push("Conversions are not consistently linked to ad clicks.");
    }
    if (d.code === "conversion_payload_incomplete" && !list.some((r) => r.toLowerCase().includes("revenue"))) {
      list.push("Some purchase events are incomplete (value or currency).");
    }
  });

  return dedupe(list).slice(0, 5);
}

/** 2–5 growth opportunities. */
export function buildWeeklyGrowthOpportunities(input: WeeklyBoardReportInput): string[] {
  const { budgetOptimization, repeatPurchaseJourneysCount } = input;
  const list: string[] = [];
  const insights = budgetOptimization?.insights ?? [];
  const portfolio = budgetOptimization?.portfolio_summary;

  if (hasBudgetInsight(insights, "scaling_opportunity")) {
    const ch = insights.find((i) => i.type === "scaling_opportunity")?.channel;
    if (ch) list.push(`${capitalize(ch)} may support cautious budget expansion.`);
  }
  if (hasBudgetInsight(insights, "under_attributed_channel")) {
    const ch = insights.find((i) => i.type === "under_attributed_channel")?.channel;
    if (ch) list.push(`${capitalize(ch)} may be undervalued by last-click; evaluate using multi-touch before reducing spend.`);
  }
  if (repeatPurchaseJourneysCount > 0) {
    list.push("Strong repeat purchases suggest retention campaigns may be scalable.");
  }
  if (portfolio?.top_first_touch_channel) {
    list.push(`Channels with strong first-touch contribution (e.g. ${capitalize(portfolio.top_first_touch_channel)}) may deserve better top-funnel evaluation.`);
  }
  if (portfolio?.top_closing_channel) {
    list.push(`${capitalize(portfolio.top_closing_channel)} is the strongest closer and may be a candidate for budget review.`);
  }

  return dedupe(list).slice(0, 5);
}

/** Top 3–5 priority actions, ranked. */
export function buildWeeklyPriorityActions(input: WeeklyBoardReportInput): string[] {
  const { current_week, assistant, budgetOptimization } = input;
  const list: string[] = [];
  const dq = current_week.data_quality_full;

  if (hasIssue(dq, "conversions_without_click_id")) {
    const rec = dq?.recommendations?.find((r) => r.related_issue_codes?.includes("conversions_without_click_id"));
    list.push(rec?.action_text?.trim() || "Pass click_id in registration and purchase events.");
  }
  if (hasIssue(dq, "clicks_without_source_signal") || hasIssue(dq, "visits_without_traffic_source")) {
    list.push("Ensure all ad platforms use BoardIQ tracking links.");
  }
  if (hasIssue(dq, "purchases_without_currency") || hasIssue(dq, "purchases_without_value")) {
    list.push("Add missing currency and value to purchase events.");
  }
  assistant.priority_actions.forEach((a) => {
    const t = a.trim();
    if (t && !list.some((x) => x.toLowerCase().includes(t.slice(0, 20).toLowerCase()))) list.push(t);
  });
  budgetOptimization?.priority_actions?.forEach((a) => {
    const t = a.trim();
    if (t && !list.some((x) => x.toLowerCase().includes(t.slice(0, 25).toLowerCase()))) list.push(t);
  });

  return dedupe(list).slice(0, 5);
}

function hasSufficientData(input: WeeklyBoardReportInput): boolean {
  const c = input.current_week.stats;
  const hasVolume =
    c.clicks_total > 0 || c.visits_total > 0 || c.registrations_total > 0 || c.purchases_total > 0;
  const hasDq = input.current_week.data_quality_score != null;
  return hasVolume || hasDq || (input.anomalies?.length ?? 0) > 0;
}

/** Build full weekly board report. */
export function buildWeeklyBoardReport(input: WeeklyBoardReportInput): WeeklyBoardReportOutput {
  if (!hasSufficientData(input)) {
    return {
      has_sufficient_data: false,
      summary: "Insufficient data to form a weekly report for this period.",
      kpis: buildWeeklyKpis(input),
      attribution_highlights: [],
      data_quality_highlights: [],
      risks: [],
      growth_opportunities: [],
      priority_actions: [],
    };
  }

  return {
    has_sufficient_data: true,
    summary: buildWeeklySummary(input),
    kpis: buildWeeklyKpis(input),
    attribution_highlights: buildWeeklyAttributionHighlights(input),
    data_quality_highlights: buildWeeklyDataQualityHighlights(input),
    risks: buildWeeklyRisks(input),
    growth_opportunities: buildWeeklyGrowthOpportunities(input),
    priority_actions: buildWeeklyPriorityActions(input),
  };
}
