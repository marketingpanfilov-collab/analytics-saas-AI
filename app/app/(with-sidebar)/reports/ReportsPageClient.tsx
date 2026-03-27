"use client";

import { useSearchParams } from "next/navigation";
import { useEffect, useState, useCallback, useMemo, useLayoutEffect, useRef } from "react";

type PlanMetrics = {
  monthly_budget: number | null;
  target_registrations: number | null;
  target_sales: number | null;
  target_roas: number | null;
  target_cac: number | null;
  fact_budget: number;
  fact_registrations: number;
  fact_sales: number;
  fact_revenue: number;
  fact_roas: number | null;
  fact_cac: number | null;
};

type KpiMetrics = {
  cac: number | null;
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
  by_platform: { platform: string; spend: number }[];
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
  campaign_id: string | null;
  campaign_name: string;
  spend: number;
  impressions: number;
  clicks: number;
  conversions: number;
  cac: number | null;
  roas: number | null;
  status: "green" | "yellow" | "red";
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
};

type Summary = {
  plan: PlanMetrics;
  kpi: KpiMetrics;
  budget: BudgetCoverage;
  campaign_alerts: CampaignAlert[];
  campaign_table: CampaignRow[];
  forecast?: ForecastMetrics | null;
};

const CARD_RADIUS = 14;
const CARD_BORDER = "1px solid rgba(255,255,255,0.10)";
const CARD_BG = "rgba(255,255,255,0.03)";
const CARD_SHADOW = "0 12px 40px rgba(0,0,0,0.35)";
const COLOR_GREEN = "#22c55e";
const COLOR_RED = "#ef4444";
const COLOR_YELLOW = "#eab308";
const COLOR_MUTED = "rgba(255,255,255,0.65)";
const COLOR_TEXT = "rgba(255,255,255,0.9)";

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

function Card({
  title,
  tooltip,
  children,
  className = "",
}: {
  title: string;
  tooltip?: string;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <div className={`rounded-2xl border border-white/10 bg-white/[0.03] p-4 shadow-xl ${className}`}>
      <div className="mb-3 flex items-center gap-2">
        <h2 className="text-[18px] font-black text-white tracking-tight">{title}</h2>
        {tooltip && <span title={tooltip} className="cursor-help text-sm text-zinc-500 opacity-80">ⓘ</span>}
      </div>
      {children}
    </div>
  );
}

function ProgressBar({
  value,
  max,
  label,
  forecast,
  fmtMoney,
  isCount,
}: {
  value: number;
  max: number;
  label: string;
  forecast?: string | null;
  fmtMoney: (n: number | null) => string;
  isCount?: boolean;
}) {
  const percent = max > 0 ? Math.min(100, (value / max) * 100) : 0;
  const fillColor = percent >= 100 ? "bg-emerald-500" : percent >= 80 ? "bg-amber-500" : "bg-red-500";
  return (
    <div className="mb-4 last:mb-0">
      <div className="mb-1 flex items-center justify-between text-sm">
        <span className="text-white/90">{label}</span>
        <span className="text-zinc-400">
          {isCount ? value.toLocaleString("ru-RU") : fmtMoney(value)} / {isCount ? max.toLocaleString("ru-RU") : fmtMoney(max)} ({Math.round(percent)}%)
        </span>
      </div>
      <div className="h-2 w-full overflow-hidden rounded-full bg-white/10">
        <div className={`h-full rounded-full transition-[width] ${fillColor}`} style={{ width: `${percent}%` }} />
      </div>
      {forecast != null && forecast !== "" && (
        <p className="mt-1 text-xs text-zinc-500">Forecast: {forecast}</p>
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
  const [fontSize, setFontSize] = useState(36);

  useLayoutEffect(() => {
    const container = containerRef.current;
    const text = textRef.current;
    if (!container || !text) return;

    let size = 36;
    text.style.fontSize = `${size}px`;

    // Уменьшаем шрифт, пока текст не помещается по ширине контейнера.
    // Минимальный размер — 20px.
    while (size > 20 && text.scrollWidth > container.clientWidth) {
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
  subtitle,
  variant = "number",
}: {
  title: string;
  value: string;
  subtitle: string;
  variant?: MetricVariant;
}) {
  return (
    <div className="flex h-[170px] flex-col justify-between overflow-hidden rounded-xl border border-white/10 bg-white/[0.04] p-5">
      <div className="min-h-[40px] text-sm text-muted-foreground leading-snug">
        {title}
      </div>
      <div className="min-h-[68px] w-full">
        <AutoFitMetricValue value={value} />
      </div>
      <div className="min-h-[36px] text-xs text-muted-foreground leading-snug">
        {subtitle}
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
  direct: "#6366f1",
};

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
  const size = 140;
  const stroke = 12;
  const r = (size - stroke) / 2;
  const cx = size / 2;
  const cy = size / 2;
  const positive = segments.filter((s) => s.value > 0);
  const paths = positive.map((s, i) => {
    const pct = total > 0 ? s.value / total : 0;
    const start = positive
      .slice(0, i)
      .reduce((sum, x) => sum + (total > 0 ? x.value / total : 0), 0);
    const key = PLATFORM_LABEL_TO_KEY[s.platform] ?? s.platform.toLowerCase();
    const color = DONUT_COLORS[key] ?? ["#1877f2", "#ea4335", "#000000", "#fc3f7c"][i % 4];
    const dash = `${2 * Math.PI * r * pct} ${2 * Math.PI * r}`;
    const offset = -2 * Math.PI * r * start;
    return { dash, offset, color, platform: s.platform, value: s.value, pct };
  });
  const displayName = (p: string) => PLATFORM_LABELS[p] ?? p;
  return (
    <div className="flex flex-col gap-2">
      {title && <div className="text-xs font-semibold text-zinc-500">{title}</div>}
      <div className="flex flex-wrap items-center gap-6">
        <svg width={size} height={size} className="shrink-0">
          {paths.map((p, i) => (
            <circle
              key={i}
              cx={cx}
              cy={cy}
              r={r}
              fill="none"
              stroke={p.color}
              strokeWidth={stroke}
              strokeDasharray={p.dash}
              strokeDashoffset={p.offset}
              transform={`rotate(-90 ${cx} ${cy})`}
            />
          ))}
          <circle cx={cx} cy={cy} r={r - stroke - 4} fill="rgba(0,0,0,0.2)" />
        </svg>
        <div className="flex flex-col gap-1.5">
          {paths.map((p, i) => (
            <div key={i} className="flex items-center gap-2 text-sm">
              <span className="h-2.5 w-2.5 rounded" style={{ background: p.color }} />
              <span className="text-white/90">{displayName(p.platform)}</span>
              <span className="text-zinc-500">{(p.pct * 100).toFixed(0)}%</span>
            </div>
          ))}
          {total > 0 && <div className="mt-1 text-xs text-zinc-500">Всего: {fmtMoney(total)}</div>}
        </div>
      </div>
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

export default function ReportsPageClient() {
  const searchParams = useSearchParams();
  const projectId = searchParams.get("project_id")?.trim() ?? null;
  const [data, setData] = useState<Summary | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [currency, setCurrency] = useState<string>("USD");
  const [dateStart, setDateStart] = useState<string>(() => {
    const today = new Date();
    const startOfMonth = new Date(today.getFullYear(), today.getMonth(), 1);
    return startOfMonth.toISOString().slice(0, 10);
  });
  const [dateEnd, setDateEnd] = useState<string>(() => new Date().toISOString().slice(0, 10));
  const [platformFilter, setPlatformFilter] = useState<string>("");
  const [campaignFilter, setCampaignFilter] = useState<string>("");
  const [tableSort, setTableSort] = useState<{ key: string; dir: "asc" | "desc" }>({ key: "spend", dir: "desc" });
  const [issuesOpen, setIssuesOpen] = useState(false);

  const currencySymbol = CURRENCY_SYMBOLS[currency] ?? currency;
  const fmtMoney = useCallback(
    (n: number | null) => {
      if (n == null) return "—";
      const formatted = n.toLocaleString("ru-RU", { maximumFractionDigits: 0 });
      return `${currencySymbol}${formatted}`;
    },
    [currencySymbol]
  );

  const fetchCurrency = useCallback(async () => {
    if (!projectId) return;
    try {
      const res = await fetch(`/api/projects/currency?project_id=${encodeURIComponent(projectId)}`, { cache: "no-store" });
      const json = await res.json();
      if (res.ok && json?.currency) setCurrency(String(json.currency).toUpperCase());
    } catch {
      // keep default USD
    }
  }, [projectId]);

  const fetchSummary = useCallback(async () => {
    if (!projectId) return;
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(
        `/api/reports/marketing-summary?project_id=${encodeURIComponent(projectId)}&start=${dateStart}&end=${dateEnd}`,
        { cache: "no-store" }
      );
      const json = await res.json();
      if (!res.ok || !json?.success) {
        setError(json?.error ?? "Ошибка загрузки");
        setData(null);
        return;
      }
      setData({
        plan: json.plan,
        kpi: json.kpi,
        budget: json.budget,
        campaign_alerts: json.campaign_alerts ?? [],
        campaign_table: json.campaign_table ?? [],
        forecast: json.forecast ?? null,
      });
    } catch (e) {
      setError("Ошибка сети");
      setData(null);
    } finally {
      setLoading(false);
    }
  }, [projectId, dateStart, dateEnd]);

  useEffect(() => {
    fetchCurrency();
  }, [fetchCurrency]);

  useEffect(() => {
    fetchSummary();
  }, [fetchSummary]);

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
    let rows = [...data.campaign_table];
    if (platformFilter) {
      const p = platformFilter.toLowerCase();
      rows = rows.filter((r) => r.platform.toLowerCase().includes(p));
    }
    if (campaignFilter.trim()) {
      const q = campaignFilter.trim().toLowerCase();
      rows = rows.filter((r) => r.campaign_name.toLowerCase().includes(q));
    }
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
  }, [data?.campaign_table, platformFilter, campaignFilter, tableSort]);

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

  const revenueByPlatform = useMemo(() => {
    if (!data?.campaign_table?.length) return [];
    const map: Record<string, number> = {};
    data.campaign_table.forEach((r) => {
      const key = r.platform;
      const revenue = r.spend * (r.roas ?? 0);
      map[key] = (map[key] ?? 0) + revenue;
    });
    return Object.entries(map).map(([platform, value]) => ({ platform, value }));
  }, [data?.campaign_table]);

  const smartInsights = useMemo(() => {
    const out: string[] = [];
    if (!data?.budget?.by_platform?.length || !data?.campaign_table?.length) return out;
    const totalSpend = data.budget.by_platform.reduce((s, p) => s + p.spend, 0);
    const revMap: Record<string, number> = {};
    data.campaign_table.forEach((r) => {
      revMap[r.platform] = (revMap[r.platform] ?? 0) + r.spend * (r.roas ?? 0);
    });
    const totalRev = Object.values(revMap).reduce((a, b) => a + b, 0);
    if (totalSpend <= 0 || totalRev <= 0) return out;
    data.budget.by_platform.forEach((p) => {
      const spendPct = (p.spend / totalSpend) * 100;
      const rev = revMap[PLATFORM_LABELS[p.platform]] ?? revMap[p.platform] ?? 0;
      const revPct = (rev / totalRev) * 100;
      const name = PLATFORM_LABELS[p.platform] ?? p.platform;
      if (revPct >= 5 && spendPct >= 5 && Math.abs(revPct - spendPct) >= 15) {
        if (revPct > spendPct + 10) {
          out.push(`${name} генерирует ${revPct.toFixed(0)}% выручки при ${spendPct.toFixed(0)}% бюджета — можно масштабировать.`);
        } else {
          out.push(`${name} использует ${spendPct.toFixed(0)}% бюджета при ${revPct.toFixed(0)}% выручки — проверить эффективность.`);
        }
      }
    });
    return out;
  }, [data?.budget?.by_platform, data?.campaign_table]);

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
            problem: r.kind === "positive" ? "Opportunity" : "Issue",
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

  const topIssueLabel =
    accordionItems.length > 0
      ? `${accordionItems[0].platform} — ${accordionItems[0].problem}`
      : "Проблем не обнаружено.";

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

  if (loading && !data) {
    return (
      <div style={{ padding: 24, color: COLOR_MUTED, textAlign: "center" }}>
        Загрузка отчёта…
      </div>
    );
  }

  if (error || !data) {
    return (
      <div style={{ padding: 24, color: COLOR_RED, textAlign: "center" }}>
        {error ?? "Нет данных"}
        <button
          type="button"
          onClick={fetchSummary}
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

  const { plan, kpi, budget, campaign_table, forecast } = data;
  const targetCac = plan.target_cac ?? null;
  const targetRoas = plan.target_roas ?? null;

  const trendStr = (pct: number | null) => (pct != null ? `${pct >= 0 ? "+" : ""}${pct.toFixed(0)}%` : null);
  const roasColor = (roas: number | null) =>
    roas == null ? "text-white/90" : roas < 1 ? "text-red-400 font-semibold" : roas <= 2 ? "text-amber-400 font-semibold" : "text-emerald-400 font-semibold";

  return (
    <div className="mx-auto max-w-7xl space-y-6 p-6">
      <header className="flex flex-col items-start justify-between gap-4 sm:flex-row sm:items-start">
        <div>
          <h1 className="text-3xl font-semibold tracking-tight text-white">
            Marketing Report
          </h1>
        </div>
        <div className="flex flex-wrap items-center justify-end gap-3">
          <span className="text-sm text-zinc-400">Period</span>
          <input
            type="date"
            value={dateStart}
            onChange={(e) => setDateStart(e.target.value)}
            className="rounded-lg border border-white/10 bg-white/5 px-3 py-1.5 text-sm text-white"
          />
          <span className="text-zinc-500">–</span>
          <input
            type="date"
            value={dateEnd}
            onChange={(e) => setDateEnd(e.target.value)}
            className="rounded-lg border border-white/10 bg-white/5 px-3 py-1.5 text-sm text-white"
          />
          <select
            value={platformFilter}
            onChange={(e) => setPlatformFilter(e.target.value)}
            className="min-w-[120px] rounded-lg border border-white/10 bg-white/5 px-3 py-1.5 text-sm text-white"
          >
            <option value="">All platforms</option>
            {[...new Set(campaign_table.map((r) => r.platform))].sort().map((p) => (
              <option key={p} value={p}>{PLATFORM_LABELS[p] ?? p}</option>
            ))}
          </select>
          <input
            type="text"
            placeholder="Campaign filter"
            value={campaignFilter}
            onChange={(e) => setCampaignFilter(e.target.value)}
            className="w-40 rounded-lg border border-white/10 bg-white/5 px-3 py-1.5 text-sm text-white placeholder:text-zinc-500"
          />
          <button
            type="button"
            onClick={fetchSummary}
            className="rounded-lg border border-white/15 bg-white/10 px-4 py-1.5 text-sm font-medium text-white hover:bg-white/15"
          >
            Refresh
          </button>
        </div>
      </header>

      {/* 1. Marketing Overview */}
      <Card
        title="Marketing Overview"
        tooltip="Основные маркетинговые показатели за выбранный период."
      >
        {(() => {
          const totalBuyers = (kpi.new_buyers ?? 0) + (kpi.returning_buyers ?? 0);
          const share = (part: number): string =>
            totalBuyers > 0 ? `${((part / totalBuyers) * 100).toFixed(0)}%` : "—";

          const fmtMoneyCompact = (n: number | null): string => {
            if (n == null) return "—";
            const rounded = Math.round(n);
            return `${currencySymbol}${rounded.toString()}`;
          };

          const spendValue = fmtMoneyCompact(plan.fact_budget);

          const cpl =
            plan.fact_registrations && plan.fact_registrations > 0
              ? fmtMoneyCompact(plan.fact_budget / plan.fact_registrations)
              : "—";
          const cacValue =
            kpi.cac != null && kpi.cac > 0
              ? fmtMoneyCompact(kpi.cac)
              : plan.fact_cac != null && plan.fact_cac > 0
                ? fmtMoneyCompact(plan.fact_cac)
                : "—";

          const registrationsValue =
            plan.fact_registrations != null && plan.fact_registrations > 0
              ? plan.fact_registrations.toLocaleString("ru-RU")
              : "—";

          const leadToSaleCr =
            plan.fact_registrations && plan.fact_registrations > 0 && plan.fact_sales != null
              ? `${((plan.fact_sales / plan.fact_registrations) * 100).toFixed(1)}%`
              : "—";

          const salesValue =
            plan.fact_sales != null && plan.fact_sales > 0
              ? plan.fact_sales.toLocaleString("ru-RU")
              : "—";

          const revenueValue =
            plan.fact_revenue != null && plan.fact_revenue > 0
              ? fmtMoneyCompact(plan.fact_revenue)
              : "—";

          const roasValue =
            kpi.roas != null && kpi.roas > 0
              ? kpi.roas.toFixed(2)
              : plan.fact_roas != null && plan.fact_roas > 0
                ? plan.fact_roas.toFixed(2)
                : plan.fact_budget > 0 && plan.fact_revenue != null && plan.fact_revenue > 0
                  ? (plan.fact_revenue / plan.fact_budget).toFixed(2)
                  : "—";

          const newBuyersValue =
            kpi.new_buyers != null
              ? kpi.new_buyers.toLocaleString("ru-RU")
              : "—";
          const returningBuyersValue =
            kpi.returning_buyers != null
              ? kpi.returning_buyers.toLocaleString("ru-RU")
              : "—";

          return (
            <div className="grid grid-cols-6 items-stretch gap-4">
              <OverviewMetricCard
                title="Spend"
                value={spendValue}
                subtitle={`CPL: ${cpl} • CAC: ${cacValue}`}
                variant="currency"
              />
              <OverviewMetricCard
                title="Registrations"
                value={registrationsValue}
                subtitle={`Lead → Sale CR: ${leadToSaleCr}`}
                variant="number"
              />
              <OverviewMetricCard
                title="Sales"
                value={salesValue}
                subtitle={`Revenue: ${revenueValue}`}
                variant="number"
              />
              <OverviewMetricCard
                title="ROAS"
                value={roasValue}
                subtitle="Revenue / Spend"
                variant="decimal"
              />
              <OverviewMetricCard
                title="New customers"
                value={newBuyersValue}
                subtitle={`Share of buyers: ${share(kpi.new_buyers ?? 0)}`}
                variant="number"
              />
              <OverviewMetricCard
                title="Returning customers"
                value={returningBuyersValue}
                subtitle={`Repeat share: ${share(kpi.returning_buyers ?? 0)}`}
                variant="number"
              />
            </div>
          );
        })()}
      </Card>

      {/* 2. Row 1: Marketing Score | Campaign Health | Plan Progress */}
      <div className="grid grid-cols-3 gap-4">
        {/* Marketing Score card */}
        <Card
          title="Marketing Score"
          tooltip="Комплексная оценка эффективности маркетинга на основе атрибуции, эффективности кампаний, выполнения бюджета и конверсий."
          className="h-full flex flex-col"
        >
          {(() => {
            const targetRoas = plan.target_roas ?? 1;
            const targetCac = plan.target_cac ?? 1;
            const roasScore = kpi.roas != null && targetRoas > 0 ? Math.min(100, (kpi.roas / targetRoas) * 100) : 50;
            const cacScore = kpi.cac != null && targetCac > 0 ? Math.max(0, 100 - (kpi.cac / targetCac) * 100) : 50;
            const convScore = kpi.conversion_rate != null ? Math.min(100, kpi.conversion_rate * 2) : 50;
            const budgetUsage = plannedBudget != null && plannedBudget > 0 ? Math.min(100, (budget.active_campaign_budget / plannedBudget) * 100) : 50;
            const touchScore = kpi.average_touches_before_purchase != null ? Math.max(0, 100 - Math.min(100, kpi.average_touches_before_purchase * 15)) : 50;
            const score = Math.round(roasScore * 0.3 + cacScore * 0.25 + convScore * 0.15 + budgetUsage * 0.15 + touchScore * 0.15);
            const clamped = Math.min(100, Math.max(0, score));
            const status = clamped >= 85 ? "excellent" : clamped >= 70 ? "good" : "attention";
            const statusLabel = status === "excellent" ? "Excellent" : status === "good" ? "Good" : "Attention needed";
            const statusClass =
              status === "excellent"
                ? "border-emerald-500/50 text-emerald-400 bg-emerald-500/20"
                : status === "good"
                  ? "border-amber-500/50 text-amber-400 bg-amber-500/20"
                  : "border-red-500/50 text-red-400 bg-red-500/20";
            const attributionQuality = Math.round((roasScore + cacScore) / 2);
            const campaignEfficiency = Math.round(roasScore);
            const budgetPacing = Math.round(budgetUsage);
            const conversionRate = Math.round(convScore);
            return (
              <div className="flex h-full flex-col space-y-4">
                <div className="flex items-center justify-between gap-3">
                  <div className="text-2xl font-semibold text-white">Score {clamped} / 100</div>
                  <span className={`rounded-lg border px-3 py-1 text-sm font-semibold ${statusClass}`}>{statusLabel}</span>
                </div>
                <div className="h-3 w-full overflow-hidden rounded-full bg-white/10">
                  <div
                    className={`h-full rounded-full transition-[width] ${
                      status === "excellent" ? "bg-emerald-500" : status === "good" ? "bg-amber-500" : "bg-red-500"
                    }`}
                    style={{ width: `${clamped}%` }}
                  />
                </div>
                <div className="grid grid-cols-2 gap-2 text-xs sm:grid-cols-2">
                  <div className="rounded-lg bg-white/5 px-3 py-2" title="Качество данных атрибуции и полнота событий.">
                    <div className="text-[11px] text-zinc-500">Attribution quality</div>
                    <div className="text-sm font-semibold text-white">{attributionQuality}</div>
                  </div>
                  <div className="rounded-lg bg-white/5 px-3 py-2" title="Эффективность рекламных кампаний.">
                    <div className="text-[11px] text-zinc-500">Campaign efficiency</div>
                    <div className="text-sm font-semibold text-white">{campaignEfficiency}</div>
                  </div>
                  <div className="rounded-lg bg-white/5 px-3 py-2" title="Скорость расходования бюджета.">
                    <div className="text-[11px] text-zinc-500">Budget pacing</div>
                    <div className="text-sm font-semibold text-white">{budgetPacing}</div>
                  </div>
                  <div className="rounded-lg bg-white/5 px-3 py-2" title="Конверсия трафика в продажи.">
                    <div className="text-[11px] text-zinc-500">Conversion rate</div>
                    <div className="text-sm font-semibold text-white">{conversionRate}</div>
                  </div>
                </div>
              </div>
            );
          })()}
        </Card>

        {/* Campaign Health card */}
        <Card
          title="Campaign Health"
          tooltip="Состояние рекламных кампаний на основе CTR, расходов и активности трафика."
          className="h-full flex flex-col"
        >
          {campaignHealthCounts.green + campaignHealthCounts.yellow + campaignHealthCounts.red === 0 ? (
            <p className="mt-4 text-sm text-zinc-500">Все кампании работают стабильно.</p>
          ) : (
            <div className="mt-4 flex items-center gap-4 text-sm">
              <CampaignHealthDonut
                green={campaignHealthCounts.green}
                yellow={campaignHealthCounts.yellow}
                red={campaignHealthCounts.red}
              />
              <div className="space-y-2">
                <div>
                  <span className="inline-flex items-center rounded-lg bg-emerald-500/15 px-3 py-1.5 text-sm font-medium text-emerald-400">
                    🟢 Healthy {campaignHealthCounts.green}
                  </span>
                </div>
                <div>
                  <span className="inline-flex items-center rounded-lg bg-amber-500/15 px-3 py-1.5 text-sm font-medium text-amber-300">
                    🟡 Warning {campaignHealthCounts.yellow}
                  </span>
                </div>
                <div>
                  <span className="inline-flex items-center rounded-lg bg-red-500/15 px-3 py-1.5 text-sm font-medium text-red-400">
                    🔴 Critical {campaignHealthCounts.red}
                  </span>
                </div>
              </div>
            </div>
          )}
        </Card>

        {/* Plan Progress card */}
        <Card
          title="Plan Progress"
          tooltip="Выполнение маркетингового плана по бюджету и количеству продаж."
          className="h-full flex flex-col"
        >
          <div className="mt-2 space-y-5">
            {plan.monthly_budget != null && plan.monthly_budget > 0 && (
              <div>
                <div className="text-sm font-medium text-white/90">Budget</div>
                <div className="mt-2">
                  <ProgressBar
                    value={plan.fact_budget}
                    max={plan.monthly_budget}
                    label=""
                    forecast={forecast != null ? fmtMoney(forecast.forecast_spend) : null}
                    fmtMoney={fmtMoney}
                  />
                </div>
              </div>
            )}
            {plan.target_sales != null && plan.target_sales > 0 && (
              <div>
                <div className="text-sm font-medium text-white/90">Sales</div>
                <div className="mt-2">
                  <ProgressBar
                    value={plan.fact_sales}
                    max={plan.target_sales}
                    label=""
                    forecast={forecast != null ? String(forecast.forecast_sales) : null}
                    fmtMoney={(n) => (n != null ? n.toLocaleString("ru-RU") : "—")}
                    isCount
                  />
                </div>
              </div>
            )}
            {(plan.monthly_budget == null || plan.monthly_budget <= 0) &&
              (plan.target_sales == null || plan.target_sales <= 0) && (
                <p className="text-sm text-zinc-500">Set monthly budget and sales plan in settings.</p>
              )}
          </div>
        </Card>
      </div>

      {/* 3. Row 2: Channel Performance | Forecast | Issues Summary */}
      <div className="grid grid-cols-3 gap-4">
        {/* Channel Performance card */}
        <Card
          title="Channel Performance"
          tooltip="Распределение рекламных расходов и выручки по каналам."
          className="h-full flex flex-col"
        >
          <div className="mt-3 flex-1 space-y-6">
            <div>
              <div className="mb-1 text-sm font-medium text-white/90">Spend share</div>
              <div className="mb-2 text-xs text-zinc-500">Доля расходов по каналам.</div>
              <div className="flex h-36 items-center justify-center">
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
                  <p className="text-xs text-zinc-500">No channel data.</p>
                )}
              </div>
            </div>
            <div>
              <div className="mb-1 text-sm font-medium text-white/90">Revenue share</div>
              <div className="mb-2 text-xs text-zinc-500">Доля выручки по каналам.</div>
              <div className="flex h-36 items-center justify-center">
                {revenueByPlatform.length > 0 ? (
                  <DonutChart
                    segments={revenueByPlatform}
                    total={revenueByPlatform.reduce((s, p) => s + p.value, 0)}
                    valueLabel="revenue"
                    currencySymbol={currencySymbol}
                    fmtMoney={fmtMoney}
                  />
                ) : (
                  <p className="text-xs text-zinc-500">No revenue data.</p>
                )}
              </div>
            </div>
            {budget.by_platform.length === 1 && (
              <p className="text-xs text-amber-300">
                Все расходы приходятся на один канал.
              </p>
            )}
          </div>
        </Card>

        {/* Forecast card */}
        <Card
          title="Forecast"
          tooltip="Прогноз выполнения плана до конца месяца на основе текущей динамики."
          className="h-full flex flex-col"
        >
          {forecast != null ? (
            <div className="mt-4 space-y-4">
              <p className="text-xs text-zinc-500">
                Прогноз рассчитывается на основе текущей средней дневной динамики.
              </p>
              <div className="space-y-4">
                {forecast.plan_budget != null && forecast.plan_budget > 0 && (
                  <div className="rounded-lg bg-white/5 p-4">
                    <div className="text-xs text-zinc-500">Forecast Budget</div>
                    <div className="mt-1 text-2xl font-bold text-white">{fmtMoney(forecast.forecast_spend)}</div>
                  </div>
                )}
                {forecast.plan_sales != null && forecast.plan_sales > 0 && (
                  <div className="rounded-lg bg-white/5 p-4">
                    <div className="text-xs text-zinc-500">Forecast Sales</div>
                    <div className="mt-1 text-2xl font-bold text-white">{forecast.forecast_sales}</div>
                  </div>
                )}
              </div>
              {(forecast.plan_budget == null || forecast.plan_budget <= 0) &&
                (forecast.plan_sales == null || forecast.plan_sales <= 0) && (
                  <p className="text-sm text-zinc-500">Set monthly plan to see forecast.</p>
                )}
            </div>
          ) : (
            <p className="mt-4 text-sm text-zinc-500">No forecast data.</p>
          )}
        </Card>

        {/* Issues Summary card */}
        <Card
          title="Issues Summary"
          tooltip="Список проблем и аномалий, обнаруженных в рекламных кампаниях."
          className="h-full flex flex-col"
        >
          <div className="mt-4 flex flex-1 flex-col justify-between space-y-4">
            <div className="space-y-4">
              <div className="text-sm font-medium text-white">⚠ Issues detected</div>
              {accordionItems.length === 0 ? (
                <p className="text-sm text-zinc-500">Проблем не обнаружено.</p>
              ) : (
                <>
                  <div className="space-y-1 text-sm text-white/90">
                    <div className="text-red-400">Critical: {campaignHealthCounts.red}</div>
                    <div className="text-amber-300">Warning: {campaignHealthCounts.yellow}</div>
                  </div>
                  <div className="border-t border-white/10 pt-3">
                    <div className="text-xs text-zinc-500">Most critical</div>
                    <div className="mt-1 text-sm text-white/90">{topIssueLabel}</div>
                  </div>
                </>
              )}
            </div>
            {accordionItems.length > 0 && (
              <div className="pt-2">
                <button
                  type="button"
                  onClick={() => setIssuesOpen(true)}
                  className="w-full rounded-lg border border-white/20 bg-transparent px-3 py-1.5 text-sm font-medium text-white hover:bg-white/10"
                >
                  View issues
                </button>
              </div>
            )}
          </div>
        </Card>
      </div>

      {/* 4. Campaign Intelligence Table */}
      <Card
        title="Campaign Intelligence"
        tooltip="Детальный анализ кампаний и их эффективности."
      >
        {filteredTable.length === 0 ? (
          <p className="text-sm text-zinc-500">Нет кампаний за выбранный период.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full border-collapse text-sm">
              <thead>
                <tr className="border-b border-white/10">
                  {[
                    { key: "platform", label: "Platform" },
                    { key: "campaign_name", label: "Campaign" },
                    { key: "spend", label: "Spend" },
                    { key: "impressions", label: "Impressions" },
                    { key: "clicks", label: "Clicks" },
                    { key: "ctr", label: "CTR" },
                    { key: "status", label: "Status" },
                    { key: "insight", label: "Insight" },
                  ].map((col) => (
                    <th
                      key={col.key}
                      className={`cursor-pointer select-none px-3 py-2 font-semibold text-zinc-400 ${
                        col.key === "platform" || col.key === "campaign_name" ? "text-left" : "text-right"
                      } ${col.key === "status" || col.key === "insight" ? "cursor-default" : "hover:text-white"}`}
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
                {filteredTable.map((r, i) => {
                  const ctr = r.impressions > 0 ? (r.clicks / r.impressions) * 100 : 0;
                  let status: "healthy" | "warning" | "critical" = "healthy";
                  let insight = "Stable";

                  if (r.spend > 0 && r.clicks === 0) {
                    status = "critical";
                    insight = "Traffic problem";
                  } else if (ctr < 1) {
                    status = "critical";
                    insight = r.spend > 0 ? "Weak creatives" : "Weak engagement";
                  } else if (ctr >= 1 && ctr < 2) {
                    status = "warning";
                    insight = "Low CTR";
                  } else if (ctr >= 2) {
                    if (r.clicks > 500) {
                      insight = "Strong engagement";
                    } else {
                      insight = "Healthy traffic";
                    }
                  }

                  const rowBg =
                    status === "critical" ? "bg-red-500/5" : status === "warning" ? "bg-amber-500/5" : "bg-emerald-500/0";
                  const statusBadge =
                    status === "healthy"
                      ? { label: "🟢 Healthy", className: "text-emerald-400" }
                      : status === "warning"
                        ? { label: "🟡 Warning", className: "text-amber-300" }
                        : { label: "🔴 Critical", className: "text-red-400" };

                  return (
                    <tr key={r.campaign_id ?? i} className={`border-b border-white/5 ${rowBg}`}>
                      <td className="px-3 py-2 text-white">
                        <div className="flex items-center gap-2">
                          <PlatformIcon platform={r.platform} />
                          {r.platform}
                        </div>
                      </td>
                      <td className="max-w-[220px] truncate px-3 py-2 text-white" title={r.campaign_name}>
                        {r.campaign_name}
                      </td>
                      <td className="px-3 py-2 text-right text-white/90">{fmtMoney(r.spend)}</td>
                      <td className="px-3 py-2 text-right text-white/90">{fmtNum(r.impressions)}</td>
                      <td className="px-3 py-2 text-right text-white/90">{fmtNum(r.clicks)}</td>
                      <td className="px-3 py-2 text-right text-white/90">
                        {r.impressions > 0 ? `${ctr.toFixed(1)}%` : "—"}
                      </td>
                      <td className="px-3 py-2 text-center">
                        <span className={`text-xs font-medium ${statusBadge.className}`}>{statusBadge.label}</span>
                      </td>
                      <td className="px-3 py-2 text-left text-xs text-zinc-300">{insight}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      {issuesOpen && (
        <div className="fixed inset-0 z-40 flex justify-end bg-black/40">
          <div className="h-full w-full max-w-md bg-zinc-900/95 p-6 shadow-2xl ring-1 ring-white/10">
            <div className="mb-4 flex items-center justify-between">
              <h3 className="text-lg font-semibold text-white">Issues</h3>
              <button
                type="button"
                onClick={() => setIssuesOpen(false)}
                className="rounded-md p-1 text-zinc-400 hover:bg-white/10 hover:text-white"
              >
                ✕
              </button>
            </div>
            {accordionItems.length === 0 ? (
              <p className="text-sm text-zinc-500">No problems or recommendations.</p>
            ) : (
              <div className="space-y-3 overflow-y-auto pr-1" style={{ maxHeight: "calc(100vh - 96px)" }}>
                {accordionItems.map((item) => (
                  <div
                    key={item.id}
                    className={`rounded-xl border px-3 py-2 text-sm ${
                      item.kind === "positive"
                        ? "border-emerald-500/40 bg-emerald-500/10"
                        : "border-red-500/40 bg-red-500/10"
                    }`}
                  >
                    <div className="flex items-center gap-2">
                      <span>{item.kind === "positive" ? "🟢" : "🔴"}</span>
                      <span className="font-medium text-white">
                        {item.platform} — {item.problem}
                      </span>
                    </div>
                    {item.actions.length > 0 && (
                      <ul className="mt-2 list-none space-y-1 text-xs text-white/90">
                        {item.actions.map((action, idx) => (
                          <li key={idx}>→ {action}</li>
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
