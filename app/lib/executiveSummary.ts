/**
 * Attribution Debugger V12: Executive Summary Layer
 * Rule-based management summary (no LLM). Aggregates Data Quality, Assistant,
 * Anomalies, Budget Optimization, and Journey/Chain signals into a short executive view.
 */

import type { DataQualityResult, DataQualityIssue } from "./dataQualityScore";
import type { AttributionAnomaly } from "./attributionAnomalies";
import type { AttributionDiagnosis } from "./attributionAssistant";
import type {
  BudgetOptimizationResult,
  BudgetInsight,
} from "./budgetOptimizationInsights";

export type ExecutiveSummaryInput = {
  dataQuality: DataQualityResult | null;
  assistant: {
    summary: string;
    diagnoses: AttributionDiagnosis[];
    priority_actions: string[];
  };
  anomalies: AttributionAnomaly[];
  budgetOptimization: BudgetOptimizationResult | null;
  totalChains: number;
  repeatPurchaseJourneysCount: number;
};

export type ExecutiveSummaryOutput = {
  has_sufficient_data: boolean;
  summary: string;
  key_findings: string[];
  key_risks: string[];
  growth_opportunities: string[];
  priority_actions: string[];
};

function hasIssue(dq: DataQualityResult | null, code: string): boolean {
  return dq?.issues?.some((i) => i.code === code) ?? false;
}

function getIssue(dq: DataQualityResult | null, code: string): DataQualityIssue | undefined {
  return dq?.issues?.find((i) => i.code === code);
}

function highSeverityIssue(dq: DataQualityResult | null, code: string): boolean {
  const i = getIssue(dq, code);
  return !!(i && (i.severity === "high" || i.percent >= 25));
}

function hasAnomaly(anomalies: AttributionAnomaly[], type: string): boolean {
  return anomalies.some((a) => a.type === type);
}

function hasBudgetInsight(insights: BudgetInsight[] | undefined, type: string): boolean {
  return (insights ?? []).some((i) => i.type === type);
}

/** 2–4 sentences: state of attribution and data, management tone. */
export function buildExecutiveSummary(input: ExecutiveSummaryInput): string {
  const { dataQuality, budgetOptimization, assistant } = input;
  const parts: string[] = [];

  const portfolio = budgetOptimization?.portfolio_summary;
  const topCloser = portfolio?.top_closing_channel;
  const topUnder = portfolio?.top_underattributed_channel;
  const topOver = portfolio?.top_overvalued_channel;

  if (topCloser) {
    parts.push(
      `${capitalize(topCloser)} is currently the strongest closing channel in the selected period.`
    );
  }
  if (topUnder) {
    parts.push(
      `${capitalize(topUnder)} appears undervalued in last-click reporting and contributes more in multi-touch attribution.`
    );
  }
  if (topOver) {
    parts.push(
      `${capitalize(topOver)} may be overvalued by last-click; multi-touch models assign it less revenue.`
    );
  }

  const missingClickId = hasIssue(dataQuality, "conversions_without_click_id");
  const missingCurrency = hasIssue(dataQuality, "purchases_without_currency");
  const missingValue = hasIssue(dataQuality, "purchases_without_value");

  if (missingClickId) {
    const issue = getIssue(dataQuality, "conversions_without_click_id");
    const pct = issue?.percent;
    if (pct != null && pct >= 10) {
      parts.push(
        `Attribution quality is limited by missing click_id on a significant share of conversions.`
      );
    } else {
      parts.push(`Some conversions are missing click_id, which weakens attribution accuracy.`);
    }
  }
  if (missingCurrency || missingValue) {
    parts.push(
      `Purchase revenue tracking is partially incomplete: some purchases lack currency or value.`
    );
  }
  if (dataQuality?.has_data && dataQuality?.label && dataQuality.label !== "No data") {
    if (parts.length < 2) {
      parts.push(
        `Data quality is rated "${dataQuality.label}" for the period.`
      );
    }
  }

  if (parts.length === 0) {
    return "Insufficient data to form an executive summary for the selected period.";
  }
  return parts.slice(0, 4).join(" ");
}

function capitalize(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1).toLowerCase();
}

/** 3–6 key findings from channels, attribution, journeys, data quality. */
export function buildKeyFindings(input: ExecutiveSummaryInput): string[] {
  const { dataQuality, budgetOptimization, repeatPurchaseJourneysCount } = input;
  const list: string[] = [];

  const portfolio = budgetOptimization?.portfolio_summary;
  const insights = budgetOptimization?.insights ?? [];
  const metrics = budgetOptimization?.channel_metrics ?? [];

  if (portfolio?.top_closing_channel) {
    list.push(
      `${capitalize(portfolio.top_closing_channel)} is the strongest closing channel in the selected period.`
    );
  }
  if (hasBudgetInsight(insights, "under_attributed_channel")) {
    const ch = insights.find((i) => i.type === "under_attributed_channel")?.channel;
    if (ch) {
      list.push(
        `${capitalize(ch)} contributes more revenue in multi-touch attribution than in last-click.`
      );
    }
  }
  if (hasBudgetInsight(insights, "over_attributed_channel")) {
    const ch = insights.find((i) => i.type === "over_attributed_channel")?.channel;
    if (ch) {
      list.push(
        `${capitalize(ch)} receives more credit in last-touch than in multi-touch models.`
      );
    }
  }
  if (hasBudgetInsight(insights, "strong_first_touch_channel")) {
    const ch = insights.find((i) => i.type === "strong_first_touch_channel")?.channel;
    if (ch) {
      list.push(
        `${capitalize(ch)} is effective at starting customer journeys.`
      );
    }
  }
  if (hasBudgetInsight(insights, "weak_channel")) {
    const ch = insights.find((i) => i.type === "weak_channel")?.channel;
    if (ch) {
      list.push(
        `${capitalize(ch)} drives visits but shows weak purchase contribution.`
      );
    }
  }
  if (repeatPurchaseJourneysCount > 0) {
    list.push(
      `Repeat purchases are present in ${repeatPurchaseJourneysCount} user journey(s).`
    );
  }
  if (dataQuality?.has_data && dataQuality?.label && dataQuality.label !== "No data") {
    list.push(
      `Data quality for the period is rated "${dataQuality.label}".`
    );
  }
  if (metrics.length >= 2 && portfolio?.total_revenue != null && portfolio.total_revenue > 0) {
    const topByRevenue = metrics[0];
    if (topByRevenue) {
      list.push(
        `${capitalize(topByRevenue.channel)} leads in attributed revenue (data-driven model).`
      );
    }
  }

  return dedupeSentences(list).slice(0, 6);
}

/** 3–5 key risks from data quality, anomalies, orphan/weak attribution. */
export function buildKeyRisks(input: ExecutiveSummaryInput): string[] {
  const { dataQuality, anomalies, assistant } = input;
  const list: string[] = [];

  if (highSeverityIssue(dataQuality, "conversions_without_click_id") || hasIssue(dataQuality, "conversions_without_click_id")) {
    const i = getIssue(dataQuality, "conversions_without_click_id");
    const pct = i?.percent;
    if (pct != null && pct >= 25) {
      list.push("A large share of conversions is missing click_id.");
    } else {
      list.push("A significant share of conversions is missing click_id.");
    }
  }
  if (hasIssue(dataQuality, "purchases_without_currency") || hasIssue(dataQuality, "purchases_without_value")) {
    list.push("Revenue reporting is partially incomplete because some purchases lack currency or value.");
  }
  if (hasIssue(dataQuality, "visits_without_traffic_source")) {
    list.push("Some traffic sources may be under-attributed due to missing visit linkage.");
  }
  if (hasAnomaly(anomalies, "click_to_visit_drop")) {
    list.push("Click-to-visit linkage has dropped; landing or pixel tracking may need review.");
  }
  if (hasAnomaly(anomalies, "missing_click_id_conversions")) {
    list.push("Attribution quality remains weak for part of conversion events.");
  }
  const orphanSpike = hasAnomaly(anomalies, "orphan_spike");
  if (orphanSpike) {
    list.push("Unmatched conversions have increased; attribution path may be broken for some events.");
  }
  assistant.diagnoses.forEach((d) => {
    if (d.code === "missing_click_id_on_conversions" && !list.some((r) => r.toLowerCase().includes("click_id"))) {
      list.push("Conversions are not consistently linked to ad clicks.");
    }
    if (d.code === "conversion_payload_incomplete" && !list.some((r) => r.toLowerCase().includes("currency") && r.toLowerCase().includes("value"))) {
      list.push("Some purchase events are incomplete (missing value or currency).");
    }
  });

  return dedupeSentences(list).slice(0, 5);
}

/** 2–5 growth opportunities from budget insights and journey signals. */
export function buildGrowthOpportunities(input: ExecutiveSummaryInput): string[] {
  const { budgetOptimization, repeatPurchaseJourneysCount } = input;
  const list: string[] = [];
  const insights = budgetOptimization?.insights ?? [];
  const portfolio = budgetOptimization?.portfolio_summary;

  if (hasBudgetInsight(insights, "scaling_opportunity")) {
    const ch = insights.find((i) => i.type === "scaling_opportunity")?.channel;
    if (ch) {
      list.push(
        `${capitalize(ch)} may support additional budget; it performs strongly across multi-touch models.`
      );
    }
  }
  if (hasBudgetInsight(insights, "under_attributed_channel")) {
    const ch = insights.find((i) => i.type === "under_attributed_channel")?.channel;
    if (ch) {
      list.push(
        `${capitalize(ch)} may be undervalued by last-click; review using multi-touch attribution before reducing spend.`
      );
    }
  }
  if (portfolio?.top_first_touch_channel) {
    list.push(
      `Channels with strong first-touch influence (e.g. ${capitalize(portfolio.top_first_touch_channel)}) may deserve better upper-funnel evaluation.`
    );
  }
  const topClose = portfolio?.top_closing_channel;
  if (topClose && !list.some((s) => s.includes(topClose))) {
    list.push(
      `${capitalize(topClose)} is the strongest closer and may be a candidate for cautious budget expansion.`
    );
  }
  if (repeatPurchaseJourneysCount > 0) {
    list.push(
      "Repeat-purchase journeys suggest retention-oriented campaigns may be scalable."
    );
  }
  if (hasBudgetInsight(insights, "strong_closing_channel")) {
    const ch = insights.find((i) => i.type === "strong_closing_channel")?.channel;
    if (ch && !list.some((s) => s.includes(ch))) {
      list.push(
        `${capitalize(ch)} is effective at closing conversions; ensure tracking is correct before scaling.`
      );
    }
  }

  return dedupeSentences(list).slice(0, 5);
}

/** 3–5 priority actions: data fixes first, then business actions. Ranked. */
export function buildPriorityActions(input: ExecutiveSummaryInput): string[] {
  const { dataQuality, assistant, budgetOptimization } = input;
  const list: string[] = [];

  // 1. Data quality: missing click_id
  if (hasIssue(dataQuality, "conversions_without_click_id")) {
    const rec = dataQuality?.recommendations?.find((r) =>
      r.related_issue_codes?.includes("conversions_without_click_id")
    );
    if (rec?.action_text) {
      list.push(normalizeAction(rec.action_text));
    } else {
      list.push("Pass click_id in registration and purchase events.");
    }
  }
  // 2. Tracking links
  if (hasIssue(dataQuality, "clicks_without_source") || hasIssue(dataQuality, "visits_without_traffic_source")) {
    list.push("Ensure all ad platforms use BoardIQ tracking links.");
  }
  // 3. Purchase completeness
  if (hasIssue(dataQuality, "purchases_without_currency") || hasIssue(dataQuality, "purchases_without_value")) {
    list.push("Add currency and value to all purchase events.");
  }
  // 4. Assistant priority actions (avoid duplicate messages)
  assistant.priority_actions.forEach((a) => {
    const norm = normalizeAction(a);
    if (!list.some((x) => similarAction(x, norm))) list.push(norm);
  });
  // 5. Budget optimization actions (growth / review)
  budgetOptimization?.priority_actions?.forEach((a) => {
    const norm = normalizeAction(a);
    if (!list.some((x) => similarAction(x, norm))) list.push(norm);
  });

  return dedupeSentences(list).slice(0, 5);
}

function normalizeAction(s: string): string {
  return s.trim().replace(/\s+/g, " ");
}

function similarAction(a: string, b: string): boolean {
  const na = a.toLowerCase();
  const nb = b.toLowerCase();
  if (na === nb) return true;
  if (na.includes("click_id") && nb.includes("click_id")) return true;
  if (na.includes("currency") && nb.includes("currency")) return true;
  if (na.includes("value") && nb.includes("value")) return true;
  return false;
}

function dedupeSentences(list: string[]): string[] {
  const seen = new Set<string>();
  return list.filter((s) => {
    const key = s.toLowerCase().replace(/\s+/g, " ").trim();
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

/** Determines if we have enough data to show an executive summary. */
function hasSufficientData(input: ExecutiveSummaryInput): boolean {
  const { dataQuality, budgetOptimization, totalChains } = input;
  if (dataQuality?.has_data) return true;
  if ((budgetOptimization?.channel_metrics?.length ?? 0) > 0) return true;
  if (totalChains > 0) return true;
  if ((input.anomalies?.length ?? 0) > 0) return true;
  return false;
}

/** Build full executive summary output. */
export function buildExecutiveSummaryLayer(
  input: ExecutiveSummaryInput
): ExecutiveSummaryOutput {
  const sufficient = hasSufficientData(input);

  if (!sufficient) {
    return {
      has_sufficient_data: false,
      summary: "Insufficient data to form an executive summary for the selected period.",
      key_findings: [],
      key_risks: [],
      growth_opportunities: [],
      priority_actions: [],
    };
  }

  return {
    has_sufficient_data: true,
    summary: buildExecutiveSummary(input),
    key_findings: buildKeyFindings(input),
    key_risks: buildKeyRisks(input),
    growth_opportunities: buildGrowthOpportunities(input),
    priority_actions: buildPriorityActions(input),
  };
}
