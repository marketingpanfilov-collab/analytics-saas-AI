/**
 * Marketing report: plan vs fact, KPIs, budget coverage, campaign alerts, campaign table.
 * Ad spend/revenue: canonical dashboard path (enabled accounts, correct level per platform, USD-normalized).
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import {
  fetchCampaignLevelMetricRowsForProject,
  fetchCanonicalMetricRowsForProject,
  resolveEnabledAdAccountIdsForProject,
  type CanonicalFilterOptions,
} from "@/app/lib/dashboardCanonical";
import { sumPlannedBudgetForMonth, type CampaignBudgetInput } from "@/app/lib/campaignPlannedBudget";
import { computeLtvStyleRetentionCprActual } from "@/app/lib/marketingRetentionCpr";
import {
  aggregatePurchaseRevenueByReportChannel,
  fetchAndEnrichKpiConversionRows,
  filterEnrichedRowsByDashboardSources,
  sumPurchaseRevenueProjectCurrency,
} from "@/app/lib/dashboardKpiAttribution";
import { isNonPlatformSourcesOnly, PLATFORM_SOURCES } from "@/app/lib/dashboardRangeParams";
import { getDashboardSourceOptions, type DashboardSourceOption } from "@/app/lib/dashboardSourceOptions";

export type PlanMetrics = {
  plan_month: number;
  plan_year: number;
  /** План расхода за месяц: `sales_plan_budget` + `repeat_sales_budget` (как «Общий бюджет» в «Редактировать план»). */
  monthly_budget: number | null;
  target_registrations: number | null;
  /** План продаж за месяц: `sales_plan_count` + `repeat_sales_count` (как «Всего продаж»). */
  target_sales: number | null;
  target_roas: number | null;
  target_cac: number | null;
  fact_budget: number;
  /** Число событий `registration` за период (может быть больше числа людей). */
  fact_registrations: number;
  /** Уникальные пользователи с ≥1 событием registration в периоде (по visitor_id / user_external_id). */
  fact_unique_registrants: number;
  fact_sales: number;
  fact_revenue: number;
  fact_roas: number | null;
  /** Фактический расход (USD), отнесённый к привлечению: весь канонический расход минус удержание; неопределённый intent и расход без привязки к кампании — здесь. */
  fact_spend_acquisition_usd: number;
  /** Фактический расход (USD) по кампаниям с marketing_intent = retention (сумма по campaign-level метрикам). */
  fact_spend_retention_usd: number;
  /** CPR (факт) как в LTV: расход retention-кампаний ÷ покупки с campaign_intent=retention. */
  fact_cpr: number | null;
  /** САС по новым покупателям (одна покупка в периоде на пользователя): spend ÷ new_buyers. */
  fact_cac: number | null;
};

export type KpiMetrics = {
  /** САС по новым покупателям (для сравнения с целью и скорингом). */
  cac: number | null;
  /** САС по всем уникальным платящим за период: spend ÷ число пользователей с ≥1 покупкой. */
  cac_blended: number | null;
  cpr: number | null;
  cpo: number | null;
  roas: number | null;
  /**
   * Конверсия регистрация → покупка по событиям: purchase ÷ registration × 100% (не выше 100%), тот же фильтр источников.
   */
  conversion_rate: number | null;
  new_buyers: number;
  returning_buyers: number;
  average_touches_before_purchase: number | null;
};

export type BudgetCoverage = {
  monthly_budget: number | null;
  active_campaign_budget: number;
  uncovered_budget: number | null;
  /** Spend + delivery из тех же канонических строк `daily_ad_metrics`, что и итоговый расход (account-level Meta/Google/TikTok). */
  by_platform: { platform: string; spend: number; impressions: number; clicks: number }[];
};

export type PlatformBudgetCoverage = {
  /**
   * Сумма пропорциональных бюджетов кампаний за месяц плана (daily/lifetime + даты).
   * Шкала как в `campaigns` (как расход в кабинете); план продаж в другой валюте сравнивается без конвертации (v1).
   */
  allocated_campaign_budget_month: number;
  /** Сумма `sales_plan_budget` + `repeat_sales_budget` месяца (как «Общий бюджет» в модалке плана). */
  plan_monthly_budget: number | null;
  /** allocated / plan_monthly_budget * 100 при plan > 0. */
  budget_plan_coverage_pct: number | null;
  /** Канонический USD spend на пересечении выбранного периода с месяцем плана (до сегодня). */
  fact_slice_usd: number;
  /** Канонический USD spend с 1-го числа месяца плана до min(конец месяца, сегодня). */
  fact_month_usd: number;
  /** fact_slice_usd / allocated при allocated > 0. */
  spend_vs_allocated_slice_pct: number | null;
  /** fact_month_usd / allocated при allocated > 0. */
  spend_vs_allocated_month_pct: number | null;
  campaigns_with_budget: number;
  campaigns_total_in_project: number;
  coverage_period_start: string;
  coverage_period_end: string;
  month_coverage_start: string;
  month_coverage_end: string;
};

export type CampaignAlert = {
  platform: string;
  campaign_name: string;
  campaign_id: string | null;
  problem_type: string;
  recommendation: string;
};

export type CampaignRow = {
  platform: string;
  platform_key: string;
  campaign_id: string | null;
  campaign_name: string;
  spend: number;
  impressions: number;
  clicks: number;
  conversions: number;
  cac: number | null;
  roas: number | null;
  status: "green" | "yellow" | "red";
  marketing_intent: "acquisition" | "retention" | null;
  campaign_status: string | null;
  is_inactive: boolean;
  status_label_ru: string | null;
};

export type ForecastMetrics = {
  days_passed: number;
  days_total: number;
  current_spend: number;
  current_sales: number;
  current_registrations: number;
  plan_budget: number | null;
  plan_registrations: number | null;
  plan_sales: number | null;
  forecast_spend: number;
  forecast_registrations: number;
  forecast_sales: number;
  forecast_month: number;
  forecast_year: number;
};

const PLATFORM_LABEL: Record<string, string> = {
  meta: "Meta Ads",
  google: "Google Ads",
  tiktok: "TikTok Ads",
  yandex: "Yandex Ads",
};

function maxYmd(a: string, b: string): string {
  return a >= b ? a : b;
}

function minYmd(a: string, b: string): string {
  return a <= b ? a : b;
}

function planMonthYearFromEnd(endYmd: string): { year: number; month: number } {
  const [y, m] = endYmd.split("-").map(Number);
  return { year: y, month: m };
}

function lastDayOfMonthYmd(year: number, month: number): string {
  const d = new Date(Date.UTC(year, month, 0));
  return d.toISOString().slice(0, 10);
}

const ACTIVE_STATUS = new Set(["active", "enabled"]);

function normalizeCampaignStatus(status: string | null | undefined): string | null {
  if (status == null || String(status).trim() === "") return null;
  return String(status).trim();
}

function campaignIsInactive(status: string | null): boolean {
  if (status == null) return false;
  return !ACTIVE_STATUS.has(status.toLowerCase());
}

function statusLabelRu(status: string | null, inactive: boolean): string | null {
  if (!inactive || !status) return inactive ? "Неактивна" : null;
  const u = status.toUpperCase();
  if (u === "ARCHIVED" || u === "REMOVED" || u === "COMPLETED" || u === "DELETED") return "Завершена";
  if (u === "PAUSED") return "На паузе";
  return status;
}

export type MarketingScoreFactor = {
  label: string;
  /** Компонент 0–100 до взвешивания. */
  score: number;
  /** Базовый вес в формуле (сумма активных весов нормируется до 1). */
  weight: number;
};

export type MarketingScoreDetail = {
  score: number | null;
  factors: MarketingScoreFactor[];
  skipped: string[];
};

/** Дедуп регистраций / покупателей по строке события: приоритет user_external_id, иначе visitor_id, иначе id события. */
function simpleConversionUserKey(c: { id: string; visitor_id: string | null; user_external_id?: string | null }): string {
  const u = c.user_external_id?.trim();
  const v = c.visitor_id?.trim();
  if (u) return `u:${u}`;
  if (v) return `v:${v}`;
  return `evt:${c.id}`;
}

function computeMarketingScoreDetail(input: {
  roas: number | null;
  target_roas: number | null;
  cac: number | null;
  target_cac: number | null;
  unique_registrants: number;
  conversion_rate: number | null;
  monthly_budget: number | null;
  spend: number;
  avg_touches: number | null;
}): MarketingScoreDetail {
  const factors: MarketingScoreFactor[] = [];
  const skipped: string[] = [];

  const tr = input.target_roas;
  if (input.roas != null && tr != null && tr > 0) {
    factors.push({
      label: "ROAS к цели",
      score: Math.min(100, (input.roas / tr) * 100),
      weight: 0.3,
    });
  } else if (input.roas == null) {
    skipped.push("ROAS не входит: нет выручки или расхода за период");
  } else {
    skipped.push("ROAS не входит: цель ROAS в плане не задана");
  }

  const tc = input.target_cac;
  if (input.cac != null && tc != null && tc > 0) {
    const ratio = input.cac / tc;
    factors.push({
      label: "CAC к цели",
      score: Math.max(0, Math.min(100, 100 - (ratio - 1) * 80)),
      weight: 0.25,
    });
  } else if (input.cac == null) {
    skipped.push("CAC не входит: нет новых покупателей или расхода");
  } else {
    skipped.push("CAC не входит: цель CAC в плане не задана");
  }

  if (input.unique_registrants > 0 && input.conversion_rate != null) {
    factors.push({
      label: "Конверсия рег. → покупка (события)",
      score: Math.min(100, input.conversion_rate * 4),
      weight: 0.15,
    });
  } else {
    skipped.push("Конверсия не входит: нет регистраций за период");
  }

  if (input.monthly_budget != null && input.monthly_budget > 0) {
    factors.push({
      label: "Освоение бюджета",
      score: Math.min(100, (input.spend / input.monthly_budget) * 100),
      weight: 0.15,
    });
  } else {
    skipped.push("Освоение бюджета не входит: месячный бюджет в плане не задан");
  }

  if (input.avg_touches != null && Number.isFinite(input.avg_touches)) {
    factors.push({
      label: "Касания до покупки",
      score: Math.max(0, 100 - Math.min(100, input.avg_touches * 12)),
      weight: 0.15,
    });
  } else {
    skipped.push("Касания не входят: нет данных по визитам");
  }

  if (factors.length === 0) {
    return { score: null, factors: [], skipped };
  }

  const wsum = factors.reduce((a, f) => a + f.weight, 0);
  if (wsum <= 0) {
    return { score: null, factors, skipped };
  }
  let acc = 0;
  for (const f of factors) {
    acc += f.score * (f.weight / wsum);
  }
  const score = Math.round(Math.min(100, Math.max(0, acc)));
  return { score, factors, skipped };
}

export type RevenueByAcquisitionRow = {
  /** Канонический ключ: meta | google | tiktok | yandex | direct | organic_search | referral */
  source: string;
  revenue: number;
};

/** Сводная таблица каналов: метрики за период; null = показывать «—». */
export type MarketingReportChannelRow = {
  id: string;
  type: "platform" | "class";
  label_ru: string;
  spend: number | null;
  impressions: number | null;
  clicks: number | null;
  revenue: number | null;
  share_spend_pct: number | null;
  roas: number | null;
};

const CHANNEL_LABEL_RU: Record<string, string> = {
  meta: "Meta Ads",
  google: "Google Ads",
  tiktok: "TikTok Ads",
  yandex: "Yandex Ads",
  direct: "Прямые",
  organic_search: "Органический поиск",
  organic_social: "Органика (соцсети)",
  paid: "Paid",
  unknown: "Неизвестно",
  referral: "Рефералы",
};

const PLATFORM_ORDER = ["meta", "google", "tiktok", "yandex"] as const;

function sortMarketingChannelIds(ids: string[]): string[] {
  const arr = [...new Set(ids)];
  arr.sort((a, b) => {
    const ia = PLATFORM_ORDER.indexOf(a as (typeof PLATFORM_ORDER)[number]);
    const ib = PLATFORM_ORDER.indexOf(b as (typeof PLATFORM_ORDER)[number]);
    if (ia >= 0 && ib >= 0) return ia - ib;
    if (ia >= 0) return -1;
    if (ib >= 0) return 1;
    const la = CHANNEL_LABEL_RU[a] ?? a;
    const lb = CHANNEL_LABEL_RU[b] ?? b;
    return la.localeCompare(lb, "ru");
  });
  return arr;
}

export type MarketingSummaryOptions = {
  project_id: string;
  start: string;
  end: string;
  target_cac?: number | null;
  target_roas?: number | null;
  /** Как на главном дашборде: фильтр по id из source-options (пусто = все). */
  sources?: string[] | null;
  /** Как `account_ids` на `/api/dashboard/bundle`: только эти ad_accounts.id (включённые). */
  account_ids?: string[] | null;
};

/** Согласовано с каноникой дашборда: фильтр платформ + опционально аккаунты. */
function buildMarketingCanonicalOpts(
  sources: string[] | undefined,
  accountIds: string[] | undefined
): CanonicalFilterOptions | null {
  const acc = accountIds?.length ? accountIds : undefined;
  if (sources?.length && isNonPlatformSourcesOnly(sources)) {
    return acc ? { accountIds: acc } : null;
  }
  let plats: string[] | undefined;
  if (sources?.length) {
    const filtered = sources.filter((s) =>
      PLATFORM_SOURCES.includes(s.toLowerCase() as (typeof PLATFORM_SOURCES)[number])
    );
    plats = filtered.length ? filtered : undefined;
  }
  if (!plats?.length && !acc?.length) return null;
  const out: CanonicalFilterOptions = {};
  if (plats?.length) out.sources = plats;
  if (acc?.length) out.accountIds = acc;
  return out;
}

export async function getMarketingSummary(
  admin: SupabaseClient,
  options: MarketingSummaryOptions
): Promise<{
  plan: PlanMetrics;
  kpi: KpiMetrics;
  budget: BudgetCoverage;
  platform_budget: PlatformBudgetCoverage;
  campaign_alerts: CampaignAlert[];
  campaign_table: CampaignRow[];
  forecast: ForecastMetrics | null;
  marketing_score: number | null;
  marketing_score_detail: MarketingScoreDetail;
  canonical_ad_row_count: number;
  revenue_by_acquisition_source: RevenueByAcquisitionRow[];
  source_options: DashboardSourceOption[];
  channel_summary: MarketingReportChannelRow[];
}> {
  const { project_id, start, end, target_cac = null, target_roas = null } = options;
  const sources =
    options.sources?.length && options.sources.some((s) => String(s).trim() !== "")
      ? options.sources.map((s) => String(s).trim()).filter(Boolean)
      : undefined;
  const accountIds =
    options.account_ids?.length && options.account_ids.some((s) => String(s).trim() !== "")
      ? options.account_ids.map((s) => String(s).trim()).filter(Boolean)
      : undefined;

  const { year: planYear, month: planMonth } = planMonthYearFromEnd(end);
  const monthStartStr = `${planYear}-${String(planMonth).padStart(2, "0")}-01`;
  const monthEndStr = lastDayOfMonthYmd(planYear, planMonth);

  const plan: PlanMetrics = {
    plan_month: planMonth,
    plan_year: planYear,
    monthly_budget: null,
    target_registrations: null,
    target_sales: null,
    target_roas: target_roas ?? null,
    target_cac: target_cac ?? null,
    fact_budget: 0,
    fact_registrations: 0,
    fact_unique_registrants: 0,
    fact_sales: 0,
    fact_revenue: 0,
    fact_roas: null,
    fact_spend_acquisition_usd: 0,
    fact_spend_retention_usd: 0,
    fact_cpr: null,
    fact_cac: null,
  };

  const { data: planRow } = await admin
    .from("project_monthly_plans")
    .select(
      "sales_plan_budget, sales_plan_count, planned_revenue, repeat_sales_budget, repeat_sales_count"
    )
    .eq("project_id", project_id)
    .eq("month", planMonth)
    .eq("year", planYear)
    .maybeSingle();

  if (planRow) {
    const row = planRow as {
      sales_plan_budget?: number | null;
      sales_plan_count?: number | null;
      repeat_sales_budget?: number | null;
      repeat_sales_count?: number | null;
    };
    // Как в SalesPlanModal «Итоги месяца»: Общий бюджет = первичный + повторный; Всего продаж = sc + rc.
    const primaryBudget = Number(row.sales_plan_budget ?? 0);
    const repeatBudget = Number(row.repeat_sales_budget ?? 0);
    const budgetSum = primaryBudget + repeatBudget;
    plan.monthly_budget = Number.isFinite(budgetSum) && budgetSum > 0 ? budgetSum : null;

    const primarySales = Number(row.sales_plan_count ?? 0);
    const repeatSales = Number(row.repeat_sales_count ?? 0);
    const salesSum = primarySales + repeatSales;
    plan.target_sales = Number.isFinite(salesSum) && salesSum > 0 ? Math.round(salesSum) : null;
  }
  if (target_roas != null) plan.target_roas = target_roas;
  if (target_cac != null) plan.target_cac = target_cac;

  const startDate = start + "T00:00:00.000Z";
  const endDate = end + "T23:59:59.999Z";

  const convSelect =
    "id, event_name, value, currency, source, traffic_source, traffic_platform, visitor_id, user_external_id, created_at, event_time";

  const [{ rows: enriched, pagesFetched: convPages }, source_options] = await Promise.all([
    fetchAndEnrichKpiConversionRows(admin, project_id, start, end, convSelect),
    getDashboardSourceOptions(admin, project_id, start, end),
  ]);

  if (convPages > 1) {
    console.log("[MARKETING_REPORT_CONVERSION_ROWCAP]", {
      project_id,
      start,
      end,
      convPages,
      rowCount: enriched.length,
    });
  }

  const filtered = filterEnrichedRowsByDashboardSources(enriched, sources);
  const registrations = filtered.filter((c) => c.event_name === "registration");
  const purchasesForKpi = filtered.filter((c) => c.event_name === "purchase");

  const { revenue } = await sumPurchaseRevenueProjectCurrency(admin, project_id, purchasesForKpi);

  const revenueBySourceAgg = await aggregatePurchaseRevenueByReportChannel(admin, project_id, purchasesForKpi);
  const revenue_by_acquisition_source: RevenueByAcquisitionRow[] = Object.entries(revenueBySourceAgg)
    .filter(([, rev]) => rev > 0)
    .map(([source, rev]) => ({ source, revenue: rev }))
    .sort((a, b) => b.revenue - a.revenue);

  const registrantIds = new Set(registrations.map((c) => simpleConversionUserKey(c)));

  const purchaseByUser = new Map<string, number>();
  for (const p of purchasesForKpi) {
    const uid = simpleConversionUserKey(p);
    purchaseByUser.set(uid, (purchaseByUser.get(uid) ?? 0) + 1);
  }
  let new_buyers = 0;
  let returning_buyers = 0;
  purchaseByUser.forEach((count) => {
    if (count === 1) new_buyers += 1;
    else returning_buyers += 1;
  });

  const canonicalOpts = buildMarketingCanonicalOpts(sources, accountIds);

  const canonicalRowsFiltered =
    sources?.length && isNonPlatformSourcesOnly(sources)
      ? []
      : await fetchCanonicalMetricRowsForProject(admin, project_id, start, end, canonicalOpts);

  const canonical_ad_row_count = canonicalRowsFiltered.length;

  let totalSpend = 0;
  let totalRevenue = 0;
  const spendByPlatform: Record<string, number> = {};
  const impressionsByPlatform: Record<string, number> = {};
  const clicksByPlatform: Record<string, number> = {};
  for (const r of canonicalRowsFiltered) {
    totalSpend += r.spend;
    totalRevenue += r.revenue;
    const plat = r.platform || "unknown";
    spendByPlatform[plat] = (spendByPlatform[plat] ?? 0) + r.spend;
    impressionsByPlatform[plat] = (impressionsByPlatform[plat] ?? 0) + r.impressions;
    clicksByPlatform[plat] = (clicksByPlatform[plat] ?? 0) + r.clicks;
  }

  /* Same source/account filters as plan/KPI/campaigns — not full-project canonical rows or all purchases. */
  const revenueByChannelForSummary = await aggregatePurchaseRevenueByReportChannel(
    admin,
    project_id,
    purchasesForKpi
  );

  const rowIdSet = new Set<string>();
  for (const o of source_options) rowIdSet.add(o.id);
  for (const k of Object.keys(spendByPlatform)) {
    if ((spendByPlatform[k] ?? 0) > 0 && PLATFORM_LABEL[k]) rowIdSet.add(k);
  }
  for (const k of Object.keys(revenueByChannelForSummary)) {
    if ((revenueByChannelForSummary[k] ?? 0) > 0) rowIdSet.add(k);
  }

  const channel_summary: MarketingReportChannelRow[] = sortMarketingChannelIds([...rowIdSet]).map((id) => {
    const isPlatform = PLATFORM_ORDER.includes(id as (typeof PLATFORM_ORDER)[number]);
    const spendNum = isPlatform ? spendByPlatform[id] ?? 0 : 0;
    const impNum = isPlatform ? impressionsByPlatform[id] ?? 0 : 0;
    const clkNum = isPlatform ? clicksByPlatform[id] ?? 0 : 0;
    const rev = revenueByChannelForSummary[id];
    const revenueCell = rev != null ? rev : null;
    const share_spend_pct =
      isPlatform && totalSpend > 0 && spendNum > 0 ? (spendNum / totalSpend) * 100 : null;
    const roas = isPlatform && spendNum > 0 && revenueCell != null ? revenueCell / spendNum : null;
    return {
      id,
      type: isPlatform ? "platform" : "class",
      label_ru: CHANNEL_LABEL_RU[id] ?? id,
      spend: isPlatform ? spendNum : null,
      impressions: isPlatform ? impNum : null,
      clicks: isPlatform ? clkNum : null,
      revenue: revenueCell,
      share_spend_pct,
      roas,
    };
  });

  plan.fact_budget = totalSpend;
  plan.fact_registrations = registrations.length;
  plan.fact_unique_registrants = registrantIds.size;
  plan.fact_sales = purchasesForKpi.length;
  plan.fact_revenue = revenue;
  plan.fact_roas = totalSpend > 0 ? revenue / totalSpend : null;
  const { cpr_actual } = await computeLtvStyleRetentionCprActual(admin, project_id, start, end, totalSpend);
  plan.fact_cpr = cpr_actual;
  plan.fact_cac = new_buyers > 0 ? totalSpend / new_buyers : null;
  const uniquePurchasers = purchaseByUser.size;
  const cac_blended = uniquePurchasers > 0 ? totalSpend / uniquePurchasers : null;

  const by_platform = Object.entries(spendByPlatform).map(([platform, spend]) => ({
    platform: PLATFORM_LABEL[platform] ?? platform,
    spend,
    impressions: impressionsByPlatform[platform] ?? 0,
    clicks: clicksByPlatform[platform] ?? 0,
  }));

  const budget: BudgetCoverage = {
    monthly_budget: plan.monthly_budget,
    active_campaign_budget: totalSpend,
    uncovered_budget: plan.monthly_budget != null ? Math.max(0, plan.monthly_budget - totalSpend) : null,
    by_platform,
  };

  let average_touches: number | null = null;
  if (purchasesForKpi.length > 0) {
    const visitorIds = [...new Set(purchasesForKpi.map((p) => p.visitor_id?.trim()).filter(Boolean))] as string[];
    if (visitorIds.length > 0) {
      const { data: visitRows } = await admin
        .from("visit_source_events")
        .select("visitor_id, created_at")
        .eq("site_id", String(project_id))
        .in("visitor_id", visitorIds)
        .lte("created_at", endDate);
      const visits = (visitRows ?? []) as { visitor_id: string; created_at: string }[];
      let totalTouches = 0;
      let counted = 0;
      for (const p of purchasesForKpi) {
        const vid = p.visitor_id?.trim();
        if (!vid) continue;
        const purchaseTime = new Date(p.created_at).getTime();
        const n = visits.filter((v) => v.visitor_id === vid && new Date(v.created_at).getTime() < purchaseTime).length;
        totalTouches += n;
        counted += 1;
      }
      average_touches = counted > 0 ? totalTouches / counted : null;
    }
  }

  const kpi: KpiMetrics = {
    cac: plan.fact_cac,
    cac_blended: cac_blended,
    cpr: plan.fact_cpr,
    cpo: purchasesForKpi.length > 0 ? totalSpend / purchasesForKpi.length : null,
    roas: plan.fact_roas,
    conversion_rate:
      registrations.length > 0
        ? Math.min(100, (purchasesForKpi.length / registrations.length) * 100)
        : null,
    new_buyers,
    returning_buyers,
    average_touches_before_purchase: average_touches,
  };

  const campLevelRows = await fetchCampaignLevelMetricRowsForProject(
    admin,
    project_id,
    start,
    end,
    canonicalOpts
  );
  const campaignAgg: Record<
    string,
    { platform: string; spend: number; impressions: number; clicks: number; conversions: number; revenue: number }
  > = {};

  for (const r of campLevelRows) {
    const cid = r.campaign_id;
    if (!cid) continue;
    if (!campaignAgg[cid]) {
      campaignAgg[cid] = { platform: r.platform, spend: 0, impressions: 0, clicks: 0, conversions: 0, revenue: 0 };
    }
    const agg = campaignAgg[cid];
    agg.spend += r.spend;
    agg.impressions += r.impressions;
    agg.clicks += r.clicks;
    agg.conversions += r.purchases;
    agg.revenue += r.revenue;
  }

  const enabledForCampaignTable = await resolveEnabledAdAccountIdsForProject(
    admin,
    project_id,
    canonicalOpts?.sources ?? null,
    canonicalOpts?.accountIds ?? null
  );
  if (enabledForCampaignTable.length > 0) {
    const { data: tiktokCampaignOnlyRows } = await admin
      .from("campaigns")
      .select("id")
      .eq("project_id", project_id)
      .eq("platform", "tiktok")
      .in("ad_accounts_id", enabledForCampaignTable);
    for (const row of (tiktokCampaignOnlyRows ?? []) as { id: string }[]) {
      if (!campaignAgg[row.id]) {
        campaignAgg[row.id] = {
          platform: "tiktok",
          spend: 0,
          impressions: 0,
          clicks: 0,
          conversions: 0,
          revenue: 0,
        };
      }
    }
  }

  const campaignIds = new Set(Object.keys(campaignAgg));

  type CampMeta = {
    id: string;
    name: string | null;
    status: string | null;
    marketing_intent: string | null;
    budget_type: string | null;
    daily_budget: number | null;
    lifetime_budget: number | null;
    campaign_start_time: string | null;
    campaign_stop_time: string | null;
  };

  const campaignMeta = new Map<string, CampMeta>();
  if (campaignIds.size > 0) {
    const { data: cRows } = await admin
      .from("campaigns")
      .select(
        "id, name, status, marketing_intent, budget_type, daily_budget, lifetime_budget, campaign_start_time, campaign_stop_time"
      )
      .in("id", Array.from(campaignIds));
    for (const c of (cRows ?? []) as CampMeta[]) {
      campaignMeta.set(c.id, c);
    }
  }

  let factSpendRetentionUsd = 0;
  for (const [cid, agg] of Object.entries(campaignAgg)) {
    const meta = campaignMeta.get(cid);
    if (String(meta?.marketing_intent ?? "").toLowerCase() === "retention") {
      factSpendRetentionUsd += agg.spend;
    }
  }
  plan.fact_spend_retention_usd = factSpendRetentionUsd;
  plan.fact_spend_acquisition_usd = Math.max(0, totalSpend - factSpendRetentionUsd);

  const { count: projectCampaignCount } = await admin
    .from("campaigns")
    .select("id", { count: "exact", head: true })
    .eq("project_id", project_id);

  const { data: budgetCampaignRows } = await admin
    .from("campaigns")
    .select("budget_type, daily_budget, lifetime_budget, campaign_start_time, campaign_stop_time")
    .eq("project_id", project_id);

  const budgetInputs: CampaignBudgetInput[] = ((budgetCampaignRows ?? []) as CampMeta[]).map((c) => ({
    budget_type: c.budget_type === "daily" || c.budget_type === "lifetime" ? c.budget_type : null,
    daily_budget: c.daily_budget != null ? Number(c.daily_budget) : null,
    lifetime_budget: c.lifetime_budget != null ? Number(c.lifetime_budget) : null,
    campaign_start_time: c.campaign_start_time,
    campaign_stop_time: c.campaign_stop_time,
  }));

  const campaignsWithBudget = budgetInputs.filter(
    (b) =>
      (b.budget_type === "daily" && (b.daily_budget ?? 0) > 0) ||
      (b.budget_type === "lifetime" && (b.lifetime_budget ?? 0) > 0)
  ).length;

  const allocatedMonth = sumPlannedBudgetForMonth(budgetInputs, planYear, planMonth);
  const planMonthlyBudget = plan.monthly_budget;

  const covStart = maxYmd(start, monthStartStr);
  const covEnd = minYmd(end, monthEndStr);
  const todayStr = new Date().toISOString().slice(0, 10);
  const covEndCapped = minYmd(covEnd, todayStr);

  const coverageRows =
    sources?.length && isNonPlatformSourcesOnly(sources)
      ? []
      : await fetchCanonicalMetricRowsForProject(admin, project_id, covStart, covEndCapped, canonicalOpts);
  const factSliceUsd = coverageRows.reduce((s, r) => s + r.spend, 0);

  const monthCoverageEnd = minYmd(monthEndStr, todayStr);
  const monthCoverageRows =
    sources?.length && isNonPlatformSourcesOnly(sources)
      ? []
      : await fetchCanonicalMetricRowsForProject(
          admin,
          project_id,
          monthStartStr,
          monthCoverageEnd,
          canonicalOpts
        );
  const factMonthUsd = monthCoverageRows.reduce((s, r) => s + r.spend, 0);

  const budgetPlanCoveragePct =
    planMonthlyBudget != null && planMonthlyBudget > 0
      ? Math.min(999, (allocatedMonth / planMonthlyBudget) * 100)
      : null;
  const spendVsAllocatedSlicePct =
    allocatedMonth > 0 ? Math.min(999, (factSliceUsd / allocatedMonth) * 100) : null;
  const spendVsAllocatedMonthPct =
    allocatedMonth > 0 ? Math.min(999, (factMonthUsd / allocatedMonth) * 100) : null;

  const platform_budget: PlatformBudgetCoverage = {
    allocated_campaign_budget_month: allocatedMonth,
    plan_monthly_budget: planMonthlyBudget,
    budget_plan_coverage_pct: budgetPlanCoveragePct,
    fact_slice_usd: factSliceUsd,
    fact_month_usd: factMonthUsd,
    spend_vs_allocated_slice_pct: spendVsAllocatedSlicePct,
    spend_vs_allocated_month_pct: spendVsAllocatedMonthPct,
    campaigns_with_budget: campaignsWithBudget,
    campaigns_total_in_project: typeof projectCampaignCount === "number" ? projectCampaignCount : 0,
    coverage_period_start: covStart,
    coverage_period_end: covEndCapped,
    month_coverage_start: monthStartStr,
    month_coverage_end: monthCoverageEnd,
  };

  const targetCacEff = plan.target_cac ?? 0;
  const targetRoasEff = plan.target_roas ?? 0;

  const campaign_table: CampaignRow[] = [];
  const campaign_alerts: CampaignAlert[] = [];

  for (const [cid, agg] of Object.entries(campaignAgg)) {
    const meta = campaignMeta.get(cid);
    const name = meta?.name ?? "—";
    const rawStatus = normalizeCampaignStatus(meta?.status);
    const inactive = campaignIsInactive(rawStatus);
    const platformKey = String(agg.platform || "unknown").toLowerCase();
    const platformLabel = PLATFORM_LABEL[platformKey] ?? agg.platform;
    const intentRaw = meta?.marketing_intent;
    const marketing_intent: "acquisition" | "retention" | null =
      intentRaw === "retention" ? "retention" : intentRaw === "acquisition" ? "acquisition" : null;

    const cac = agg.conversions > 0 ? agg.spend / agg.conversions : null;
    const roas = agg.spend > 0 ? agg.revenue / agg.spend : null;

    let status: "green" | "yellow" | "red" = "green";
    if (targetCacEff > 0 && cac != null) {
      const pct = Math.abs(cac - targetCacEff) / targetCacEff;
      if (pct > 0.2) status = "red";
      else if (pct > 0) status = "yellow";
    }
    if (targetRoasEff > 0 && roas != null) {
      const pct = Math.abs(roas - targetRoasEff) / targetRoasEff;
      if (pct > 0.2) status = "red";
      else if (pct > 0 && status === "green") status = "yellow";
    }

    campaign_table.push({
      platform: platformLabel,
      platform_key: platformKey,
      campaign_id: cid,
      campaign_name: name,
      spend: agg.spend,
      impressions: agg.impressions,
      clicks: agg.clicks,
      conversions: agg.conversions,
      cac,
      roas,
      status,
      marketing_intent,
      campaign_status: rawStatus,
      is_inactive: inactive,
      status_label_ru: statusLabelRu(rawStatus, inactive),
    });

    if (agg.spend > 0 && agg.conversions === 0) {
      campaign_alerts.push({
        platform: platformLabel,
        campaign_name: name,
        campaign_id: cid,
        problem_type: "spend_no_conversions",
        recommendation: "Проверить креативы и таргетинг или отключить кампанию.",
      });
    }
    if (targetCacEff > 0 && cac != null && cac > targetCacEff) {
      campaign_alerts.push({
        platform: platformLabel,
        campaign_name: name,
        campaign_id: cid,
        problem_type: "cac_above_target",
        recommendation: `CAC ${cac.toFixed(0)} выше цели ${targetCacEff}. Оптимизировать воронку или креативы.`,
      });
    }
    if (targetRoasEff > 0 && roas != null && roas < targetRoasEff) {
      campaign_alerts.push({
        platform: platformLabel,
        campaign_name: name,
        campaign_id: cid,
        problem_type: "roas_below_target",
        recommendation: `ROAS ${(roas ?? 0).toFixed(2)} ниже цели ${targetRoasEff}. Пересмотреть ставки или креативы.`,
      });
    }
    if (agg.impressions === 0) {
      campaign_alerts.push({
        platform: platformLabel,
        campaign_name: name,
        campaign_id: cid,
        problem_type: "no_impressions",
        recommendation: "Нет показов. Проверить бюджет и таргетинг.",
      });
    }
    if (agg.spend === 0 && agg.impressions === 0) {
      campaign_alerts.push({
        platform: platformLabel,
        campaign_name: name,
        campaign_id: cid,
        problem_type: "no_activity",
        recommendation: "Нет активности. Запустить кампанию или проверить синхронизацию.",
      });
    }
  }

  campaign_table.sort((a, b) => b.spend - a.spend);

  const todayStrForecast = new Date().toISOString().slice(0, 10);
  const elapsedEndForecast = minYmd(minYmd(end, todayStrForecast), monthEndStr);
  const days_total = parseInt(monthEndStr.slice(8, 10), 10);
  const t0 = Date.parse(`${monthStartStr}T00:00:00.000Z`);
  const t1 = Date.parse(`${elapsedEndForecast}T00:00:00.000Z`);
  let days_passed = Math.floor((t1 - t0) / 86400000) + 1;
  if (days_passed < 1) days_passed = 1;

  let forecast: ForecastMetrics | null = null;
  if (days_passed > 0) {
    const monthStartDate = monthStartStr + "T00:00:00.000Z";
    const elapsedEndDate = elapsedEndForecast + "T23:59:59.999Z";

    const forecastCanonical =
      sources?.length && isNonPlatformSourcesOnly(sources)
        ? []
        : await fetchCanonicalMetricRowsForProject(
            admin,
            project_id,
            monthStartStr,
            elapsedEndForecast,
            canonicalOpts
          );
    const currentSpend = forecastCanonical.reduce((s, r) => s + r.spend, 0);

    const { data: monthConvs } = await admin
      .from("conversion_events")
      .select("event_name")
      .eq("project_id", project_id)
      .gte("created_at", monthStartDate)
      .lte("created_at", elapsedEndDate)
      .in("event_name", ["registration", "purchase"]);
    const monthConvList = (monthConvs ?? []) as { event_name: string }[];
    const currentReg = monthConvList.filter((c) => c.event_name === "registration").length;
    const currentSales = monthConvList.filter((c) => c.event_name === "purchase").length;

    const dailySpend = currentSpend / days_passed;
    const dailyReg = currentReg / days_passed;
    const dailySales = currentSales / days_passed;

    forecast = {
      days_passed,
      days_total,
      current_spend: currentSpend,
      current_sales: currentSales,
      current_registrations: currentReg,
      plan_budget: plan.monthly_budget,
      plan_registrations: plan.target_registrations,
      plan_sales: plan.target_sales,
      forecast_spend: dailySpend * days_total,
      forecast_registrations: Math.round(dailyReg * days_total),
      forecast_sales: Math.round(dailySales * days_total),
      forecast_month: planMonth,
      forecast_year: planYear,
    };
  }

  const marketing_score_detail = computeMarketingScoreDetail({
    roas: kpi.roas,
    target_roas: plan.target_roas,
    cac: kpi.cac,
    target_cac: plan.target_cac,
    unique_registrants: registrantIds.size,
    conversion_rate: kpi.conversion_rate,
    monthly_budget: plan.monthly_budget,
    spend: totalSpend,
    avg_touches: average_touches,
  });

  return {
    plan,
    kpi,
    budget,
    platform_budget,
    campaign_alerts,
    campaign_table,
    forecast,
    marketing_score: marketing_score_detail.score,
    marketing_score_detail,
    canonical_ad_row_count,
    revenue_by_acquisition_source,
    source_options,
    channel_summary,
  };
}
