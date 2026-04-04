import { NextResponse } from "next/server";
import type { SupabaseClient } from "@supabase/supabase-js";

import { requireProjectAccessOrInternal } from "@/app/lib/auth/requireProjectAccessOrInternal";
import { billingAnalyticsReadGateFromAccess } from "@/app/lib/auth/requireBillingAccess";
import { getCanonicalSummary } from "@/app/lib/dashboardCanonical";
import { pickInsightTexts } from "@/app/lib/weeklyReportInsightTexts";
import { supabaseAdmin } from "@/app/lib/supabaseAdmin";

type ExecutiveKpi = {
  label: string;
  group: "finance" | "product" | "marketing";
  value: number | null;
  format: "money" | "number" | "percent" | "ratio";
  note?: string;
  delta_percent?: number;
  plan_value?: number | null;
  fact_value?: number | null;
  plan_progress?: number | null;
};

type RangeStats = {
  spend: number;
  impressions: number;
  clicks: number;
  registrations: number;
  purchases: number;
  revenue: number;
  uniquePurchasers: number;
  newUsersRevenue: number;
  repeatUsersRevenue: number;
};

type BuildPayloadParams = {
  start: string;
  end: string;
  sources: string[];
  accountIds: string[];
};

type MonthlyPlanRow = {
  year: number;
  month: number;
  sales_plan_count: number | null;
  sales_plan_budget: number | null;
  repeat_sales_count: number | null;
  repeat_sales_budget: number | null;
  planned_revenue: number | null;
};

const DAY_MS = 24 * 60 * 60 * 1000;
const ATTRIBUTION_SOURCE_WHITELIST = ["meta", "google", "tiktok", "yandex", "direct", "organic", "referral"];

function toYmd(date: Date): string {
  return date.toISOString().slice(0, 10);
}

function parseYmd(raw: string | null | undefined): string | null {
  const v = String(raw ?? "").trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(v)) return null;
  return v;
}

function parseCsv(raw: string | null | undefined): string[] {
  if (!raw) return [];
  return raw
    .split(",")
    .map((v) => v.trim())
    .filter(Boolean);
}

function round2(v: number | null): number | null {
  if (v == null || !Number.isFinite(v)) return null;
  return Math.round(v * 100) / 100;
}

function formatNum(v: number): string {
  return Math.round(v).toLocaleString();
}

function moneyText(v: number, currency: string): string {
  const n = formatNum(v);
  return currency === "KZT" ? `${n} ₸` : `$${n}`;
}

function formatDateRu(ymd: string): string {
  const d = parseUtcDay(ymd);
  return new Intl.DateTimeFormat("ru-RU", {
    day: "numeric",
    month: "long",
    year: "numeric",
    timeZone: "UTC",
  }).format(d);
}

function deltaPercent(current: number, prev: number): number | undefined {
  if (!Number.isFinite(current) || !Number.isFinite(prev)) return undefined;
  if (prev === 0) return current > 0 ? 100 : undefined;
  return Math.round((((current - prev) / prev) * 100) * 10) / 10;
}

function parseUtcDay(ymd: string): Date {
  return new Date(`${ymd}T00:00:00.000Z`);
}

function daysInclusive(start: string, end: string): number {
  const diff = parseUtcDay(end).getTime() - parseUtcDay(start).getTime();
  if (diff < 0) return 0;
  return Math.floor(diff / DAY_MS) + 1;
}

function addDays(ymd: string, offsetDays: number): string {
  const d = parseUtcDay(ymd);
  return toYmd(new Date(d.getTime() + offsetDays * DAY_MS));
}

function monthStartYmd(year: number, month: number): string {
  return `${year}-${String(month).padStart(2, "0")}-01`;
}

function monthEndYmd(year: number, month: number): string {
  return toYmd(new Date(Date.UTC(year, month, 0)));
}

function monthDays(year: number, month: number): number {
  return daysInclusive(monthStartYmd(year, month), monthEndYmd(year, month));
}

function overlapDays(aStart: string, aEnd: string, bStart: string, bEnd: string): number {
  const start = aStart > bStart ? aStart : bStart;
  const end = aEnd < bEnd ? aEnd : bEnd;
  return daysInclusive(start, end);
}

function monthsInRange(start: string, end: string): Array<{ year: number; month: number }> {
  const out: Array<{ year: number; month: number }> = [];
  let cur = parseUtcDay(start);
  const limit = parseUtcDay(end);
  while (cur <= limit) {
    out.push({ year: cur.getUTCFullYear(), month: cur.getUTCMonth() + 1 });
    cur = new Date(Date.UTC(cur.getUTCFullYear(), cur.getUTCMonth() + 1, 1));
  }
  return out;
}

function isFullCalendarMonthRange(start: string, end: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(start) || !/^\d{4}-\d{2}-\d{2}$/.test(end)) return false;
  const [y, m] = start.split("-").map(Number);
  if (!Number.isFinite(y) || !Number.isFinite(m)) return false;
  if (!start.endsWith("-01")) return false;
  return end === monthEndYmd(y, m);
}

async function loadPlansForRange(
  admin: SupabaseClient,
  projectId: string,
  start: string,
  end: string
): Promise<MonthlyPlanRow[]> {
  const months = monthsInRange(start, end);
  if (months.length === 0) return [];
  const years = [...new Set(months.map((m) => m.year))];
  const monthNums = [...new Set(months.map((m) => m.month))];
  const { data } = await admin
    .from("project_monthly_plans")
    .select("year, month, sales_plan_count, sales_plan_budget, repeat_sales_count, repeat_sales_budget, planned_revenue")
    .eq("project_id", projectId)
    .in("year", years)
    .in("month", monthNums);
  return (data ?? []) as MonthlyPlanRow[];
}

function computeProratedPlan(plans: MonthlyPlanRow[], start: string, end: string) {
  let revenuePlan = 0;
  let spendPlan = 0;
  let purchasesPlan = 0;
  for (const row of plans) {
    const ms = monthStartYmd(row.year, row.month);
    const me = monthEndYmd(row.year, row.month);
    const overlap = overlapDays(start, end, ms, me);
    if (overlap <= 0) continue;
    const ratio = overlap / monthDays(row.year, row.month);
    revenuePlan += Math.max(0, Number(row.planned_revenue ?? 0)) * ratio;
    spendPlan +=
      (Math.max(0, Number(row.sales_plan_budget ?? 0)) + Math.max(0, Number(row.repeat_sales_budget ?? 0))) * ratio;
    purchasesPlan +=
      (Math.max(0, Number(row.sales_plan_count ?? 0)) + Math.max(0, Number(row.repeat_sales_count ?? 0))) * ratio;
  }
  return {
    revenuePlan: round2(revenuePlan) ?? 0,
    spendPlan: round2(spendPlan) ?? 0,
    purchasesPlan: round2(purchasesPlan) ?? 0,
  };
}

async function loadRangeStats(
  admin: SupabaseClient,
  projectId: string,
  start: string,
  end: string,
  sources: string[],
  accountIds: string[]
): Promise<RangeStats> {
  const canonical = await getCanonicalSummary(admin, projectId, start, end, { sources, accountIds });
  const spend = Number(canonical?.data.spend ?? 0);
  const impressions = Number(canonical?.data.impressions ?? 0);
  const clicks = Number(canonical?.data.clicks ?? 0);

  let q = admin
    .from("conversion_events")
    .select("event_name, value, user_external_id, visitor_id, traffic_source, created_at")
    .eq("project_id", projectId)
    .in("event_name", ["registration", "purchase"])
    .gte("created_at", `${start}T00:00:00.000Z`)
    .lte("created_at", `${end}T23:59:59.999Z`);
  if (sources.length > 0) {
    q = q.in("traffic_source", sources);
  }
  const { data: convRows } = await q;

  let registrations = 0;
  let purchases = 0;
  let revenue = 0;
  const purchasers = new Set<string>();
  const purchaseRows: Array<{ value: number; user_external_id: string | null; visitor_id: string | null }> = [];

  for (const row of (convRows ?? []) as {
    event_name?: string | null;
    value?: number | null;
    user_external_id?: string | null;
    visitor_id?: string | null;
  }[]) {
    const eventName = String(row.event_name ?? "");
    if (eventName === "registration") {
      registrations += 1;
      continue;
    }
    if (eventName !== "purchase") continue;
    purchases += 1;
    revenue += Math.max(0, Number(row.value ?? 0));
    purchaseRows.push({
      value: Math.max(0, Number(row.value ?? 0)),
      user_external_id: row.user_external_id ?? null,
      visitor_id: row.visitor_id ?? null,
    });
    const key = String(row.user_external_id ?? row.visitor_id ?? "").trim();
    if (key) purchasers.add(key);
  }

  const userExternalIds = [...new Set(purchaseRows.map((r) => String(r.user_external_id ?? "").trim()).filter(Boolean))];
  const visitorIds = [...new Set(purchaseRows.map((r) => String(r.visitor_id ?? "").trim()).filter(Boolean))];
  const priorUserExternal = new Set<string>();
  const priorVisitor = new Set<string>();
  const rangeStartIso = `${start}T00:00:00.000Z`;

  if (userExternalIds.length > 0) {
    const { data: priorRows } = await admin
      .from("conversion_events")
      .select("user_external_id")
      .eq("project_id", projectId)
      .eq("event_name", "purchase")
      .lt("created_at", rangeStartIso)
      .in("user_external_id", userExternalIds);
    for (const row of (priorRows ?? []) as { user_external_id?: string | null }[]) {
      const key = String(row.user_external_id ?? "").trim();
      if (key) priorUserExternal.add(key);
    }
  }

  if (visitorIds.length > 0) {
    const { data: priorRows } = await admin
      .from("conversion_events")
      .select("visitor_id")
      .eq("project_id", projectId)
      .eq("event_name", "purchase")
      .lt("created_at", rangeStartIso)
      .in("visitor_id", visitorIds);
    for (const row of (priorRows ?? []) as { visitor_id?: string | null }[]) {
      const key = String(row.visitor_id ?? "").trim();
      if (key) priorVisitor.add(key);
    }
  }

  let newUsersRevenue = 0;
  let repeatUsersRevenue = 0;
  for (const row of purchaseRows) {
    const u = String(row.user_external_id ?? "").trim();
    const v = String(row.visitor_id ?? "").trim();
    const isRepeat = (u && priorUserExternal.has(u)) || (!u && v && priorVisitor.has(v));
    if (isRepeat) repeatUsersRevenue += row.value;
    else newUsersRevenue += row.value;
  }

  return {
    spend: round2(spend) ?? 0,
    impressions: Math.max(0, Math.round(impressions)),
    clicks: Math.max(0, Math.round(clicks)),
    registrations,
    purchases,
    revenue: round2(revenue) ?? 0,
    uniquePurchasers: purchasers.size,
    newUsersRevenue: round2(newUsersRevenue) ?? 0,
    repeatUsersRevenue: round2(repeatUsersRevenue) ?? 0,
  };
}

function makeKpis(
  current: RangeStats,
  previous: RangeStats,
  plan: ReturnType<typeof computeProratedPlan>,
  currency: string
) {
  const roas = current.spend > 0 ? current.revenue / current.spend : 0;
  const prevRoas = previous.spend > 0 ? previous.revenue / previous.spend : 0;
  const romi = current.spend > 0 ? (current.revenue - current.spend) / current.spend : 0;
  const prevRomi = previous.spend > 0 ? (previous.revenue - previous.spend) / previous.spend : 0;
  const conversion = current.registrations > 0 ? current.purchases / current.registrations : 0;
  const prevConversion = previous.registrations > 0 ? previous.purchases / previous.registrations : 0;
  const cac = current.registrations > 0 ? current.spend / current.registrations : 0;
  const prevCac = previous.registrations > 0 ? previous.spend / previous.registrations : 0;
  const cpo = current.purchases > 0 ? current.spend / current.purchases : 0;
  const prevCpo = previous.purchases > 0 ? previous.spend / previous.purchases : 0;
  const avgCheck = current.purchases > 0 ? current.revenue / current.purchases : 0;
  const prevAvgCheck = previous.purchases > 0 ? previous.revenue / previous.purchases : 0;
  const ltv = current.uniquePurchasers > 0 ? current.revenue / current.uniquePurchasers : 0;
  const prevLtv = previous.uniquePurchasers > 0 ? previous.revenue / previous.uniquePurchasers : 0;
  const newPercent = current.revenue > 0 ? current.newUsersRevenue / current.revenue : 0;
  const prevNewPercent = previous.revenue > 0 ? previous.newUsersRevenue / previous.revenue : 0;
  const ctr = current.impressions > 0 ? current.clicks / current.impressions : 0;
  const prevCtr = previous.impressions > 0 ? previous.clicks / previous.impressions : 0;

  const kpis: Record<string, ExecutiveKpi> = {
    revenue: {
      label: "Доход",
      group: "finance",
      value: round2(current.revenue),
      format: "money",
      delta_percent: deltaPercent(current.revenue, previous.revenue),
      plan_value: round2(plan.revenuePlan),
      fact_value: round2(current.revenue),
      plan_progress: plan.revenuePlan > 0 ? round2(current.revenue / plan.revenuePlan) : null,
    },
    spend: {
      label: "Расход",
      group: "finance",
      value: round2(current.spend),
      format: "money",
      delta_percent: deltaPercent(current.spend, previous.spend),
      plan_value: round2(plan.spendPlan),
      fact_value: round2(current.spend),
      plan_progress: plan.spendPlan > 0 ? round2(current.spend / plan.spendPlan) : null,
    },
    new_percent: {
      label: "Процент новых",
      group: "finance",
      value: round2(newPercent),
      format: "percent",
      delta_percent: deltaPercent(newPercent, prevNewPercent),
      note: `Новые пользователи: ${moneyText(current.newUsersRevenue, currency)}  Повторные: ${moneyText(current.repeatUsersRevenue, currency)}`,
    },
    roas: {
      label: "ROAS",
      group: "finance",
      value: round2(roas),
      format: "ratio",
      delta_percent: deltaPercent(roas, prevRoas),
      note: "Отношение дохода к расходу (Revenue / Spend).",
    },
    romi: {
      label: "ROMI",
      group: "finance",
      value: round2(romi),
      format: "percent",
      delta_percent: deltaPercent(romi, prevRomi),
      note: "Маркетинговая окупаемость: (Доход - Расход) / Расход.",
    },
    registrations: {
      label: "Регистрации",
      group: "product",
      value: current.registrations,
      format: "number",
      delta_percent: deltaPercent(current.registrations, previous.registrations),
      note: "Количество регистраций за диапазон.",
    },
    purchases: {
      label: "Покупки",
      group: "product",
      value: current.purchases,
      format: "number",
      delta_percent: deltaPercent(current.purchases, previous.purchases),
      plan_value: round2(plan.purchasesPlan),
      fact_value: current.purchases,
      plan_progress: plan.purchasesPlan > 0 ? round2(current.purchases / plan.purchasesPlan) : null,
    },
    purchase_conversion: {
      label: "CR в покупку",
      group: "product",
      value: round2(conversion),
      format: "percent",
      delta_percent: deltaPercent(conversion, prevConversion),
      note: "Доля покупок от числа регистраций.",
    },
    cac: {
      label: "CAC",
      group: "product",
      value: round2(cac),
      format: "money",
      delta_percent: deltaPercent(cac, prevCac),
      note: "Стоимость привлечения одной регистрации.",
    },
    cpo: {
      label: "CPO",
      group: "product",
      value: round2(cpo),
      format: "money",
      delta_percent: deltaPercent(cpo, prevCpo),
      note: "Стоимость одной покупки.",
    },
    avg_check: {
      label: "Средний чек",
      group: "finance",
      value: round2(avgCheck),
      format: "money",
      delta_percent: deltaPercent(avgCheck, prevAvgCheck),
      note: "Средняя выручка на одну покупку.",
    },
    ltv: {
      label: "LTV",
      group: "product",
      value: round2(ltv),
      format: "money",
      delta_percent: deltaPercent(ltv, prevLtv),
      note: "Средняя выручка на уникального платящего пользователя.",
    },
    impressions: {
      label: "Показы",
      group: "marketing",
      value: current.impressions,
      format: "number",
      delta_percent: deltaPercent(current.impressions, previous.impressions),
      note: "Общее число показов рекламных объявлений.",
    },
    clicks: {
      label: "Клики",
      group: "marketing",
      value: current.clicks,
      format: "number",
      delta_percent: deltaPercent(current.clicks, previous.clicks),
      note: "Количество кликов по объявлениям.",
    },
    ctr: {
      label: "CTR",
      group: "marketing",
      value: round2(ctr),
      format: "percent",
      delta_percent: deltaPercent(ctr, prevCtr),
      note: "Кликабельность объявлений: Клики / Показы.",
    },
  };
  return kpis;
}

function buildSummaryRu(
  kpis: Record<string, ExecutiveKpi>,
  start: string,
  end: string,
  currency: string,
  firstMonthMode: boolean
): string {
  const revenue = Number(kpis.revenue.value ?? 0);
  const spend = Number(kpis.spend.value ?? 0);
  const roas = Number(kpis.roas.value ?? 0);
  const cr = Number(kpis.purchase_conversion.value ?? 0);
  const cpo = Number(kpis.cpo.value ?? 0);
  const avgCheck = Number(kpis.avg_check.value ?? 0);
  const newShare = Number(kpis.new_percent.value ?? 0) * 100;
  const revenueProgress = Number(kpis.revenue.plan_progress ?? 0);
  const purchasesProgress = Number(kpis.purchases.plan_progress ?? 0);
  const revenueDelta = Number(kpis.revenue.delta_percent ?? 0);

  const strengths: string[] = [];
  const weaknesses: string[] = [];

  if (revenueProgress >= 1) strengths.push("план по доходу выполнен");
  else weaknesses.push("доход пока ниже планового уровня");

  if (purchasesProgress >= 1) strengths.push("план по покупкам закрыт");
  else if (purchasesProgress > 0) weaknesses.push("покупки отстают от плана");

  if (roas >= 1.5) strengths.push(`хорошая окупаемость трафика (ROAS ${roas.toFixed(2)})`);
  else if (roas < 1) weaknesses.push(`низкая окупаемость трафика (ROAS ${roas.toFixed(2)})`);

  if (cpo > 0 && avgCheck > 0 && cpo > avgCheck) weaknesses.push("стоимость покупки выше среднего чека");
  if (cr >= 0.2) strengths.push(`сильная конверсия в покупку (${(cr * 100).toFixed(1)}%)`);
  else if (cr > 0 && cr < 0.1) weaknesses.push(`конверсия в покупку низкая (${(cr * 100).toFixed(1)}%)`);

  if (newShare >= 60) strengths.push(`высокая доля новых пользователей (${newShare.toFixed(1)}%)`);
  else if (newShare <= 35) weaknesses.push(`низкая доля новых пользователей (${newShare.toFixed(1)}%)`);

  const base = `За период с ${formatDateRu(start)} по ${formatDateRu(end)}: доход ${moneyText(revenue, currency)}, расход ${moneyText(spend, currency)}.`;
  const trend = firstMonthMode
    ? "Проект находится на этапе первого месяца работы: метрики могут быть волатильными, ключевая цель — накопить стабильную базу данных для сравнения."
    : revenueDelta > 0
      ? `Динамика положительная: доход выше предыдущего периода на ${revenueDelta.toFixed(1)}%.`
      : revenueDelta < 0
        ? `Динамика отрицательная: доход ниже предыдущего периода на ${Math.abs(revenueDelta).toFixed(1)}%.`
        : "Динамика к прошлому периоду нейтральная.";

  const strengthText = strengths.length > 0 ? `Сильные стороны: ${strengths.slice(0, 2).join(", ")}.` : "";
  const weakText = weaknesses.length > 0 ? `Зоны внимания: ${weaknesses.slice(0, 2).join(", ")}.` : "";

  return [base, trend, strengthText, weakText].filter(Boolean).join("\n");
}

export async function buildWeeklyReportPayload(
  admin: ReturnType<typeof supabaseAdmin>,
  projectId: string,
  params: BuildPayloadParams
): Promise<{
  success: true;
  has_sufficient_data: boolean;
  period: { start: string; end: string; prev_start: string; prev_end: string };
  summary: string;
  summary_ru: string;
  currency: string;
  kpis: Record<string, ExecutiveKpi>;
  insights_ru: string[];
  risks_ru: string[];
  actions_ru: string[];
  attribution_highlights: string[];
  data_quality_highlights: string[];
  risks: string[];
  growth_opportunities: string[];
  priority_actions: string[];
}> {
  const { data: projectRow } = await admin
    .from("projects")
    .select("currency, created_at")
    .eq("id", projectId)
    .maybeSingle();
  const currency = String((projectRow as { currency?: string | null } | null)?.currency ?? "USD")
    .trim()
    .toUpperCase();
  const displayCurrency = currency === "KZT" ? "KZT" : "USD";
  const createdAtRaw = String((projectRow as { created_at?: string | null } | null)?.created_at ?? "").trim();
  const createdYmd = /^\d{4}-\d{2}-\d{2}/.test(createdAtRaw) ? createdAtRaw.slice(0, 10) : null;

  const rangeDays = daysInclusive(params.start, params.end);
  let prevStart = "";
  let prevEnd = "";
  if (isFullCalendarMonthRange(params.start, params.end)) {
    const [y, m] = params.start.split("-").map(Number);
    const prevMonth = m === 1 ? 12 : m - 1;
    const prevYear = m === 1 ? y - 1 : y;
    prevStart = monthStartYmd(prevYear, prevMonth);
    prevEnd = monthEndYmd(prevYear, prevMonth);
  } else {
    prevEnd = addDays(params.start, -1);
    prevStart = addDays(prevEnd, -(Math.max(1, rangeDays) - 1));
  }

  const [current, previous, planRows] = await Promise.all([
    loadRangeStats(admin, projectId, params.start, params.end, params.sources, params.accountIds),
    loadRangeStats(admin, projectId, prevStart, prevEnd, params.sources, params.accountIds),
    loadPlansForRange(admin, projectId, params.start, params.end),
  ]);
  const plan = computeProratedPlan(planRows, params.start, params.end);
  const kpis = makeKpis(current, previous, plan, displayCurrency);
  let firstMonthMode = false;
  if (createdYmd) {
    const firstMonthEnd = addDays(createdYmd, 29);
    firstMonthMode = overlapDays(params.start, params.end, createdYmd, firstMonthEnd) > 0;
  }
  const summaryRu = buildSummaryRu(kpis, params.start, params.end, displayCurrency, firstMonthMode);
  const textBlocks = pickInsightTexts(kpis, params.end);

  const hasSufficientData =
    (current.clicks > 0 || current.registrations > 0 || current.purchases > 0 || current.revenue > 0 || current.spend > 0);

  return {
    success: true,
    has_sufficient_data: hasSufficientData,
    period: { start: params.start, end: params.end, prev_start: prevStart, prev_end: prevEnd },
    summary: summaryRu,
    summary_ru: summaryRu,
    currency: displayCurrency,
    kpis,
    insights_ru: textBlocks.insights,
    risks_ru: textBlocks.risks,
    actions_ru: textBlocks.actions,
    attribution_highlights: textBlocks.insights,
    data_quality_highlights: [],
    risks: textBlocks.risks,
    growth_opportunities: textBlocks.insights,
    priority_actions: textBlocks.actions,
  };
}

export async function GET(req: Request) {
  try {
    const { searchParams } = new URL(req.url);
    const projectId = searchParams.get("project_id")?.trim() ?? null;
    if (!projectId) {
      return NextResponse.json({ success: false, error: "project_id is required" }, { status: 400 });
    }

    const access = await requireProjectAccessOrInternal(req, projectId, { allowInternalBypass: false });
    if (!access.allowed) {
      return NextResponse.json(access.body, { status: access.status });
    }

    const billing = await billingAnalyticsReadGateFromAccess(access);
    if (!billing.ok) return billing.response;

    const today = toYmd(new Date());
    const monthStart = `${today.slice(0, 8)}01`;
    const start = parseYmd(searchParams.get("start")) ?? monthStart;
    const end = parseYmd(searchParams.get("end")) ?? today;
    if (start > end) {
      return NextResponse.json({ success: false, error: "start must be <= end" }, { status: 400 });
    }

    const sources = parseCsv(searchParams.get("sources")).filter((v) => ATTRIBUTION_SOURCE_WHITELIST.includes(v));
    const accountIds = parseCsv(searchParams.get("account_ids"));

    const admin = supabaseAdmin();
    const payload = await buildWeeklyReportPayload(admin, projectId, { start, end, sources, accountIds });
    return NextResponse.json(payload);
  } catch (e) {
    console.error("[WEEKLY_BOARD_REPORT_ERROR]", e);
    return NextResponse.json(
      { success: false, error: e instanceof Error ? e.message : "Internal error" },
      { status: 500 }
    );
  }
}
