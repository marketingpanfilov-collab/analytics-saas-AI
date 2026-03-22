/**
 * Data Quality Engine (BoardIQ)
 *
 * Answers: (1) How well is tracking configured? (2) Where are data lost? (3) What to fix?
 *
 * Data sources: redirect_click_events, visit_source_events, conversion_events.
 *
 * Score 0–100 (sum of 5 components):
 * - Click capture quality: (clicks_with_source_signal / clicks_total) * 20
 * - Visit attribution quality: avg(%click_id, %visit_id, %traffic_source) * 25
 * - Conversion attribution quality: avg(%click_id, %traffic_source, %user_external_id) * 30
 * - Purchase completeness: avg(value, currency, external_event_id, user_external_id) * 15
 * - Registration completeness: avg(%user_external_id, %traffic_or_click) * 10
 *
 * No-data rule: if no clicks, visits, registrations, or purchases in the period,
 * returns has_data: false, score: null, label: "No data" (no fake percentage).
 *
 * Issues: 13 types (clicks, visits, conversions, purchases, registrations).
 * Severity: 0–9% low, 10–24% medium, 25%+ high.
 *
 * Recommendations: derived from issues; include action_text and impact;
 * deduplicated by code; sorted by priority then relevance to top issues.
 * To add new issues: extend ISSUE_DEFS. To add new recommendations: extend RECOMMENDATION_DEFS.
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import { getAttributionState } from "./trafficSourceDetection";

// ---------------------------------------------------------------------------
// Score model (unchanged from MVP)
// ---------------------------------------------------------------------------

const MAX_POINTS = {
  click_capture: 20,
  visit_attribution: 25,
  conversion_attribution: 30,
  purchase_completeness: 15,
  registration_completeness: 10,
} as const;

export type DataQualityBreakdown = {
  click_capture_quality: number;
  visit_attribution_quality: number;
  conversion_attribution_quality: number;
  purchase_completeness: number;
  registration_completeness: number;
};

export type DataQualityStats = {
  clicks_total: number;
  visits_total: number;
  registrations_total: number;
  purchases_total: number;
};

export type DataQualityLabel =
  | "Low"
  | "Needs improvement"
  | "Good"
  | "Excellent"
  | "No data";

export type DataQualityIssue = {
  code: string;
  title: string;
  description: string;
  percent: number;
  missing_count: number;
  total_count: number;
  severity: "low" | "medium" | "high";
  category: "clicks" | "visits" | "conversions" | "purchases" | "registrations";
  low_sample?: boolean;
};

/** Business impact: attribution, ROAS, revenue tracking. */
export type DataQualityImpact =
  | "affects_attribution"
  | "affects_roas"
  | "affects_revenue_tracking";

export type DataQualityRecommendation = {
  code: string;
  title: string;
  description: string;
  /** Short action text for UI (e.g. "Передавайте bqcid как click_id после регистрации и покупки."). */
  action_text: string;
  priority: "high" | "medium" | "low";
  /** Which business metrics this recommendation improves. */
  impact: DataQualityImpact[];
  related_issue_codes: string[];
};

export type DataQualityResult = {
  has_data: boolean;
  score: number | null;
  label: DataQualityLabel;
  breakdown: DataQualityBreakdown | null;
  stats: DataQualityStats;
  issues: DataQualityIssue[];
  recommendations: DataQualityRecommendation[];
};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function getLabel(score: number): Exclude<DataQualityLabel, "No data"> {
  if (score <= 39) return "Low";
  if (score <= 69) return "Needs improvement";
  if (score <= 89) return "Good";
  return "Excellent";
}

function sinceIso(days: number): string {
  const d = new Date();
  d.setDate(d.getDate() - days);
  return d.toISOString();
}

const SEVERITY_ORDER: DataQualityIssue["severity"][] = ["high", "medium", "low"];
function severityRank(s: DataQualityIssue["severity"]): number {
  const i = SEVERITY_ORDER.indexOf(s);
  return i >= 0 ? i : 99;
}

/** 0–9% = low, 10–24% = medium, 25%+ = high. total_count < 5 → low_sample. */
function severityFromPercent(
  percent: number,
  totalCount: number
): { severity: DataQualityIssue["severity"]; low_sample: boolean } {
  const low_sample = totalCount < 5;
  if (percent <= 9) return { severity: "low", low_sample };
  if (percent <= 24) return { severity: "medium", low_sample };
  return { severity: "high", low_sample };
}

// ---------------------------------------------------------------------------
// Issue definitions: code, title, description, category (extensible)
// ---------------------------------------------------------------------------

const ISSUE_DEFS: Array<{
  code: DataQualityIssue["code"];
  title: string;
  description: string;
  category: DataQualityIssue["category"];
}> = [
  {
    code: "clicks_without_source_signal",
    title: "Клики без источника",
    description:
      "Часть переходов по redirect-ссылкам не содержит ни одного сигнала источника (fbclid, gclid, ttclid, yclid, utm_source). Атрибуция таких кликов невозможна.",
    category: "clicks",
  },
  {
    code: "visits_without_click_id",
    title: "Визиты без click ID",
    description:
      "Визиты приходят без click_id (bqcid), поэтому не связываются с переходом по tracking-ссылке.",
    category: "visits",
  },
  {
    code: "visits_without_visit_id",
    title: "Визиты без visit ID",
    description:
      "Визиты без visit_id (bqvid) затрудняют связку сессии с конверсиями.",
    category: "visits",
  },
  {
    code: "visits_without_traffic_source",
    title: "Визиты без источника трафика",
    description:
      "Нет определённого traffic_source (auto-detect по click id / UTM / referrer).",
    category: "visits",
  },
  {
    code: "visits_with_lost_attribution",
    title: "Потеря атрибуции",
    description:
      "Визиты с переходом с рекламного/социального источника (Facebook, Google, TikTok, Yandex), но без click_id и UTM — атрибуция могла быть потеряна.",
    category: "visits",
  },
  {
    code: "conversions_without_click_id",
    title: "Конверсии без click ID",
    description:
      "События конверсий приходят без click_id, поэтому не связываются с рекламным кликом.",
    category: "conversions",
  },
  {
    code: "conversions_without_traffic_source",
    title: "Конверсии без источника трафика",
    description:
      "Конверсии без traffic_source снижают точность атрибуции по каналам.",
    category: "conversions",
  },
  {
    code: "conversions_without_user_external_id",
    title: "Конверсии без user_external_id",
    description:
      "Отсутствие user_external_id не позволяет связать конверсию с пользователем в вашей системе.",
    category: "conversions",
  },
  {
    code: "purchases_without_value",
    title: "Покупки без суммы",
    description:
      "События purchase без value не участвуют в расчёте выручки и ROMI.",
    category: "purchases",
  },
  {
    code: "purchases_without_currency",
    title: "Покупки без валюты",
    description:
      "Без currency невозможно корректно агрегировать выручку по валютам.",
    category: "purchases",
  },
  {
    code: "purchases_without_external_event_id",
    title: "Покупки без external_event_id",
    description:
      "external_event_id нужен для дедупликации и связи с заказами в CRM.",
    category: "purchases",
  },
  {
    code: "purchases_without_user_external_id",
    title: "Покупки без user_external_id",
    description:
      "user_external_id связывает покупку с пользователем для LTV и когорт.",
    category: "purchases",
  },
  {
    code: "registrations_without_user_external_id",
    title: "Регистрации без user_external_id",
    description:
      "Передавайте внутренний user_external_id после успешной регистрации для связи с визитом.",
    category: "registrations",
  },
  {
    code: "registrations_without_traffic_source_or_click_id",
    title: "Регистрации без источника или click ID",
    description:
      "Регистрации без traffic_source и click_id не позволяют атрибутировать канал.",
    category: "registrations",
  },
];

// ---------------------------------------------------------------------------
// Recommendation rules: from issue codes to recommendation (extensible).
// Deduplication: one recommendation per code; multiple issues can map to same rec.
// ---------------------------------------------------------------------------

const RECOMMENDATION_DEFS: Array<{
  code: string;
  title: string;
  description: string;
  action_text: string;
  priority: DataQualityRecommendation["priority"];
  impact: DataQualityImpact[];
  related_issue_codes: string[];
}> = [
  {
    code: "pass_click_id_to_conversions",
    title: "Передавайте click_id в событиях конверсий",
    description:
      "Часть purchase и registration событий приходит без click_id. Это снижает точность атрибуции.",
    action_text: "Передавайте bqcid как click_id после регистрации и покупки.",
    priority: "high",
    impact: ["affects_attribution", "affects_roas"],
    related_issue_codes: ["conversions_without_click_id"],
  },
  {
    code: "use_tracking_links",
    title: "Используйте tracking-ссылки",
    description:
      "Прямые ссылки не передают UTM и click id. Замените их на ссылки из UTM Builder.",
    action_text: "Замените прямые ссылки на tracking-ссылки из UTM Builder.",
    priority: "high",
    impact: ["affects_attribution"],
    related_issue_codes: [
      "visits_without_traffic_source",
      "visits_with_lost_attribution",
      "clicks_without_source_signal",
    ],
  },
  {
    code: "fix_lost_attribution",
    title: "Восстановите атрибуцию с рекламных источников",
    description:
      "Часть визитов приходит с рекламных/социальных источников (Facebook, Google, TikTok, Yandex), но без click_id и UTM — метки теряются при переходе.",
    action_text: "Проверьте передачу UTM и click_id с landing URL в pixel/source-запросах.",
    priority: "high",
    impact: ["affects_attribution", "affects_roas"],
    related_issue_codes: ["visits_with_lost_attribution"],
  },
  {
    code: "pass_click_id",
    title: "Передавайте click_id",
    description: "Передавайте bqcid с landing URL в pixel/source запросы.",
    action_text: "Передавайте bqcid как click_id в запросах визита.",
    priority: "high",
    impact: ["affects_attribution"],
    related_issue_codes: ["visits_without_click_id"],
  },
  {
    code: "check_visit_id",
    title: "Проверьте генерацию visit_id",
    description: "visit_id (bqvid) связывает визит с конверсиями.",
    action_text: "Убедитесь, что pixel передаёт visit_id (bqvid) в source-событиях.",
    priority: "medium",
    impact: ["affects_attribution"],
    related_issue_codes: ["visits_without_visit_id"],
  },
  {
    code: "check_utm_and_click_id",
    title: "Проверьте передачу UTM и click id",
    description: "Визиты без traffic_source не участвуют в атрибуции по каналам.",
    action_text: "Проверьте использование tracking-ссылок и передачу UTM или click id на визит.",
    priority: "high",
    impact: ["affects_attribution"],
    related_issue_codes: ["visits_without_traffic_source", "visits_with_lost_attribution"],
  },
  {
    code: "add_currency_to_purchases",
    title: "Передавайте currency",
    description:
      "Без currency невозможно корректно считать выручку по валютам. Поддерживаются USD, KZT.",
    action_text: "Передавайте currency в purchase событиях (USD, KZT).",
    priority: "high",
    impact: ["affects_revenue_tracking", "affects_roas"],
    related_issue_codes: ["purchases_without_currency"],
  },
  {
    code: "add_user_external_id",
    title: "Передавайте user_external_id",
    description:
      "user_external_id связывает конверсии с пользователем для когорт и LTV.",
    action_text: "Передавайте внутренний ID пользователя в registration и purchase.",
    priority: "high",
    impact: ["affects_attribution"],
    related_issue_codes: [
      "registrations_without_user_external_id",
      "conversions_without_user_external_id",
      "purchases_without_user_external_id",
    ],
  },
  {
    code: "add_value_to_purchases",
    title: "Передавайте сумму покупки",
    description: "Поле value нужно для расчёта выручки и ROMI.",
    action_text: "Передавайте value (сумму) в purchase событиях.",
    priority: "medium",
    impact: ["affects_revenue_tracking", "affects_roas"],
    related_issue_codes: ["purchases_without_value"],
  },
  {
    code: "add_external_event_id",
    title: "Передавайте ID заказа",
    description: "external_event_id нужен для дедупликации и связи с заказами в CRM.",
    action_text: "Передавайте external_event_id в purchase (ID заказа в вашей системе).",
    priority: "medium",
    impact: ["affects_revenue_tracking"],
    related_issue_codes: ["purchases_without_external_event_id"],
  },
  {
    code: "registrations_traffic_or_click",
    title: "Регистрации: источник или click_id",
    description:
      "Регистрации без traffic_source и click_id не атрибутируются по каналу.",
    action_text: "Передавайте click_id или UTM/traffic_source в registration событиях.",
    priority: "high",
    impact: ["affects_attribution"],
    related_issue_codes: ["registrations_without_traffic_source_or_click_id"],
  },
];

// ---------------------------------------------------------------------------
// Build issues from raw counts (only include when total > 0 and missing > 0)
// ---------------------------------------------------------------------------

type Aggregates = {
  clicksTotal: number;
  clicksWithSignal: number;
  visitsTotal: number;
  visitsWithClickId: number;
  visitsWithVisitId: number;
  visitsWithTrafficSource: number;
  visitsWithLostAttribution: number;
  convTotal: number;
  convWithClickId: number;
  convWithTraffic: number;
  convWithUserExt: number;
  purchasesTotal: number;
  purchWithValue: number;
  purchWithCurrency: number;
  purchWithExtId: number;
  purchWithUserExt: number;
  regTotal: number;
  regWithUserExt: number;
  regWithTrafficOrClick: number;
};

function buildIssues(agg: Aggregates): DataQualityIssue[] {
  const issues: DataQualityIssue[] = [];
  const def = (code: string) => ISSUE_DEFS.find((d) => d.code === code)!;

  if (agg.clicksTotal > 0) {
    const missing = agg.clicksTotal - agg.clicksWithSignal;
    if (missing > 0) {
      const percent = Math.round((missing / agg.clicksTotal) * 100);
      const { severity, low_sample } = severityFromPercent(percent, agg.clicksTotal);
      issues.push({
        ...def("clicks_without_source_signal"),
        percent,
        missing_count: missing,
        total_count: agg.clicksTotal,
        severity,
        low_sample,
      });
    }
  }

  if (agg.visitsTotal > 0) {
    const missingVisit = agg.visitsTotal - agg.visitsWithVisitId;
    if (missingVisit > 0) {
      const percent = Math.round((missingVisit / agg.visitsTotal) * 100);
      const { severity, low_sample } = severityFromPercent(percent, agg.visitsTotal);
      issues.push({
        ...def("visits_without_visit_id"),
        percent,
        missing_count: missingVisit,
        total_count: agg.visitsTotal,
        severity,
        low_sample,
      });
    }
    if (agg.visitsWithLostAttribution > 0) {
      const percent = Math.round((agg.visitsWithLostAttribution / agg.visitsTotal) * 100);
      const { severity, low_sample } = severityFromPercent(percent, agg.visitsTotal);
      issues.push({
        ...def("visits_with_lost_attribution"),
        percent,
        missing_count: agg.visitsWithLostAttribution,
        total_count: agg.visitsTotal,
        severity,
        low_sample,
      });
    }
  }

  if (agg.convTotal > 0) {
    const missingClick = agg.convTotal - agg.convWithClickId;
    if (missingClick > 0) {
      const percent = Math.round((missingClick / agg.convTotal) * 100);
      const { severity, low_sample } = severityFromPercent(percent, agg.convTotal);
      issues.push({
        ...def("conversions_without_click_id"),
        percent,
        missing_count: missingClick,
        total_count: agg.convTotal,
        severity,
        low_sample,
      });
    }
    const missingTraffic = agg.convTotal - agg.convWithTraffic;
    if (missingTraffic > 0) {
      const percent = Math.round((missingTraffic / agg.convTotal) * 100);
      const { severity, low_sample } = severityFromPercent(percent, agg.convTotal);
      issues.push({
        ...def("conversions_without_traffic_source"),
        percent,
        missing_count: missingTraffic,
        total_count: agg.convTotal,
        severity,
        low_sample,
      });
    }
    const missingUser = agg.convTotal - agg.convWithUserExt;
    if (missingUser > 0) {
      const percent = Math.round((missingUser / agg.convTotal) * 100);
      const { severity, low_sample } = severityFromPercent(percent, agg.convTotal);
      issues.push({
        ...def("conversions_without_user_external_id"),
        percent,
        missing_count: missingUser,
        total_count: agg.convTotal,
        severity,
        low_sample,
      });
    }
  }

  if (agg.purchasesTotal > 0) {
    for (const [missingCount, key] of [
      [agg.purchasesTotal - agg.purchWithValue, "purchases_without_value"],
      [agg.purchasesTotal - agg.purchWithCurrency, "purchases_without_currency"],
      [agg.purchasesTotal - agg.purchWithExtId, "purchases_without_external_event_id"],
      [agg.purchasesTotal - agg.purchWithUserExt, "purchases_without_user_external_id"],
    ] as const) {
      if (missingCount > 0) {
        const percent = Math.round((missingCount / agg.purchasesTotal) * 100);
        const { severity, low_sample } = severityFromPercent(percent, agg.purchasesTotal);
        issues.push({
          ...def(key),
          percent,
          missing_count: missingCount,
          total_count: agg.purchasesTotal,
          severity,
          low_sample,
        });
      }
    }
  }

  if (agg.regTotal > 0) {
    const missingUser = agg.regTotal - agg.regWithUserExt;
    if (missingUser > 0) {
      const percent = Math.round((missingUser / agg.regTotal) * 100);
      const { severity, low_sample } = severityFromPercent(percent, agg.regTotal);
      issues.push({
        ...def("registrations_without_user_external_id"),
        percent,
        missing_count: missingUser,
        total_count: agg.regTotal,
        severity,
        low_sample,
      });
    }
    const missingTraffic = agg.regTotal - agg.regWithTrafficOrClick;
    if (missingTraffic > 0) {
      const percent = Math.round((missingTraffic / agg.regTotal) * 100);
      const { severity, low_sample } = severityFromPercent(percent, agg.regTotal);
      issues.push({
        ...def("registrations_without_traffic_source_or_click_id"),
        percent,
        missing_count: missingTraffic,
        total_count: agg.regTotal,
        severity,
        low_sample,
      });
    }
  }

  // Sort: severity (high first), then percent DESC
  issues.sort((a, b) => {
    const sa = severityRank(a.severity);
    const sb = severityRank(b.severity);
    if (sa !== sb) return sa - sb;
    return b.percent - a.percent;
  });

  return issues;
}

// ---------------------------------------------------------------------------
// Build recommendations from issues (only include if related issue present)
// ---------------------------------------------------------------------------

function buildRecommendations(issues: DataQualityIssue[]): DataQualityRecommendation[] {
  const issueCodes = new Set(issues.map((i) => i.code));
  const topIssueCodes = new Set(issues.slice(0, 5).map((i) => i.code));

  const out: DataQualityRecommendation[] = [];
  for (const rec of RECOMMENDATION_DEFS) {
    const hasRelated = rec.related_issue_codes.some((c) => issueCodes.has(c));
    if (!hasRelated) continue;
    const relatedToTop = rec.related_issue_codes.some((c) => topIssueCodes.has(c));
    out.push({
      code: rec.code,
      title: rec.title,
      description: rec.description,
      action_text: rec.action_text,
      priority: rec.priority,
      impact: rec.impact,
      related_issue_codes: rec.related_issue_codes.filter((c) => issueCodes.has(c)),
    });
  }

  const priorityOrder: DataQualityRecommendation["priority"][] = ["high", "medium", "low"];
  out.sort((a, b) => {
    const pa = priorityOrder.indexOf(a.priority);
    const pb = priorityOrder.indexOf(b.priority);
    if (pa !== pb) return pa - pb;
    const aRelevant = a.related_issue_codes.some((c) => topIssueCodes.has(c));
    const bRelevant = b.related_issue_codes.some((c) => topIssueCodes.has(c));
    if (aRelevant && !bRelevant) return -1;
    if (!aRelevant && bRelevant) return 1;
    return 0;
  });

  return out;
}

// ---------------------------------------------------------------------------
// Main: fetch data, compute score, issues, recommendations
// ---------------------------------------------------------------------------

export type DataQualityScoreOptions = {
  /** When set, compute score for the N-day window ending at this ISO date (for week-over-week). */
  rangeEndIso?: string;
};

export async function computeDataQualityScore(
  admin: SupabaseClient,
  projectId: string,
  days: number,
  options?: DataQualityScoreOptions
): Promise<DataQualityResult> {
  let since: string;
  let until: string | undefined;
  if (options?.rangeEndIso) {
    const end = new Date(options.rangeEndIso);
    const start = new Date(end.getTime() - days * 24 * 60 * 60 * 1000);
    since = start.toISOString();
    until = end.toISOString();
  } else {
    since = sinceIso(days);
  }

  const baseClick = admin
    .from("redirect_click_events")
    .select("id, fbclid, gclid, ttclid, yclid, utm_source")
    .eq("project_id", projectId)
    .gte("created_at", since);
  const baseVisit = admin
    .from("visit_source_events")
    .select("id, click_id, visit_id, traffic_source, referrer, utm_source, fbclid, gclid, ttclid, yclid")
    .eq("site_id", projectId)
    .gte("created_at", since);
  const baseConv = admin
    .from("conversion_events")
    .select("id, click_id, traffic_source, user_external_id")
    .eq("project_id", projectId)
    .gte("created_at", since);
  const basePurch = admin
    .from("conversion_events")
    .select("id, value, currency, external_event_id, user_external_id")
    .eq("project_id", projectId)
    .eq("event_name", "purchase")
    .gte("created_at", since);
  const baseReg = admin
    .from("conversion_events")
    .select("id, user_external_id, traffic_source, click_id")
    .eq("project_id", projectId)
    .eq("event_name", "registration")
    .gte("created_at", since);

  const [
    { data: clickRows },
    { data: visitRows },
    { data: convRows },
    { data: purchaseRows },
    { data: regRows },
  ] = await Promise.all([
    until ? baseClick.lte("created_at", until) : baseClick,
    until ? baseVisit.lte("created_at", until) : baseVisit,
    until ? baseConv.lte("created_at", until) : baseConv,
    until ? basePurch.lte("created_at", until) : basePurch,
    until ? baseReg.lte("created_at", until) : baseReg,
  ]);

  const clicksTotal = clickRows?.length ?? 0;
  const clicksWithSignal =
    clickRows?.filter(
      (r) =>
        (r.fbclid != null && r.fbclid !== "") ||
        (r.gclid != null && r.gclid !== "") ||
        (r.ttclid != null && r.ttclid !== "") ||
        (r.yclid != null && r.yclid !== "") ||
        (r.utm_source != null && r.utm_source !== "")
    ).length ?? 0;

  const visitsTotal = visitRows?.length ?? 0;
  const visitsWithClickId = visitRows?.filter((r) => r.click_id != null && r.click_id !== "").length ?? 0;
  const visitsWithVisitId = visitRows?.filter((r) => r.visit_id != null && r.visit_id !== "").length ?? 0;
  const visitsWithTrafficSource = visitRows?.filter((r) => r.traffic_source != null && r.traffic_source !== "").length ?? 0;
  const visitsWithLostAttribution =
    visitRows?.filter((r) =>
      getAttributionState({
        referrer: r.referrer,
        utm_source: r.utm_source,
        click_id: r.click_id,
        fbclid: r.fbclid,
        gclid: r.gclid,
        ttclid: r.ttclid,
        yclid: r.yclid,
      }) === "missing_expected_attribution"
    ).length ?? 0;
  const visitsWithValidAttribution = visitsTotal - visitsWithLostAttribution;

  const convTotal = convRows?.length ?? 0;
  const convWithClickId = convRows?.filter((r) => r.click_id != null && r.click_id !== "").length ?? 0;
  const convWithTraffic = convRows?.filter((r) => r.traffic_source != null && r.traffic_source !== "").length ?? 0;
  const convWithUserExt = convRows?.filter((r) => r.user_external_id != null && r.user_external_id !== "").length ?? 0;

  const purchasesTotal = purchaseRows?.length ?? 0;
  const purchWithValue = purchaseRows?.filter((r) => r.value != null).length ?? 0;
  const purchWithCurrency = purchaseRows?.filter((r) => r.currency != null && r.currency !== "").length ?? 0;
  const purchWithExtId = purchaseRows?.filter((r) => r.external_event_id != null && r.external_event_id !== "").length ?? 0;
  const purchWithUserExt = purchaseRows?.filter((r) => r.user_external_id != null && r.user_external_id !== "").length ?? 0;

  const regTotal = regRows?.length ?? 0;
  const regWithUserExt = regRows?.filter((r) => r.user_external_id != null && r.user_external_id !== "").length ?? 0;
  const regWithTrafficOrClick = regRows?.filter(
    (r) =>
      (r.traffic_source != null && r.traffic_source !== "") || (r.click_id != null && r.click_id !== "")
  ).length ?? 0;

  const stats: DataQualityStats = {
    clicks_total: clicksTotal,
    visits_total: visitsTotal,
    registrations_total: regTotal,
    purchases_total: purchasesTotal,
  };

  const has_data =
    clicksTotal > 0 || visitsTotal > 0 || regTotal > 0 || purchasesTotal > 0;

  if (!has_data) {
    return {
      has_data: false,
      score: null,
      label: "No data",
      breakdown: null,
      stats,
      issues: [],
      recommendations: [],
    };
  }

  const agg: Aggregates = {
    clicksTotal,
    clicksWithSignal,
    visitsTotal,
    visitsWithClickId,
    visitsWithVisitId,
    visitsWithTrafficSource,
    visitsWithLostAttribution,
    convTotal,
    convWithClickId,
    convWithTraffic,
    convWithUserExt,
    purchasesTotal,
    purchWithValue,
    purchWithCurrency,
    purchWithExtId,
    purchWithUserExt,
    regTotal,
    regWithUserExt,
    regWithTrafficOrClick,
  };

  const clickShare = clicksTotal > 0 ? clicksWithSignal / clicksTotal : 0;
  const clickCaptureQuality = Math.round(clickShare * MAX_POINTS.click_capture);

  const visitShares =
    visitsTotal > 0
      ? [visitsWithClickId / visitsTotal, visitsWithVisitId / visitsTotal, visitsWithValidAttribution / visitsTotal]
      : [0, 0, 0];
  const visitAttributionQuality = Math.round(
    (visitShares.reduce((a, b) => a + b, 0) / 3) * MAX_POINTS.visit_attribution
  );

  const convShares =
    convTotal > 0
      ? [convWithClickId / convTotal, convWithTraffic / convTotal, convWithUserExt / convTotal]
      : [0, 0, 0];
  const conversionAttributionQuality = Math.round(
    (convShares.reduce((a, b) => a + b, 0) / 3) * MAX_POINTS.conversion_attribution
  );

  const purchShares =
    purchasesTotal > 0
      ? [
          purchWithValue / purchasesTotal,
          purchWithCurrency / purchasesTotal,
          purchWithExtId / purchasesTotal,
          purchWithUserExt / purchasesTotal,
        ]
      : [0, 0, 0, 0];
  const purchaseCompleteness = Math.round(
    (purchShares.reduce((a, b) => a + b, 0) / 4) * MAX_POINTS.purchase_completeness
  );

  const regShares = regTotal > 0 ? [regWithUserExt / regTotal, regWithTrafficOrClick / regTotal] : [0, 0];
  const registrationCompleteness = Math.round(
    (regShares.reduce((a, b) => a + b, 0) / 2) * MAX_POINTS.registration_completeness
  );

  const breakdown: DataQualityBreakdown = {
    click_capture_quality: clickCaptureQuality,
    visit_attribution_quality: visitAttributionQuality,
    conversion_attribution_quality: conversionAttributionQuality,
    purchase_completeness: purchaseCompleteness,
    registration_completeness: registrationCompleteness,
  };

  const score = Math.min(
    100,
    Math.max(
      0,
      clickCaptureQuality +
        visitAttributionQuality +
        conversionAttributionQuality +
        purchaseCompleteness +
        registrationCompleteness
    )
  );

  const issues = buildIssues(agg);
  const recommendations = buildRecommendations(issues);

  return {
    has_data: true,
    score: Math.round(score),
    label: getLabel(score),
    breakdown,
    stats,
    issues,
    recommendations,
  };
}
