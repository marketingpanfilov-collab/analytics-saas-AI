"use client";

import { useMemo, useState, useEffect, useCallback } from "react";
import { useSearchParams } from "next/navigation";
import LtvChart, { type Point } from "../../components/LtvChart";
import CohortHeatmap, { type CohortRow } from "../../components/CohortHeatmap";
import HelpTooltip from "../../components/HelpTooltip";
import type { ProjectCurrency } from "@/app/lib/currency";
import { fmtProjectCurrency } from "@/app/lib/currency";
import { getSharedCached } from "@/app/lib/sharedDataCache";
import { LTV_HELP_CROSS_BOARD_PARITY } from "./ltvHelpCopy";

const pillStyle = (active: boolean) => ({
  padding: "6px 16px",
  borderRadius: 8,
  border: "none",
  background: active ? "rgba(255,255,255,0.10)" : "transparent",
  boxShadow: active ? "0 1px 2px rgba(0,0,0,0.2)" : "none",
  color: "white",
  fontWeight: 500 as const,
  fontSize: 12,
  opacity: active ? 1 : 0.5,
  cursor: "pointer" as const,
  transition: "opacity 0.2s ease, background 0.2s ease",
});

const filterDropdownWrapStyle = {
  height: 44,
  padding: "0 14px",
  borderRadius: 12,
  fontSize: 13,
  background: "#1c1c1c",
  border: "1px solid rgba(255,255,255,0.1)",
  color: "#fff",
  minWidth: 176,
  display: "flex" as const,
  alignItems: "center" as const,
  justifyContent: "space-between" as const,
  gap: 8,
  boxSizing: "border-box" as const,
};
const filterSelectStyle = {
  flex: 1,
  minWidth: 0,
  height: "100%",
  border: "none",
  background: "transparent",
  color: "#fff",
  fontSize: 13,
  outline: "none",
  cursor: "pointer" as const,
  appearance: "none" as const,
  WebkitAppearance: "none" as const,
  paddingRight: 4,
};
const filterChevronStyle = {
  width: 16,
  height: 16,
  display: "flex" as const,
  alignItems: "center" as const,
  justifyContent: "center" as const,
  opacity: 0.6,
  flexShrink: 0,
  pointerEvents: "none" as const,
};
const filterLabelStyle = { fontSize: 11, fontWeight: 700, opacity: 0.55, textTransform: "uppercase" as const, letterSpacing: "0.05em", marginBottom: 6 };
/** Колонка фильтра: ширина = ширине селекта; подпись не шире кнопки. */
const ltvFilterColumnStyle = { display: "flex" as const, flexDirection: "column" as const, gap: 6, width: "fit-content" as const, maxWidth: "100%" };
/** Синхрон с padding селекта (14px) + 2px слева; справа 14px под зону chevron. */
const ltvFilterLabelRowStyle = {
  ...filterLabelStyle,
  display: "flex" as const,
  alignItems: "center" as const,
  gap: 6,
  marginBottom: 0,
  paddingLeft: 16,
  paddingRight: 14,
  boxSizing: "border-box" as const,
  width: "100%",
  minWidth: 0,
};

const customCardStyle = {
  background: "#161616",
  border: "1px solid rgba(255,255,255,0.08)",
  borderRadius: 16,
  padding: 16,
  transition: "border-color 0.2s ease",
};
const cardStyle = {
  ...customCardStyle,
  minHeight: 160,
};
const revenueCardStyle = { ...customCardStyle, minHeight: 220 };
const sectionLabel = { fontSize: 11, opacity: 0.5, fontWeight: 700, marginBottom: 6, textTransform: "uppercase" as const, letterSpacing: "0.04em" };
const sectionHeaderStyle = { fontSize: 14, fontWeight: 600, opacity: 0.95, margin: "0 0 12px", letterSpacing: "-0.01em" };
const sectionSubheaderStyle = { fontSize: 12, color: "rgba(255,255,255,0.55)", margin: "0 0 14px", lineHeight: 1.4 };
const metricLabelStyle = { fontSize: 13, opacity: 0.6 };
const kpiLargeStyle = { fontSize: 32, fontWeight: 700, letterSpacing: "-0.02em" as const };
const progressThinStyle = { height: 4, background: "rgba(255,255,255,0.05)", borderRadius: 2, overflow: "hidden" as const };

const demoBadgeStyle = {
  padding: "2px 8px",
  borderRadius: 999,
  fontSize: 9,
  fontWeight: 700,
  background: "rgba(244,63,94,0.2)",
  border: "1px solid rgba(244,63,94,0.2)",
  color: "rgb(251,113,133)",
  textTransform: "uppercase" as const,
  letterSpacing: "0.06em",
  marginLeft: 12,
};

const unitEconomicsCardStyle = {
  ...customCardStyle,
  minHeight: 200,
  border: "1px solid rgba(16,185,129,0.2)",
  background: "linear-gradient(180deg, rgba(16,185,129,0.02) 0%, #161616 100%)",
  boxShadow: "0 0 0 1px rgba(16,185,129,0.08)",
};

/** Форматирование сумм в валюте проекта. Значения с API уже в этой валюте (единый источник: API возвращает currency). */
function formatMoney(value: number, currency: ProjectCurrency): string {
  if (!Number.isFinite(value)) return "—";
  if (currency === "KZT") {
    return "₸ " + new Intl.NumberFormat("ru-RU").format(Math.round(value));
  }
  return fmtProjectCurrency(value, "USD", null);
}

const MONTH_NAMES = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
function formatCohortLabel(ym: string): string {
  if (!ym || !/^\d{4}-\d{2}$/.test(ym)) return ym || "—";
  const [y, m] = ym.split("-").map(Number);
  return `${MONTH_NAMES[m - 1] ?? ym} ${y}`;
}

function lastDayOfCalendarMonthYm(ym: string): string {
  if (!ym || !/^\d{4}-\d{2}$/.test(ym)) return ym;
  const [y, m] = ym.split("-").map(Number);
  if (!Number.isFinite(y) || !Number.isFinite(m) || m < 1 || m > 12) return ym;
  const d = new Date(y, m, 0).getDate();
  return `${ym}-${String(d).padStart(2, "0")}`;
}

function defaultDateRange(): { start: string; end: string } {
  const end = new Date();
  const start = new Date(end);
  start.setMonth(start.getMonth() - 2);
  return {
    start: start.toISOString().slice(0, 10),
    end: end.toISOString().slice(0, 10),
  };
}

const ACQUISITION_SOURCE_LABELS: Record<string, string> = {
  all: "Все источники",
  meta: "Meta Ads",
  google: "Google Ads",
  tiktok: "TikTok Ads",
  yandex: "Yandex Ads",
  direct: "Direct",
  organic_search: "Organic Search",
  referral: "Referral",
};

type LtvKpi = {
  usersMi: number;
  activeUsersMi: number;
  revenueMi: number;
  arpuMi: number;
  ltvCum: number;
  payingShare: number | null;
  /** События registration в периоде (после фильтра канала) */
  registrants_in_period?: number;
  /** События purchase в периоде (после фильтра канала) */
  purchases_in_period?: number;
  retentionPct: number;
  usersM0: number;
  retentionMoM: number | null;
  revenueMoM: number | null;
  ltvXUsers: number;
  repeat_purchases_count: number;
  repeat_revenue: number;
  total_purchases: number;
  budget_for_repeat_sales: number | null;
  cpr: number | null;
  retention_spend?: number | null;
  cpr_actual?: number | null;
  /** Год/месяц строки project_monthly_plans (когорта или конец отчёта) */
  monthly_plan_year?: number | null;
  monthly_plan_month?: number | null;
  monthly_plan_source?: "cohort" | "report_end" | null;
  monthly_plan_row_found?: boolean;
  plan_repeat_sales_count?: number | null;
  plan_sales_plan_count?: number | null;
  plan_sales_plan_budget?: number | null;
  planned_revenue?: number | null;
  planned_retention_revenue?: number | null;
  plan_cac?: number | null;
  spend: number;
  /** Расход на привлечение в окне KPI: spend − retention_spend (если retention посчитан), иначе весь spend. Дублирует расчёт на API. */
  acquisition_spend?: number | null;
  retention_purchases_count?: number;
  retention_revenue?: number;
  total_purchase_count?: number;
  first_purchase_count?: number;
  repeat_purchase_count?: number;
  unique_purchasers?: number;
  total_revenue?: number;
  first_revenue?: number;
  repeat_revenue_share?: number | null;
  retention_revenue_share?: number | null;
  repeat_purchase_rate?: number;
  repeat_purchasers_count?: number;
  repeat_user_rate?: number | null;
  retention_user_rate?: number | null;
  first_revenue_share?: number | null;
  revenue_recapture_rate?: number | null;
  retention_roas?: number | null;
  /** Границы окна KPI на борде (покупки, регистрации, spend); при выбранной когорте — календарный месяц YYYY-MM. */
  kpi_window_start?: string;
  kpi_window_end?: string;
  /** Пересечение start–end с месяцем когорты. */
  kpi_window_cohort_calendar_month?: boolean;
  /** Окно = весь календарный месяц когорты (можно сравнивать с дашбордом за месяц). */
  kpi_window_full_cohort_month?: boolean;
  /** Сумма первых оплат пользователей выбранной когорты (см. API LTV). */
  cohort_first_order_revenue?: number | null;
  cohort_repeat_purchases_in_period?: number | null;
  cohort_repeat_revenue_in_period?: number | null;
};

function safeNum(v: number | null | undefined): number | "--" {
  if (v == null || !Number.isFinite(v)) return "--";
  return v;
}
function safePct(v: number | null | undefined): string {
  if (v == null || !Number.isFinite(v)) return "—";
  return v.toFixed(1).replace(".", ",") + "%";
}
function safeRoas(v: number | null | undefined): string {
  if (v == null || !Number.isFinite(v)) return "—";
  return v.toFixed(2).replace(".", ",");
}

const DEMO_LINE_BY_COHORT: Record<string, Point[]> = {
  "2026-01": [
    { day: "D1", ltv: 7, arpu: 5 },
    { day: "D7", ltv: 16, arpu: 11 },
    { day: "D14", ltv: 27, arpu: 19 },
    { day: "D30", ltv: 42, arpu: 31 },
    { day: "D60", ltv: 58, arpu: 44 },
    { day: "D90", ltv: 72, arpu: 56 },
  ],
  "2026-02": [
    { day: "D1", ltv: 7, arpu: 6 },
    { day: "D7", ltv: 16, arpu: 12 },
    { day: "D14", ltv: 27, arpu: 21 },
    { day: "D30", ltv: 42, arpu: 33 },
    { day: "D60", ltv: 61, arpu: 48 },
    { day: "D90", ltv: 78, arpu: 61 },
  ],
  "2026-03": [
    { day: "D1", ltv: 8, arpu: 6 },
    { day: "D7", ltv: 18, arpu: 12 },
    { day: "D14", ltv: 31, arpu: 22 },
    { day: "D30", ltv: 48, arpu: 35 },
    { day: "D60", ltv: 67, arpu: 51 },
    { day: "D90", ltv: 82, arpu: 64 },
  ],
};

const DEMO_COHORT_ROWS_PERCENT: CohortRow[] = [
  { cohort: "2026-01", values: [100, 52, 39, 31, 24, 18, 14] },
  { cohort: "2026-02", values: [100, 48, 35, 28, 21, 15, 0] },
  { cohort: "2026-03", values: [100, 45, 32, 27, 20, 0, 0] },
];

const DEMO_COHORT_SIZES: Record<string, number> = {
  "2026-01": 980,
  "2026-02": 1110,
  "2026-03": 1240,
};

const DEMO_COHORT_REVENUE_ROWS: CohortRow[] = [
  { cohort: "2026-01", values: [45200, 38400, 32500, 27100, 20300, 13500, 9900] },
  { cohort: "2026-02", values: [58100, 49200, 41800, 34800, 26200, 17800, 0] },
  { cohort: "2026-03", values: [101600, 82400, 71500, 59100, 46300, 0, 0] },
];

function makeDemoKpi(overrides: Partial<LtvKpi>): LtvKpi {
  const base: LtvKpi = {
    usersMi: 1240,
    activeUsersMi: 1240,
    revenueMi: 128000,
    arpuMi: 64,
    ltvCum: 39800,
    payingShare: 7.2,
    registrants_in_period: 1240,
    purchases_in_period: 89,
    retentionPct: 38.4,
    usersM0: 1240,
    retentionMoM: null,
    revenueMoM: null,
    ltvXUsers: 101600,
    repeat_purchases_count: 420,
    repeat_revenue: 52000,
    total_purchases: 1240,
    budget_for_repeat_sales: 3000,
    cpr: 7.14,
    retention_spend: 2160,
    cpr_actual: 5.14,
    spend: 15000,
    acquisition_spend: 12840,
    retention_purchases_count: 420,
    retention_revenue: 52000,
    total_purchase_count: 1240,
    first_purchase_count: 820,
    repeat_purchase_count: 420,
    unique_purchasers: 980,
    total_revenue: 128000,
    first_revenue: 76000,
    repeat_revenue_share: 0.406,
    retention_revenue_share: 0.406,
    repeat_purchase_rate: 0.339,
    repeat_purchasers_count: 420,
    repeat_user_rate: 0.339,
    retention_user_rate: null,
    first_revenue_share: 0.594,
    revenue_recapture_rate: null,
    retention_roas: 18.4,
    monthly_plan_year: 2026,
    monthly_plan_month: 3,
    monthly_plan_source: "cohort",
    monthly_plan_row_found: true,
    plan_repeat_sales_count: 420,
    plan_sales_plan_count: 500,
    plan_sales_plan_budget: 25000,
    planned_revenue: 180000,
    plan_cac: 50,
    kpi_window_start: "2026-03-01",
    kpi_window_end: "2026-03-31",
    kpi_window_cohort_calendar_month: true,
    kpi_window_full_cohort_month: true,
    cohort_first_order_revenue: 76000,
    cohort_repeat_purchases_in_period: 420,
    cohort_repeat_revenue_in_period: 52000,
  };
  return { ...base, ...overrides };
}

/** Demo mode: scale factors per acquisition source so filter visibly changes KPI/cohorts (not fake). */
const DEMO_SOURCE_SCALE: Record<string, number> = {
  meta: 0.42,
  google: 0.35,
  tiktok: 0.18,
  yandex: 0.12,
  direct: 0.28,
  organic_search: 0.22,
  referral: 0.1,
};

function scaleDemoKpi(kpi: LtvKpi, scale: number): LtvKpi {
  const n = (v: number) => Math.round(v * scale);
  const regScaled = kpi.registrants_in_period != null ? n(kpi.registrants_in_period) : null;
  const purScaled = kpi.purchases_in_period != null ? n(kpi.purchases_in_period) : null;
  const payingShareScaled =
    regScaled != null && regScaled > 0 && purScaled != null
      ? Math.round((1000 * purScaled) / regScaled) / 10
      : kpi.payingShare;
  return {
    ...kpi,
    usersMi: n(kpi.usersMi),
    activeUsersMi: n(kpi.activeUsersMi),
    usersM0: n(kpi.usersM0),
    revenueMi: n(kpi.revenueMi),
    ltvXUsers: n(kpi.ltvXUsers),
    first_purchase_count: n(kpi.first_purchase_count ?? 0),
    repeat_purchase_count: n(kpi.repeat_purchase_count ?? 0),
    total_purchase_count: n(kpi.total_purchase_count ?? kpi.total_purchases ?? 0),
    unique_purchasers: n(kpi.unique_purchasers ?? 0),
    total_revenue: n(kpi.total_revenue ?? 0),
    first_revenue: n(kpi.first_revenue ?? 0),
    repeat_revenue: n(kpi.repeat_revenue ?? 0),
    repeat_purchases_count: n(kpi.repeat_purchases_count ?? 0),
    retention_purchases_count: n(kpi.retention_purchases_count ?? 0),
    retention_revenue: n(kpi.retention_revenue ?? 0),
    repeat_purchasers_count: n(kpi.repeat_purchasers_count ?? 0),
    spend: n(kpi.spend ?? 0),
    retention_spend: kpi.retention_spend != null ? n(kpi.retention_spend) : null,
    acquisition_spend: (() => {
      const ss = n(kpi.spend ?? 0);
      const rs = kpi.retention_spend != null ? n(kpi.retention_spend) : null;
      return rs != null ? Math.max(0, ss - rs) : ss;
    })(),
    budget_for_repeat_sales: kpi.budget_for_repeat_sales != null ? n(kpi.budget_for_repeat_sales) : null,
    plan_repeat_sales_count: kpi.plan_repeat_sales_count != null ? n(kpi.plan_repeat_sales_count) : null,
    plan_sales_plan_count: kpi.plan_sales_plan_count != null ? n(kpi.plan_sales_plan_count) : null,
    plan_sales_plan_budget: kpi.plan_sales_plan_budget != null ? n(kpi.plan_sales_plan_budget) : null,
    planned_revenue: kpi.planned_revenue != null ? n(kpi.planned_revenue) : null,
    registrants_in_period: regScaled ?? undefined,
    purchases_in_period: purScaled ?? undefined,
    payingShare: payingShareScaled,
    cpr: (() => {
      const b = kpi.budget_for_repeat_sales != null ? n(kpi.budget_for_repeat_sales) : null;
      const c = kpi.plan_repeat_sales_count != null ? n(kpi.plan_repeat_sales_count) : null;
      if (b != null && c != null && c > 0 && b > 0) return Math.round((10000 * b) / c) / 10000;
      return kpi.cpr;
    })(),
    plan_cac: (() => {
      const b = kpi.plan_sales_plan_budget != null ? n(kpi.plan_sales_plan_budget) : null;
      const c = kpi.plan_sales_plan_count != null ? n(kpi.plan_sales_plan_count) : null;
      if (b != null && c != null && c > 0 && b > 0) return Math.round((10000 * b) / c) / 10000;
      return kpi.plan_cac ?? null;
    })(),
    cohort_first_order_revenue: kpi.cohort_first_order_revenue != null ? n(kpi.cohort_first_order_revenue) : undefined,
    cohort_repeat_purchases_in_period:
      kpi.cohort_repeat_purchases_in_period != null ? n(kpi.cohort_repeat_purchases_in_period) : undefined,
    cohort_repeat_revenue_in_period:
      kpi.cohort_repeat_revenue_in_period != null ? n(kpi.cohort_repeat_revenue_in_period) : undefined,
    kpi_window_full_cohort_month: kpi.kpi_window_full_cohort_month,
  };
}

const DEMO_KPI_BY_COHORT: Record<string, LtvKpi> = {
  "2026-01": makeDemoKpi({
    usersMi: 980,
    activeUsersMi: 980,
    usersM0: 980,
    revenueMi: 89600,
    arpuMi: 58,
    ltvCum: 35200,
    retentionPct: 36,
    ltvXUsers: 34496,
    first_purchase_count: 650,
    repeat_purchase_count: 330,
    repeat_purchases_count: 330,
    unique_purchasers: 920,
    total_revenue: 89600,
    first_revenue: 53200,
    repeat_revenue: 36400,
    repeat_revenue_share: 0.406,
    retention_revenue: 36400,
    retention_purchases_count: 330,
    repeat_purchasers_count: 330,
    repeat_purchase_rate: 0.328,
    repeat_user_rate: 0.328,
    first_revenue_share: 0.594,
    budget_for_repeat_sales: 2800,
    retention_spend: 1980,
    cpr: 6.0,
    cpr_actual: 6.0,
    spend: 13200,
    acquisition_spend: 11220,
    registrants_in_period: 980,
    purchases_in_period: 71,
    monthly_plan_month: 1,
    monthly_plan_year: 2026,
    monthly_plan_source: "cohort",
    kpi_window_start: "2026-01-01",
    kpi_window_end: "2026-01-31",
    kpi_window_cohort_calendar_month: true,
    kpi_window_full_cohort_month: true,
    cohort_first_order_revenue: 53200,
    cohort_repeat_purchases_in_period: 330,
    cohort_repeat_revenue_in_period: 36400,
  }),
  "2026-02": makeDemoKpi({
    usersMi: 1110,
    activeUsersMi: 1110,
    usersM0: 1110,
    revenueMi: 108200,
    arpuMi: 61,
    ltvCum: 37800,
    retentionPct: 37,
    ltvXUsers: 41958,
    first_purchase_count: 738,
    repeat_purchase_count: 372,
    repeat_purchases_count: 372,
    unique_purchasers: 1050,
    total_revenue: 108200,
    first_revenue: 64800,
    repeat_revenue: 43400,
    repeat_revenue_share: 0.401,
    retention_revenue: 43400,
    retention_purchases_count: 372,
    repeat_purchasers_count: 372,
    repeat_purchase_rate: 0.335,
    repeat_user_rate: 0.335,
    first_revenue_share: 0.599,
    budget_for_repeat_sales: 2900,
    retention_spend: 2100,
    cpr: 6.5,
    cpr_actual: 5.65,
    spend: 14200,
    acquisition_spend: 12100,
    registrants_in_period: 1110,
    purchases_in_period: 80,
    monthly_plan_month: 2,
    monthly_plan_year: 2026,
    monthly_plan_source: "cohort",
    kpi_window_start: "2026-02-01",
    kpi_window_end: "2026-02-28",
    kpi_window_cohort_calendar_month: true,
    kpi_window_full_cohort_month: true,
    cohort_first_order_revenue: 64800,
    cohort_repeat_purchases_in_period: 372,
    cohort_repeat_revenue_in_period: 43400,
  }),
  "2026-03": makeDemoKpi({}),
};

export default function LtvPageClient() {
  const searchParams = useSearchParams();
  const projectId = searchParams.get("project_id")?.trim() ?? "";
  const selectedSources = useMemo(
    () =>
      (searchParams.get("sources") ?? "")
        .split(",")
        .map((s) => s.trim().toLowerCase())
        .filter(Boolean),
    [searchParams]
  );
  const selectedAccountIds = useMemo(
    () =>
      (searchParams.get("account_ids") ?? "")
        .split(",")
        .map((s) => s.trim())
        .filter(Boolean),
    [searchParams]
  );

  const [metric, setMetric] = useState<"money" | "users" | "percent">("percent");

  const { start: defaultStart, end: defaultEnd } = defaultDateRange();
  const [dateRange] = useState({ start: defaultStart, end: defaultEnd });

  const [data, setData] = useState<{
    currency?: ProjectCurrency;
    kpi: LtvKpi;
    lineData: Point[];
    cohortRows: CohortRow[];
    cohortSizes: Record<string, number>;
    cohortRevenueRows?: CohortRow[];
    acquisition_sources?: string[];
    ltv_curve_mode?: "first_n_days" | "realized_period_end";
    usd_to_kzt_rate_used?: number | null;
    scan_truncated?: boolean;
    scan_max_rows?: number;
    currency_diagnostics?: {
      reason_codes: string[];
      warnings: string[];
      mixed_currency: boolean;
    } | null;
  } | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [cohortMonth, setCohortMonth] = useState("");
  const [acquisitionSource, setAcquisitionSource] = useState<string>("all");
  const [revenueSegmentHover, setRevenueSegmentHover] = useState<0 | 1 | 2 | null>(null);
  const [retentionPlanAccordion, setRetentionPlanAccordion] = useState<"repeat" | "primary" | null>(null);
  const [kpiWindowExplainerOpen, setKpiWindowExplainerOpen] = useState(false);
  const [projectCurrency, setProjectCurrency] = useState<ProjectCurrency>("USD");

  useEffect(() => {
    if (!projectId) return;
    let mounted = true;
    (async () => {
      try {
        const res = await getSharedCached(
          `projects-currency:${projectId}`,
          () => fetch(`/api/projects/currency?project_id=${encodeURIComponent(projectId)}`, { cache: "no-store" }),
          { ttlMs: 120_000 }
        );
        const json = await res.json();
        if (!mounted) return;
        if (res.ok && json?.success && typeof json.currency === "string") {
          const c = json.currency.toUpperCase();
          if (c === "KZT" || c === "USD") setProjectCurrency(c);
        }
      } catch {
        // keep default
      }
    })();
    return () => { mounted = false; };
  }, [projectId]);

  const displayCurrency: ProjectCurrency = (data?.currency === "KZT" || data?.currency === "USD" ? data.currency : projectCurrency);
  const fmtMoney = useCallback((n: number) => formatMoney(n, displayCurrency), [displayCurrency]);

  const isDemoLtv = Boolean(
    data &&
    (!data.kpi ||
      (data.kpi.unique_purchasers ?? 0) === 0 ||
      ((data.kpi.total_purchase_count ?? data.kpi.total_purchases ?? 0) === 0) ||
      !data.cohortRows?.length)
  );

  const realizedLtvCurve = Boolean(!isDemoLtv && data?.ltv_curve_mode === "realized_period_end");

  const cohortMonths = useMemo(() => {
    const rows = isDemoLtv ? DEMO_COHORT_ROWS_PERCENT : (data?.cohortRows ?? []);
    if (!rows.length) return [defaultEnd.slice(0, 7)];
    return rows.map((r) => r.cohort);
  }, [isDemoLtv, data?.cohortRows, defaultEnd]);

  useEffect(() => {
    if (!cohortMonth && cohortMonths.length > 0) {
      setCohortMonth(cohortMonths[cohortMonths.length - 1] ?? "");
    }
    if (cohortMonths.length > 0 && cohortMonth && !cohortMonths.includes(cohortMonth)) {
      setCohortMonth(cohortMonths[cohortMonths.length - 1] ?? "");
    }
  }, [cohortMonths, cohortMonth]);

  const fetchLtv = useCallback(async () => {
    if (!projectId) {
      setData(null);
      setLoading(false);
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams({
        project_id: projectId,
        start: dateRange.start,
        end: dateRange.end,
      });
      if (cohortMonth) params.set("cohort_month", cohortMonth);
      if (acquisitionSource && acquisitionSource !== "all") params.set("acquisition_source", acquisitionSource);
      if (selectedSources.length > 0) params.set("sources", selectedSources.join(","));
      if (selectedAccountIds.length > 0) params.set("account_ids", selectedAccountIds.join(","));
      const res = await fetch(`/api/ltv?${params.toString()}`, { cache: "no-store" });
      const json = await res.json();
      if (!res.ok) {
        setError(json?.error ?? "Ошибка загрузки");
        setData(null);
        return;
      }
      if (json.success && json.kpi) {
        const diag = json.currency_diagnostics;
        setData({
          currency: (json.currency === "KZT" || json.currency === "USD") ? json.currency : undefined,
          kpi: json.kpi,
          lineData: Array.isArray(json.lineData) ? json.lineData : [],
          cohortRows: Array.isArray(json.cohortRows) ? json.cohortRows : [],
          cohortSizes: json.cohortSizes ?? {},
          cohortRevenueRows: Array.isArray(json.cohortRevenueRows) ? json.cohortRevenueRows : undefined,
          acquisition_sources: Array.isArray(json.acquisition_sources) ? json.acquisition_sources : undefined,
          ltv_curve_mode:
            json.ltv_curve_mode === "realized_period_end" || json.ltv_curve_mode === "first_n_days"
              ? json.ltv_curve_mode
              : undefined,
          usd_to_kzt_rate_used: typeof json.usd_to_kzt_rate_used === "number" ? json.usd_to_kzt_rate_used : json.usd_to_kzt_rate_used === null ? null : undefined,
          scan_truncated: json.scan_truncated === true,
          scan_max_rows: typeof json.scan_max_rows === "number" ? json.scan_max_rows : undefined,
          currency_diagnostics:
            diag && typeof diag === "object"
              ? {
                  reason_codes: Array.isArray(diag.reason_codes) ? diag.reason_codes : [],
                  warnings: Array.isArray(diag.warnings) ? diag.warnings : [],
                  mixed_currency: Boolean(diag.mixed_currency),
                }
              : null,
        });
      } else {
        setData(null);
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "Ошибка сети");
      setData(null);
    } finally {
      setLoading(false);
    }
  }, [projectId, dateRange.start, dateRange.end, cohortMonth, acquisitionSource, selectedSources, selectedAccountIds]);

  useEffect(() => {
    fetchLtv();
  }, [fetchLtv]);

  const defaultDemoCohort = "2026-03";
  const baseDemoKpi = DEMO_KPI_BY_COHORT[cohortMonth] ?? DEMO_KPI_BY_COHORT[defaultDemoCohort];
  const demoScale = acquisitionSource && acquisitionSource !== "all" ? (DEMO_SOURCE_SCALE[acquisitionSource] ?? 0.2) : 1;
  const effectiveKpi = isDemoLtv
    ? (demoScale === 1 ? baseDemoKpi : scaleDemoKpi(baseDemoKpi, demoScale))
    : data?.kpi ?? null;
  const effectiveLineData: Point[] = isDemoLtv ? (DEMO_LINE_BY_COHORT[cohortMonth] ?? DEMO_LINE_BY_COHORT[defaultDemoCohort]) : (data?.lineData?.length ? data.lineData : DEMO_LINE_BY_COHORT[defaultDemoCohort]);
  const effectiveApiCohortRows = isDemoLtv ? DEMO_COHORT_ROWS_PERCENT : (data?.cohortRows ?? []);
  const effectiveApiCohortRevenueRows = isDemoLtv
    ? (demoScale === 1 ? DEMO_COHORT_REVENUE_ROWS : DEMO_COHORT_REVENUE_ROWS.map((r) => ({ cohort: r.cohort, values: r.values.map((v) => Math.round(v * demoScale)) })))
    : (data?.cohortRevenueRows ?? []);
  const effectiveCohortSizes = isDemoLtv
    ? (demoScale === 1 ? DEMO_COHORT_SIZES : Object.fromEntries(Object.entries(DEMO_COHORT_SIZES).map(([c, n]) => [c, Math.round(n * demoScale)])))
    : (data?.cohortSizes ?? {});

  const cohortRows: CohortRow[] = useMemo(() => {
    if (metric === "percent") return effectiveApiCohortRows;
    if (metric === "users") {
      return effectiveApiCohortRows.map((r) => {
        const size = effectiveCohortSizes[r.cohort] ?? 0;
        return {
          cohort: r.cohort,
          values: r.values.map((p) => Math.round((p / 100) * size)),
        };
      });
    }
    if (metric === "money" && effectiveApiCohortRevenueRows.length) {
      return effectiveApiCohortRevenueRows;
    }
    if (metric === "money" && !isDemoLtv) {
      return [];
    }
    const arpuByMonthIndex = [8000, 6200, 5400, 4800, 4300, 3900, 3600];
    return effectiveApiCohortRows.map((r) => {
      const size = effectiveCohortSizes[r.cohort] ?? 0;
      const users = r.values.map((p) => (p / 100) * size);
      const money = users.map((u, i) => Math.round(u * (arpuByMonthIndex[i] ?? 4000)));
      return { cohort: r.cohort, values: money };
    });
  }, [metric, isDemoLtv, effectiveApiCohortRows, effectiveApiCohortRevenueRows, effectiveCohortSizes]);

  const usersMi = effectiveKpi?.usersMi ?? 0;
  const activeUsersMi = effectiveKpi?.activeUsersMi ?? 0;
  const revenueMi = effectiveKpi?.revenueMi ?? 0;
  const arpuMi = effectiveKpi?.arpuMi ?? 0;
  const ltvCum = effectiveKpi?.ltvCum ?? 0;
  const payingShare = effectiveKpi?.payingShare ?? null;
  const registrantsInPeriod = effectiveKpi?.registrants_in_period ?? null;
  const purchasesInPeriod = effectiveKpi?.purchases_in_period ?? null;
  const retentionPct = effectiveKpi?.retentionPct ?? 0;
  const usersM0 = effectiveKpi?.usersM0 ?? 0;
  const retentionMoM = effectiveKpi?.retentionMoM ?? null;
  const revenueMoM = effectiveKpi?.revenueMoM ?? null;
  const ltvXUsers = effectiveKpi?.ltvXUsers ?? 0;
  const budgetForRepeatSales = effectiveKpi?.budget_for_repeat_sales ?? null;
  const cpr = effectiveKpi?.cpr ?? null;
  const retentionSpend = effectiveKpi?.retention_spend ?? null;
  const cprActual = effectiveKpi?.cpr_actual ?? null;
  const monthlyPlanYear = effectiveKpi?.monthly_plan_year ?? null;
  const monthlyPlanMonth = effectiveKpi?.monthly_plan_month ?? null;
  const monthlyPlanSource = effectiveKpi?.monthly_plan_source ?? null;
  const monthlyPlanRowFound = effectiveKpi?.monthly_plan_row_found ?? false;
  const planRepeatSalesCount = effectiveKpi?.plan_repeat_sales_count ?? null;
  const planSalesPlanCount = effectiveKpi?.plan_sales_plan_count ?? null;
  const planSalesPlanBudget = effectiveKpi?.plan_sales_plan_budget ?? null;
  const plannedRevenueKpi =
    effectiveKpi?.planned_retention_revenue ??
    effectiveKpi?.planned_revenue ??
    null;
  const planCac = effectiveKpi?.plan_cac ?? null;
  const spend = effectiveKpi?.spend ?? 0;
  const acquisitionSpend =
    effectiveKpi?.acquisition_spend != null && Number.isFinite(effectiveKpi.acquisition_spend)
      ? effectiveKpi.acquisition_spend
      : retentionSpend != null && Number.isFinite(retentionSpend)
        ? Math.max(0, spend - retentionSpend)
        : spend;

  const planMonthLabel =
    monthlyPlanYear != null && monthlyPlanMonth != null
      ? formatCohortLabel(`${monthlyPlanYear}-${String(monthlyPlanMonth).padStart(2, "0")}`)
      : null;
  const planSourceHintRu =
    monthlyPlanSource === "cohort"
      ? "месяц когорты (первая оплата)"
      : monthlyPlanSource === "report_end"
        ? "месяц даты окончания отчёта"
        : null;
  const retentionPurchasesCount = effectiveKpi?.retention_purchases_count ?? 0;
  const retentionRevenue = effectiveKpi?.retention_revenue ?? 0;
  const totalPurchaseCount = effectiveKpi?.total_purchase_count ?? effectiveKpi?.total_purchases ?? 0;
  const firstPurchaseCount = effectiveKpi?.first_purchase_count ?? 0;
  const repeatPurchaseCount = effectiveKpi?.repeat_purchase_count ?? effectiveKpi?.repeat_purchases_count ?? 0;
  const repeatPurchaseRate = effectiveKpi?.repeat_purchase_rate ?? null;
  const uniquePurchasers = effectiveKpi?.unique_purchasers ?? 0;
  const firstRevenue = effectiveKpi?.first_revenue ?? 0;
  const repeatRevenueShare = effectiveKpi?.repeat_revenue_share ?? null;
  const retentionRevenueShare = effectiveKpi?.retention_revenue_share ?? null;
  const repeatPurchasersCount = effectiveKpi?.repeat_purchasers_count ?? 0;
  const repeatUserRate = effectiveKpi?.repeat_user_rate ?? null;
  const retentionUserRate = effectiveKpi?.retention_user_rate ?? null;
  const firstRevenueShare = effectiveKpi?.first_revenue_share ?? null;
  const revenueRecaptureRate = effectiveKpi?.revenue_recapture_rate ?? null;
  const retentionRoas = effectiveKpi?.retention_roas ?? null;

  /** Ratio can be 0% while revenue/LTV &gt; 0: e.g. другой фильтр канала или покупки без событий registration в окне. */
  const payingShareMismatchHint =
    !isDemoLtv &&
    payingShare === 0 &&
    registrantsInPeriod != null &&
    registrantsInPeriod > 0 &&
    (revenueMi > 0 || uniquePurchasers > 0)
      ? "Выручка и LTV могут быть выше нуля, а эта метрика — ноль: так бывает, если регистрации есть, а покупок в том же окне почти нет или они не попали в расчёт."
      : null;

  const isCohortMoneyFallback =
    metric === "money" && (!effectiveApiCohortRevenueRows.length && !isDemoLtv);
  const hasRetentionEconomics =
    (budgetForRepeatSales != null && Number.isFinite(budgetForRepeatSales)) ||
    (retentionSpend != null && Number.isFinite(retentionSpend));
  const progressDenom = budgetForRepeatSales != null && budgetForRepeatSales > 0 ? budgetForRepeatSales : null;
  const progressValue =
    progressDenom != null && retentionSpend != null && Number.isFinite(retentionSpend)
      ? Math.min(2, retentionSpend / progressDenom)
      : null;
  const difference =
    budgetForRepeatSales != null &&
    retentionSpend != null &&
    Number.isFinite(retentionSpend) &&
    Number.isFinite(budgetForRepeatSales)
      ? retentionSpend - budgetForRepeatSales
      : null;

  const insights: string[] = [];
  if (repeatPurchaseCount === 0) insights.push("В периоде отчёта нет повторных покупок");
  if (retentionSpend === 0 || retentionSpend == null) insights.push("Retention-расходы не найдены или равны нулю");
  if (retentionRoas != null && Number.isFinite(retentionRoas) && retentionRoas > 3)
    insights.push("Retention-кампании по ROAS выглядят сильнее порога 3×");
  if (
    retentionRoas != null &&
    Number.isFinite(retentionRoas) &&
    retentionRoas < 1 &&
    retentionSpend != null &&
    retentionSpend > 0
  )
    insights.push("Реклама на удержание: окупаемость (ROAS) ниже 1 при ненулевых расходах");
  if (
    (effectiveKpi?.repeat_revenue ?? 0) > (firstRevenue ?? 0) &&
    Number.isFinite(effectiveKpi?.repeat_revenue) &&
    Number.isFinite(firstRevenue)
  )
    insights.push("Выручка repeat (в т.ч. retention) выше выручки first в периоде отчёта");

  const cacAcquisition =
    firstPurchaseCount > 0 && Number.isFinite(acquisitionSpend)
      ? acquisitionSpend / firstPurchaseCount
      : null;
  const retentionCost =
    repeatPurchasersCount > 0 &&
    retentionSpend != null &&
    Number.isFinite(retentionSpend)
      ? retentionSpend / repeatPurchasersCount
      : null;
  const trueCac =
    cacAcquisition != null && retentionCost != null
      ? cacAcquisition + retentionCost
      : null;
  const ltv = ltvCum;
  const unitProfit = trueCac != null && Number.isFinite(ltv) ? ltv - trueCac : null;
  const ltvCacRatio =
    trueCac != null && trueCac > 0 && Number.isFinite(ltv) ? ltv / trueCac : null;

  const dayOrder: Record<string, number> = { D1: 1, D7: 7, D14: 14, D30: 30, D60: 60, D90: 90 };
  const sortedLineData = [...(effectiveLineData.length ? effectiveLineData : [])].sort(
    (a, b) => (dayOrder[a.day] ?? 0) - (dayOrder[b.day] ?? 0)
  );
  const breakEvenPoint =
    trueCac != null && trueCac > 0 && sortedLineData.length > 0
      ? sortedLineData.find((p) => Number.isFinite(p.ltv) && p.ltv >= trueCac)?.day ?? null
      : null;
  // Revenue composition: non-overlapping segments. Retention campaign revenue is a subset of repeat;
  // repeat_excluding_retention ensures the bar sums to 100%. Safeguard if data anomaly: retention > repeat.
  const totalRev = revenueMi > 0 ? revenueMi : 1;
  const repeatRevenueRaw = effectiveKpi?.repeat_revenue ?? 0;
  const repeatRevenueExcludingRetention = Math.max(0, repeatRevenueRaw - retentionRevenue);
  const firstRevShare = revenueMi > 0 ? (firstRevenue ?? 0) / totalRev : 0;
  const repeatExclShare = revenueMi > 0 ? repeatRevenueExcludingRetention / totalRev : 0;
  const retentionCampaignShare = revenueMi > 0 ? retentionRevenue / totalRev : 0;

  /** План из строки месяца когорты — факт первички/repeat сопоставляем с когортой, а не со всеми first/repeat в окне отчёта. */
  const useCohortPlanFact = monthlyPlanSource === "cohort";
  const primaryFactCount = useCohortPlanFact ? usersM0 : firstPurchaseCount;
  const primaryFactRevenue = useCohortPlanFact
    ? (effectiveKpi?.cohort_first_order_revenue ?? firstRevenue)
    : firstRevenue;
  const primaryFactCac =
    primaryFactCount > 0 && Number.isFinite(acquisitionSpend) ? acquisitionSpend / primaryFactCount : null;
  const repeatFactCount = useCohortPlanFact
    ? (effectiveKpi?.cohort_repeat_purchases_in_period ?? repeatPurchaseCount)
    : repeatPurchaseCount;
  const repeatFactRevenue = useCohortPlanFact
    ? (effectiveKpi?.cohort_repeat_revenue_in_period ?? repeatRevenueRaw)
    : repeatRevenueRaw;

  const kpiWindowStart =
    effectiveKpi?.kpi_window_start ??
    (isDemoLtv && cohortMonth && /^\d{4}-\d{2}$/.test(cohortMonth) ? `${cohortMonth}-01` : dateRange.start);
  const kpiWindowEnd =
    effectiveKpi?.kpi_window_end ??
    (isDemoLtv && cohortMonth && /^\d{4}-\d{2}$/.test(cohortMonth)
      ? lastDayOfCalendarMonthYm(cohortMonth)
      : dateRange.end);
  const boardRangeLabel = `${kpiWindowStart} — ${kpiWindowEnd}`;
  const kpiWindowCohortScoped =
    Boolean(effectiveKpi?.kpi_window_cohort_calendar_month) ||
    (isDemoLtv && Boolean(cohortMonth && /^\d{4}-\d{2}$/.test(cohortMonth)));
  const kpiWindowFullCohortMonth =
    effectiveKpi?.kpi_window_full_cohort_month ??
    (isDemoLtv &&
    cohortMonth &&
    /^\d{4}-\d{2}$/.test(cohortMonth) &&
    kpiWindowStart === `${cohortMonth}-01` &&
    kpiWindowEnd === lastDayOfCalendarMonthYm(cohortMonth));

  const currencyDiag = !isDemoLtv ? data?.currency_diagnostics : null;
  /** Только rate_missing — не показываем баннер (курс дозаполняется в API; англ. строки не выводим пользователю). */
  const currencyReasonCodesForUi =
    currencyDiag?.reason_codes?.filter((c) => c !== "rate_missing") ?? [];
  const showCurrencyWarning =
    Boolean(currencyDiag) &&
    (currencyReasonCodesForUi.length > 0 ||
      (currencyDiag!.warnings?.length ?? 0) > 0 ||
      Boolean(currencyDiag!.mixed_currency));
  const showKztRateLine =
    !isDemoLtv &&
    displayCurrency === "KZT" &&
    data?.usd_to_kzt_rate_used != null &&
    Number.isFinite(data.usd_to_kzt_rate_used);
  const showCurrencyBanner = showKztRateLine || showCurrencyWarning;

  if (!projectId) {
    return (
      <div style={{ padding: 24 }}>
        <h1 style={{ fontSize: 28, fontWeight: 900, margin: 0 }}>LTV / Retention</h1>
        <div style={{ opacity: 0.75, marginTop: 12 }}>Выберите проект в сайдбаре.</div>
      </div>
    );
  }

  if (loading && !data) {
    return (
      <div style={{ padding: 24 }}>
        <h1 style={{ fontSize: 28, fontWeight: 900, margin: 0 }}>LTV / Retention</h1>
        <div style={{ opacity: 0.75, marginTop: 12 }}>Загрузка…</div>
      </div>
    );
  }

  if (error) {
    return (
      <div style={{ padding: 24 }}>
        <h1 style={{ fontSize: 28, fontWeight: 900, margin: 0 }}>LTV / Retention</h1>
        <div style={{ opacity: 0.75, marginTop: 12, color: "rgba(239,68,68,0.9)" }}>{error}</div>
      </div>
    );
  }

  const showDemoBadgeInHeader = isDemoLtv;

  return (
    <div style={{ background: "#0a0a0a", minHeight: "100%", padding: "24px 24px 40px", maxWidth: 1280, margin: "0 auto" }}>
      <header style={{ marginBottom: 32, display: "flex", flexDirection: "column", gap: 4 }}>
        <h1 style={{ fontSize: 26, fontWeight: 600, margin: 0, letterSpacing: "-0.02em", display: "flex", alignItems: "center", flexWrap: "wrap" }}>
          LTV / Retention
          {showDemoBadgeInHeader && <span style={demoBadgeStyle}>Demo Data</span>}
        </h1>
        <p
          style={{
            fontSize: 13,
            opacity: 0.6,
            margin: 0,
            lineHeight: 1.45,
            display: "flex",
            alignItems: "center",
            flexWrap: "wrap",
            gap: 6,
          }}
        >
          Дальше — динамика по месяцам (M0, M1…) и по дням (D1–D90)
          <HelpTooltip content={LTV_HELP_CROSS_BOARD_PARITY} triggerMarginLeft={0} />
        </p>
        <div style={{ marginTop: 8, maxWidth: 820 }}>
          <button
            type="button"
            aria-expanded={kpiWindowExplainerOpen}
            onClick={() => setKpiWindowExplainerOpen((o) => !o)}
            style={{
              display: "block",
              width: "fit-content",
              maxWidth: "100%",
              margin: 0,
              padding: "4px 0",
              border: "none",
              borderRadius: 0,
              background: "transparent",
              color: "inherit",
              cursor: "pointer",
              fontSize: 12,
              textAlign: "left",
              boxSizing: "border-box" as const,
              opacity: 0.62,
            }}
          >
            <span style={{ lineHeight: 1.45 }}>
              <strong style={{ opacity: 0.95, fontWeight: 600 }}>{kpiWindowCohortScoped ? "Сводные показатели и реклама" : "Период отчёта"}</strong>
              <span style={{ opacity: 0.9 }}>
                {" "}
                {kpiWindowStart} — {kpiWindowEnd}
              </span>
              {kpiWindowCohortScoped && cohortMonth ? (
                <span style={{ opacity: 0.75 }}> · {formatCohortLabel(cohortMonth)}</span>
              ) : null}
              <span style={{ whiteSpace: "nowrap" }}>
                <span style={{ opacity: 0.7, fontWeight: 500 }}> — как считаются даты</span>{" "}
                <span
                  style={{
                    display: "inline-block",
                    opacity: 0.45,
                    fontSize: 9,
                    lineHeight: 1,
                    verticalAlign: "0.05em",
                    transform: kpiWindowExplainerOpen ? "rotate(180deg)" : "rotate(0deg)",
                    transition: "transform 0.15s ease",
                  }}
                  aria-hidden
                >
                  ▼
                </span>
              </span>
            </span>
          </button>
          {kpiWindowExplainerOpen ? (
            <div
              style={{
                marginTop: 4,
                padding: "2px 0 0",
                border: "none",
                background: "transparent",
                fontSize: 12,
                opacity: 0.55,
                lineHeight: 1.55,
              }}
            >
              <strong style={{ opacity: 0.82 }}>{kpiWindowCohortScoped ? "Сводные показатели и реклама" : "Период отчёта"}</strong>{" "}
              <strong style={{ opacity: 0.88 }}>{kpiWindowStart}</strong> — <strong style={{ opacity: 0.88 }}>{kpiWindowEnd}</strong>
              {kpiWindowCohortScoped ? (
                kpiWindowFullCohortMonth ? (
                  <>
                    : полный месяц когорты ({cohortMonth ? formatCohortLabel(cohortMonth) : ""}). Карточки сверху, расходы и реклама — за эти даты;
                    при выборе того же месяца на главном дашборде цифры можно сравнивать напрямую.{" "}
                  </>
                ) : (
                  <>
                    : месяц когорты — {cohortMonth ? formatCohortLabel(cohortMonth) : ""}, а даты выше —{" "}
                    <strong style={{ opacity: 0.85 }}>только та часть месяца</strong>, которая попадает в выбранный период отчёта. Итоговые метрики и
                    реклама считаются строго между этими датами.{" "}
                  </>
                )
              ) : (
                <>
                  : сводные показатели, состав выручки, расходы, CAC и доля платящих — только то, что попало в эти даты (продажи, регистрации,
                  реклама).{" "}
                </>
              )}
              <strong style={{ opacity: 0.82 }}>Кривая LTV, теплокарта и выручка по месяцам</strong> для выбранной когорты считаются по тем же людям
              (первая оплата в месяце когорты), но для поздних точек покупки дополнительно подгружаются{" "}
              {kpiWindowFullCohortMonth
                ? "после последнего дня этого месяца"
                : kpiWindowCohortScoped
                  ? `после ${kpiWindowEnd} (в пределах более широкого периода загрузки данных)`
                  : "после конца этого окна"}{" "}
              — до 90 дней после первой оплаты и до конца M6 в сетке.
            </div>
          ) : null}
        </div>
      </header>

      {!isDemoLtv && data?.scan_truncated ? (
        <div
          role="alert"
          style={{
            marginBottom: 16,
            padding: "10px 14px",
            borderRadius: 12,
            border: "1px solid rgba(251,191,36,0.35)",
            background: "rgba(251,191,36,0.08)",
            fontSize: 13,
            lineHeight: 1.45,
            color: "rgba(254,240,200,0.95)",
          }}
        >
          Выборка событий достигла лимита ({data.scan_max_rows?.toLocaleString("ru-RU") ?? "—"} строк). Итоги могут быть
          неполными — сузьте период в параметрах страницы или обратитесь к поддержке для агрегации на стороне БД.
        </div>
      ) : null}

      {showCurrencyBanner ? (
        <div
          role="status"
          style={{
            marginBottom: 16,
            padding: "10px 14px",
            borderRadius: 12,
            border: "1px solid rgba(96,165,250,0.35)",
            background: "rgba(59,130,246,0.08)",
            fontSize: 13,
            lineHeight: 1.45,
            color: "rgba(219,234,254,0.95)",
          }}
        >
          {showKztRateLine && data ? (
            <span style={{ display: "block", marginBottom: showCurrencyWarning ? 6 : 0, opacity: 0.9 }}>
              Курс USD→KZT для рекламных сумм (как в маркетинговом отчёте):{" "}
              {Number(data.usd_to_kzt_rate_used).toLocaleString("ru-RU", { maximumFractionDigits: 2 })}
            </span>
          ) : null}
          {showCurrencyWarning ? (
            currencyDiag?.warnings?.length ? (
              <ul style={{ margin: 0, paddingLeft: 18 }}>
                {currencyDiag.warnings.map((w, i) => (
                  <li key={i}>{w}</li>
                ))}
              </ul>
            ) : (
              <span>
                Предупреждения по валютам: {currencyReasonCodesForUi.join(", ") || "—"}
                {currencyDiag?.mixed_currency ? " (смешанные валюты во входных данных)" : ""}
              </span>
            )
          ) : null}
        </div>
      ) : null}

      <section style={{ display: "flex", flexWrap: "wrap", alignItems: "flex-end", gap: 16, marginBottom: 32 }}>
        <div style={ltvFilterColumnStyle}>
          <label style={ltvFilterLabelRowStyle}>
            Источник
            <HelpTooltip content={<><strong>Источник</strong><br />Канал определяется по <strong>первой покупке</strong> клиента. На графике остаются только те, кто пришёл с выбранного канала. Реклама на удержание в этот фильтр не входит.</>} />
          </label>
          <div className="filter-dropdown-wrap" style={filterDropdownWrapStyle}>
            <select value={acquisitionSource} onChange={(e) => setAcquisitionSource(e.target.value)} style={filterSelectStyle}>
              <option value="all" style={{ background: "#1c1c1c" }}>{ACQUISITION_SOURCE_LABELS.all}</option>
              {(data?.acquisition_sources ?? ["meta", "google", "tiktok", "yandex", "direct", "organic_search", "referral"]).map((s) => (
                <option key={s} value={s} style={{ background: "#1c1c1c" }}>{ACQUISITION_SOURCE_LABELS[s] ?? s}</option>
              ))}
            </select>
            <span className="filter-dropdown-chevron" style={filterChevronStyle} aria-hidden>
              <svg width="10" height="6" viewBox="0 0 10 6" fill="none" xmlns="http://www.w3.org/2000/svg">
                <path d="M1 1L5 5L9 1" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
            </span>
          </div>
        </div>
        <div style={ltvFilterColumnStyle}>
          <label style={ltvFilterLabelRowStyle}>
            Когорта
            <HelpTooltip content={<><strong>Когорта</strong><br />Все пользователи, у которых первая покупка в выбранном календарном месяце. M0, M1… — следующие месяцы после этого месяца.</>} />
          </label>
          <div className="filter-dropdown-wrap" style={filterDropdownWrapStyle}>
            <select value={cohortMonth} onChange={(e) => setCohortMonth(e.target.value)} style={filterSelectStyle}>
              {cohortMonths.map((m) => (
                <option key={m} value={m} style={{ background: "#1c1c1c" }}>
                  {formatCohortLabel(m)}
                </option>
              ))}
            </select>
            <span className="filter-dropdown-chevron" style={filterChevronStyle} aria-hidden>
              <svg width="10" height="6" viewBox="0 0 10 6" fill="none" xmlns="http://www.w3.org/2000/svg">
                <path d="M1 1L5 5L9 1" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
            </span>
          </div>
        </div>
      </section>

      <section style={{ marginBottom: 32 }}>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 20 }}>
          <div style={{ ...cardStyle, minHeight: 170, display: "flex", flexDirection: "column", justifyContent: "space-between" }}>
            <div>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 8 }}>
                <p style={{ ...metricLabelStyle, margin: 0, display: "flex", alignItems: "center" }}>
                  Users
                  <HelpTooltip content={<><strong>Пользователи</strong><br />При выбранной когорте — сколько людей впервые заплатили в этом месяце. Без когорты — сколько уникальных покупателей попало в выбранные даты.</>} />
                </p>
                <span style={{ fontSize: 11, opacity: 0.55 }}>{cohortMonth ? formatCohortLabel(cohortMonth) : "—"}</span>
              </div>
              <div style={kpiLargeStyle}>{usersMi.toLocaleString("ru-RU")}</div>
            </div>
            <div style={{ marginTop: 24, display: "grid", gridTemplateColumns: "1fr 1fr", gap: "8px 16px", fontSize: 11 }}>
              <div style={{ display: "flex", flexDirection: "column" }}>
                <span style={{ opacity: 0.6, fontSize: 12, fontWeight: 700, textTransform: "uppercase", display: "flex", alignItems: "center" }}>First<HelpTooltip content={<><strong>Первые покупки</strong><br />Сколько оплат в выбранном периоде были для клиента самыми первыми за всё время.</>} /></span>
                <span style={{ fontWeight: 500 }}>{firstPurchaseCount}</span>
              </div>
              <div style={{ display: "flex", flexDirection: "column" }}>
                <span style={{ opacity: 0.6, fontSize: 12, fontWeight: 700, textTransform: "uppercase", display: "flex", alignItems: "center" }}>Repeat<HelpTooltip content={<><strong>Повторные покупки</strong><br />Сколько оплат в периоде пришлось на клиентов, у которых уже была покупка раньше. Считаются платежи, а не число людей.</>} /></span>
                <span style={{ fontWeight: 500 }}>{repeatPurchaseCount}</span>
              </div>
              <div style={{ display: "flex", flexDirection: "column" }}>
                <span style={{ opacity: 0.6, fontSize: 12, fontWeight: 700, textTransform: "uppercase", display: "flex", alignItems: "center" }}>Rate<HelpTooltip content={<><strong>Доля повторов</strong><br />Какой процент всех оплат в периоде — повторные (не первая покупка клиента).</>} /></span>
                <span style={{ fontWeight: 500, color: "rgb(16,185,129)" }}>{safePct(repeatPurchaseRate != null ? repeatPurchaseRate * 100 : null)}</span>
              </div>
            </div>
          </div>
          <div style={{ ...cardStyle, minHeight: 170, display: "flex", flexDirection: "column", justifyContent: "space-between" }}>
            <div>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 8 }}>
                <p style={{ ...metricLabelStyle, margin: 0, display: "flex", alignItems: "center" }}>Активность M0<HelpTooltip content={<><strong>Активность в первом месяце (M0)</strong><br />Доля клиентов когорты, у которых была покупка в том же месяце, что и первая оплата. Отдельно от колонок M1, M2… в таблице ниже.</>} /></p>
                <span style={{ fontSize: 11, opacity: 0.55 }}>{cohortMonth ? formatCohortLabel(cohortMonth) : "—"}</span>
              </div>
              <div style={{ ...kpiLargeStyle, color: "rgb(245,158,11)" }}>{retentionPct.toFixed(1).replace(".", ",")}%</div>
            </div>
            <div style={{ marginTop: 24 }}>
              <div style={{ display: "flex", justifyContent: "space-between", fontSize: 11, opacity: 0.55, marginBottom: 6 }}>
                <span>M0</span>
                <span>M1</span>
              </div>
              <div style={progressThinStyle}>
                <div style={{ width: `${Math.min(100, retentionPct)}%`, height: "100%", background: "rgb(245,158,11)", borderRadius: 2, position: "relative", boxShadow: "0 0 8px rgba(245,158,11,0.5)" }} />
              </div>
              <p style={{ fontSize: 11, opacity: 0.5, margin: "8px 0 0", textAlign: "center" }}>Активные в M0 / размер когорты</p>
            </div>
          </div>
          <div style={{ ...cardStyle, minHeight: 170, display: "flex", flexDirection: "column", justifyContent: "space-between" }}>
            <div>
              <p style={{ ...metricLabelStyle, margin: "0 0 8px", display: "flex", alignItems: "center" }}>Paying share<HelpTooltip content={<><strong>Доля платящих</strong><br />Сколько покупок приходится на 100 регистраций в том же периоде и с тем же фильтром канала. Помогает понять, насколько регистрации превращаются в оплаты.</>} /></p>
              <div style={kpiLargeStyle}>
                {payingShare != null && Number.isFinite(payingShare) ? payingShare.toFixed(1).replace(".", ",") + "%" : "—"}
              </div>
            </div>
            <div style={{ marginTop: 24 }}>
              <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: payingShareMismatchHint ? 8 : 12 }}>
                <div style={{ width: 6, height: 6, borderRadius: "50%", background: "rgba(255,255,255,0.2)" }} />
                <p style={{ fontSize: 12, opacity: 0.7, margin: 0 }}>
                  {payingShare == null
                    ? "Нет регистраций в выбранном периоде"
                    : purchasesInPeriod != null && registrantsInPeriod != null
                      ? `${purchasesInPeriod} покупок / ${registrantsInPeriod} регистр.`
                      : "Покупки в периоде / регистрации в периоде"}
                </p>
              </div>
              {payingShareMismatchHint ? (
                <p style={{ fontSize: 11, opacity: 0.62, margin: "0 0 12px", lineHeight: 1.45, paddingLeft: 14 }}>{payingShareMismatchHint}</p>
              ) : null}
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", fontSize: 12, paddingTop: 12, borderTop: "1px solid rgba(255,255,255,0.08)" }}>
                <span style={{ opacity: 0.5, display: "flex", alignItems: "center" }}>
                  LTV (накоп.)
                  <HelpTooltip content={<><strong>LTV по кривой</strong><br />Берётся с графика ниже для выбранной когорты — накопленная выручка на клиента к D90 или к концу периода, если так показано на графике. Это не то же самое, что «доля платящих» слева.</>} />
                </span>
                <span style={{ fontWeight: 500 }}>{ltvCum > 0 ? fmtMoney(ltvCum) : "—"}</span>
              </div>
            </div>
          </div>
        </div>
      </section>

      <section style={{ marginBottom: 32 }}>
        <div style={{ display: "grid", gridTemplateColumns: "1.35fr 1fr", gap: 20 }}>
          <div style={{ ...revenueCardStyle, minHeight: 240 }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 24 }}>
              <div>
                <p style={{ ...metricLabelStyle, margin: 0, display: "flex", alignItems: "center" }}>Revenue composition<HelpTooltip content={<><strong>Состав выручки</strong><br />Как распределилась выручка в датах из шапки: первая покупка клиента, обычные повторы и оплаты, пришедшие с рекламы на удержание.</>} /></p>
                <p style={{ fontSize: 11, opacity: 0.55, margin: "2px 0 0" }}>Период: {boardRangeLabel}</p>
              </div>
              <div style={{ textAlign: "right" }}>
                <p style={{ fontSize: 11, opacity: 0.5, margin: 0 }}>First: {fmtMoney(firstRevenue)}</p>
                <p style={{ fontSize: 11, opacity: 0.5, margin: "2px 0 0" }}>Repeat: {fmtMoney(repeatRevenueExcludingRetention)}</p>
                <p style={{ fontSize: 11, opacity: 0.5, margin: "2px 0 0" }}>Retention campaign: {fmtMoney(retentionRevenue)}</p>
              </div>
            </div>
            <div style={{ marginBottom: 16, position: "relative" }}>
              <div style={{ display: "flex", height: 32, borderRadius: 6, overflow: "hidden", gap: 2 }}>
                <div
                  className="revenue-segment"
                  style={{
                    flex: revenueMi > 0 ? firstRevShare : 1 / 3,
                    background: "linear-gradient(90deg, #2f8f66, #35a874)",
                    minWidth: firstRevShare > 1e-4 ? 8 : 0,
                    display: revenueMi > 0 && firstRevShare <= 1e-4 ? "none" : undefined,
                    cursor: "pointer",
                    transition: "filter 0.2s ease, box-shadow 0.2s ease, transform 0.2s ease",
                    filter: revenueSegmentHover === 0 ? "brightness(1.15)" : undefined,
                    boxShadow: revenueSegmentHover === 0 ? "0 0 12px rgba(47,143,102,0.25)" : "0 0 12px rgba(47,143,102,0.25)",
                    transform: revenueSegmentHover === 0 ? "scaleY(1.03)" : undefined,
                  }}
                  onMouseEnter={() => setRevenueSegmentHover(0)}
                  onMouseLeave={() => setRevenueSegmentHover(null)}
                />
                <div
                  className="revenue-segment"
                  style={{
                    flex: revenueMi > 0 ? repeatExclShare : 1 / 3,
                    background: "linear-gradient(90deg, #3a5fa8, #4672c9)",
                    minWidth: repeatExclShare > 1e-4 ? 8 : 0,
                    display: revenueMi > 0 && repeatExclShare <= 1e-4 ? "none" : undefined,
                    cursor: "pointer",
                    transition: "filter 0.2s ease, box-shadow 0.2s ease, transform 0.2s ease",
                    filter: revenueSegmentHover === 1 ? "brightness(1.15)" : undefined,
                    boxShadow: revenueSegmentHover === 1 ? "0 0 12px rgba(58,95,168,0.25)" : "0 0 12px rgba(58,95,168,0.25)",
                    transform: revenueSegmentHover === 1 ? "scaleY(1.03)" : undefined,
                  }}
                  onMouseEnter={() => setRevenueSegmentHover(1)}
                  onMouseLeave={() => setRevenueSegmentHover(null)}
                />
                <div
                  className="revenue-segment"
                  style={{
                    flex: revenueMi > 0 ? retentionCampaignShare : 1 / 3,
                    background: "linear-gradient(90deg, #5a3a7a, #6f4aa1)",
                    minWidth: retentionCampaignShare > 1e-4 ? 8 : 0,
                    display: revenueMi > 0 && retentionCampaignShare <= 1e-4 ? "none" : undefined,
                    cursor: "pointer",
                    transition: "filter 0.2s ease, box-shadow 0.2s ease, transform 0.2s ease",
                    filter: revenueSegmentHover === 2 ? "brightness(1.15)" : undefined,
                    boxShadow: revenueSegmentHover === 2 ? "0 0 12px rgba(90,58,122,0.25)" : "0 0 12px rgba(90,58,122,0.25)",
                    transform: revenueSegmentHover === 2 ? "scaleY(1.03)" : undefined,
                  }}
                  onMouseEnter={() => setRevenueSegmentHover(2)}
                  onMouseLeave={() => setRevenueSegmentHover(null)}
                />
              </div>
              {revenueSegmentHover !== null && (
                <div
                  style={{
                    position: "absolute",
                    left: "50%",
                    bottom: "100%",
                    transform: "translate(-50%, -8px)",
                    marginBottom: 6,
                    background: "rgba(17,18,22,0.98)",
                    border: "1px solid rgba(255,255,255,0.08)",
                    borderRadius: 14,
                    padding: "14px 16px",
                    fontSize: 13,
                    lineHeight: 1.4,
                    boxShadow: "0 16px 40px rgba(0,0,0,0.5)",
                    zIndex: 10,
                    minWidth: 180,
                  }}
                >
                  <div style={{ fontWeight: 600, marginBottom: 6, color: "rgba(255,255,255,0.95)" }}>
                    {revenueSegmentHover === 0 ? "First revenue" : revenueSegmentHover === 1 ? "Repeat revenue" : "Retention campaign revenue"}
                  </div>
                  <div style={{ fontWeight: 500, marginBottom: 4 }}>
                    {revenueSegmentHover === 0 ? fmtMoney(firstRevenue) : revenueSegmentHover === 1 ? fmtMoney(repeatRevenueExcludingRetention) : fmtMoney(retentionRevenue)}
                  </div>
                  <div style={{ opacity: 0.7, fontSize: 12, marginBottom: 4 }}>
                    {revenueSegmentHover === 0 ? safePct(firstRevShare * 100) : revenueSegmentHover === 1 ? safePct(repeatExclShare * 100) : safePct(retentionCampaignShare * 100)} of total
                  </div>
                  <div style={{ opacity: 0.6, fontSize: 11 }}>
                    {revenueSegmentHover === 0
                      ? "Выручка по покупкам, засчитанным как первая для пользователя, в периоде отчёта."
                      : revenueSegmentHover === 1
                        ? "Повторные оплаты, не отнесённые к рекламе на удержание."
                        : "Оплаты, которые система отнесла к retention-рекламе."}
                  </div>
                </div>
              )}
              <div style={{ display: "flex", flexWrap: "wrap", gap: "16px 24px", marginTop: 12 }}>
                <div style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 11, opacity: 0.6 }}>
                  <span style={{ width: 8, height: 8, borderRadius: 2, background: "rgba(16,185,129,0.5)" }} /> First
                </div>
                <div style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 11, opacity: 0.6 }}>
                  <span style={{ width: 8, height: 8, borderRadius: 2, background: "rgba(59,130,246,0.5)" }} /> Repeat
                </div>
                <div style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 11, opacity: 0.6 }}>
                  <span style={{ width: 8, height: 8, borderRadius: 2, background: "rgba(168,85,247,0.5)" }} /> Retention
                  <HelpTooltip content={<><strong>Удержание (реклама)</strong><br />Выручка с оплат, которые пришли с кампаний на удержание. Не путать с процентом «остались в M0» в таблице когорт.</>} />
                </div>
              </div>
            </div>
            <div style={{ paddingTop: 12, borderTop: "1px solid rgba(255,255,255,0.05)", display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12, fontSize: 12 }}>
              <div style={{ display: "flex", justifyContent: "space-between" }}>
                <span style={{ opacity: 0.5 }}>First</span>
                <span>{safePct(firstRevShare * 100)}</span>
              </div>
              <div style={{ display: "flex", justifyContent: "space-between" }}>
                <span style={{ opacity: 0.5 }}>Repeat</span>
                <span>{safePct(repeatExclShare * 100)}</span>
              </div>
              <div style={{ display: "flex", justifyContent: "space-between" }}>
                <span style={{ opacity: 0.5 }}>Retention campaign</span>
                <span>{safePct(retentionCampaignShare * 100)}</span>
              </div>
            </div>
            <div style={{ marginTop: 12, display: "flex", justifyContent: "space-between", fontSize: 12 }}>
              <span style={{ opacity: 0.5 }}>Retention campaign users</span>
              <strong>{safePct(retentionUserRate != null ? retentionUserRate * 100 : null)}</strong>
            </div>
            <div style={{ marginTop: 6, display: "flex", justifyContent: "space-between", fontSize: 12 }}>
              <span style={{ opacity: 0.5 }}>Revenue MoM</span>
              <strong>{revenueMoM != null && Number.isFinite(revenueMoM) ? (revenueMoM * 100).toFixed(1).replace(".", ",") + "%" : "—"}</strong>
            </div>
          </div>
          <div style={{ ...cardStyle, minHeight: 240, display: "flex", flexDirection: "column", justifyContent: "space-between" }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start" }}>
              <div>
                <p style={{ ...metricLabelStyle, margin: 0, display: "flex", alignItems: "center" }}>LTV × users<HelpTooltip content={<><strong>LTV × пользователи</strong><br />LTV с графика умножается на размер когорты (или на число покупателей в периоде, если когорта не выбрана). Это оценка «денег когорты», а не просто сумма выручки за месяц.</>} /></p>
                <div style={{ ...kpiLargeStyle, marginTop: 4 }}>{fmtMoney(ltvXUsers)}</div>
              </div>
              <span style={{ padding: "4px 8px", borderRadius: 4, background: "rgba(255,255,255,0.05)", fontSize: 11, fontWeight: 700, textTransform: "uppercase", opacity: 0.55 }}>Live Sync</span>
            </div>
            <div style={{ marginTop: 24 }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", fontSize: 12, paddingBottom: 8, borderBottom: "1px solid rgba(255,255,255,0.05)", marginBottom: 8 }}>
                <span style={{ opacity: 0.55, fontSize: 11, fontWeight: 700, textTransform: "uppercase" }}>Revenue</span>
                <span style={{ fontWeight: 500 }}>{fmtMoney(revenueMi)}</span>
              </div>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", fontSize: 12, paddingBottom: 8, borderBottom: "1px solid rgba(255,255,255,0.05)", marginBottom: 8 }}>
                <span style={{ opacity: 0.55, fontSize: 11, fontWeight: 700, textTransform: "uppercase", display: "flex", alignItems: "center" }}>ARPU<HelpTooltip content={<><strong>ARPU</strong><br />Средняя выручка на одного покупателя в выбранном периоде. Считается по тем, кто реально платил в этих датах — это может отличаться от числа «пользователей» в карточке слева.</>} /></span>
                <span style={{ fontWeight: 500 }}>{arpuMi > 0 ? fmtMoney(arpuMi) : "—"}</span>
              </div>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", fontSize: 12 }}>
                <span style={{ opacity: 0.55, fontSize: 11, fontWeight: 700, textTransform: "uppercase", display: "flex", alignItems: "center" }}>
                  Unique purchasers
                  <HelpTooltip content={<><strong>Уникальные покупатели</strong><br />Сколько разных людей сделали хотя бы одну покупку в выбранных датах (с учётом канала). Нужны для расчёта ARPU.</>} />
                </span>
                <span style={{ fontWeight: 500 }}>{uniquePurchasers}</span>
              </div>
            </div>
          </div>
        </div>
      </section>

      <section style={{ marginBottom: 32 }}>
        <div style={{ display: "grid", gridTemplateColumns: "0.9fr 1.1fr 1.2fr", gap: 20, alignItems: "stretch" }}>
          <div style={{ ...cardStyle, minHeight: 220, height: "100%", display: "flex", flexDirection: "column", gap: 24, boxSizing: "border-box" as const }}>
            <p style={{ ...metricLabelStyle, margin: 0, display: "flex", alignItems: "center" }}>CPR<HelpTooltip content={<><strong>CPR — стоимость повторной продажи</strong><br /><strong>План:</strong> плановый бюджет на повторные продажи делим на запланированное их количество (как в помесячном плане). Месяц плана совпадает с когортой, если она выбрана.<br /><strong>Факт:</strong> расход по кампаниям, которые мы отнесли к удержанию по ссылке в объявлении (та же пометка, что в конструкторе ссылок), делим на число оплат с пометкой удержания.</>} /></p>
            <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-end", paddingBottom: 16, borderBottom: "1px solid rgba(255,255,255,0.08)" }}>
                <span style={{ fontSize: 12, opacity: 0.5 }}>CPR (plan)</span>
                <span style={{ fontSize: 18, fontWeight: 500 }}>{cpr != null && Number.isFinite(cpr) ? fmtMoney(cpr) : "—"}</span>
              </div>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-end" }}>
                <span style={{ fontSize: 12, opacity: 0.5 }}>CPR (actual)</span>
                <span style={{ fontSize: 18, fontWeight: 500 }}>{cprActual != null && Number.isFinite(cprActual) ? fmtMoney(cprActual) : "—"}</span>
              </div>
            </div>
            <div style={{ flex: 1, minHeight: 12 }} />
            <p style={{ fontSize: 11, opacity: 0.55, lineHeight: 1.5, margin: 0 }}>
              Плановый CPR из месячного плана{planMonthLabel ? ` (${planMonthLabel}` : ""}
              {planSourceHintRu ? ` · ${planSourceHintRu}` : ""}
              {planMonthLabel ? ")" : ""}: сколько в среднем заложено на одну повторную продажу (бюджет на повторы делим на их плановое число).
            </p>
          </div>

          <div style={{ ...unitEconomicsCardStyle, minHeight: 220, height: "100%", display: "flex", flexDirection: "column", boxSizing: "border-box" as const }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 16 }}>
              <p style={{ ...metricLabelStyle, margin: 0 }}>Unit Economics</p>
              <span style={{ fontSize: 11, opacity: 0.55 }}>{cohortMonth ? formatCohortLabel(cohortMonth) : "—"}</span>
            </div>
            <p style={{ fontSize: 10, opacity: 0.45, margin: "0 0 10px", lineHeight: 1.4 }}>
              Расходы и CAC — за окно {boardRangeLabel}
              {kpiWindowFullCohortMonth ? " (полный месяц когорты)" : kpiWindowCohortScoped ? " (часть месяца когорты)" : ""}; LTV в блоке —
              с кривой когорты (см. подсказку у LTV).
            </p>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 24, flex: 1, alignContent: "start" }}>
              <div>
                <p style={{ ...sectionLabel, borderBottom: "1px solid rgba(255,255,255,0.05)", paddingBottom: 4, marginBottom: 8 }}>Costs</p>
                <div style={{ display: "flex", flexDirection: "column", gap: 8, fontSize: 12 }}>
                  <div style={{ display: "flex", justifyContent: "space-between" }}>
                    <span style={{ opacity: 0.6 }}>ACQ CAC</span>
                    <span>{cacAcquisition != null && Number.isFinite(cacAcquisition) ? fmtMoney(cacAcquisition) : "—"}</span>
                  </div>
                  <div style={{ display: "flex", justifyContent: "space-between" }}>
                    <span style={{ opacity: 0.6 }}>RET Cost</span>
                    <span>{retentionCost != null && Number.isFinite(retentionCost) ? fmtMoney(retentionCost) : "—"}</span>
                  </div>
                  <div style={{ display: "flex", justifyContent: "space-between", fontWeight: 700, paddingTop: 8, borderTop: "1px solid rgba(255,255,255,0.05)" }}>
                    <span style={{ opacity: 0.9, display: "flex", alignItems: "center" }}>
                      True CAC
                      <HelpTooltip content={<><strong>True CAC — полная стоимость клиента (оценка)</strong><br />Складывается из стоимости привлечения (расход на рекламу привлечения на одну первую покупку) и доли расходов на удержание на «повторного» покупателя. Упрощённая модель для сравнения с LTV.</>} />
                    </span>
                    <span>{trueCac != null && Number.isFinite(trueCac) ? fmtMoney(trueCac) : "—"}</span>
                  </div>
                </div>
              </div>
              <div>
                <p style={{ ...sectionLabel, borderBottom: "1px solid rgba(255,255,255,0.05)", paddingBottom: 4, marginBottom: 8 }}>Profit</p>
                <div style={{ display: "flex", flexDirection: "column", gap: 8, fontSize: 12 }}>
                  <div style={{ display: "flex", justifyContent: "space-between" }}>
                    <span style={{ opacity: 0.6, display: "flex", alignItems: "center" }}>
                      {realizedLtvCurve ? "LTV (к end)" : "LTV D90"}
                      <HelpTooltip
                        content={
                          realizedLtvCurve ? (
                            <>
                              <strong>LTV к концу периода</strong>
                              <br />
                              Средняя выручка на клиента когорты от первой оплаты до конца выбранных дат. Так показывают, когда классические 90 дней после первой покупки ещё «пустые», а деньги уже есть позже.
                            </>
                          ) : (
                            <>
                              <strong>LTV за 90 дней</strong>
                              <br />
                              Сколько в среднем принёс клиент за первые 90 дней после первой оплаты.
                            </>
                          )
                        }
                      />
                    </span>
                    <span>{Number.isFinite(ltv) ? fmtMoney(ltv) : "—"}</span>
                  </div>
                  <div style={{ display: "flex", justifyContent: "space-between", fontWeight: 700 }}>
                    <span style={{ opacity: 0.9 }}>Profit</span>
                    <span style={{ color: unitProfit != null && Number.isFinite(unitProfit) ? (unitProfit > 0 ? "rgb(16,185,129)" : "rgb(239,68,68)") : undefined }}>
                      {unitProfit != null && Number.isFinite(unitProfit) ? (unitProfit >= 0 ? "+" : "") + fmtMoney(unitProfit) : "—"}
                    </span>
                  </div>
                  <div style={{ display: "flex", justifyContent: "space-between", paddingTop: 8, borderTop: "1px solid rgba(255,255,255,0.05)" }}>
                    <span style={{ opacity: 0.6, display: "flex", alignItems: "center" }}>LTV/CAC<HelpTooltip content={<><strong>LTV / CAC</strong><br />Сколько выручки с клиента приходит на каждый потраченный на него условный «доллар» полной стоимости (True CAC). Ориентир: выше 3 часто считают устойчивой экономикой.</>} /></span>
                    <span>{ltvCacRatio != null && Number.isFinite(ltvCacRatio) ? ltvCacRatio.toFixed(2).replace(".", ",") + "x" : "—"}</span>
                  </div>
                </div>
              </div>
            </div>
            <div style={{ flex: 1, minHeight: 12 }} />
          </div>

          <div style={{ ...cardStyle, minHeight: 220, height: "100%", display: "flex", flexDirection: "column", gap: 16, boxSizing: "border-box" as const }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
              <p style={{ ...metricLabelStyle, margin: 0, display: "flex", alignItems: "center" }}>Retention Economics<HelpTooltip content={<><strong>Экономика удержания</strong><br />Сравниваем, что заложено в плане на месяц (первые и повторные продажи, бюджеты), с тем, что произошло за выбранные даты отчёта. Ниже — факт по рекламе на удержание, отклонение от плана, окупаемость и стоимость повторной продажи (CPR).</>} /></p>
              <span style={{ fontSize: 11, padding: "2px 8px", borderRadius: 999, background: "rgba(255,255,255,0.05)", opacity: 0.55 }}>Budget</span>
            </div>
            <div style={{ fontSize: 10, opacity: 0.48, marginBottom: 8, lineHeight: 1.4 }}>
              {planMonthLabel ? (
                <>
                  План: <strong style={{ opacity: 0.85 }}>{planMonthLabel}</strong>
                  {planSourceHintRu ? ` · ${planSourceHintRu}` : ""}
                  {!monthlyPlanRowFound ? " — для этого месяца план не заполнен в настройках проекта." : null}
                </>
              ) : (
                "Месяц для плана не определён (проверьте даты отчёта)."
              )}
            </div>
            <div style={{ display: "flex", flexDirection: "column", gap: 6, fontSize: 12 }}>
              <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                <button
                  type="button"
                  aria-expanded={retentionPlanAccordion === "primary"}
                  onClick={() => setRetentionPlanAccordion((prev) => (prev === "primary" ? null : "primary"))}
                  style={{
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "space-between",
                    width: "100%",
                    padding: "8px 10px",
                    border: "none",
                    borderRadius: 8,
                    background: "rgba(255,255,255,0.05)",
                    cursor: "pointer",
                    fontSize: 12,
                    fontWeight: 500,
                    color: "inherit",
                    textAlign: "left",
                  }}
                >
                  <span>Первичные продажи</span>
                  <span style={{ opacity: 0.45, fontSize: 10, transform: retentionPlanAccordion === "primary" ? "rotate(0deg)" : "rotate(-90deg)", transition: "transform 0.15s ease" }} aria-hidden>
                    ▼
                  </span>
                </button>
                {retentionPlanAccordion === "primary" && (
                  <div style={{ display: "flex", flexDirection: "column", gap: 6, padding: "4px 4px 8px 12px" }}>
                    <p style={{ fontSize: 10, fontWeight: 600, opacity: 0.42, letterSpacing: "0.05em", textTransform: "uppercase", margin: "4px 0 2px" }}>План</p>
                    <div style={{ display: "flex", justifyContent: "space-between" }}>
                      <span style={{ opacity: 0.5 }}>Объём, шт.</span>
                      <span>{planSalesPlanCount != null && Number.isFinite(planSalesPlanCount) ? planSalesPlanCount.toLocaleString("ru-RU") : "—"}</span>
                    </div>
                    <div style={{ display: "flex", justifyContent: "space-between" }}>
                      <span style={{ opacity: 0.5 }}>Бюджет привлечения</span>
                      <span>{planSalesPlanBudget != null && Number.isFinite(planSalesPlanBudget) ? fmtMoney(planSalesPlanBudget) : "—"}</span>
                    </div>
                    <div style={{ display: "flex", justifyContent: "space-between" }}>
                      <span style={{ opacity: 0.5 }}>CAC привлечения</span>
                      <span>{planCac != null && Number.isFinite(planCac) ? fmtMoney(planCac) : "—"}</span>
                    </div>
                    <p style={{ fontSize: 10, fontWeight: 600, opacity: 0.42, letterSpacing: "0.05em", textTransform: "uppercase", margin: "10px 0 2px" }}>
                      {useCohortPlanFact ? "Факт · когорта плана" : "Факт · период отчёта"}
                    </p>
                    <div style={{ display: "flex", justifyContent: "space-between" }}>
                      <span style={{ opacity: 0.5 }}>{useCohortPlanFact ? "Когорта (1-я оплата в месяце плана), чел." : "Покупок (first) в периоде, шт."}</span>
                      <span>{primaryFactCount.toLocaleString("ru-RU")}</span>
                    </div>
                    <div style={{ display: "flex", justifyContent: "space-between" }}>
                      <span style={{ opacity: 0.5 }}>Расход на привлечение</span>
                      <span>{Number.isFinite(acquisitionSpend) ? fmtMoney(acquisitionSpend) : "—"}</span>
                    </div>
                    <div style={{ display: "flex", justifyContent: "space-between" }}>
                      <span style={{ opacity: 0.5 }}>{useCohortPlanFact ? "Выручка с первых оплат когорты" : "Выручка (первичные в периоде)"}</span>
                      <span>{fmtMoney(primaryFactRevenue)}</span>
                    </div>
                    <div style={{ display: "flex", justifyContent: "space-between" }}>
                      <span style={{ opacity: 0.5 }}>Фактический CAC (ACQ)</span>
                      <span>{primaryFactCac != null && Number.isFinite(primaryFactCac) ? fmtMoney(primaryFactCac) : "—"}</span>
                    </div>
                    {useCohortPlanFact && kpiWindowCohortScoped ? (
                      <p style={{ fontSize: 10, opacity: 0.38, lineHeight: 1.35, margin: "4px 0 0" }}>
                        {kpiWindowFullCohortMonth
                          ? `Расход и CAC — за полный месяц когорты (${boardRangeLabel}).`
                          : `Расход и CAC — за даты ${boardRangeLabel} (не весь календарный месяц когорты, если период отчёта короче).`}
                      </p>
                    ) : null}
                  </div>
                )}
                <button
                  type="button"
                  aria-expanded={retentionPlanAccordion === "repeat"}
                  onClick={() => setRetentionPlanAccordion((prev) => (prev === "repeat" ? null : "repeat"))}
                  style={{
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "space-between",
                    width: "100%",
                    padding: "8px 10px",
                    border: "none",
                    borderRadius: 8,
                    background: "rgba(255,255,255,0.05)",
                    cursor: "pointer",
                    fontSize: 12,
                    fontWeight: 500,
                    color: "inherit",
                    textAlign: "left",
                  }}
                >
                  <span>Повторные продажи</span>
                  <span style={{ opacity: 0.45, fontSize: 10, transform: retentionPlanAccordion === "repeat" ? "rotate(0deg)" : "rotate(-90deg)", transition: "transform 0.15s ease" }} aria-hidden>
                    ▼
                  </span>
                </button>
                {retentionPlanAccordion === "repeat" && (
                  <div style={{ display: "flex", flexDirection: "column", gap: 6, padding: "4px 4px 8px 12px" }}>
                    <p style={{ fontSize: 10, fontWeight: 600, opacity: 0.42, letterSpacing: "0.05em", textTransform: "uppercase", margin: "4px 0 2px" }}>План</p>
                    <div style={{ display: "flex", justifyContent: "space-between" }}>
                      <span style={{ opacity: 0.5 }}>Объём repeat, шт.</span>
                      <span>{planRepeatSalesCount != null && Number.isFinite(planRepeatSalesCount) ? planRepeatSalesCount.toLocaleString("ru-RU") : "—"}</span>
                    </div>
                    <div style={{ display: "flex", justifyContent: "space-between" }}>
                      <span style={{ opacity: 0.5 }}>Бюджет repeat (план)</span>
                      <span>{budgetForRepeatSales != null && Number.isFinite(budgetForRepeatSales) ? fmtMoney(budgetForRepeatSales) : "—"}</span>
                    </div>
                    <div style={{ display: "flex", justifyContent: "space-between" }}>
                      <span style={{ opacity: 0.5 }}>CPR (план)</span>
                      <span>{cpr != null && Number.isFinite(cpr) ? fmtMoney(cpr) : "—"}</span>
                    </div>
                    <p style={{ fontSize: 10, fontWeight: 600, opacity: 0.42, letterSpacing: "0.05em", textTransform: "uppercase", margin: "10px 0 2px" }}>
                      {useCohortPlanFact ? "Факт · когорта и период" : "Факт · период отчёта"}
                    </p>
                    <div style={{ display: "flex", justifyContent: "space-between" }}>
                      <span style={{ opacity: 0.5 }}>{useCohortPlanFact ? "Покупок repeat (когорта, в периоде)" : "Покупок (repeat), шт."}</span>
                      <span>{repeatFactCount.toLocaleString("ru-RU")}</span>
                    </div>
                    <div style={{ display: "flex", justifyContent: "space-between" }}>
                      <span style={{ opacity: 0.5 }}>{useCohortPlanFact ? "Выручка repeat (когорта, в периоде)" : "Выручка repeat"}</span>
                      <span>{fmtMoney(repeatFactRevenue)}</span>
                    </div>
                    <div style={{ display: "flex", justifyContent: "space-between" }}>
                      <span style={{ opacity: 0.5 }}>Расход retention (реклама)</span>
                      <span>{retentionSpend != null && Number.isFinite(retentionSpend) ? fmtMoney(retentionSpend) : "—"}</span>
                    </div>
                    <div style={{ display: "flex", justifyContent: "space-between" }}>
                      <span style={{ opacity: 0.5 }}>Покупок с retention intent</span>
                      <span>{retentionPurchasesCount.toLocaleString("ru-RU")}</span>
                    </div>
                    <div style={{ display: "flex", justifyContent: "space-between" }}>
                      <span style={{ opacity: 0.5 }}>Выручка retention-кампаний</span>
                      <span>{fmtMoney(retentionRevenue)}</span>
                    </div>
                    <div style={{ display: "flex", justifyContent: "space-between" }}>
                      <span style={{ opacity: 0.5 }}>CPR (факт)</span>
                      <span>{cprActual != null && Number.isFinite(cprActual) ? fmtMoney(cprActual) : "—"}</span>
                    </div>
                  </div>
                )}
              </div>
              <div style={{ display: "flex", flexDirection: "column", gap: 8, paddingTop: 8, borderTop: "1px solid rgba(255,255,255,0.08)" }}>
                <div style={{ display: "flex", justifyContent: "space-between" }}>
                  <span style={{ opacity: 0.5 }}>Плановая выручка</span>
                  <span>{plannedRevenueKpi != null && Number.isFinite(plannedRevenueKpi) ? fmtMoney(plannedRevenueKpi) : "—"}</span>
                </div>
                <div style={{ display: "flex", justifyContent: "space-between", fontWeight: 500 }}>
                  <span style={{ opacity: 0.5 }}>Actual spend</span>
                  <span>{retentionSpend != null && Number.isFinite(retentionSpend) ? fmtMoney(retentionSpend) : "—"}</span>
                </div>
                <div
                  style={{
                    display: "flex",
                    justifyContent: "space-between",
                    color:
                      difference == null
                        ? undefined
                        : difference > 0
                          ? "rgb(239,68,68)"
                          : difference < 0
                            ? "rgb(16,185,129)"
                            : undefined,
                  }}
                >
                  <span>Difference</span>
                  <span>{difference != null ? fmtMoney(difference) : "—"}</span>
                </div>
                <div style={{ display: "flex", justifyContent: "space-between" }}>
                  <span style={{ opacity: 0.5 }}>CPR (plan)</span>
                  <span>{cpr != null && Number.isFinite(cpr) ? fmtMoney(cpr) : "—"}</span>
                </div>
                <div style={{ display: "flex", justifyContent: "space-between" }}>
                  <span style={{ opacity: 0.5 }}>CPR (actual)</span>
                  <span>{cprActual != null && Number.isFinite(cprActual) ? fmtMoney(cprActual) : "—"}</span>
                </div>
                <div style={{ display: "flex", justifyContent: "space-between" }}>
                  <span style={{ opacity: 0.5 }}>Retention campaign ROAS</span>
                  <span>{retentionRoas != null && Number.isFinite(retentionRoas) ? safeRoas(retentionRoas) : "—"}</span>
                </div>
              </div>
            </div>
            <div style={{ marginTop: 4 }}>
              <div style={progressThinStyle}>
                <div
                  style={{
                    height: "100%",
                    width: progressValue != null ? `${Math.min(100, progressValue * 100)}%` : "0%",
                    borderRadius: 2,
                    background:
                      progressValue == null ? "rgba(255,255,255,0.08)" : progressValue > 1 ? "rgba(239,68,68,0.4)" : progressValue >= 0.8 ? "rgba(245,158,11,0.5)" : "rgba(255,255,255,0.2)",
                  }}
                />
              </div>
              <p style={{ fontSize: 11, opacity: 0.5, margin: "6px 0 0", lineHeight: 1.3 }}>
                Сравниваем плановый бюджет на рекламу удержания с фактическими расходами за период отчёта; план берётся из настроек проекта на месяц когорты (если заполнен).
              </p>
            </div>
            {insights.length > 0 && (
              <div style={{ marginTop: 12, paddingTop: 12, borderTop: "1px solid rgba(255,255,255,0.08)" }}>
                {insights.slice(0, 3).map((text, i) => (
                  <div key={i} style={{ display: "flex", alignItems: "flex-start", gap: 8, fontSize: 11, marginBottom: i < 2 ? 6 : 0, lineHeight: 1.4 }}>
                    <span style={{ width: 6, height: 6, borderRadius: "50%", background: "rgb(16,185,129)", marginTop: 5, flexShrink: 0 }} />
                    <span style={{ opacity: 0.9 }}>{text}</span>
                  </div>
                ))}
              </div>
            )}
            {isDemoLtv && (
              <span style={{ ...demoBadgeStyle, marginTop: "auto", marginLeft: 0 }}>Demo Data</span>
            )}
          </div>
        </div>
      </section>

      <section style={{ marginBottom: 32 }}>
        <div style={{ ...customCardStyle, padding: "20px 20px 24px" }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", flexWrap: "wrap", gap: 12, marginBottom: 24 }}>
            <div>
              <div style={{ display: "flex", alignItems: "center", flexWrap: "wrap", gap: 8 }}>
                <h3 style={{ fontSize: 14, fontWeight: 600, margin: 0 }}>LTV Dynamics</h3>
                {showDemoBadgeInHeader && <span style={{ ...demoBadgeStyle, marginLeft: 0 }}>Demo Data</span>}
              </div>
              <p style={{ fontSize: 11, opacity: 0.55, margin: "4px 0 0" }}>Когорта (1-я оплата): {cohortMonth ? formatCohortLabel(cohortMonth) : "—"}</p>
              {realizedLtvCurve && (
                <p style={{ fontSize: 11, opacity: 0.5, margin: "6px 0 0", lineHeight: 1.45, maxWidth: 520 }}>
                  Показана средняя выручка на пользователя когорты с момента первой покупки до конца периода отчёта (плоская
                  линия): классический LTV за первые 90 дней после первой покупки для этой когорты = 0, т.к. события в отчёте
                  произошли позже.
                </p>
              )}
            </div>
            <div style={{ display: "flex", gap: 16 }}>
              <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                <span style={{ width: 12, height: 2, background: "rgb(16,185,129)", borderRadius: 1 }} />
                <span style={{ fontSize: 11, opacity: 0.6 }}>LTV</span>
              </div>
              <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                <span style={{ width: 12, height: 2, background: "rgb(96,165,250)", borderRadius: 1 }} />
                <span style={{ fontSize: 11, opacity: 0.6 }}>ARPU</span>
              </div>
            </div>
          </div>
          <p style={{ fontSize: 10, opacity: 0.45, margin: "0 0 16px", lineHeight: 1.4, maxWidth: 720 }}>
            Накопительные LTV и ARPU по дням после первой оплаты; для поздних D покупки могут браться после даты end отчёта (см. шапку страницы).
          </p>
          <LtvChart
            data={effectiveLineData.length ? effectiveLineData : [{ day: "D1", ltv: 0, arpu: 0 }]}
            cohortLabel={cohortMonth ? formatCohortLabel(cohortMonth) : "—"}
            isDemo={isDemoLtv}
            formatMoney={fmtMoney}
          />
        </div>
      </section>

      <section style={{ marginBottom: 32 }}>
        <div style={{ ...customCardStyle, overflow: "hidden", padding: 0 }}>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", borderBottom: "1px solid rgba(255,255,255,0.08)" }}>
            <div style={{ padding: 16, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", textAlign: "center", borderRight: "1px solid rgba(255,255,255,0.08)" }}>
              <p style={{ fontSize: 11, opacity: 0.55, fontWeight: 700, textTransform: "uppercase", margin: "0 0 4px" }}>True CAC</p>
              <p style={{ fontSize: 20, fontWeight: 600, margin: 0 }}>{trueCac != null && Number.isFinite(trueCac) ? fmtMoney(trueCac) : "—"}</p>
            </div>
            <div style={{ padding: 16, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", textAlign: "center", borderRight: "1px solid rgba(255,255,255,0.08)" }}>
              <p style={{ fontSize: 11, opacity: 0.55, fontWeight: 700, textTransform: "uppercase", margin: "0 0 4px" }}>
                {realizedLtvCurve ? "LTV (к end периода)" : "LTV (накоп., D90)"}
              </p>
              <p style={{ fontSize: 20, fontWeight: 600, margin: 0 }}>{Number.isFinite(ltv) ? fmtMoney(ltv) : "—"}</p>
            </div>
            <div style={{ padding: 16, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", textAlign: "center", background: "rgba(255,255,255,0.02)" }}>
              <p style={{ fontSize: 11, opacity: 0.55, fontWeight: 700, textTransform: "uppercase", margin: "0 0 4px", display: "flex", alignItems: "center", justifyContent: "center", gap: 4 }}>Break-even point<HelpTooltip content={<><strong>Окупаемость</strong><br />Первый день на графике LTV, когда накопленная выручка на клиента сравнялась с полной стоимостью привлечения (True CAC).</>} /></p>
              <p style={{ fontSize: 13, fontWeight: 500, margin: 0, fontStyle: "italic", color: breakEvenPoint ? "rgb(16,185,129)" : undefined }}>
                {breakEvenPoint
                  ? `${breakEvenPoint} (${breakEvenPoint === "D7" ? "1 week" : breakEvenPoint === "D14" ? "2 weeks" : breakEvenPoint === "D30" ? "1 month" : breakEvenPoint === "D60" ? "2 months" : breakEvenPoint === "D90" ? "3 months" : breakEvenPoint})`
                  : "Не достигнут на горизонте кривой (D90)"}
              </p>
            </div>
          </div>
        </div>
      </section>

      <section style={{ marginBottom: 32 }}>
        <div style={{ display: "flex", flexDirection: "column", gap: 4, marginBottom: 16 }}>
          <div style={{ display: "flex", alignItems: "center", flexWrap: "wrap", gap: 8 }}>
            <h3 style={{ fontSize: 14, fontWeight: 600, margin: 0, display: "flex", alignItems: "center" }}>Cohort Analysis<HelpTooltip content={<><strong>Когорты</strong><br />Строки — месяцы первой оплаты (с учётом канала). Колонки M0–M6 — следующие календарные месяцы жизни когорты. Для графика и выручки учитываются покупки и за пределами дат в шапке, чтобы кривая не обрывалась.</>} /></h3>
            {isDemoLtv && <span style={{ ...demoBadgeStyle, marginLeft: 0 }}>Demo Data</span>}
          </div>
          <p style={{ fontSize: 11, opacity: 0.55, margin: 0 }}>Выбранная когорта: {cohortMonth ? formatCohortLabel(cohortMonth) : "—"}</p>
        </div>
        {isDemoLtv && (
          <p style={{ fontSize: 12, color: "rgba(255,255,255,0.5)", margin: "0 0 12px", lineHeight: 1.4 }}>
            Недостаточно реальных данных когорт за период — показаны демо-ряды.
          </p>
        )}
        <div style={{ display: "flex", background: "rgba(255,255,255,0.05)", padding: 4, borderRadius: 8, width: "fit-content", marginBottom: 16 }}>
          <button style={pillStyle(metric === "money")} onClick={() => setMetric("money")} type="button">
            Выручка
          </button>
          <button style={pillStyle(metric === "users")} onClick={() => setMetric("users")} type="button">
            Пользователи
          </button>
          <button style={pillStyle(metric === "percent")} onClick={() => setMetric("percent")} type="button">
            Retention %
          </button>
        </div>
        {isCohortMoneyFallback && (
          <p style={{ fontSize: 13, color: "rgba(255,255,255,0.6)", margin: "0 0 16px", padding: 12, background: "rgba(255,255,255,0.04)", borderRadius: 8 }}>
            Нет данных по выручке когорт. Режим «Выручка» покажет данные, когда по когортам будет рассчитана выручка.
          </p>
        )}
        <CohortHeatmap
          rows={cohortRows}
          mode={metric}
          cohortLabel={cohortMonth ? formatCohortLabel(cohortMonth) : ""}
          isDemo={isDemoLtv}
          formatMoney={fmtMoney}
          retentionRows={effectiveApiCohortRows}
          usersRows={effectiveApiCohortRows.map((r) => ({
            cohort: r.cohort,
            values: r.values.map((p) => Math.round((p / 100) * (effectiveCohortSizes[r.cohort] ?? 0))),
          }))}
          revenueRows={effectiveApiCohortRevenueRows}
        />
      </section>
    </div>
  );
}
