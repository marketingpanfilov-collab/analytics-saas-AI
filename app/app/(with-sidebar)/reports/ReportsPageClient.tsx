"use client";

import { usePathname, useRouter, useSearchParams } from "next/navigation";
import {
  useEffect,
  useState,
  useCallback,
  useMemo,
  useLayoutEffect,
  useRef,
  type MouseEvent as ReactMouseEvent,
  type ReactNode,
} from "react";
import { createPortal } from "react-dom";
import HelpTooltip from "../../components/HelpTooltip";
import {
  REPORT_HELP_CAMPAIGN_SCORE_CARD,
  REPORT_HELP_CAMPAIGNS_TABLE,
  REPORT_HELP_CAC_BLENDED,
  REPORT_HELP_CHANNEL_TABLE_CTR,
  REPORT_HELP_CHANNEL_TABLE_REVENUE,
  REPORT_HELP_CHANNEL_TABLE_ROAS,
  REPORT_HELP_CHANNELS_CARD,
  REPORT_HELP_CPR_RETENTION,
  REPORT_HELP_HERO_PURCHASES,
  REPORT_HELP_HERO_REVENUE,
  REPORT_HELP_HERO_ROAS,
  REPORT_HELP_HERO_SPEND,
  REPORT_HELP_REVENUE_DONUT,
  REPORT_HELP_TOUCHES,
  reportHelpNewBuyers,
  reportHelpRegistrationsUnique,
  reportHelpReturningBuyers,
} from "./reportHelpCopy";
import { getChannelInsight } from "./channelInsight";
import { ActionId } from "@/app/lib/billingUiContract";
import { billingActionAllowed } from "@/app/lib/billingBootstrapClient";
import { resolveReportsWidgetState } from "@/app/lib/billingWidgetState";
import { useBillingBootstrap } from "../../components/BillingBootstrapProvider";
import BillingWidgetPlaceholder from "../../components/BillingWidgetPlaceholder";
import { ignoreAbortRejection, isAbortError, safeAbortController } from "@/app/lib/abortUtils";
import { getSharedCached } from "@/app/lib/sharedDataCache";
import { parseDashboardRangeParams } from "@/app/lib/dashboardRangeParams";
import { supabase } from "@/app/lib/supabaseClient";
import {
  REPORT_OVERVIEW_VALUE_MIN_PX,
  REPORT_OVERVIEW_VALUE_START_PX,
  REPORT_PAGE_BG,
  reportCardStyle,
} from "./reportUiTokens";

type PlanMetrics = {
  plan_month: number;
  plan_year: number;
  monthly_budget: number | null;
  target_registrations: number | null;
  target_sales: number | null;
  target_roas: number | null;
  target_cac: number | null;
  fact_budget: number;
  fact_registrations: number;
  fact_unique_registrants: number;
  fact_sales: number;
  fact_revenue: number;
  fact_roas: number | null;
  fact_spend_acquisition_usd: number;
  fact_spend_retention_usd: number;
  fact_cac: number | null;
  fact_cpr: number | null;
};

type KpiMetrics = {
  cac: number | null;
  cac_blended: number | null;
  cpr: number | null;
  cpo: number | null;
  roas: number | null;
  conversion_rate: number | null;
  new_buyers: number;
  returning_buyers: number;
  average_touches_before_purchase: number | null;
};

type BudgetCoverage = {
  monthly_budget: number | null;
  active_campaign_budget: number;
  uncovered_budget: number | null;
  by_platform: { platform: string; spend: number; impressions: number; clicks: number }[];
};

type PlatformBudgetCoverage = {
  allocated_campaign_budget_month: number;
  plan_monthly_budget: number | null;
  budget_plan_coverage_pct: number | null;
  fact_slice_usd: number;
  fact_month_usd: number;
  spend_vs_allocated_slice_pct: number | null;
  spend_vs_allocated_month_pct: number | null;
  campaigns_with_budget: number;
  campaigns_total_in_project: number;
  coverage_period_start: string;
  coverage_period_end: string;
  month_coverage_start: string;
  month_coverage_end: string;
};

type CampaignAlert = {
  platform: string;
  campaign_name: string;
  campaign_id: string | null;
  problem_type: string;
  recommendation: string;
};

type CampaignRow = {
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

type ForecastMetrics = {
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

type MarketingScoreFactor = {
  label: string;
  score: number;
  weight: number;
};

type MarketingScoreDetail = {
  score: number | null;
  factors: MarketingScoreFactor[];
  skipped: string[];
};

type RevenueByAcquisitionRow = { source: string; revenue: number };

type DashboardSourceOption = { id: string; type: "platform" | "class"; label: string };

type MarketingReportChannelRow = {
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

type Summary = {
  plan: PlanMetrics;
  kpi: KpiMetrics;
  budget: BudgetCoverage;
  platform_budget: PlatformBudgetCoverage;
  campaign_alerts: CampaignAlert[];
  campaign_table: CampaignRow[];
  forecast?: ForecastMetrics | null;
  marketing_score: number | null;
  marketing_score_detail: MarketingScoreDetail | null;
  canonical_ad_row_count: number;
  revenue_by_acquisition_source: RevenueByAcquisitionRow[];
  source_options: DashboardSourceOption[];
  channel_summary: MarketingReportChannelRow[];
  /** Как на дашборде после ensureBackfill (исторические интервалы). */
  backfill?: {
    historical_sync_started?: boolean;
    range_partially_covered?: boolean;
    intervals?: { start: string; end: string }[];
  };
  backfill_status?: {
    triggered: boolean;
    reason: string | null;
    range_partially_covered: boolean;
    historical_sync_intervals: { start: string; end: string }[];
  };
};

function normalizeMarketingScoreDetail(raw: unknown, fallbackScore: unknown): MarketingScoreDetail | null {
  if (raw == null || typeof raw !== "object") return null;
  const o = raw as Record<string, unknown>;
  const factorsRaw = o.factors;
  const factors: MarketingScoreFactor[] = [];
  if (Array.isArray(factorsRaw)) {
    for (const x of factorsRaw) {
      if (x == null || typeof x !== "object") continue;
      const f = x as Record<string, unknown>;
      if (typeof f.label !== "string" || typeof f.score !== "number" || typeof f.weight !== "number") continue;
      factors.push({ label: f.label, score: f.score, weight: f.weight });
    }
  }
  const skippedRaw = o.skipped;
  const skipped =
    Array.isArray(skippedRaw) && skippedRaw.every((s) => typeof s === "string") ? (skippedRaw as string[]) : [];
  const sc = typeof o.score === "number" ? o.score : typeof fallbackScore === "number" ? fallbackScore : null;
  return { score: sc, factors, skipped };
}

function normalizeRevenueByAcquisition(raw: unknown): RevenueByAcquisitionRow[] {
  if (!Array.isArray(raw)) return [];
  const out: RevenueByAcquisitionRow[] = [];
  for (const x of raw) {
    if (x == null || typeof x !== "object") continue;
    const o = x as Record<string, unknown>;
    if (typeof o.source !== "string" || typeof o.revenue !== "number") continue;
    if (!Number.isFinite(o.revenue) || o.revenue <= 0) continue;
    out.push({ source: o.source, revenue: o.revenue });
  }
  return out.sort((a, b) => b.revenue - a.revenue);
}

function normalizeBudgetCoverage(raw: unknown): BudgetCoverage {
  const o = raw != null && typeof raw === "object" ? (raw as Record<string, unknown>) : {};
  const byRaw = o.by_platform;
  const by_platform: BudgetCoverage["by_platform"] = [];
  if (Array.isArray(byRaw)) {
    for (const x of byRaw) {
      if (x == null || typeof x !== "object") continue;
      const p = x as Record<string, unknown>;
      by_platform.push({
        platform: String(p.platform ?? ""),
        spend: Number(p.spend) || 0,
        impressions: Number(p.impressions) || 0,
        clicks: Number(p.clicks) || 0,
      });
    }
  }
  return {
    monthly_budget: typeof o.monthly_budget === "number" ? o.monthly_budget : null,
    active_campaign_budget: Number(o.active_campaign_budget) || 0,
    uncovered_budget: typeof o.uncovered_budget === "number" ? o.uncovered_budget : null,
    by_platform,
  };
}

function normalizeSourceOptions(raw: unknown): DashboardSourceOption[] {
  if (!Array.isArray(raw)) return [];
  const out: DashboardSourceOption[] = [];
  for (const x of raw) {
    if (x == null || typeof x !== "object") continue;
    const o = x as Record<string, unknown>;
    if (typeof o.id !== "string" || (o.type !== "platform" && o.type !== "class")) continue;
    out.push({ id: o.id, type: o.type, label: typeof o.label === "string" ? o.label : o.id });
  }
  return out;
}

function normalizeChannelSummary(raw: unknown): MarketingReportChannelRow[] {
  if (!Array.isArray(raw)) return [];
  const out: MarketingReportChannelRow[] = [];
  for (const x of raw) {
    if (x == null || typeof x !== "object") continue;
    const o = x as Record<string, unknown>;
    if (typeof o.id !== "string" || (o.type !== "platform" && o.type !== "class")) continue;
    out.push({
      id: o.id,
      type: o.type,
      label_ru: typeof o.label_ru === "string" ? o.label_ru : o.id,
      spend: typeof o.spend === "number" ? o.spend : null,
      impressions: typeof o.impressions === "number" ? o.impressions : null,
      clicks: typeof o.clicks === "number" ? o.clicks : null,
      revenue: typeof o.revenue === "number" ? o.revenue : null,
      share_spend_pct: typeof o.share_spend_pct === "number" ? o.share_spend_pct : null,
      roas: typeof o.roas === "number" ? o.roas : null,
    });
  }
  return out;
}

const COLOR_GREEN = "#22c55e";
const COLOR_RED = "#ef4444";
const COLOR_YELLOW = "#eab308";
const COLOR_TEXT = "rgba(255,255,255,0.9)";

/** Карточка «Оценка и здоровье кампаний» — временно скрыта; `true`, чтобы снова показать. */
const SHOW_CAMPAIGN_EVALUATION_CARD = false;

const CURRENCY_SYMBOLS: Record<string, string> = {
  USD: "$",
  KZT: "₸",
  EUR: "€",
  RUB: "₽",
};

const PLATFORM_LABELS: Record<string, string> = {
  meta: "Meta Ads",
  google: "Google Ads",
  tiktok: "TikTok Ads",
  yandex: "Yandex Ads",
};

const PLATFORM_LABEL_TO_KEY: Record<string, string> = {
  "Meta Ads": "meta",
  "Google Ads": "google",
  "TikTok Ads": "tiktok",
  "Yandex Ads": "yandex",
};

/** Ключ сегмента доната: подписи таблицы + id вроде `tiktok` из API. */
function donutSegmentKeyFromPlatform(platform: string): string {
  const t = platform.trim();
  const fromLabel = PLATFORM_LABEL_TO_KEY[t];
  if (fromLabel) return fromLabel;
  const lower = t.toLowerCase();
  if (lower === "tiktok" || lower.includes("tiktok")) return "tiktok";
  return lower;
}

function toISO(d: Date) {
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  return `${yyyy}-${mm}-${dd}`;
}

function toErrorText(x: unknown): string {
  if (!x) return "";
  if (typeof x === "string") return x;
  if (x instanceof Error) return x.message || String(x);
  try {
    return JSON.stringify(x);
  } catch {
    return String(x);
  }
}

function extractApiError(payload: unknown): string {
  if (!payload) return "";
  const p = payload as Record<string, unknown>;
  const err = (p.error ?? p) as Record<string, unknown>;
  const errSync = (err.sync as { error?: string } | undefined)?.error;
  const parts: string[] = [];
  const msg =
    err?.message ||
    errSync ||
    (p.sync as { error?: string } | undefined)?.error ||
    p.message ||
    p.error_description;
  if (msg) parts.push(String(msg));
  if (err?.code) parts.push(`code=${err.code}`);
  if (err?.details) parts.push(String(err.details));
  if (err?.hint) parts.push(String(err.hint));
  return parts.filter(Boolean).join(" | ");
}

type DashboardAccount = {
  id: string;
  name: string | null;
  platform: string;
  platform_account_id: string;
  is_enabled: boolean;
};

type SourceOption = { id: string; label: string; type: "platform" | "class" };

function Card({
  title,
  helpContent,
  children,
  className = "",
}: {
  title: string;
  helpContent?: React.ReactNode;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <div className={className} style={reportCardStyle}>
      <div className="mb-3 flex items-center gap-2">
        <h2 className="text-[14px] font-semibold tracking-tight text-white" style={{ letterSpacing: "-0.01em" }}>
          {title}
        </h2>
        {helpContent != null ? <HelpTooltip content={helpContent} /> : null}
      </div>
      {children}
    </div>
  );
}

function SectionLabel({ children }: { children: React.ReactNode }) {
  return <p className="mb-3 text-[11px] font-bold uppercase tracking-[0.08em] text-zinc-500">{children}</p>;
}

function HeroKpiTile({
  label,
  helpContent,
  value,
  sub,
  accent,
}: {
  label: string;
  helpContent: React.ReactNode;
  value: string;
  sub: string;
  accent: "emerald" | "sky" | "violet" | "amber";
}) {
  const border = {
    emerald: "border-t-emerald-500/75",
    sky: "border-t-sky-500/75",
    violet: "border-t-violet-500/75",
    amber: "border-t-amber-500/75",
  }[accent];
  return (
    <div
      className={`rounded-2xl border border-white/[0.07] bg-gradient-to-b from-white/[0.05] to-transparent p-5 pt-4 shadow-lg ${border} border-t-[3px]`}
    >
      <div className="mb-3 flex items-center gap-2">
        <span className="text-[11px] font-bold uppercase tracking-wider text-zinc-500">{label}</span>
        <HelpTooltip content={helpContent} />
      </div>
      <div className="text-[clamp(1.35rem,3.2vw,2rem)] font-bold leading-none tracking-tight text-white tabular-nums">
        {value}
      </div>
      <div className="mt-2.5 text-[13px] leading-snug text-zinc-500">{sub}</div>
    </div>
  );
}

function planFactRemainderTooltip(
  max: number,
  value: number,
  isCount: boolean | undefined,
  fmtMoney: (n: number | null) => string
): string | null {
  if (max <= 0) return null;
  const rem = max - value;
  if (isCount) {
    const r = Math.round(rem);
    if (r > 0) return `Осталось продаж: ${r.toLocaleString("ru-RU")}`;
    if (r < 0) return `Сверх плана: ${Math.abs(r).toLocaleString("ru-RU")}`;
    return "План по продажам выполнен";
  }
  if (rem > 0) return `Остаток бюджета: ${fmtMoney(rem)}`;
  if (rem < 0) return `Перерасход: ${fmtMoney(-rem)}`;
  return "План по бюджету выполнен";
}

function factTooltipText(
  value: number,
  isCount: boolean | undefined,
  fmtMoney: (n: number | null) => string
): string {
  if (isCount) {
    return `Фактические продажи: ${value.toLocaleString("ru-RU")}`;
  }
  return `Фактический расход: ${fmtMoney(value)}`;
}

function ReportCursorTooltip({ tip }: { tip: { x: number; y: number; text: string } | null }) {
  if (typeof document === "undefined" || tip == null) return null;
  return createPortal(
    <div
      className="pointer-events-none fixed z-[9999] max-w-[min(90vw,320px)] rounded-lg border border-white/12 bg-zinc-950/98 px-2.5 py-1.5 text-[11px] leading-snug text-zinc-200 shadow-xl"
      style={{ left: tip.x + 14, top: tip.y + 14 }}
      role="tooltip"
    >
      {tip.text}
    </div>,
    document.body
  );
}

function ProgressBar({
  value,
  max,
  label,
  forecast,
  fmtMoney,
  isCount,
  size = "sm",
  barTone = "auto",
  forecastPrefix = "Прогноз",
}: {
  value: number;
  max: number;
  label: string;
  forecast?: string | null;
  fmtMoney: (n: number | null) => string;
  isCount?: boolean;
  /** sm — компактный; md — как полосы на главном дашборде (толще, скругление). */
  size?: "sm" | "md";
  /** auto — цвет по доле выполнения; green / yellow — фиксированные полосы для визуального различия рядом. */
  barTone?: "auto" | "green" | "yellow";
  /** Текст перед значением прогноза, например «Прогноз расхода». */
  forecastPrefix?: string;
}) {
  const [cursorTip, setCursorTip] = useState<{ x: number; y: number; text: string } | null>(null);

  const ratioPct = max > 0 ? (value / max) * 100 : 0;
  const barPct = max > 0 ? Math.min(100, Math.max(0, ratioPct)) : 0;
  const fillColorAuto =
    ratioPct >= 100 ? "bg-emerald-500/90" : ratioPct >= 80 ? "bg-amber-500/90" : "bg-red-500/85";
  const fillColor =
    barTone === "green" ? "bg-emerald-500/90" : barTone === "yellow" ? "bg-yellow-500/90" : fillColorAuto;
  const isMd = size === "md";
  const pctLabel = max <= 0 ? "—" : `${Math.round(ratioPct)}%`;
  const remainderTip = planFactRemainderTooltip(max, value, isCount, fmtMoney);

  const onFactZonePointer = useCallback(
    (e: ReactMouseEvent<HTMLDivElement>) => {
      if (max <= 0) return;
      setCursorTip({ x: e.clientX, y: e.clientY, text: factTooltipText(value, isCount, fmtMoney) });
    },
    [max, value, isCount, fmtMoney]
  );

  const onRemainderZonePointer = useCallback(
    (e: ReactMouseEvent<HTMLDivElement>) => {
      if (max <= 0) return;
      setCursorTip({
        x: e.clientX,
        y: e.clientY,
        text: remainderTip ?? factTooltipText(value, isCount, fmtMoney),
      });
    },
    [max, remainderTip, value, isCount, fmtMoney]
  );

  const isMdSize = isMd;
  const barH = isMdSize ? 12 : 5;
  const zoneGlow = "transition-shadow duration-200 hover:shadow-[0_0_16px_rgba(161,161,170,0.55)]";
  const factZoneRounded =
    isMdSize ? (barPct >= 100 ? "rounded-full" : "rounded-l-full") : barPct >= 100 ? "rounded-sm" : "rounded-l-sm";
  const remZoneRounded =
    isMdSize ? (barPct <= 0 ? "rounded-full" : "rounded-r-full") : barPct <= 0 ? "rounded-sm" : "rounded-r-sm";

  return (
    <div className="mb-4 last:mb-0">
      <div className={`flex items-center justify-between ${isMdSize ? "mb-2" : "mb-1.5"} text-[13px]`}>
        <span className="text-white/90">{label}</span>
        <span className="text-zinc-400">
          {isCount ? value.toLocaleString("ru-RU") : fmtMoney(value)} / {isCount ? max.toLocaleString("ru-RU") : fmtMoney(max)} (
          {pctLabel})
        </span>
      </div>
      <div className="relative w-full" style={{ height: barH }} onMouseLeave={() => setCursorTip(null)}>
        <div
          className={`pointer-events-none absolute inset-0 ${
            isMdSize
              ? "overflow-hidden rounded-full border border-white/10 bg-black/25"
              : "overflow-hidden rounded-sm bg-white/[0.06]"
          }`}
        >
          <div
            className={`h-full transition-[width] duration-300 ${fillColor} ${isMdSize ? "rounded-full" : "rounded-sm"}`}
            style={{ width: `${barPct}%` }}
          />
        </div>
        <div className="absolute inset-0 z-10 flex flex-row">
          {barPct > 0 ? (
            <div
              className={`h-full shrink-0 cursor-default ${zoneGlow} ${factZoneRounded}`}
              style={{ width: `${barPct}%`, minWidth: barPct > 0 && barPct < 0.5 ? 6 : undefined }}
              onMouseEnter={onFactZonePointer}
              onMouseMove={onFactZonePointer}
            />
          ) : null}
          {barPct < 100 ? (
            <div
              className={`h-full min-w-0 flex-1 cursor-default ${zoneGlow} ${remZoneRounded}`}
              onMouseEnter={onRemainderZonePointer}
              onMouseMove={onRemainderZonePointer}
            />
          ) : null}
        </div>
      </div>
      <ReportCursorTooltip tip={cursorTip} />
      {forecast != null && forecast !== "" && (
        <p className="mt-1.5 text-[13px] text-zinc-500">
          {forecastPrefix}: {forecast}
        </p>
      )}
    </div>
  );
}

function Sparkline({ data }: { data: number[] }) {
  const safeData = data.map((v) => (Number.isFinite(v) ? Math.max(0, v) : 0));
  const max = Math.max(...safeData, 1);
  return (
    <div className="mt-2 flex items-end gap-0.5" style={{ height: 20 }}>
      {safeData.map((v, i) => (
        <div
          key={i}
          className="min-h-[2px] w-1 rounded-sm bg-white/40"
          style={{ height: `${Math.max(4, (v / max) * 100)}%` }}
        />
      ))}
    </div>
  );
}

function MetricCard({
  title,
  value,
  trend,
  trendUp,
  data,
}: {
  title: string;
  value: string | number;
  trend?: string | null;
  trendUp?: boolean | null;
  data?: number[];
}) {
  const hasValue = value !== "—" && value !== null;
  return (
    <div className="rounded-xl border border-white/10 bg-white/[0.04] p-4 transition-colors hover:border-white/15">
      <div className="text-xs text-zinc-500">{title}</div>
      <div className="mt-1 text-2xl font-bold text-white">{hasValue ? value : "Нет данных"}</div>
      {hasValue && trend != null && trend !== "" && (
        <div className={`mt-1 flex items-center text-xs font-medium ${trendUp === true ? "text-emerald-400" : trendUp === false ? "text-red-400" : "text-zinc-400"}`}>
          {trendUp === true ? "↑" : trendUp === false ? "↓" : ""} {trend}
        </div>
      )}
      {hasValue && data != null && data.length > 0 && <Sparkline data={data} />}
    </div>
  );
}

type MetricVariant = "number" | "currency" | "decimal";

function AutoFitMetricValue({ value }: { value: string }) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const textRef = useRef<HTMLDivElement | null>(null);
  const [fontSize, setFontSize] = useState(REPORT_OVERVIEW_VALUE_START_PX);

  useLayoutEffect(() => {
    const container = containerRef.current;
    const text = textRef.current;
    if (!container || !text) return;

    let size = REPORT_OVERVIEW_VALUE_START_PX;
    text.style.fontSize = `${size}px`;

    while (size > REPORT_OVERVIEW_VALUE_MIN_PX && text.scrollWidth > container.clientWidth) {
      size -= 1;
      text.style.fontSize = `${size}px`;
    }

    setFontSize(size);
  }, [value]);

  return (
    <div ref={containerRef} className="flex w-full min-w-0 items-center overflow-hidden">
      <div
        ref={textRef}
        className="whitespace-nowrap font-semibold leading-none tracking-tight text-white"
        style={{ fontSize: `${fontSize}px` }}
      >
        {String(value).trim()}
      </div>
    </div>
  );
}

function OverviewMetricCard({
  title,
  value,
  caption,
  helpContent,
  variant = "number",
}: {
  title: string;
  value: string;
  /** Очень короткая подпись под цифрой (2–4 слова). */
  caption?: string;
  helpContent?: ReactNode;
  variant?: MetricVariant;
}) {
  void variant;
  return (
    <div className="flex h-full min-h-[168px] flex-col overflow-hidden rounded-xl border border-white/10 bg-white/[0.04] p-4">
      <div className="flex min-h-[3rem] shrink-0 items-start justify-between gap-2">
        <div className="min-w-0 flex-1 text-[13px] leading-snug text-white/60 line-clamp-2">{title}</div>
        {helpContent != null ? <HelpTooltip content={helpContent} /> : null}
      </div>
      <div className="flex min-h-[56px] flex-1 flex-col justify-center">
        <div className="w-full min-w-0 pb-1">
          <AutoFitMetricValue value={value} />
        </div>
        {caption != null && caption.trim() !== "" ? (
          <p className="mt-5 text-[11px] leading-relaxed text-zinc-500">{caption}</p>
        ) : null}
      </div>
    </div>
  );
}

const DONUT_COLORS: Record<string, string> = {
  meta: "#1877f2",
  google: "#ea4335",
  tiktok: "#000000",
  yandex: "#fc3f7c",
  organic: "#22c55e",
  organic_search: "#22c55e",
  organic_social: "#22c55e",
  referral: "#a855f7",
  direct: "#6366f1",
  paid: "#f59e0b",
  unknown: "#71717a",
};

/** Подписи каналов привлечения (как в LTV / фильтр дашборда). */
const ACQUISITION_CHANNEL_LABELS: Record<string, string> = {
  meta: "Meta Ads",
  google: "Google Ads",
  tiktok: "TikTok Ads",
  yandex: "Yandex Ads",
  direct: "Прямые / не атрибутировано",
  organic_search: "Органический поиск",
  organic_social: "Органика (соцсети)",
  referral: "Рефералы и соцсети",
  paid: "Paid",
  unknown: "Неизвестно",
};

const PLATFORM_ID_TO_EN_LABEL: Record<string, string> = {
  meta: "Meta Ads",
  google: "Google Ads",
  tiktok: "TikTok Ads",
  yandex: "Yandex Ads",
};

/** Кольцевой сектор для доната (углы в радианах, по часовой стрелке от «12 часов»). */
function annulusWedgePathHalf(cx: number, cy: number, rInner: number, rOuter: number, a0: number, a1: number): string {
  const sweep = a1 - a0;
  const x0o = cx + rOuter * Math.cos(a0);
  const y0o = cy + rOuter * Math.sin(a0);
  const x1o = cx + rOuter * Math.cos(a1);
  const y1o = cy + rOuter * Math.sin(a1);
  const x1i = cx + rInner * Math.cos(a1);
  const y1i = cy + rInner * Math.sin(a1);
  const x0i = cx + rInner * Math.cos(a0);
  const y0i = cy + rInner * Math.sin(a0);
  const largeArc = sweep > Math.PI ? 1 : 0;
  return [
    `M ${x0o} ${y0o}`,
    `A ${rOuter} ${rOuter} 0 ${largeArc} 1 ${x1o} ${y1o}`,
    `L ${x1i} ${y1i}`,
    `A ${rInner} ${rInner} 0 ${largeArc} 0 ${x0i} ${y0i}`,
    "Z",
  ].join(" ");
}

function annulusWedgePath(cx: number, cy: number, rInner: number, rOuter: number, a0: number, a1: number): string {
  let sweep = a1 - a0;
  while (sweep <= 0) sweep += 2 * Math.PI;
  while (sweep > 2 * Math.PI + 1e-9) sweep -= 2 * Math.PI;
  if (sweep >= 2 * Math.PI - 1e-6) {
    return `${annulusWedgePathHalf(cx, cy, rInner, rOuter, a0, a0 + Math.PI)} ${annulusWedgePathHalf(
      cx,
      cy,
      rInner,
      rOuter,
      a0 + Math.PI,
      a0 + 2 * Math.PI
    )}`;
  }
  return annulusWedgePathHalf(cx, cy, rInner, rOuter, a0, a1);
}

function DonutChart({
  segments,
  total,
  valueLabel,
  currencySymbol,
  fmtMoney,
  title,
}: {
  segments: { platform: string; value: number }[];
  total: number;
  valueLabel: "spend" | "revenue";
  currencySymbol: string;
  fmtMoney: (n: number | null) => string;
  title?: string;
}) {
  void currencySymbol;
  const [donutTip, setDonutTip] = useState<{ x: number; y: number; text: string } | null>(null);

  const size = 140;
  const stroke = 12;
  const cx = size / 2;
  const cy = size / 2;
  const rMid = (size - stroke) / 2;
  const rOuter = rMid + stroke / 2;
  const rInner = rMid - stroke / 2;
  const positive = segments.filter((s) => s.value > 0);

  const displayName = (p: string) => ACQUISITION_CHANNEL_LABELS[p] ?? PLATFORM_LABELS[p] ?? p;
  const valueWord = valueLabel === "spend" ? "Расход" : "Выручка";

  const arcs = positive.map((s, i) => {
    const pct = total > 0 ? s.value / total : 0;
    const prevFrac = positive.slice(0, i).reduce((sum, x) => sum + (total > 0 ? x.value / total : 0), 0);
    const nextFrac = prevFrac + pct;
    const a0 = -Math.PI / 2 + prevFrac * 2 * Math.PI;
    const a1 = -Math.PI / 2 + nextFrac * 2 * Math.PI;
    const segmentKey = donutSegmentKeyFromPlatform(s.platform);
    const color = DONUT_COLORS[segmentKey] ?? ["#1877f2", "#ea4335", "#52525b", "#fc3f7c"][i % 4];
    const d = annulusWedgePath(cx, cy, rInner, rOuter, a0, a1);
    return { d, color, platform: s.platform, value: s.value, pct, index: i };
  });

  const updateSegmentTip = (e: ReactMouseEvent<SVGPathElement>, item: (typeof arcs)[number]) => {
    const name = displayName(item.platform);
    const pctStr = `${(item.pct * 100).toFixed(0)}%`;
    setDonutTip({
      x: e.clientX,
      y: e.clientY,
      text: `${name} — ${valueWord}: ${fmtMoney(item.value)} (${pctStr} от общего)`,
    });
  };

  if (positive.length === 0) {
    return (
      <div className="flex flex-col gap-2">
        {title ? <div className="text-[13px] font-semibold text-zinc-400">{title}</div> : null}
        <p className="text-[13px] text-zinc-500">Нет положительных значений для диаграммы.</p>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-2">
      {title ? <div className="text-[13px] font-semibold text-zinc-400">{title}</div> : null}
      <div className="flex flex-wrap items-center gap-6">
        <svg
          width={size}
          height={size}
          className="shrink-0 overflow-visible"
          onMouseLeave={() => setDonutTip(null)}
        >
          <g>
            {arcs.map((p) => (
              <path
                key={p.index}
                d={p.d}
                fill={p.color}
                stroke="rgba(0,0,0,0.25)"
                strokeWidth={0.5}
                className="cursor-default transition-[filter] duration-200 hover:drop-shadow-[0_0_14px_rgba(161,161,170,0.7)]"
                onMouseEnter={(e) => updateSegmentTip(e, p)}
                onMouseMove={(e) => updateSegmentTip(e, p)}
              />
            ))}
          </g>
          <circle cx={cx} cy={cy} r={rMid - stroke - 4} fill="rgba(0,0,0,0.2)" pointerEvents="none" />
        </svg>
        <div className="flex flex-col gap-1.5">
          {arcs.map((p) => (
            <div key={p.index} className="flex items-center gap-2 text-[13px]">
              <span className="h-2.5 w-2.5 shrink-0 rounded" style={{ background: p.color }} />
              <span className="text-white/90">{displayName(p.platform)}</span>
              <span className="text-zinc-500">{(p.pct * 100).toFixed(0)}%</span>
            </div>
          ))}
          {total > 0 ? <div className="mt-1 text-[13px] text-zinc-500">Всего: {fmtMoney(total)}</div> : null}
        </div>
      </div>
      <ReportCursorTooltip tip={donutTip} />
    </div>
  );
}

function PlatformIcon({ platform }: { platform: string }) {
  const key = PLATFORM_LABEL_TO_KEY[platform] ?? platform.toLowerCase().split(" ")[0] ?? platform.toLowerCase();
  const colors: Record<string, string> = { meta: "#1877f2", google: "#ea4335", tiktok: "#000", yandex: "#fc3f7c" };
  const color = colors[key] ?? "rgba(255,255,255,0.5)";
  const letter = key === "meta" ? "M" : key === "google" ? "G" : key === "tiktok" ? "T" : key === "yandex" ? "Y" : platform.slice(0, 1);
  return (
    <span
      className="inline-flex h-6 w-6 items-center justify-center rounded-md text-xs font-bold text-white"
      style={{ background: color }}
      title={PLATFORM_LABELS[platform] ?? platform}
    >
      {letter}
    </span>
  );
}

function Badge({ color, children }: { color: "green" | "yellow" | "red"; children: React.ReactNode }) {
  const classes =
    color === "green"
      ? "bg-emerald-500/20 text-emerald-400 border-emerald-500/30"
      : color === "yellow"
        ? "bg-amber-500/20 text-amber-400 border-amber-500/30"
        : "bg-red-500/20 text-red-400 border-red-500/30";
  return (
    <span className={`inline-flex items-center gap-1.5 rounded-lg border px-3 py-1.5 text-sm font-medium ${classes}`}>
      {color === "green" && <span className="h-2 w-2 rounded-full bg-emerald-400" />}
      {color === "yellow" && <span className="h-2 w-2 rounded-full bg-amber-400" />}
      {color === "red" && <span className="h-2 w-2 rounded-full bg-red-400" />}
      {children}
    </span>
  );
}

function fmtNum(n: number | null): string {
  if (n == null) return "—";
  return n.toLocaleString("ru-RU", { maximumFractionDigits: 2 });
}

function ReportsPageSkeleton() {
  const bar = "animate-pulse rounded-xl bg-white/[0.07]";
  return (
    <div style={{ background: REPORT_PAGE_BG, minHeight: "100%" }} className="mx-auto max-w-7xl space-y-5 px-6 py-6">
      <div className="space-y-4">
        <div className={`h-9 w-80 ${bar}`} />
        <div className={`h-4 max-w-xl ${bar}`} />
      </div>
      <div className={`h-14 max-w-5xl ${bar}`} />
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        {[1, 2, 3, 4].map((i) => (
          <div key={i} className={`h-[132px] ${bar}`} />
        ))}
      </div>
      <div className="grid grid-cols-2 gap-3 md:grid-cols-3 lg:grid-cols-6">
        {[1, 2, 3, 4, 5, 6].map((i) => (
          <div key={i} className={`h-24 ${bar}`} />
        ))}
      </div>
      <div className="grid gap-5 lg:grid-cols-12">
        <div className="space-y-3 lg:col-span-7">
          <div className={`min-h-[300px] ${bar}`} />
        </div>
        <div className="lg:col-span-5">
          <div className={`min-h-[300px] ${bar}`} />
        </div>
      </div>
      <div className={`min-h-[320px] ${bar}`} />
      <div className={`min-h-[220px] ${bar}`} />
      <div className={`min-h-[360px] ${bar}`} />
    </div>
  );
}

export default function ReportsPageClient() {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const projectId = searchParams.get("project_id")?.trim() ?? null;
  const { resolvedUi, bootstrap } = useBillingBootstrap();
  const reportsPack = useMemo(
    () => resolveReportsWidgetState(resolvedUi, bootstrap?.plan_feature_matrix),
    [resolvedUi, bootstrap?.plan_feature_matrix]
  );
  const [data, setData] = useState<Summary | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [currency, setCurrency] = useState<string>("USD");
  const [usdToKztRate, setUsdToKztRate] = useState<number | null>(null);

  const initialRange = useMemo(() => {
    const d = new Date();
    return { from: toISO(new Date(d.getFullYear(), d.getMonth(), 1)), to: toISO(d) };
  }, []);

  const [draftDateFrom, setDraftDateFrom] = useState<string>(initialRange.from);
  const [draftDateTo, setDraftDateTo] = useState<string>(initialRange.to);
  const [appliedDateFrom, setAppliedDateFrom] = useState<string>(initialRange.from);
  const [appliedDateTo, setAppliedDateTo] = useState<string>(initialRange.to);

  const [tableSort, setTableSort] = useState<{ key: string; dir: "asc" | "desc" }>({ key: "spend", dir: "desc" });
  const [issuesOpen, setIssuesOpen] = useState(false);
  const [activeSourceOptions, setActiveSourceOptions] = useState<SourceOption[]>([]);
  const [selectedSources, setSelectedSources] = useState<string[]>([]);
  const [selectedAccountIds, setSelectedAccountIds] = useState<string[]>([]);
  const [dashboardAccounts, setDashboardAccounts] = useState<DashboardAccount[]>([]);
  const [sourcesOpen, setSourcesOpen] = useState(false);
  const [accountsOpen, setAccountsOpen] = useState(false);
  const [projectMinDate, setProjectMinDate] = useState<string | null>(null);
  const sourcesDropdownRef = useRef<HTMLDivElement>(null);
  const accountsDropdownRef = useRef<HTMLDivElement>(null);
  const abortRef = useRef<AbortController | null>(null);
  const reqSeqRef = useRef(0);
  const prevProjectHydrateRef = useRef<string | null>(null);

  const enabledAccounts = useMemo(
    () => dashboardAccounts.filter((a) => a.is_enabled),
    [dashboardAccounts]
  );

  const effectiveSources = useMemo(
    () => selectedSources.filter((s) => activeSourceOptions.some((o) => o.id === s)),
    [selectedSources, activeSourceOptions]
  );
  const effectiveAccountIds = useMemo(
    () => selectedAccountIds.filter((id) => enabledAccounts.some((a) => a.id === id)),
    [selectedAccountIds, enabledAccounts]
  );
  const sourcesKey = effectiveSources.length ? [...effectiveSources].sort().join(",") : "all";
  const accountIdsKey = effectiveAccountIds.length ? [...effectiveAccountIds].sort().join(",") : "all";

  const isInvalidRange = useMemo(() => draftDateFrom > draftDateTo, [draftDateFrom, draftDateTo]);
  const isInvalidApplied = useMemo(
    () => appliedDateFrom > appliedDateTo,
    [appliedDateFrom, appliedDateTo]
  );

  useEffect(() => {
    if (!projectId) {
      setProjectMinDate(null);
      return;
    }
    let cancelled = false;
    (async () => {
      try {
        const { data, error } = await supabase
          .from("projects")
          .select("created_at")
          .eq("id", projectId)
          .maybeSingle();
        if (cancelled) return;
        if (error) {
          setProjectMinDate(null);
          return;
        }
        const createdRaw = typeof data?.created_at === "string" ? data.created_at : null;
        const createdYmd = createdRaw ? createdRaw.slice(0, 10) : null;
        setProjectMinDate(createdYmd);
      } catch {
        if (!cancelled) setProjectMinDate(null);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [projectId]);

  useEffect(() => {
    if (!projectMinDate) return;
    setDraftDateFrom((prev) => (prev < projectMinDate ? projectMinDate : prev));
    setDraftDateTo((prev) => (prev < projectMinDate ? projectMinDate : prev));
    setAppliedDateFrom((prev) => (prev < projectMinDate ? projectMinDate : prev));
    setAppliedDateTo((prev) => (prev < projectMinDate ? projectMinDate : prev));
  }, [projectMinDate]);

  const sourcesLabel = useMemo(() => {
    if (!effectiveSources || effectiveSources.length === 0) return "All";
    if (effectiveSources.length === activeSourceOptions.length) return "All";
    if (effectiveSources.length === 1) {
      const opt = activeSourceOptions.find((o) => o.id === effectiveSources[0]);
      return opt?.label ?? effectiveSources[0];
    }
    return "Mixed";
  }, [effectiveSources, activeSourceOptions]);

  const accountsLabel =
    selectedAccountIds.length === 0 ? "All" : `${selectedAccountIds.length} selected`;

  const accountsByPlatform = useMemo(() => {
    const map = new Map<string, DashboardAccount[]>();
    for (const a of enabledAccounts) {
      const list = map.get(a.platform) ?? [];
      list.push(a);
      map.set(a.platform, list);
    }
    return map;
  }, [enabledAccounts]);

  const platformsForAccounts = useMemo(
    () =>
      (selectedSources.length
        ? activeSourceOptions.filter((s) => selectedSources.includes(s.id))
        : activeSourceOptions
      ).filter((opt) => opt.type === "platform"),
    [selectedSources, activeSourceOptions]
  );

  const tabStyle = (active: boolean, disabled?: boolean) => ({
    height: 40,
    boxSizing: "border-box" as const,
    padding: "0 12px",
    borderRadius: 999,
    border: "1px solid rgba(255,255,255,0.10)",
    background: active ? "rgba(255,255,255,0.09)" : "rgba(255,255,255,0.04)",
    color: disabled ? "rgba(255,255,255,0.45)" : "rgba(255,255,255,0.92)",
    cursor: disabled ? "not-allowed" : "pointer",
    fontWeight: 800,
    fontSize: 12,
    opacity: disabled ? 0.7 : 1,
    whiteSpace: "nowrap" as const,
  });

  const statusState = useMemo<"loading" | "success" | "error">(() => {
    if (loading) return "loading";
    if (error) return "error";
    return "success";
  }, [loading, error]);

  const statusLabel = useMemo(() => {
    if (statusState === "loading") return "Загрузка…";
    if (statusState === "error") return "Ошибка";
    return "Готово";
  }, [statusState]);

  const currencySymbol = CURRENCY_SYMBOLS[currency] ?? currency;

  const toProjectFromCanonicalUsd = useCallback(
    (usd: number) =>
      currency === "KZT" && usdToKztRate != null && usdToKztRate > 0 ? usd * usdToKztRate : usd,
    [currency, usdToKztRate]
  );

  /** Канонический расход из daily_ad_metrics (USD) → отображение как на главном дашборде. */
  const fmtMoney = useCallback(
    (n: number | null) => {
      if (n == null) return "—";
      const v = toProjectFromCanonicalUsd(Number(n) || 0);
      const formatted = Math.round(v).toLocaleString("ru-RU", { maximumFractionDigits: 0 });
      return `${currencySymbol}${formatted}`;
    },
    [currencySymbol, toProjectFromCanonicalUsd]
  );

  /** Тот же канонический USD→проект, но с копейками: строки кампаний (суммы после конвертации часто не целые). */
  const fmtMoneyCanonicalDetail = useCallback(
    (n: number | null) => {
      if (n == null) return "—";
      const v = toProjectFromCanonicalUsd(Number(n) || 0);
      const formatted = v.toLocaleString("ru-RU", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
      return `${currencySymbol}${formatted}`;
    },
    [currencySymbol, toProjectFromCanonicalUsd]
  );

  /** Суммы уже в валюте проекта (выручка KPI и т.п.). */
  const fmtMoneyProject = useCallback(
    (n: number | null) => {
      if (n == null) return "—";
      const formatted = Math.round(Number(n) || 0).toLocaleString("ru-RU", { maximumFractionDigits: 0 });
      return `${currencySymbol}${formatted}`;
    },
    [currencySymbol]
  );

  const fmtMoneyCompactCanonical = useCallback(
    (n: number | null) => {
      if (n == null) return "—";
      const v = toProjectFromCanonicalUsd(Number(n) || 0);
      return `${currencySymbol}${Math.round(v).toLocaleString("ru-RU", { maximumFractionDigits: 0 })}`;
    },
    [currencySymbol, toProjectFromCanonicalUsd]
  );

  const fmtMoneyCompactProject = useCallback(
    (n: number | null) => {
      if (n == null) return "—";
      return `${currencySymbol}${Math.round(Number(n) || 0).toLocaleString("ru-RU", { maximumFractionDigits: 0 })}`;
    },
    [currencySymbol]
  );

  const fetchCurrency = useCallback(async () => {
    if (!projectId) {
      setCurrency("USD");
      return;
    }
    try {
      const res = await getSharedCached(
        `projects-currency:${projectId}`,
        () => fetch(`/api/projects/currency?project_id=${encodeURIComponent(projectId)}`, { cache: "no-store" }),
        { ttlMs: 120_000 }
      );
      const json = await res.json();
      if (res.ok && json?.success && typeof json.currency === "string") {
        setCurrency(String(json.currency).toUpperCase() === "KZT" ? "KZT" : "USD");
      } else if (res.ok && json?.currency) {
        setCurrency(String(json.currency).toUpperCase());
      }
    } catch {
      setCurrency("USD");
    }
  }, [projectId]);

  useEffect(() => {
    if (currency !== "KZT") {
      setUsdToKztRate(null);
      return;
    }
    let cancelled = false;
    (async () => {
      try {
        if (!billingActionAllowed(resolvedUi, ActionId.sync_refresh)) {
          if (!cancelled) setUsdToKztRate(null);
          return;
        }
        const res = await fetch("/api/system/update-rates", { method: "POST" });
        const json = await res.json();
        if (cancelled) return;
        const rate = Number(json?.rate ?? 0);
        setUsdToKztRate(res.ok && json?.success && rate > 0 ? rate : null);
      } catch {
        if (!cancelled) setUsdToKztRate(null);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [currency, resolvedUi]);

  function abortInFlight() {
    const c = abortRef.current;
    abortRef.current = null;
    safeAbortController(c);
  }

  function makeController() {
    abortInFlight();
    const c = new AbortController();
    abortRef.current = c;
    return c;
  }

  const loadMarketingSummary = useCallback(
    async (signal?: AbortSignal) => {
      if (!projectId) return;
      if (reportsPack.state === "BLOCKED") {
        setLoading(false);
        setData(null);
        setError(reportsPack.hint || "Отчёт недоступен");
        return;
      }
      if (!billingActionAllowed(resolvedUi, ActionId.navigate_app)) {
        setLoading(false);
        setData(null);
        setError("Отчёт недоступен в текущем режиме доступа (нет navigate_app).");
        return;
      }
      const start = appliedDateFrom;
      const end = appliedDateTo;
      if (!start || !end || start > end) {
        setLoading(false);
        return;
      }

      const mySeq = ++reqSeqRef.current;
      setLoading(true);
      setError(null);

      const params = new URLSearchParams({
        project_id: projectId,
        start,
        end,
      });
      if (effectiveSources.length) params.set("sources", effectiveSources.join(","));
      if (effectiveAccountIds.length) params.set("account_ids", effectiveAccountIds.join(","));

      try {
        const res = await fetch(`/api/reports/marketing-summary?${params.toString()}`, {
          cache: "no-store",
          signal,
        });
        const json = await res.json();
        if (!res.ok || !json?.success) {
          if (json?.code === "BILLING_BLOCKED") {
            setError(
              "Отчёт недоступен при текущем статусе подписки (BILLING_BLOCKED). " +
                (typeof json?.access_state === "string" ? `access_state=${json.access_state}` : "")
            );
          } else {
            setError(extractApiError(json) || (typeof json?.error === "string" ? json.error : "") || "Ошибка загрузки");
          }
          return;
        }
      const rawRows = (json.campaign_table ?? []) as Partial<CampaignRow>[];
      const campaign_table: CampaignRow[] = rawRows.map((r) => {
        const platform = String(r.platform ?? "");
        const platform_key =
          r.platform_key ??
          ((PLATFORM_LABEL_TO_KEY[platform] ?? platform.toLowerCase().replace(/\s+ads?$/i, "").trim()) ||
            "unknown");
        return {
          platform,
          platform_key,
          campaign_id: r.campaign_id ?? null,
          campaign_name: r.campaign_name ?? "—",
          spend: Number(r.spend) || 0,
          impressions: Number(r.impressions) || 0,
          clicks: Number(r.clicks) || 0,
          conversions: Number(r.conversions) || 0,
          cac: r.cac ?? null,
          roas: r.roas ?? null,
          status: r.status ?? "green",
          marketing_intent: r.marketing_intent ?? null,
          campaign_status: r.campaign_status ?? null,
          is_inactive: Boolean(r.is_inactive),
          status_label_ru: r.status_label_ru ?? null,
        };
      });

      type PbJson = Partial<PlatformBudgetCoverage> & {
        planned_month_usd?: number | null;
        coverage_pct?: number | null;
        coverage_month_pct?: number | null;
      };
      const pbRaw = json.platform_budget as PbJson | null | undefined;
      const planFromJson = json.plan as PlanMetrics | undefined;
      const sliceUsd = typeof pbRaw?.fact_slice_usd === "number" ? pbRaw.fact_slice_usd : 0;
      const factMonth =
        typeof pbRaw?.fact_month_usd === "number" ? pbRaw.fact_month_usd : sliceUsd;
      const allocated =
        typeof pbRaw?.allocated_campaign_budget_month === "number"
          ? pbRaw.allocated_campaign_budget_month
          : typeof pbRaw?.planned_month_usd === "number"
            ? pbRaw.planned_month_usd
            : 0;
      const planMonthlyBudget = pbRaw?.plan_monthly_budget ?? planFromJson?.monthly_budget ?? null;
      const budgetPlanCoveragePct =
        typeof pbRaw?.budget_plan_coverage_pct === "number"
          ? pbRaw.budget_plan_coverage_pct
          : planMonthlyBudget != null && planMonthlyBudget > 0
            ? Math.min(999, (allocated / planMonthlyBudget) * 100)
            : null;
      const spendVsSlice =
        pbRaw?.spend_vs_allocated_slice_pct ??
        (typeof pbRaw?.coverage_pct === "number" ? pbRaw.coverage_pct : null);
      const spendVsMonth =
        pbRaw?.spend_vs_allocated_month_pct ??
        (typeof pbRaw?.coverage_month_pct === "number" ? pbRaw.coverage_month_pct : null);

      const platform_budgetNorm: PlatformBudgetCoverage = pbRaw
        ? {
            allocated_campaign_budget_month: allocated,
            plan_monthly_budget: planMonthlyBudget,
            budget_plan_coverage_pct: budgetPlanCoveragePct,
            fact_slice_usd: sliceUsd,
            fact_month_usd: factMonth,
            spend_vs_allocated_slice_pct: spendVsSlice,
            spend_vs_allocated_month_pct: spendVsMonth,
            campaigns_with_budget: typeof pbRaw.campaigns_with_budget === "number" ? pbRaw.campaigns_with_budget : 0,
            campaigns_total_in_project:
              typeof pbRaw.campaigns_total_in_project === "number" ? pbRaw.campaigns_total_in_project : 0,
            coverage_period_start: pbRaw.coverage_period_start ?? start,
            coverage_period_end: pbRaw.coverage_period_end ?? end,
            month_coverage_start: pbRaw.month_coverage_start ?? start,
            month_coverage_end: pbRaw.month_coverage_end ?? end,
          }
        : {
            allocated_campaign_budget_month: 0,
            plan_monthly_budget: planFromJson?.monthly_budget ?? null,
            budget_plan_coverage_pct: null,
            fact_slice_usd: 0,
            fact_month_usd: 0,
            spend_vs_allocated_slice_pct: null,
            spend_vs_allocated_month_pct: null,
            campaigns_with_budget: 0,
            campaigns_total_in_project: 0,
            coverage_period_start: start,
            coverage_period_end: end,
            month_coverage_start: start,
            month_coverage_end: end,
          };

      const rawPlan = json.plan as PlanMetrics;
      const planNormalized: PlanMetrics = {
        ...rawPlan,
        fact_unique_registrants:
          typeof rawPlan.fact_unique_registrants === "number"
            ? rawPlan.fact_unique_registrants
            : rawPlan.fact_registrations ?? 0,
        fact_spend_acquisition_usd:
          typeof rawPlan.fact_spend_acquisition_usd === "number"
            ? rawPlan.fact_spend_acquisition_usd
            : typeof rawPlan.fact_budget === "number"
              ? rawPlan.fact_budget
              : 0,
        fact_spend_retention_usd:
          typeof rawPlan.fact_spend_retention_usd === "number" ? rawPlan.fact_spend_retention_usd : 0,
      };

      const rawKpi = json.kpi as KpiMetrics;
      const kpiNormalized: KpiMetrics = {
        ...rawKpi,
        cac_blended: typeof rawKpi.cac_blended === "number" ? rawKpi.cac_blended : null,
      };

        if (mySeq !== reqSeqRef.current) return;

        setData({
          plan: planNormalized,
          kpi: kpiNormalized,
          budget: normalizeBudgetCoverage(json.budget),
          platform_budget: platform_budgetNorm,
          campaign_alerts: json.campaign_alerts ?? [],
          campaign_table,
          forecast: json.forecast ?? null,
          marketing_score: json.marketing_score ?? null,
          marketing_score_detail: normalizeMarketingScoreDetail(json.marketing_score_detail, json.marketing_score),
          canonical_ad_row_count: typeof json.canonical_ad_row_count === "number" ? json.canonical_ad_row_count : 0,
          revenue_by_acquisition_source: normalizeRevenueByAcquisition(json.revenue_by_acquisition_source),
          source_options: normalizeSourceOptions(json.source_options),
          channel_summary: normalizeChannelSummary(json.channel_summary),
          backfill: json.backfill as Summary["backfill"] | undefined,
          backfill_status: json.backfill_status as Summary["backfill_status"] | undefined,
        });
      } catch (e: unknown) {
        if (isAbortError(e)) return;
        setError(toErrorText(e) || "Ошибка сети");
      } finally {
        if (mySeq === reqSeqRef.current) setLoading(false);
      }
    },
    [
      projectId,
      appliedDateFrom,
      appliedDateTo,
      effectiveSources,
      effectiveAccountIds,
      reportsPack.state,
      reportsPack.hint,
      resolvedUi,
    ]
  );

  const handleDateBlur = () => {
    const nextFrom = projectMinDate && draftDateFrom < projectMinDate ? projectMinDate : draftDateFrom;
    const nextTo = projectMinDate && draftDateTo < projectMinDate ? projectMinDate : draftDateTo;
    if (nextFrom > nextTo) return;
    if (nextFrom !== draftDateFrom) setDraftDateFrom(nextFrom);
    if (nextTo !== draftDateTo) setDraftDateTo(nextTo);
    if (nextFrom === appliedDateFrom && nextTo === appliedDateTo) return;
    setAppliedDateFrom(nextFrom);
    setAppliedDateTo(nextTo);
    const params = new URLSearchParams(searchParams.toString());
    if (projectId) params.set("project_id", projectId);
    params.set("start", nextFrom);
    params.set("end", nextTo);
    router.replace(`${pathname}?${params.toString()}`, { scroll: false });
  };

  useLayoutEffect(() => {
    if (!projectId) return;
    if (prevProjectHydrateRef.current !== projectId) {
      prevProjectHydrateRef.current = projectId;
      const p = parseDashboardRangeParams(new URLSearchParams(searchParams.toString()));
      if (p && p.projectId === projectId) {
        setDraftDateFrom(p.start);
        setDraftDateTo(p.end);
        setAppliedDateFrom(p.start);
        setAppliedDateTo(p.end);
        if (p.sources?.length) setSelectedSources([...p.sources]);
        else setSelectedSources([]);
        if (p.accountIds?.length) setSelectedAccountIds([...p.accountIds]);
        else setSelectedAccountIds([]);
      } else {
        setDraftDateFrom(initialRange.from);
        setDraftDateTo(initialRange.to);
        setAppliedDateFrom(initialRange.from);
        setAppliedDateTo(initialRange.to);
        setSelectedSources([]);
        setSelectedAccountIds([]);
      }
    }
  }, [projectId, searchParams, initialRange.from, initialRange.to]);

  useEffect(() => {
    if (!projectId) {
      setDashboardAccounts([]);
      return;
    }
    let cancelled = false;
    (async () => {
      try {
        const res = await getSharedCached(
          `dashboard-accounts:${projectId}:selected-only`,
          () =>
            fetch(
              `/api/dashboard/accounts?project_id=${encodeURIComponent(projectId)}&selected_only=1`,
              { cache: "no-store" }
            ),
          { ttlMs: 90_000 }
        );
        const json = (await res.json()) as { success?: boolean; accounts?: DashboardAccount[] };
        if (!cancelled) setDashboardAccounts(json?.accounts ?? []);
      } catch {
        if (!cancelled) setDashboardAccounts([]);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [projectId]);

  useEffect(() => {
    if (!projectId || !appliedDateFrom || !appliedDateTo) return;
    let cancelled = false;
    (async () => {
      try {
        const res = await getSharedCached(
          `dashboard-source-options:${projectId}:${appliedDateFrom}:${appliedDateTo}`,
          () =>
            fetch(
              `/api/dashboard/source-options?project_id=${encodeURIComponent(projectId)}&start=${encodeURIComponent(
                appliedDateFrom
              )}&end=${encodeURIComponent(appliedDateTo)}`,
              { cache: "no-store" }
            ),
          { ttlMs: 90_000 }
        );
        const json = await res.json();
        if (!cancelled && res.ok && json?.success && Array.isArray(json.options)) {
          setActiveSourceOptions(normalizeSourceOptions(json.options));
        } else if (!cancelled && res.ok) {
          const platforms = [...new Set(enabledAccounts.map((a) => a.platform))].filter(Boolean);
          setActiveSourceOptions(
            platforms.map((id) => ({
              id,
              label: PLATFORM_LABELS[id] ?? id,
              type: "platform" as const,
            }))
          );
        }
      } catch {
        if (!cancelled) {
          const platforms = [...new Set(enabledAccounts.map((a) => a.platform))].filter(Boolean);
          setActiveSourceOptions(
            platforms.map((id) => ({
              id,
              label: PLATFORM_LABELS[id] ?? id,
              type: "platform" as const,
            }))
          );
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [projectId, appliedDateFrom, appliedDateTo, enabledAccounts]);

  useEffect(() => {
    if (activeSourceOptions.length === 0) return;
    setSelectedSources((prev) => prev.filter((id) => activeSourceOptions.some((o) => o.id === id)));
  }, [activeSourceOptions]);

  useEffect(() => {
    if (enabledAccounts.length === 0) return;
    setSelectedAccountIds((prev) => prev.filter((id) => enabledAccounts.some((a) => a.id === id)));
  }, [enabledAccounts]);

  useEffect(() => {
    fetchCurrency();
  }, [fetchCurrency]);

  useEffect(() => {
    if (!projectId || isInvalidApplied) {
      if (isInvalidApplied) setLoading(false);
      return;
    }
    const c = makeController();
    ignoreAbortRejection(loadMarketingSummary(c.signal), "reports marketing summary");
    return () => {
      abortInFlight();
    };
  }, [projectId, appliedDateFrom, appliedDateTo, sourcesKey, accountIdsKey, isInvalidApplied, loadMarketingSummary]);

  useEffect(() => {
    return () => abortInFlight();
  }, []);

  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      const target = e.target as Node;
      if (sourcesDropdownRef.current?.contains(target) || accountsDropdownRef.current?.contains(target)) return;
      setSourcesOpen(false);
      setAccountsOpen(false);
    }
    function handleKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") {
        setSourcesOpen(false);
        setAccountsOpen(false);
      }
    }
    if (sourcesOpen || accountsOpen) {
      document.addEventListener("mousedown", handleClickOutside);
      document.addEventListener("keydown", handleKeyDown);
      return () => {
        document.removeEventListener("mousedown", handleClickOutside);
        document.removeEventListener("keydown", handleKeyDown);
      };
    }
  }, [sourcesOpen, accountsOpen]);

  const kpiStatus = (val: number | null, target: number | null, lowerIsBetter: boolean): "green" | "yellow" | "red" | undefined => {
    if (val == null || target == null || target === 0) return undefined;
    const ratio = val / target;
    if (lowerIsBetter) {
      if (ratio <= 1) return "green";
      if (ratio <= 1.2) return "yellow";
      return "red";
    }
    if (ratio >= 1) return "green";
    if (ratio >= 0.8) return "yellow";
    return "red";
  };

  const deltaPct = (fact: number | null, target: number | null): number | null => {
    if (fact == null || target == null || target === 0) return null;
    return ((fact - target) / target) * 100;
  };

  const plannedBudget = data?.plan?.monthly_budget ?? data?.budget?.monthly_budget ?? null;

  const filteredTable = useMemo(() => {
    if (!data?.campaign_table) return [];
    const rows = [...data.campaign_table];
    const { key, dir } = tableSort;
    rows.sort((a, b) => {
      let va: number | string = 0;
      let vb: number | string = 0;
      if (key === "spend") {
        va = a.spend;
        vb = b.spend;
      } else if (key === "ctr") {
        const ctrA = a.impressions > 0 ? (a.clicks / a.impressions) * 100 : 0;
        const ctrB = b.impressions > 0 ? (b.clicks / b.impressions) * 100 : 0;
        va = ctrA;
        vb = ctrB;
      } else if (key === "platform") {
        va = a.platform;
        vb = b.platform;
      } else if (key === "campaign_name") {
        va = a.campaign_name;
        vb = b.campaign_name;
      } else if (key === "impressions") {
        va = a.impressions;
        vb = b.impressions;
      } else if (key === "clicks") {
        va = a.clicks;
        vb = b.clicks;
      }
      const cmp = typeof va === "string" ? (va as string).localeCompare(vb as string) : (va as number) - (vb as number);
      return dir === "asc" ? cmp : -cmp;
    });
    return rows;
  }, [data?.campaign_table, tableSort]);

  const campaignGroups = useMemo(() => {
    const PLATFORM_GROUP_ORDER = ["meta", "google", "tiktok", "yandex"];
    const byPlat = new Map<string, Map<string, CampaignRow[]>>();
    for (const r of filteredTable) {
      const pk = r.platform_key;
      const ik = r.marketing_intent ?? "__none__";
      if (!byPlat.has(pk)) byPlat.set(pk, new Map());
      const im = byPlat.get(pk)!;
      if (!im.has(ik)) im.set(ik, []);
      im.get(ik)!.push(r);
    }
    const platKeys = [...byPlat.keys()].sort((a, b) => {
      const ia = PLATFORM_GROUP_ORDER.indexOf(a);
      const ib = PLATFORM_GROUP_ORDER.indexOf(b);
      const va = ia === -1 ? 100 : ia;
      const vb = ib === -1 ? 100 : ib;
      if (va !== vb) return va - vb;
      return a.localeCompare(b);
    });
    const intentRank = (k: string) =>
      k === "acquisition" ? 0 : k === "retention" ? 1 : k === "__none__" ? 2 : 3;
    return platKeys.map((pk) => {
      const im = byPlat.get(pk)!;
      const intents = [...im.keys()].sort((a, b) => intentRank(a) - intentRank(b) || a.localeCompare(b));
      return {
        platform_key: pk,
        platformLabel: PLATFORM_LABELS[pk] ?? filteredTable.find((x) => x.platform_key === pk)?.platform ?? pk,
        blocks: intents.map((ik) => ({
          key: ik,
          label:
            ik === "acquisition" ? "Acquisition" : ik === "retention" ? "Retention" : "Тип не задан",
          rows: im.get(ik)!,
        })),
      };
    });
  }, [filteredTable]);

  const { alertsList, recommendationsList } = useMemo(() => {
    const alerts: { platform: string; campaign_name: string; problem: string }[] = [];
    const recommendations: { platform: string; campaign_name: string; text: string; kind: "positive" | "problem" }[] = [];
    const targetRoas = data?.plan?.target_roas ?? 0;
    const targetCac = data?.plan?.target_cac ?? 0;
    (data?.campaign_table ?? []).forEach((r) => {
      if (targetRoas > 0 && r.roas != null && r.roas > targetRoas) {
        recommendations.push({
          platform: r.platform,
          campaign_name: r.campaign_name,
          text: "ROAS выше цели. Рекомендация: увеличить бюджет.",
          kind: "positive",
        });
      }
      if (targetCac > 0 && r.cac != null && r.cac > targetCac) {
        alerts.push({ platform: r.platform, campaign_name: r.campaign_name, problem: "CAC выше цели" });
        recommendations.push({
          platform: r.platform,
          campaign_name: r.campaign_name,
          text: "Снизить бюджет или оптимизировать воронку.",
          kind: "problem",
        });
      }
      if (r.spend > 0 && r.conversions === 0) {
        alerts.push({ platform: r.platform, campaign_name: r.campaign_name, problem: "Нет конверсий при наличии расхода" });
        recommendations.push({
          platform: r.platform,
          campaign_name: r.campaign_name,
          text: "Проверить таргетинг или остановить кампанию.",
          kind: "problem",
        });
      }
      if (r.impressions === 0) {
        alerts.push({ platform: r.platform, campaign_name: r.campaign_name, problem: "Кампания не запущена (нет показов)" });
        recommendations.push({
          platform: r.platform,
          campaign_name: r.campaign_name,
          text: "Проверить запуск кампании.",
          kind: "problem",
        });
      }
    });
    (data?.campaign_alerts ?? []).forEach((a) => {
      alerts.push({ platform: a.platform, campaign_name: a.campaign_name, problem: a.problem_type });
      recommendations.push({ platform: a.platform, campaign_name: a.campaign_name, text: a.recommendation, kind: "problem" });
    });
    return { alertsList: alerts, recommendationsList: recommendations };
  }, [data?.campaign_table, data?.campaign_alerts, data?.plan?.target_roas, data?.plan?.target_cac]);

  const campaignHealthCounts = useMemo(() => {
    if (!data?.campaign_table?.length) return { green: 0, yellow: 0, red: 0 };
    let green = 0,
      yellow = 0,
      red = 0;
    data.campaign_table.forEach((r) => {
      if (r.status === "green") green++;
      else if (r.status === "red") red++;
      else yellow++;
    });
    return { green, yellow, red };
  }, [data?.campaign_table]);

  function CampaignHealthDonut({ green, yellow, red }: { green: number; yellow: number; red: number }) {
    const total = green + yellow + red;
    if (!total) return null;
    const size = 60;
    const stroke = 8;
    const r = (size - stroke) / 2;
    const cx = size / 2;
    const cy = size / 2;
    const circumference = 2 * Math.PI * r;
    const seg = (count: number) => (total > 0 ? (count / total) * circumference : 0);
    const greenLen = seg(green);
    const yellowLen = seg(yellow);
    const redLen = seg(red);
    return (
      <svg width={size} height={size} className="text-xs text-zinc-500">
        <circle
          cx={cx}
          cy={cy}
          r={r}
          fill="none"
          stroke="rgba(255,255,255,0.08)"
          strokeWidth={stroke}
        />
        {red > 0 && (
          <circle
            cx={cx}
            cy={cy}
            r={r}
            fill="none"
            stroke="#ef4444"
            strokeWidth={stroke}
            strokeDasharray={`${redLen} ${circumference}`}
            strokeDashoffset={-(greenLen + yellowLen)}
            transform={`rotate(-90 ${cx} ${cy})`}
          />
        )}
        {yellow > 0 && (
          <circle
            cx={cx}
            cy={cy}
            r={r}
            fill="none"
            stroke="#eab308"
            strokeWidth={stroke}
            strokeDasharray={`${yellowLen} ${circumference}`}
            strokeDashoffset={-greenLen}
            transform={`rotate(-90 ${cx} ${cy})`}
          />
        )}
        {green > 0 && (
          <circle
            cx={cx}
            cy={cy}
            r={r}
            fill="none"
            stroke="#22c55e"
            strokeWidth={stroke}
            strokeDasharray={`${greenLen} ${circumference}`}
            strokeDashoffset={0}
            transform={`rotate(-90 ${cx} ${cy})`}
          />
        )}
      </svg>
    );
  }

  const revenueByAcquisitionSegments = useMemo(() => {
    if (!data?.revenue_by_acquisition_source?.length) return [];
    return data.revenue_by_acquisition_source.map((r) => ({
      platform: r.source,
      value: r.revenue,
    }));
  }, [data?.revenue_by_acquisition_source]);

  const revenueDonutTotal = useMemo(
    () => revenueByAcquisitionSegments.reduce((s, p) => s + p.value, 0),
    [revenueByAcquisitionSegments]
  );

  const channelInsight = useMemo(() => {
    if (!data?.budget?.by_platform?.length) return null;
    return getChannelInsight({
      fmtMoney,
      by_platform: data.budget.by_platform,
      revenue_by_acquisition_source: data.revenue_by_acquisition_source ?? [],
      roas: data.kpi?.roas ?? data.plan?.fact_roas ?? null,
    });
  }, [data?.budget?.by_platform, data?.revenue_by_acquisition_source, data?.kpi?.roas, data?.plan?.fact_roas, fmtMoney]);

  const accordionItems = useMemo(
    () => {
      const items: {
        id: string;
        platform: string;
        campaign_name: string;
        problem: string;
        kind: "problem" | "positive";
        actions: string[];
      }[] = [];

      alertsList.forEach((a, idx) => {
        items.push({
          id: `alert-${idx}`,
          platform: a.platform,
          campaign_name: a.campaign_name,
          problem: a.problem,
          kind: "problem",
          actions: [],
        });
      });

      recommendationsList.forEach((r, idx) => {
        let item =
          items.find(
            (it) =>
              it.platform === r.platform &&
              it.campaign_name === r.campaign_name &&
              it.kind === "problem"
          ) ?? null;

        if (!item) {
          item = {
            id: `rec-${idx}`,
            platform: r.platform,
            campaign_name: r.campaign_name,
            problem: r.kind === "positive" ? "Возможность" : "Замечание",
            kind: r.kind,
            actions: [],
          };
          items.push(item);
        }

        item.actions.push(r.text);
      });

      return items;
    },
    [alertsList, recommendationsList]
  );

  const sparklineFromRatio = (ratio: number): number[] => {
    const base = Math.min(1, Math.max(0, ratio));
    return [base * 0.4, base * 0.6, base * 0.8, base, base * 0.9, base].map((v) => v * 100);
  };

  if (!projectId) {
    return (
      <div style={{ padding: 24, color: COLOR_TEXT, textAlign: "center" }}>
        <p>
          Выберите проект: <code style={{ background: "rgba(255,255,255,0.1)", padding: "2px 8px", borderRadius: 6 }}>?project_id=...</code>
        </p>
      </div>
    );
  }

  if (reportsPack.state === "BLOCKED") {
    return (
      <div style={{ padding: 24, color: COLOR_TEXT }}>
        <BillingWidgetPlaceholder pack={reportsPack} minHeight={220} />
      </div>
    );
  }

  if (loading && !data) {
    return <ReportsPageSkeleton />;
  }

  if (!data) {
    return (
      <div style={{ padding: 24, color: COLOR_RED, textAlign: "center" }}>
        {error ?? "Нет данных"}
        <button
          type="button"
          onClick={() => {
            if (!projectId || isInvalidApplied) return;
            const c = makeController();
            ignoreAbortRejection(loadMarketingSummary(c.signal), "reports marketing summary retry");
          }}
          style={{
            marginLeft: 12,
            padding: "6px 12px",
            borderRadius: 8,
            border: "1px solid rgba(255,255,255,0.2)",
            background: "rgba(255,255,255,0.06)",
            color: "white",
            cursor: "pointer",
          }}
        >
          Повторить
        </button>
      </div>
    );
  }

  const { plan, kpi, budget, campaign_table, forecast, canonical_ad_row_count, channel_summary } = data;
  const channelRows = channel_summary ?? [];

  const fmtMetricOrDash = (n: number | null) => (n == null ? "—" : fmtMoney(n));
  const fmtRevenueOrDash = (n: number | null) => (n == null ? "—" : fmtMoneyProject(n));
  const fmtPctOrDash = (n: number | null) => (n == null ? "—" : `${n.toFixed(0)}%`);
  const targetCac = plan.target_cac ?? null;
  const targetRoas = plan.target_roas ?? null;

  const trendStr = (pct: number | null) => (pct != null ? `${pct >= 0 ? "+" : ""}${pct.toFixed(0)}%` : null);
  const roasColor = (roas: number | null) =>
    roas == null ? "text-white/90" : roas < 1 ? "text-red-400 font-semibold" : roas <= 2 ? "text-amber-400 font-semibold" : "text-emerald-400 font-semibold";

  const totalBuyersHero = (kpi.new_buyers ?? 0) + (kpi.returning_buyers ?? 0);
  const shareBuyersHero = (part: number) =>
    totalBuyersHero > 0 ? `${((part / totalBuyersHero) * 100).toFixed(0)}%` : "—";
  const heroSpend = fmtMoneyCompactCanonical(plan.fact_budget);
  const heroRevenue = plan.fact_revenue > 0 ? fmtMoneyCompactProject(plan.fact_revenue) : "—";
  const heroPurchases = plan.fact_sales > 0 ? plan.fact_sales.toLocaleString("ru-RU") : "—";
  const heroRoas =
    kpi.roas != null && kpi.roas > 0
      ? kpi.roas.toFixed(2)
      : plan.fact_roas != null && plan.fact_roas > 0
        ? plan.fact_roas.toFixed(2)
        : plan.fact_budget > 0 && plan.fact_revenue > 0
          ? (plan.fact_revenue / plan.fact_budget).toFixed(2)
          : "—";
  const heroRegistrations =
    plan.fact_unique_registrants > 0 ? plan.fact_unique_registrants.toLocaleString("ru-RU") : "—";
  const heroLeadToSale = kpi.conversion_rate != null ? `${kpi.conversion_rate.toFixed(1)}%` : "—";
  const heroCpl =
    plan.fact_cpr != null && plan.fact_cpr > 0 ? fmtMoneyCompactCanonical(plan.fact_cpr) : "—";
  const heroCac =
    kpi.cac_blended != null && kpi.cac_blended > 0 ? fmtMoneyCompactCanonical(kpi.cac_blended) : "—";
  const heroBudgetAcquisition =
    plan.fact_budget <= 0 ? "—" : fmtMoneyCompactCanonical(plan.fact_spend_acquisition_usd);
  const heroBudgetRetention =
    plan.fact_budget <= 0 ? "—" : fmtMoneyCompactCanonical(plan.fact_spend_retention_usd);
  const heroNewBuyers =
    kpi.new_buyers != null ? kpi.new_buyers.toLocaleString("ru-RU") : "—";
  const heroReturning =
    kpi.returning_buyers != null ? kpi.returning_buyers.toLocaleString("ru-RU") : "—";
  const heroTouches =
    kpi.average_touches_before_purchase != null
      ? kpi.average_touches_before_purchase.toFixed(1)
      : "—";

  return (
    <div style={{ background: REPORT_PAGE_BG, minHeight: "100%" }} className="mx-auto max-w-7xl space-y-5 px-6 py-6">
      {reportsPack.state === "LIMITED" ? (
        <BillingWidgetPlaceholder pack={reportsPack} minHeight={72} />
      ) : null}
      <header className="flex flex-col gap-4">
        <div>
          <h1 className="text-[26px] font-semibold tracking-tight text-white" style={{ letterSpacing: "-0.02em" }}>
            Маркетинговый командный центр
          </h1>
          {error ? (
            <div style={{ marginTop: 10, color: "rgba(255,170,170,0.95)", fontWeight: 700 }}>{error}</div>
          ) : null}
          {canonical_ad_row_count === 0 && plan.fact_budget === 0 ? (
            <p className="mt-1 text-[13px]" style={{ maxWidth: 720, lineHeight: 1.45 }}>
              <span className="text-amber-300/90">Нет строк метрик за период — проверьте включённые аккаунты и синк.</span>
            </p>
          ) : null}
          {data.backfill?.historical_sync_started ? (
            <p className="mt-2 text-[13px] text-amber-300/90">
              Запущена догрузка рекламных метрик за часть периода (как на главном дашборде). Обновите отчёт через минуту — цифры
              могут измениться.
            </p>
          ) : null}
          {data.backfill_status?.triggered && data.backfill_status.reason === "fresh" && !data.backfill?.historical_sync_started ? (
            <p className="mt-2 text-[13px] text-zinc-500">
              Обновление «хвоста» периода запущено в фоне; при необходимости обновите страницу.
            </p>
          ) : null}
        </div>
        <div
          style={{
            display: "flex",
            alignItems: "flex-start",
            gap: 12,
            flexWrap: "wrap",
            width: "100%",
          }}
        >
          <div
            style={{
              display: "flex",
              gap: 8,
              alignItems: "center",
              flexWrap: "wrap",
              flex: "1 1 auto",
              minWidth: 0,
            }}
          >
            <div style={{ position: "relative" }} ref={sourcesDropdownRef}>
              <button
                type="button"
                style={{ ...tabStyle(false), minWidth: 140 }}
                onClick={() => {
                  setSourcesOpen((v) => !v);
                  setAccountsOpen(false);
                }}
                title="Traffic sources"
              >
                Sources: {sourcesLabel} ▼
              </button>
              {sourcesOpen ? (
                <div
                  style={{
                    position: "absolute",
                    top: "100%",
                    left: 0,
                    marginTop: 4,
                    padding: 10,
                    borderRadius: 12,
                    border: "1px solid rgba(255,255,255,0.12)",
                    background: "rgba(20,20,28,0.98)",
                    zIndex: 50,
                    minWidth: 180,
                    boxShadow: "0 8px 24px rgba(0,0,0,0.4)",
                  }}
                >
                  {activeSourceOptions.length === 0 ? (
                    <div style={{ fontSize: 12, opacity: 0.7 }}>No connected sources</div>
                  ) : (
                    activeSourceOptions.map((opt) => {
                      const checked = selectedSources.length === 0 || selectedSources.includes(opt.id);
                      return (
                        <label
                          key={opt.id}
                          style={{
                            display: "flex",
                            alignItems: "center",
                            gap: 8,
                            cursor: "pointer",
                            marginBottom: 6,
                          }}
                        >
                          <input
                            type="checkbox"
                            checked={checked}
                            onChange={() => {
                              if (checked) {
                                if (selectedSources.length === 0) {
                                  setSelectedSources(activeSourceOptions.map((o) => o.id).filter((id) => id !== opt.id));
                                } else {
                                  setSelectedSources((prev) => prev.filter((x) => x !== opt.id));
                                }
                              } else {
                                const next = [...selectedSources, opt.id];
                                setSelectedSources(next.length >= activeSourceOptions.length ? [] : next);
                              }
                            }}
                          />
                          <span>{opt.label}</span>
                        </label>
                      );
                    })
                  )}
                  {activeSourceOptions.length > 0 ? (
                    <div style={{ fontSize: 11, opacity: 0.7, marginTop: 6 }}>Empty = All sources</div>
                  ) : null}
                </div>
              ) : null}
            </div>

            <div style={{ position: "relative" }} ref={accountsDropdownRef}>
              <button
                type="button"
                style={{ ...tabStyle(false), minWidth: 160 }}
                onClick={() => {
                  setAccountsOpen((v) => !v);
                  setSourcesOpen(false);
                }}
                title="Ad accounts"
              >
                Accounts: {accountsLabel} ▼
              </button>
              {accountsOpen ? (
                <div
                  style={{
                    position: "absolute",
                    top: "100%",
                    left: 0,
                    marginTop: 4,
                    padding: 10,
                    borderRadius: 12,
                    border: "1px solid rgba(255,255,255,0.12)",
                    background: "rgba(20,20,28,0.98)",
                    zIndex: 50,
                    maxHeight: 320,
                    overflowY: "auto",
                    minWidth: 240,
                    boxShadow: "0 8px 24px rgba(0,0,0,0.4)",
                  }}
                >
                  {platformsForAccounts.map((opt) => {
                    const accounts = accountsByPlatform.get(opt.id) ?? [];
                    if (accounts.length === 0) return null;
                    return (
                      <div key={opt.id} style={{ marginBottom: 10 }}>
                        <div style={{ fontSize: 11, fontWeight: 700, opacity: 0.8, marginBottom: 4 }}>{opt.label}</div>
                        {accounts.map((a) => {
                          const checked = selectedAccountIds.length === 0 || selectedAccountIds.includes(a.id);
                          return (
                            <label
                              key={a.id}
                              style={{
                                display: "flex",
                                alignItems: "center",
                                gap: 8,
                                cursor: "pointer",
                                marginLeft: 8,
                                marginBottom: 4,
                              }}
                            >
                              <input
                                type="checkbox"
                                checked={checked}
                                onChange={() => {
                                  if (selectedAccountIds.includes(a.id)) {
                                    setSelectedAccountIds((prev) => prev.filter((x) => x !== a.id));
                                  } else {
                                    setSelectedAccountIds((prev) => [...prev, a.id]);
                                  }
                                }}
                              />
                              <span>{a.name || a.platform_account_id}</span>
                            </label>
                          );
                        })}
                      </div>
                    );
                  })}
                  {enabledAccounts.length === 0 ? (
                    <div style={{ fontSize: 12, opacity: 0.7 }}>No enabled accounts</div>
                  ) : null}
                  {enabledAccounts.length > 0 ? (
                    <div style={{ fontSize: 11, opacity: 0.7, marginTop: 6 }}>Empty = All accounts</div>
                  ) : null}
                </div>
              ) : null}
            </div>

            <div
              style={{
                position: "relative",
                display: "flex",
                alignItems: "center",
                gap: 8,
                flexShrink: 0,
                isolation: "isolate",
              }}
            >
              <div
                className="dashboard-native-date-range"
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 6,
                  height: 40,
                  boxSizing: "border-box",
                  padding: "0 10px",
                  borderRadius: 12,
                  border: "1px solid rgba(255,255,255,0.10)",
                  background: "rgba(255,255,255,0.04)",
                  cursor: "pointer",
                }}
              >
                <input
                  type="date"
                  value={draftDateFrom}
                  onChange={(e) => setDraftDateFrom(e.target.value)}
                  onBlur={handleDateBlur}
                  min={projectMinDate ?? undefined}
                  style={{
                    background: "transparent",
                    border: "none",
                    color: "white",
                    outline: "none",
                    fontSize: 13,
                    lineHeight: 1,
                    height: 24,
                    padding: 0,
                    minWidth: 120,
                    width: 120,
                    cursor: "pointer",
                  }}
                />
                <span style={{ opacity: 0.6, fontSize: 11, cursor: "pointer" }}>—</span>
                <input
                  type="date"
                  value={draftDateTo}
                  onChange={(e) => setDraftDateTo(e.target.value)}
                  onBlur={handleDateBlur}
                  min={projectMinDate ?? undefined}
                  style={{
                    background: "transparent",
                    border: "none",
                    color: "white",
                    outline: "none",
                    fontSize: 13,
                    lineHeight: 1,
                    height: 24,
                    padding: 0,
                    minWidth: 120,
                    width: 120,
                    cursor: "pointer",
                  }}
                />
              </div>

              <div
                role="status"
                aria-live="polite"
                title={statusState === "error" ? error ?? "Ошибка" : "Статус загрузки данных"}
                style={{
                  display: "inline-flex",
                  alignItems: "center",
                  justifyContent: "center",
                  gap: 8,
                  minWidth: 100,
                  height: 32,
                  padding: "0 14px",
                  borderRadius: 999,
                  border: "1px solid transparent",
                  fontWeight: 800,
                  fontSize: 12,
                  whiteSpace: "nowrap",
                  transition: "background-color 0.2s ease, color 0.2s ease, border-color 0.2s ease",
                  ...(statusState === "loading"
                    ? {
                        background: "rgba(251,191,36,0.95)",
                        color: "rgba(0,0,0,0.88)",
                        borderColor: "rgba(251,191,36,0.6)",
                      }
                    : statusState === "error"
                      ? {
                          background: "rgba(220,38,38,0.9)",
                          color: "rgba(255,255,255,0.98)",
                          borderColor: "rgba(220,38,38,0.7)",
                        }
                      : {
                          background: "rgba(16,185,129,0.85)",
                          color: "rgba(255,255,255,0.98)",
                          borderColor: "rgba(16,185,129,0.6)",
                        }),
                }}
              >
                {statusState === "loading" ? (
                  <>
                    <span
                      style={{
                        display: "inline-block",
                        width: 14,
                        height: 14,
                        flexShrink: 0,
                        border: "2px solid currentColor",
                        borderTopColor: "transparent",
                        borderRadius: "50%",
                        animation: "dashboard-spin 0.7s linear infinite",
                      }}
                    />
                    {statusLabel}
                  </>
                ) : (
                  statusLabel
                )}
              </div>
            </div>
          </div>
        </div>
        {isInvalidRange ? (
          <div style={{ marginTop: 8, opacity: 0.85, color: "rgba(255,200,160,0.95)" }}>
            Дата начала не может быть позже даты конца
          </div>
        ) : null}
      </header>

      {/* Сводка периода: герой-KPI + вторичная лента */}
      <div
        className="flex flex-col gap-6"
        style={{
          marginTop: 0,
          opacity: loading ? 0.95 : 1,
          transition: "opacity 0.2s ease",
        }}
      >
        <SectionLabel>Ключевые показатели периода</SectionLabel>
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
          <HeroKpiTile
            label="Выручка из покупок"
            accent="emerald"
            helpContent={REPORT_HELP_HERO_REVENUE}
            value={heroRevenue}
            sub={
              plan.fact_budget > 0 && plan.fact_revenue > 0
                ? `ROAS (выручка покупок ÷ реклама): ${heroRoas}`
                : "Нет выручки из покупок за период"
            }
          />
          <HeroKpiTile
            label="Расход на рекламу"
            accent="sky"
            helpContent={REPORT_HELP_HERO_SPEND}
            value={heroSpend}
            sub={`Acquisition: ${heroBudgetAcquisition} · Retention: ${heroBudgetRetention}`}
          />
          <HeroKpiTile
            label="Покупки (события)"
            accent="violet"
            helpContent={REPORT_HELP_HERO_PURCHASES}
            value={heroPurchases}
            sub={`Рег. → покупка (события): ${heroLeadToSale}`}
          />
          <HeroKpiTile
            label="ROAS"
            accent="amber"
            helpContent={REPORT_HELP_HERO_ROAS}
            value={heroRoas}
            sub="Выручка покупок ÷ рекламный расход"
          />
        </div>

        <SectionLabel>Детализация воронки и аудитории</SectionLabel>
        <div className="grid grid-cols-2 items-stretch gap-3 sm:grid-cols-3 lg:grid-cols-6">
          <OverviewMetricCard
            title="Регистрации (уникальные)"
            value={heroRegistrations}
            caption="Уникальные за период"
            helpContent={reportHelpRegistrationsUnique({
              heroLeadToSale,
              factRegistrations: plan.fact_registrations,
              factUniqueRegistrants: plan.fact_unique_registrants,
            })}
          />
          <OverviewMetricCard
            title="Новые покупатели"
            value={heroNewBuyers}
            caption="Ровно одна покупка"
            helpContent={reportHelpNewBuyers(shareBuyersHero(kpi.new_buyers ?? 0))}
          />
          <OverviewMetricCard
            title="Повторные покупатели"
            value={heroReturning}
            caption="Две и более покупок"
            helpContent={reportHelpReturningBuyers(shareBuyersHero(kpi.returning_buyers ?? 0))}
          />
          <OverviewMetricCard
            title="Касаний до покупки"
            value={heroTouches}
            caption="Среднее по визитам"
            helpContent={REPORT_HELP_TOUCHES}
          />
          <OverviewMetricCard
            title="CPR (факт, удержание)"
            value={heroCpl}
            variant="currency"
            caption="Удержание за период"
            helpContent={REPORT_HELP_CPR_RETENTION}
          />
          <OverviewMetricCard
            title="САС (все платящие)"
            value={heroCac}
            variant="currency"
            caption="Расход на платящего"
            helpContent={REPORT_HELP_CAC_BLENDED}
          />
        </div>
      </div>

      {/* План; при SHOW_CAMPAIGN_EVALUATION_CARD — второй столбец «Оценка и здоровье» */}
      <div className="grid gap-5 lg:grid-cols-12 lg:items-stretch">
        <div
          className={`flex min-h-0 flex-col ${SHOW_CAMPAIGN_EVALUATION_CARD ? "lg:col-span-7" : "lg:col-span-12"}`}
        >
          <Card title="Бюджеты кабинетов и продажи (План / Факт)" className="flex h-full min-h-0 flex-col">
            <div className="flex min-h-0 flex-1 flex-col">
              <div className="shrink-0 grid grid-cols-1 gap-6 lg:grid-cols-2 lg:items-start">
                {plan.monthly_budget != null && plan.monthly_budget > 0 && (
                  <div className="min-w-0">
                    <div className="text-[11px] font-bold uppercase tracking-wider text-zinc-500">Бюджет</div>
                    <div className="mt-2">
                      <ProgressBar
                        size="md"
                        barTone="green"
                        value={plan.fact_budget}
                        max={plan.monthly_budget}
                        label="Факт / план"
                        forecast={forecast != null ? fmtMoney(forecast.forecast_spend) : null}
                        forecastPrefix="Прогноз расхода"
                        fmtMoney={fmtMoney}
                      />
                    </div>
                  </div>
                )}
                {plan.target_sales != null && plan.target_sales > 0 && (
                  <div className="min-w-0">
                    <div className="text-[11px] font-bold uppercase tracking-wider text-zinc-500">Продажи</div>
                    <div className="mt-2">
                      <ProgressBar
                        size="md"
                        barTone="yellow"
                        value={plan.fact_sales}
                        max={plan.target_sales}
                        label="Факт / план"
                        forecast={forecast != null ? String(forecast.forecast_sales) : null}
                        forecastPrefix="Прогноз продаж"
                        fmtMoney={(n) => (n != null ? n.toLocaleString("ru-RU") : "—")}
                        isCount
                      />
                    </div>
                  </div>
                )}
                {(plan.monthly_budget == null || plan.monthly_budget <= 0) &&
                  (plan.target_sales == null || plan.target_sales <= 0) && (
                    <p className="text-[13px] text-zinc-500 lg:col-span-2">Задайте план месяца в настройках проекта.</p>
                  )}
              </div>
              <p className="mt-4 shrink-0 text-[12px] leading-snug text-zinc-500">
                Данные в этом блоке отображаются только за текущий календарный месяц, независимо от выбранного в отчёте периода.
              </p>
              <div className="min-h-2 flex-1" aria-hidden />
            </div>
          </Card>
        </div>

        {SHOW_CAMPAIGN_EVALUATION_CARD ? (
        <div className="flex min-h-0 flex-col lg:col-span-5">
          <Card
            title="Оценка и здоровье кампаний"
            helpContent={REPORT_HELP_CAMPAIGN_SCORE_CARD}
            className="flex h-full min-h-0 flex-col"
          >
            <div className="flex min-h-0 flex-1 flex-col">
              <div className="flex min-h-0 flex-1 flex-col gap-6 lg:flex-row lg:items-stretch">
                <div className="min-w-0 flex-1">
                {(() => {
                  const serverScore = data.marketing_score;
                  const detail =
                    data.marketing_score_detail ?? ({ score: serverScore, factors: [], skipped: [] } satisfies MarketingScoreDetail);
                  const targetRoasP = plan.target_roas ?? 0;
                  const targetCacP = plan.target_cac ?? 0;
                  const roasScore =
                    kpi.roas != null && targetRoasP > 0 ? Math.min(100, (kpi.roas / targetRoasP) * 100) : null;
                  const cacScore =
                    kpi.cac != null && targetCacP > 0 ? Math.max(0, 100 - (kpi.cac / targetCacP) * 100) : null;
                  const convScore = kpi.conversion_rate != null ? Math.min(100, kpi.conversion_rate * 4) : null;
                  const budgetUsage =
                    plannedBudget != null && plannedBudget > 0
                      ? Math.min(100, (budget.active_campaign_budget / plannedBudget) * 100)
                      : null;
                  const clamped = serverScore != null ? Math.min(100, Math.max(0, serverScore)) : null;
                  const hasCampaignProblems = alertsList.length > 0;
                  let status =
                    clamped == null ? "nodata" : clamped >= 85 ? "excellent" : clamped >= 70 ? "good" : "attention";
                  if (hasCampaignProblems && clamped != null && status !== "nodata") {
                    status = "attention";
                  }
                  const statusLabel =
                    status === "nodata"
                      ? "Недостаточно данных"
                      : status === "excellent"
                        ? "Отлично"
                        : status === "good"
                          ? "Норма"
                          : "Нужно внимание";
                  const statusClass =
                    status === "nodata"
                      ? "border-zinc-500/50 text-zinc-400 bg-zinc-500/10"
                      : status === "excellent"
                        ? "border-emerald-500/50 text-emerald-400 bg-emerald-500/20"
                        : status === "good"
                          ? "border-amber-500/50 text-amber-400 bg-amber-500/20"
                          : "border-red-500/50 text-red-400 bg-red-500/20";
                  const attributionQuality =
                    roasScore != null && cacScore != null
                      ? Math.round((roasScore + cacScore) / 2)
                      : roasScore ?? cacScore ?? "—";
                  const campaignEfficiency = roasScore != null ? Math.round(roasScore) : "—";
                  const budgetPacing = budgetUsage != null ? Math.round(budgetUsage) : "—";
                  const conversionRate = convScore != null ? Math.round(convScore) : "—";
                  const barPct = clamped ?? 0;
                  const subValClass = (v: number | string) =>
                    typeof v === "number"
                      ? "text-[15px] font-semibold text-white"
                      : "text-[15px] font-semibold text-white/40";
                  return (
                    <div className="flex flex-col space-y-4">
                      <div className="flex flex-wrap items-center justify-between gap-3">
                        <div className="text-xl font-semibold tracking-tight text-white sm:text-2xl">
                          {clamped != null ? `${clamped} / 100` : "— / 100"}
                        </div>
                        <span className={`rounded-lg border px-3 py-1 text-[13px] font-semibold ${statusClass}`}>
                          {statusLabel}
                        </span>
                      </div>
                      <div
                        className="w-full overflow-hidden rounded-full border border-white/10 bg-black/25"
                        style={{ height: 12 }}
                      >
                        <div
                          className={`h-full rounded-full transition-[width] ${
                            status === "nodata"
                              ? "bg-zinc-600"
                              : status === "excellent"
                                ? "bg-emerald-500/90"
                                : status === "good"
                                  ? "bg-amber-500/90"
                                  : "bg-red-500/85"
                          }`}
                          style={{ width: `${barPct}%` }}
                        />
                      </div>
                      {hasCampaignProblems ? (
                        <p className="text-[12px] leading-snug text-amber-400/95">
                          Есть замечания по кампаниям ({alertsList.length}). Они считаются отдельно от итогового балла — см. «Проблемы
                          и рекомендации».
                        </p>
                      ) : null}
                      {detail.factors.length > 0 ? (
                        <div className="rounded-lg border border-white/[0.06] bg-black/20 px-2.5 py-2">
                          <div className="text-[10px] font-bold uppercase tracking-wider text-zinc-500">
                            Из чего считается балл
                          </div>
                          <ul className="mt-1.5 space-y-1 text-[11px] text-zinc-400">
                            {(() => {
                              const wsum = detail.factors.reduce((a, f) => a + f.weight, 0);
                              return detail.factors.map((f) => (
                                <li key={f.label}>
                                  <span className="text-zinc-300">{f.label}</span>: {Math.round(f.score)}{" "}
                                  <span className="text-zinc-500">
                                    (доля в формуле {wsum > 0 ? Math.round((f.weight / wsum) * 100) : 0}%)
                                  </span>
                                </li>
                              ));
                            })()}
                          </ul>
                          {detail.skipped.length > 0 ? (
                            <p className="mt-2 text-[10px] leading-snug text-zinc-600">
                              Не учтено: {detail.skipped.slice(0, 5).join(" · ")}
                              {detail.skipped.length > 5 ? "…" : ""}
                            </p>
                          ) : null}
                        </div>
                      ) : null}
                      <div className="grid grid-cols-2 gap-2">
                        <div className="rounded-xl bg-white/[0.05] px-3 py-2">
                          <div className="text-[11px] text-zinc-500">Эффективность</div>
                          <div className={subValClass(attributionQuality)}>{attributionQuality}</div>
                        </div>
                        <div className="rounded-xl bg-white/[0.05] px-3 py-2">
                          <div className="text-[11px] text-zinc-500">ROAS к цели</div>
                          <div className={subValClass(campaignEfficiency)}>{campaignEfficiency}</div>
                        </div>
                        <div className="rounded-xl bg-white/[0.05] px-3 py-2">
                          <div className="text-[11px] text-zinc-500">План</div>
                          <div className={subValClass(budgetPacing)}>{budgetPacing}</div>
                        </div>
                        <div className="rounded-xl bg-white/[0.05] px-3 py-2">
                          <div className="text-[11px] text-zinc-500">Конверсия</div>
                          <div className={subValClass(conversionRate)}>{conversionRate}</div>
                        </div>
                      </div>
                    </div>
                  );
                })()}
                </div>
                <div className="flex shrink-0 flex-col gap-3 border-t border-white/10 pt-4 lg:w-[200px] lg:border-l lg:border-t-0 lg:pl-5 lg:pt-0">
                <div className="text-[11px] font-bold uppercase tracking-wider text-zinc-500">Распределение</div>
                {campaignHealthCounts.green + campaignHealthCounts.yellow + campaignHealthCounts.red === 0 ? (
                  <p className="text-[13px] text-zinc-500">Нет данных по статусам.</p>
                ) : (
                  <div className="flex flex-col items-center gap-3 sm:flex-row lg:flex-col">
                    <CampaignHealthDonut
                      green={campaignHealthCounts.green}
                      yellow={campaignHealthCounts.yellow}
                      red={campaignHealthCounts.red}
                    />
                    <div className="space-y-2 text-[12px]">
                      <div className="flex items-center gap-2 text-emerald-400">
                        <span className="h-2 w-2 rounded-full bg-emerald-400" />
                        Норма {campaignHealthCounts.green}
                      </div>
                      <div className="flex items-center gap-2 text-amber-300">
                        <span className="h-2 w-2 rounded-full bg-amber-400" />
                        Внимание {campaignHealthCounts.yellow}
                      </div>
                      <div className="flex items-center gap-2 text-red-400">
                        <span className="h-2 w-2 rounded-full bg-red-400" />
                        Риск {campaignHealthCounts.red}
                      </div>
                    </div>
                  </div>
                )}
                </div>
              </div>
              <div className="mt-auto shrink-0 border-t border-white/10 pt-4">
                <button
                  type="button"
                  onClick={() => setIssuesOpen(true)}
                  className="w-full rounded-xl border border-white/15 bg-white/[0.06] px-3 py-2.5 text-[13px] font-semibold text-white hover:bg-white/10"
                >
                  Проблемы и рекомендации
                </button>
              </div>
            </div>
          </Card>
        </div>
        ) : null}
      </div>

      {/* Каналы: донаты + таблица сравнения платформ */}
      <Card
        title="Каналы и сравнение платформ"
        helpContent={REPORT_HELP_CHANNELS_CARD}
      >
        <div className="grid gap-10 lg:grid-cols-2">
          <div>
            <div className="mb-2 text-[13px] font-semibold text-white/90">Доля расхода</div>
            <div className="flex min-h-[160px] items-center justify-center">
              {budget.by_platform.length > 0 ? (
                <DonutChart
                  segments={budget.by_platform.map((p) => ({ platform: p.platform, value: p.spend }))}
                  total={Math.max(
                    budget.active_campaign_budget,
                    budget.by_platform.reduce((s, p) => s + p.spend, 0)
                  )}
                  valueLabel="spend"
                  currencySymbol={currencySymbol}
                  fmtMoney={fmtMoney}
                />
              ) : (
                <p className="text-[13px] text-zinc-500">Нет данных по каналам.</p>
              )}
            </div>
          </div>
          <div>
            <div className="mb-2 flex flex-wrap items-center gap-2 text-[13px] font-semibold text-white/90">
              <span>Доля выручки по каналу привлечения</span>
              <HelpTooltip content={REPORT_HELP_REVENUE_DONUT} />
            </div>
            <div className="flex min-h-[160px] items-center justify-center">
              {revenueDonutTotal > 0 ? (
                <DonutChart
                  segments={revenueByAcquisitionSegments}
                  total={revenueDonutTotal}
                  valueLabel="revenue"
                  currencySymbol={currencySymbol}
                  fmtMoney={fmtMoneyProject}
                />
              ) : (
                <p className="text-[13px] text-zinc-500">Нет выручки из покупок за период или нет событий покупки в данных.</p>
              )}
            </div>
          </div>
        </div>

        {channelInsight != null ? (
          <div className="mt-6 border-y border-white/10 py-5">
            <div className="flex items-center gap-2.5 text-[13px] leading-snug text-zinc-400">
              <span
                className={`shrink-0 select-none ${
                  channelInsight.level === "high"
                    ? "text-red-400"
                    : channelInsight.level === "medium"
                      ? "text-amber-400"
                      : "text-sky-400/90"
                }`}
                aria-hidden
              >
                ↗
              </span>
              <span>{channelInsight.text}</span>
            </div>
          </div>
        ) : null}

        <div
          className={
            channelInsight != null ? "pt-6" : "mt-8 border-t border-white/10 pt-6"
          }
        >
          <SectionLabel>Сводная таблица по каналам</SectionLabel>
          {channelRows.length === 0 ? (
            <p className="text-[13px] text-zinc-500">Нет каналов за период.</p>
          ) : (
            <div className="overflow-x-auto rounded-xl border border-white/[0.08]">
              <table className="w-full min-w-[640px] border-collapse text-[13px]">
                <thead className="bg-white/[0.04]">
                  <tr>
                    <th className="px-3 py-2.5 text-left text-[12px] font-semibold uppercase tracking-wide text-zinc-500">
                      Канал
                    </th>
                    <th className="px-3 py-2.5 text-right text-[12px] font-semibold uppercase tracking-wide text-zinc-500">
                      Расход
                    </th>
                    <th className="px-3 py-2.5 text-right text-[12px] font-semibold uppercase tracking-wide text-zinc-500">
                      Доля spend
                    </th>
                    <th className="px-3 py-2.5 text-right text-[12px] font-semibold uppercase tracking-wide text-zinc-500">
                      <div className="flex items-center justify-end gap-1">
                        <span>Выручка</span>
                        <HelpTooltip content={REPORT_HELP_CHANNEL_TABLE_REVENUE} />
                      </div>
                    </th>
                    <th className="px-3 py-2.5 text-right text-[12px] font-semibold uppercase tracking-wide text-zinc-500">
                      <div className="flex items-center justify-end gap-1">
                        <span>ROAS</span>
                        <HelpTooltip content={REPORT_HELP_CHANNEL_TABLE_ROAS} />
                      </div>
                    </th>
                    <th className="px-3 py-2.5 text-right text-[12px] font-semibold uppercase tracking-wide text-zinc-500">
                      <div className="flex items-center justify-end gap-1">
                        <span>CTR</span>
                        <HelpTooltip content={REPORT_HELP_CHANNEL_TABLE_CTR} />
                      </div>
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {channelRows.map((row) => {
                    const ctr =
                      row.impressions != null && row.impressions > 0 && row.clicks != null
                        ? (row.clicks / row.impressions) * 100
                        : null;
                    const iconPlat = PLATFORM_ID_TO_EN_LABEL[row.id] ?? row.label_ru;
                    return (
                      <tr key={row.id} className="border-b border-white/[0.06]">
                        <td className="px-3 py-2.5">
                          <div className="flex items-center gap-2">
                            <PlatformIcon platform={iconPlat} />
                            <span className="text-white/90">{row.label_ru}</span>
                          </div>
                        </td>
                        <td className="whitespace-nowrap px-3 py-2.5 text-right tabular-nums text-white/90">
                          {fmtMetricOrDash(row.spend)}
                        </td>
                        <td className="whitespace-nowrap px-3 py-2.5 text-right tabular-nums text-zinc-400">
                          {fmtPctOrDash(row.share_spend_pct)}
                        </td>
                        <td className="whitespace-nowrap px-3 py-2.5 text-right tabular-nums text-white/90">
                          {fmtRevenueOrDash(row.revenue)}
                        </td>
                        <td
                          className={`whitespace-nowrap px-3 py-2.5 text-right tabular-nums font-medium ${roasColor(row.roas)}`}
                        >
                          {row.roas != null ? row.roas.toFixed(2) : "—"}
                        </td>
                        <td className="whitespace-nowrap px-3 py-2.5 text-right tabular-nums text-zinc-400">
                          {ctr != null ? `${ctr.toFixed(2)}%` : "—"}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>
        {budget.by_platform.length === 1 && (
          <p className="mt-4 text-[13px] text-amber-300">Весь расход сосредоточен на одном канале — диверсификация слабая.</p>
        )}
      </Card>

      {/* Детализация: кампании */}
      <Card
        title="Кампании: по источнику и задаче"
        helpContent={REPORT_HELP_CAMPAIGNS_TABLE}
      >
        {filteredTable.length === 0 ? (
          <p className="text-[13px] text-zinc-500">Нет кампаний за выбранный период.</p>
        ) : (
          <div className="overflow-x-auto rounded-xl border border-white/[0.08]">
            <table className="w-full min-w-[720px] border-collapse text-[13px]">
              <thead className="sticky top-0 z-10 bg-[#161616] shadow-[0_1px_0_rgba(255,255,255,0.08)]">
                <tr>
                  {[
                    { key: "platform", label: "Платформа" },
                    { key: "campaign_name", label: "Кампания" },
                    { key: "spend", label: "Расход" },
                    { key: "impressions", label: "Показы" },
                    { key: "clicks", label: "Клики" },
                    { key: "ctr", label: "CTR" },
                    { key: "status", label: "Статус" },
                    { key: "insight", label: "Инсайт" },
                  ].map((col) => (
                    <th
                      key={col.key}
                      className={`whitespace-nowrap align-middle px-3 py-3.5 text-[12px] font-semibold uppercase tracking-wide text-zinc-500 ${
                        col.key === "platform" || col.key === "campaign_name" || col.key === "insight"
                          ? "text-left"
                          : col.key === "status"
                            ? "text-center"
                            : "text-right"
                      } ${col.key === "status" || col.key === "insight" ? "cursor-default" : "cursor-pointer hover:text-zinc-300"}`}
                      onClick={() =>
                        col.key !== "status" &&
                        col.key !== "insight" &&
                        setTableSort({
                          key: col.key,
                          dir: tableSort.key === col.key && tableSort.dir === "asc" ? "desc" : "asc",
                        })
                      }
                    >
                      {col.label}
                      {tableSort.key === col.key && (tableSort.dir === "asc" ? " ↑" : " ↓")}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {campaignGroups.flatMap((g) =>
                  g.blocks.flatMap((b) => {
                    const withPeriodData: CampaignRow[] = [];
                    const noPeriodData: CampaignRow[] = [];
                    for (const row of b.rows) {
                      if (row.spend === 0 && row.impressions === 0) noPeriodData.push(row);
                      else withPeriodData.push(row);
                    }

                    const renderCampaignRow = (r: CampaignRow, i: number, mode: "data" | "nodata") => {
                      const isNoPeriodData = mode === "nodata";
                      const ctr = r.impressions > 0 ? (r.clicks / r.impressions) * 100 : 0;
                      let health: "healthy" | "warning" | "critical" = "healthy";
                      let insight = "Стабильно";

                      if (!isNoPeriodData) {
                        if (r.spend > 0 && r.clicks === 0) {
                          health = "critical";
                          insight = "Проблема трафика";
                        } else if (ctr < 1) {
                          health = "critical";
                          insight = r.spend > 0 ? "Слабые креативы" : "Слабое вовлечение";
                        } else if (ctr >= 1 && ctr < 2) {
                          health = "warning";
                          insight = "Низкий CTR";
                        } else if (ctr >= 2) {
                          insight = r.clicks > 500 ? "Сильное вовлечение" : "Норма";
                        }
                      } else {
                        insight = "—";
                      }

                      const rowAccent = isNoPeriodData
                        ? "border-l-[3px] border-l-zinc-600/60 bg-zinc-500/[0.05]"
                        : health === "critical"
                          ? "border-l-[3px] border-l-red-500/80 bg-red-500/[0.04]"
                          : health === "warning"
                            ? "border-l-[3px] border-l-amber-500/80 bg-amber-500/[0.04]"
                            : "border-l-[3px] border-l-transparent";

                      const statusBadge = isNoPeriodData
                        ? { label: "Нет данных", dot: "bg-zinc-500", className: "text-zinc-400" }
                        : health === "healthy"
                          ? { label: "Ок", dot: "bg-emerald-400", className: "text-emerald-400" }
                          : health === "warning"
                            ? { label: "Внимание", dot: "bg-amber-400", className: "text-amber-300" }
                            : { label: "Риск", dot: "bg-red-400", className: "text-red-400" };

                      const cellMuted = isNoPeriodData ? "text-zinc-500" : "text-white";
                      const cellNums = isNoPeriodData ? "text-zinc-500" : "text-white/90";

                      return (
                        <tr
                          key={r.campaign_id ?? `${g.platform_key}-${b.key}-${mode}-${i}`}
                          className={`border-b border-white/[0.06] ${rowAccent} ${r.is_inactive ? "opacity-50" : ""}`}
                        >
                          <td className={`align-middle px-3 py-3.5 ${cellMuted}`}>
                            <div className="flex items-center gap-2">
                              <PlatformIcon platform={r.platform} />
                              {r.platform}
                            </div>
                          </td>
                          <td className={`max-w-[220px] align-middle px-3 py-3.5 ${cellMuted}`} title={r.campaign_name}>
                            <div className="truncate">{r.campaign_name}</div>
                            {r.status_label_ru ? (
                              <div className="mt-0.5 text-[12px] text-zinc-500">{r.status_label_ru}</div>
                            ) : null}
                          </td>
                          <td className={`whitespace-nowrap align-middle px-3 py-3.5 text-right tabular-nums ${cellNums}`}>
                            {isNoPeriodData ? "—" : fmtMoneyCanonicalDetail(r.spend)}
                          </td>
                          <td className={`whitespace-nowrap align-middle px-3 py-3.5 text-right tabular-nums ${cellNums}`}>
                            {isNoPeriodData ? "—" : fmtNum(r.impressions)}
                          </td>
                          <td className={`whitespace-nowrap align-middle px-3 py-3.5 text-right tabular-nums ${cellNums}`}>
                            {isNoPeriodData ? "—" : fmtNum(r.clicks)}
                          </td>
                          <td className={`whitespace-nowrap align-middle px-3 py-3.5 text-right tabular-nums ${cellNums}`}>
                            {isNoPeriodData ? "—" : r.impressions > 0 ? `${ctr.toFixed(1)}%` : "—"}
                          </td>
                          <td className="align-middle px-3 py-3.5 text-center">
                            <span className={`inline-flex items-center gap-1.5 text-[13px] font-medium ${statusBadge.className}`}>
                              <span className={`h-2 w-2 shrink-0 rounded-full ${statusBadge.dot}`} aria-hidden />
                              {statusBadge.label}
                            </span>
                          </td>
                          <td
                            className={`align-middle px-3 py-3.5 text-left text-[13px] ${isNoPeriodData ? "text-zinc-500" : "text-zinc-400"}`}
                          >
                            {insight}
                          </td>
                        </tr>
                      );
                    };

                    const missingIntentHint =
                      "Проверьте финальные URL в объявлениях: замените обычные ссылки на ссылки с UTM-метками, собранные в UTM Builder — так при синхронизации корректнее определяется задача кампании.";
                    const isIntentMissing = b.key === "__none__";
                    const isIntentOk = b.key === "acquisition" || b.key === "retention";
                    const headerRow = (
                      <tr key={`h-${g.platform_key}-${b.key}`} className="border-b border-white/[0.06] bg-white/[0.04]">
                        <td
                          colSpan={8}
                          className="align-middle px-3 py-3.5 text-left text-[13px] font-semibold tracking-wide text-zinc-300"
                        >
                          {g.platformLabel} —{" "}
                          <span
                            className={`inline-flex items-center gap-1.5 ${
                              isIntentMissing
                                ? "text-amber-300"
                                : isIntentOk
                                  ? "text-emerald-400"
                                  : ""
                            }`}
                          >
                            {isIntentMissing ? (
                              <span className="h-2 w-2 shrink-0 rounded-full bg-amber-400" aria-hidden />
                            ) : null}
                            {isIntentOk ? (
                              <span className="h-2 w-2 shrink-0 rounded-full bg-emerald-400" aria-hidden />
                            ) : null}
                            <span>{b.label}</span>
                          </span>
                          {isIntentMissing ? (
                            <span className="inline-flex items-center align-middle">
                              <HelpTooltip content={<>{missingIntentHint}</>} triggerMarginLeft={2} />
                            </span>
                          ) : null}
                        </td>
                      </tr>
                    );

                    const dataRows = withPeriodData.map((r, i) => renderCampaignRow(r, i, "data"));

                    if (noPeriodData.length === 0) {
                      return [headerRow, ...dataRows];
                    }

                    const nodataSection = (
                      <tr key={`nodata-${g.platform_key}-${b.key}`} className="border-b border-white/[0.06]">
                        <td colSpan={8} className="p-0 align-top">
                          <details className="group border-t border-white/[0.04] bg-black/20">
                            <summary className="flex cursor-pointer list-none items-center gap-2 px-3 py-2.5 text-left text-[13px] text-zinc-500 hover:bg-white/[0.03] hover:text-zinc-400 [&::-webkit-details-marker]:hidden">
                              <span
                                className="inline-block text-zinc-600 transition-transform group-open:rotate-90"
                                aria-hidden
                              >
                                ▸
                              </span>
                              <span>
                                Кампании без данных за период
                                <span className="ml-1.5 tabular-nums text-zinc-600">({noPeriodData.length})</span>
                              </span>
                            </summary>
                            <div className="border-t border-white/[0.06] px-0 pb-1">
                              <table className="w-full min-w-[720px] border-collapse text-[13px]">
                                <tbody>{noPeriodData.map((r, i) => renderCampaignRow(r, i, "nodata"))}</tbody>
                              </table>
                            </div>
                          </details>
                        </td>
                      </tr>
                    );

                    return [headerRow, ...dataRows, nodataSection];
                  })
                )}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      {issuesOpen && (
        <div className="fixed inset-0 z-40 flex justify-end bg-black/40">
          <div className="h-full w-full max-w-md bg-zinc-900/95 p-6 shadow-2xl ring-1 ring-white/10">
            <div className="mb-4 flex items-center justify-between">
              <h3 className="text-lg font-semibold text-white">Проблемы и рекомендации</h3>
              <button
                type="button"
                onClick={() => setIssuesOpen(false)}
                className="rounded-md p-1 text-zinc-400 hover:bg-white/10 hover:text-white"
                aria-label="Закрыть"
              >
                ×
              </button>
            </div>
            {accordionItems.length === 0 ? (
              <p className="text-[13px] text-zinc-500">Нет записей.</p>
            ) : (
              <div className="space-y-3 overflow-y-auto pr-1" style={{ maxHeight: "calc(100vh - 96px)" }}>
                {accordionItems.map((item) => (
                  <div
                    key={item.id}
                    className={`rounded-xl border px-3 py-2.5 text-[13px] ${
                      item.kind === "positive"
                        ? "border-emerald-500/40 bg-emerald-500/10"
                        : "border-red-500/40 bg-red-500/10"
                    }`}
                  >
                    <div className="flex items-center gap-2">
                      <span
                        className={`h-2 w-2 shrink-0 rounded-full ${item.kind === "positive" ? "bg-emerald-400" : "bg-red-400"}`}
                        aria-hidden
                      />
                      <span className="font-medium text-white">
                        {item.platform} — {item.problem}
                      </span>
                    </div>
                    {item.actions.length > 0 && (
                      <ul className="mt-2 list-none space-y-1 text-[13px] text-white/90">
                        {item.actions.map((action, idx) => (
                          <li key={idx}>— {action}</li>
                        ))}
                      </ul>
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
