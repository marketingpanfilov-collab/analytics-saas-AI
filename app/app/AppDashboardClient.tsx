"use client";

import { Fragment, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { ignoreAbortRejection, isAbortError, safeAbortController } from "@/app/lib/abortUtils";
import { SIDEBAR_TODAY_REFRESH_EVENT } from "@/app/lib/sidebarTodayRefreshEvent";
import { supabase } from "@/app/lib/supabaseClient";
import { type ProjectCurrency } from "@/app/lib/currency";
import { getSharedCached } from "@/app/lib/sharedDataCache";
import {
  FRESHNESS_MIN_CHECK_INTERVAL_MS,
  POST_REFRESH_GUARD_MS,
  REFRESH_BASELINE_SESSION_KEY,
} from "@/app/lib/refreshOrchestration";
import { ActionId } from "@/app/lib/billingUiContract";
import {
  billingActionAllowed,
  canOfferBillingInlinePricing,
  isBillingBlocking,
} from "@/app/lib/billingBootstrapClient";
import { resolveDashboardWidgetState } from "@/app/lib/billingWidgetState";
import { useBillingBootstrap } from "./components/BillingBootstrapProvider";
import { useBillingPricingModalRequest } from "./components/BillingPricingModalProvider";
import BillingWidgetPlaceholder from "./components/BillingWidgetPlaceholder";
import AssistedAttributionCard from "./components/AssistedAttributionCard";
import { RevenueAttributionMapCard } from "./components/RevenueAttributionMapCard";
import { ConversionBehaviorCard } from "./components/ConversionBehaviorCard";
import { AttributionFlowCard } from "./components/AttributionFlowCard";

function toISO(d: Date) {
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  return `${yyyy}-${mm}-${dd}`;
}

function fmtRuDate(iso: string) {
  const [y, m, d] = iso.split("-");
  return `${d}.${m}.${y}`;
}

function safeIso(input: any): string | null {
  if (!input) return null;
  const t = Date.parse(String(input));
  if (!Number.isNaN(t)) return new Date(t).toISOString();
  return null;
}

function toErrorText(x: any): string {
  if (!x) return "";
  if (typeof x === "string") return x;
  if (x instanceof Error) return x.message || String(x);
  try {
    return JSON.stringify(x);
  } catch {
    return String(x);
  }
}

function extractApiError(payload: any): string {
  if (!payload) return "";

  const err = payload?.error ?? payload;
  const parts: string[] = [];

  const msg =
    err?.message ||
    err?.sync?.error ||
    payload?.sync?.error ||
    payload?.message ||
    payload?.error_description;

  if (msg) parts.push(String(msg));

  if (err?.code) parts.push(`code=${err.code}`);
  if (err?.details) parts.push(String(err.details));
  if (err?.hint) parts.push(String(err.hint));
  if (err?.type) parts.push(`type=${err.type}`);
  if (err?.fbtrace_id) parts.push(`fbtrace_id=${err.fbtrace_id}`);

  return parts.filter(Boolean).join(" | ");
}

type Summary = {
  spend: number;
  impressions?: number;
  clicks?: number;
};

type Point = {
  date: string;
  spend: number;
};

type ConversionSeriesPoint = {
  date: string;
  registrations: number;
  sales: number;
};

type ChartPoint = {
  date: string;
  spend: number;
  registrations: number;
  sales: number;
  cac: number | null;
};

function dateRange(start: string, end: string): string[] {
  const out: string[] = [];
  const d = new Date(start + "T00:00:00Z");
  const endD = new Date(end + "T00:00:00Z");
  while (d <= endD) {
    out.push(d.toISOString().slice(0, 10));
    d.setUTCDate(d.getUTCDate() + 1);
  }
  return out;
}

type KpiSummary = {
  registrations: number;
  sales: number;
  revenue: number;
  has_direct?: boolean;
};

type SourceOption = {
  id: string;
  label: string;
  type: "platform" | "class";
};
const CHART_COLORS = {
  spend: "rgba(130,255,200,0.85)",
  registrations: "rgba(147,197,253,0.9)",
  sales: "rgba(253,230,138,0.9)",
  cac: "rgba(196,181,253,0.9)",
} as const;

function formatAxisValue(val: number): string {
  if (val >= 1000) return `${(val / 1000).toFixed(1)}k`;
  if (val >= 1) return val.toFixed(0);
  return val.toFixed(1);
}

function mkPathWithGaps(
  values: (number | null)[],
  yMap: (v: number, max: number) => number,
  max: number,
  xForIndex: (i: number) => number
): string {
  const smoothRun = (pts: Array<{ x: number; y: number }>): string => {
    if (pts.length === 0) return "";
    if (pts.length === 1) return `M ${pts[0]!.x.toFixed(2)} ${pts[0]!.y.toFixed(2)}`;
    let d = `M ${pts[0]!.x.toFixed(2)} ${pts[0]!.y.toFixed(2)}`;
    for (let i = 0; i < pts.length - 1; i++) {
      const p0 = pts[i]!;
      const p1 = pts[i + 1]!;
      const cx = ((p0.x + p1.x) / 2).toFixed(2);
      const cy = ((p0.y + p1.y) / 2).toFixed(2);
      d += ` Q ${p0.x.toFixed(2)} ${p0.y.toFixed(2)} ${cx} ${cy}`;
    }
    const last = pts[pts.length - 1]!;
    d += ` T ${last.x.toFixed(2)} ${last.y.toFixed(2)}`;
    return d;
  };
  const parts: string[] = [];
  let run: Array<{ x: number; y: number }> = [];
  for (let i = 0; i < values.length; i++) {
    const v = values[i];
    if (v != null && !Number.isNaN(v)) {
      const x = xForIndex(i);
      const y = yMap(v, max);
      run.push({ x, y });
    } else {
      if (run.length > 0) parts.push(smoothRun(run));
      run = [];
    }
  }
  if (run.length > 0) parts.push(smoothRun(run));
  return parts.join(" ");
}

function MultiMetricLineChart({
  points,
  formatMoney,
}: {
  points: ChartPoint[];
  formatMoney: (v: number) => string;
}) {
  const w = 860;
  const h = 280;
  const pad = 22;
  const leftPad = 46;
  const bottomPad = 28;
  const plotW = w - leftPad - pad;
  const plotH = h - pad - bottomPad;
  const svgRef = useRef<SVGSVGElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const [hoveredIndex, setHoveredIndex] = useState<number | null>(null);
  const [tooltipPos, setTooltipPos] = useState<{ x: number; y: number } | null>(null);
  const [seriesVisible, setSeriesVisible] = useState({
    spend: true,
    registrations: true,
    sales: true,
    cac: true,
  });

  const hasAnyData =
    points &&
    points.some(
      (p) =>
        (p.spend && p.spend !== 0) ||
        (p.registrations && p.registrations !== 0) ||
        (p.sales && p.sales !== 0) ||
        (p.cac != null && !Number.isNaN(p.cac) && p.cac !== 0)
    );

  if (!points || points.length === 0 || !hasAnyData) {
    return (
      <div
        style={{
          border: "1px solid rgba(255,255,255,0.10)",
          borderRadius: 16,
          height: h,
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          opacity: 0.78,
        }}
      >
        Нет данных за выбранный период (или sync ещё не записал строки).
      </div>
    );
  }

  const maxSpend = Math.max(...points.map((p) => p.spend), 1);
  const maxReg = Math.max(...points.map((p) => p.registrations), 1);
  const maxSales = Math.max(...points.map((p) => p.sales), 1);
  const cacValues = points.map((p) => p.cac);
  const maxCac = Math.max(...cacValues.filter((v): v is number => v != null && !Number.isNaN(v)), 1);
  const isSinglePoint = points.length === 1;
  const xStep = points.length > 1 ? plotW / (points.length - 1) : 0;

  const yMap = (v: number, max: number) => pad + plotH * (1 - v / max);

  const xForIndex = (i: number) =>
    isSinglePoint ? leftPad + plotW / 2 : leftPad + i * xStep;

  const mkPath = (values: number[], max: number) => {
    const pts = values.map((v, i) => ({ x: xForIndex(i), y: yMap(v, max) }));
    if (pts.length === 0) return "";
    if (pts.length === 1) return `M ${pts[0]!.x.toFixed(2)} ${pts[0]!.y.toFixed(2)}`;
    let d = `M ${pts[0]!.x.toFixed(2)} ${pts[0]!.y.toFixed(2)}`;
    for (let i = 0; i < pts.length - 1; i++) {
      const p0 = pts[i]!;
      const p1 = pts[i + 1]!;
      const cx = ((p0.x + p1.x) / 2).toFixed(2);
      const cy = ((p0.y + p1.y) / 2).toFixed(2);
      d += ` Q ${p0.x.toFixed(2)} ${p0.y.toFixed(2)} ${cx} ${cy}`;
    }
    const last = pts[pts.length - 1]!;
    d += ` T ${last.x.toFixed(2)} ${last.y.toFixed(2)}`;
    return d;
  };

  const spendPath = mkPath(points.map((p) => p.spend), maxSpend);
  const regPath = mkPath(points.map((p) => p.registrations), maxReg);
  const salesPath = mkPath(points.map((p) => p.sales), maxSales);
  const cacPath = mkPathWithGaps(cacValues, (v, max) => yMap(v, max), maxCac, xForIndex);

  const handleMouseMove = (e: React.MouseEvent) => {
    const el = svgRef.current;
    const container = containerRef.current;
    if (!el || !container) return;
    const rect = el.getBoundingClientRect();
    const contRect = container.getBoundingClientRect();
    const xPx = e.clientX - rect.left;
    const yPx = e.clientY - rect.top;
    const viewBoxX = (xPx / rect.width) * w;
    const viewBoxY = (yPx / rect.height) * h;
    // Только область графика (без полей осей): иначе линия «срабатывала» в десятках px от линии.
    if (viewBoxX < leftPad || viewBoxX > w - pad || viewBoxY < pad || viewBoxY > h - bottomPad) {
      setHoveredIndex(null);
      setTooltipPos(null);
      return;
    }
    const rel = (viewBoxX - leftPad) / plotW;
    let idx = Math.round(rel * (points.length - 1));
    idx = Math.max(0, Math.min(idx, points.length - 1));
    setHoveredIndex(idx);
    const tx = e.clientX - contRect.left + 14;
    const ty = e.clientY - contRect.top - 8;
    const tw = 180;
    const th = 100;
    let clampX = tx;
    if (tx + tw > contRect.width) clampX = contRect.width - tw - 8;
    if (clampX < 8) clampX = 8;
    let clampY = ty;
    if (ty < 8) clampY = 8;
    if (ty + th > contRect.height - 8) clampY = contRect.height - th - 8;
    setTooltipPos({ x: clampX, y: clampY });
  };

  const handleMouseLeave = () => {
    setHoveredIndex(null);
    setTooltipPos(null);
  };

  const toggleSeries = (key: keyof typeof seriesVisible) => {
    setSeriesVisible((prev) => ({ ...prev, [key]: !prev[key] }));
  };

  const hovered = hoveredIndex != null ? points[hoveredIndex] : null;

  const yTicks = 5;
  const axisMax = maxSpend;

  return (
    <div
      ref={containerRef}
      style={{
        border: "1px solid rgba(255,255,255,0.10)",
        borderRadius: 16,
        padding: 12,
        position: "relative",
      }}
      onMouseLeave={handleMouseLeave}
    >
      <svg
        ref={svgRef}
        width="100%"
        viewBox={`0 0 ${w} ${h}`}
        preserveAspectRatio="none"
        style={{ display: "block" }}
        onMouseMove={handleMouseMove}
        onMouseLeave={handleMouseLeave}
      >
        {Array.from({ length: yTicks }).map((_, i) => {
          const y = pad + (plotH * i) / (yTicks - 1);
          const val = axisMax * (1 - i / (yTicks - 1));
          return (
            <g key={i}>
              <line
                x1={leftPad}
                x2={w - pad}
                y1={y}
                y2={y}
                stroke="rgba(255,255,255,0.06)"
                strokeWidth="1"
              />
              <text
                x={leftPad - 6}
                y={y + 4}
                fill="rgba(255,255,255,0.5)"
                fontSize="10"
                textAnchor="end"
              >
                {formatAxisValue(val)}
              </text>
            </g>
          );
        })}

        {seriesVisible.spend && (
          <path d={spendPath} fill="none" stroke={CHART_COLORS.spend} strokeWidth="3" />
        )}
        {seriesVisible.registrations && (
          <path d={regPath} fill="none" stroke={CHART_COLORS.registrations} strokeWidth="2.5" />
        )}
        {seriesVisible.sales && (
          <path d={salesPath} fill="none" stroke={CHART_COLORS.sales} strokeWidth="2.5" />
        )}
        {seriesVisible.cac && (
          <path d={cacPath} fill="none" stroke={CHART_COLORS.cac} strokeWidth="2.5" />
        )}

        {isSinglePoint && points[0] && (
          <g aria-hidden="true">
            {seriesVisible.spend && (
              <circle
                cx={xForIndex(0)}
                cy={yMap(points[0].spend, maxSpend)}
                r={6}
                fill={CHART_COLORS.spend}
                stroke="rgba(255,255,255,0.5)"
                strokeWidth="1.5"
              />
            )}
            {seriesVisible.registrations && (
              <circle
                cx={xForIndex(0)}
                cy={yMap(points[0].registrations, maxReg)}
                r={6}
                fill={CHART_COLORS.registrations}
                stroke="rgba(255,255,255,0.5)"
                strokeWidth="1.5"
              />
            )}
            {seriesVisible.sales && (
              <circle
                cx={xForIndex(0)}
                cy={yMap(points[0].sales, maxSales)}
                r={6}
                fill={CHART_COLORS.sales}
                stroke="rgba(255,255,255,0.5)"
                strokeWidth="1.5"
              />
            )}
            {seriesVisible.cac && points[0].cac != null && !Number.isNaN(points[0].cac) && (
              <circle
                cx={xForIndex(0)}
                cy={yMap(points[0].cac, maxCac)}
                r={6}
                fill={CHART_COLORS.cac}
                stroke="rgba(255,255,255,0.5)"
                strokeWidth="1.5"
              />
            )}
          </g>
        )}

        {hoveredIndex != null && (
          <line
            x1={xForIndex(hoveredIndex)}
            x2={xForIndex(hoveredIndex)}
            y1={pad}
            y2={h - bottomPad}
            stroke="rgba(255,255,255,0.35)"
            strokeWidth="1"
            strokeDasharray="4 2"
          />
        )}

        <text x={leftPad} y={h - 6} fill="rgba(255,255,255,0.55)" fontSize="11">
          {fmtRuDate(points[0].date)}
        </text>
        <text x={w - pad - 72} y={h - 6} fill="rgba(255,255,255,0.55)" fontSize="11" textAnchor="end">
          {fmtRuDate(points[points.length - 1].date)}
        </text>
      </svg>

      {hovered && tooltipPos && (
        <div
          style={{
            position: "absolute",
            left: tooltipPos.x,
            top: tooltipPos.y,
            padding: "10px 12px",
            borderRadius: 10,
            border: "1px solid rgba(255,255,255,0.15)",
            background: "rgba(20,20,28,0.96)",
            boxShadow: "0 8px 24px rgba(0,0,0,0.4)",
            fontSize: 12,
            color: "rgba(255,255,255,0.95)",
            whiteSpace: "nowrap",
            zIndex: 10,
            pointerEvents: "none",
          }}
        >
          <div style={{ fontWeight: 700, marginBottom: 6 }}>{fmtRuDate(hovered.date)}</div>
          {seriesVisible.spend && (
            <div style={{ opacity: 0.9 }}>Spend: {formatMoney(hovered.spend)}</div>
          )}
          {seriesVisible.registrations && (
            <div style={{ opacity: 0.9 }}>Registrations: {hovered.registrations}</div>
          )}
          {seriesVisible.sales && (
            <div style={{ opacity: 0.9 }}>Sales: {hovered.sales}</div>
          )}
          {seriesVisible.cac && (
            <div style={{ opacity: 0.9 }}>
              CAC: {hovered.cac != null ? formatMoney(hovered.cac) : "—"}
            </div>
          )}
        </div>
      )}

      <div
        style={{
          display: "flex",
          gap: 10,
          marginTop: 10,
          fontSize: 12,
          flexWrap: "wrap",
          alignItems: "center",
        }}
      >
        {(
          [
            { key: "spend" as const, label: "Spend" },
            { key: "registrations" as const, label: "Registrations" },
            { key: "sales" as const, label: "Sales" },
            { key: "cac" as const, label: "CAC" },
          ] as const
        ).map(({ key, label }) => (
          <button
            key={key}
            type="button"
            onClick={() => toggleSeries(key)}
            style={{
              display: "inline-flex",
              alignItems: "center",
              gap: 4,
              padding: "4px 8px",
              border: "none",
              borderRadius: 6,
              background: "transparent",
              color: seriesVisible[key] ? CHART_COLORS[key] : "rgba(255,255,255,0.4)",
              cursor: "pointer",
              fontSize: 12,
              opacity: seriesVisible[key] ? 1 : 0.6,
            }}
          >
            <span>●</span>
            <span>{label}</span>
          </button>
        ))}
      </div>
    </div>
  );
}

const PLATFORM_LABELS: Record<string, string> = {
  meta: "Meta",
  google: "Google",
  tiktok: "TikTok",
  yandex: "Yandex",
};

type DashboardAccount = {
  id: string;
  name: string | null;
  platform_account_id: string;
  platform: string;
  is_enabled: boolean;
};

type IntegrationStatusValue = "healthy" | "error" | "stale" | "disconnected" | "no_accounts" | "not_connected";

type IntegrationStatusRow = {
  platform: string;
  connected: boolean;
  oauth_valid: boolean;
  enabled_accounts: number;
  status: IntegrationStatusValue;
  reason: string | null;
  token_reason_code?: string | null;
  token_temporary?: boolean | null;
  last_recovery_attempt_at?: string | null;
  last_sync_status?: string | null;
  last_sync_at?: string | null;
  last_sync_error?: string | null;
  data_max_date?: string | null;
};

function parseEnvMinutes(raw: string | undefined, fallback: number): number {
  const parsed = Number(raw);
  if (!Number.isFinite(parsed) || parsed <= 0) return fallback;
  return Math.floor(parsed);
}

const ONLINE_STALE_MIN = parseEnvMinutes(process.env.NEXT_PUBLIC_SYNC_STATUS_ONLINE_STALE_MIN, 30);
const ONLINE_ERROR_MIN = parseEnvMinutes(process.env.NEXT_PUBLIC_SYNC_STATUS_ONLINE_ERROR_MIN, 180);
const OFFLINE_STALE_MIN = parseEnvMinutes(process.env.NEXT_PUBLIC_SYNC_STATUS_OFFLINE_STALE_MIN, 360);
const OFFLINE_ERROR_MIN = parseEnvMinutes(process.env.NEXT_PUBLIC_SYNC_STATUS_OFFLINE_ERROR_MIN, 720);

/** UTC calendar day; must match `resolveDataStatus` in `/api/oauth/integration/status`. */
function utcTodayYmd(): string {
  return new Date().toISOString().slice(0, 10);
}

function calendarDayBeforeUtc(isoDate: string): string {
  const d = new Date(isoDate + "T12:00:00Z");
  d.setUTCDate(d.getUTCDate() - 1);
  return d.toISOString().slice(0, 10);
}

function maxIsoDate(a: string, b: string): string {
  return a > b ? a : b;
}

/** Matches server refresh clamp: when end === UTC today, sync window is max(start, yesterday)…today. */
function narrowRefreshRangeForTodayEnd(start: string, end: string): { start: string; end: string } {
  const today = utcTodayYmd();
  if (end !== today) return { start, end };
  const yesterday = calendarDayBeforeUtc(today);
  return { start: maxIsoDate(start, yesterday), end: today };
}

export default function AppDashboardClient() {
  const router = useRouter();
  const sp = useSearchParams();
  const { resolvedUi, bootstrap } = useBillingBootstrap();
  const { requestBillingPricingModal } = useBillingPricingModalRequest();
  const projectId = sp.get("project_id") || "";
  const syncAllowed = billingActionAllowed(resolvedUi, ActionId.sync_refresh);
  const syncWallClickable =
    !syncAllowed && isBillingBlocking(resolvedUi) && canOfferBillingInlinePricing(resolvedUi);
  const dashboardWidgetPack = useMemo(() => resolveDashboardWidgetState(resolvedUi), [resolvedUi]);
  const attributionLimited = useMemo(() => {
    const m = bootstrap?.plan_feature_matrix;
    return Boolean(m && m.attribution_heavy === false && dashboardWidgetPack.state !== "BLOCKED");
  }, [bootstrap?.plan_feature_matrix, dashboardWidgetPack.state]);
  const refreshBaselineKey = `${REFRESH_BASELINE_SESSION_KEY}:${projectId}`;

  const entryStaleAutoRefreshPendingRef = useRef(true);
  /** One deferred refresh after first bundle when read-only mode reports coverage gaps (no implicit sync from GET). */
  const entryReadOnlyGapRefreshPendingRef = useRef(true);
  const prevProjectIdForStaleRef = useRef<string>("");
  if (prevProjectIdForStaleRef.current !== projectId) {
    prevProjectIdForStaleRef.current = projectId;
    entryStaleAutoRefreshPendingRef.current = true;
    entryReadOnlyGapRefreshPendingRef.current = true;
  }

  useEffect(() => {
    if (!projectId) return;
    if (!billingActionAllowed(resolvedUi, ActionId.navigate_app)) return;
    void fetch(`/api/projects/${encodeURIComponent(projectId)}/touch`, { method: "POST" }).catch(() => null);
  }, [projectId, resolvedUi]);

  const [selectedSources, setSelectedSources] = useState<string[]>([]);
  const [selectedAccountIds, setSelectedAccountIds] = useState<string[]>([]);
  const [dashboardAccounts, setDashboardAccounts] = useState<DashboardAccount[]>([]);
  const [sourcesOpen, setSourcesOpen] = useState(false);
  const [accountsOpen, setAccountsOpen] = useState(false);
  const sourcesDropdownRef = useRef<HTMLDivElement>(null);
  const accountsDropdownRef = useRef<HTMLDivElement>(null);
  const [kpiSummary, setKpiSummary] = useState<KpiSummary | null>(null);
  const [activeSourceOptions, setActiveSourceOptions] = useState<SourceOption[]>([]);

  const enabledAccounts = useMemo(
    () => dashboardAccounts.filter((a) => a.is_enabled),
    [dashboardAccounts]
  );

  const initial = useMemo(() => {
    const d = new Date();
    return {
      from: toISO(new Date(d.getFullYear(), d.getMonth(), 1)),
      to: toISO(d),
    };
  }, []);

  // Draft: what user sees/edits in the date inputs
  const [draftDateFrom, setDraftDateFrom] = useState<string>(initial.from);
  const [draftDateTo, setDraftDateTo] = useState<string>(initial.to);

  // Applied: what we fetch with (set on Apply click)
  const [appliedDateFrom, setAppliedDateFrom] = useState<string>(initial.from);
  const [appliedDateTo, setAppliedDateTo] = useState<string>(initial.to);

  const [loading, setLoading] = useState(false);
  const [syncLoading, setSyncLoading] = useState(false);
  /** Manual Full re-sync in progress (separate from safe auto-refresh). */
  const [fullResyncPending, setFullResyncPending] = useState(false);
  const [fullResyncBanner, setFullResyncBanner] = useState<string | null>(null);
  const fullResyncRunIdRef = useRef<string | null>(null);
  const fullResyncPendingRef = useRef(false);
  useEffect(() => {
    fullResyncPendingRef.current = fullResyncPending;
  }, [fullResyncPending]);
  const refreshAndReloadRef = useRef<() => Promise<boolean>>(async () => false);
  const freshnessCheckInFlightRef = useRef<Promise<boolean> | null>(null);
  const lastFreshnessCheckAtRef = useRef(0);
  const prevAppliedRangeKeyRef = useRef<string | null>(null);
  const [errorText, setErrorText] = useState<string | null>(null);

  const [summary, setSummary] = useState<Summary>({ spend: 0 });
  const [points, setPoints] = useState<Point[]>([]);
  const [conversionSeries, setConversionSeries] = useState<ConversionSeriesPoint[]>([]);
  const [updatedAt, setUpdatedAt] = useState<string | null>(null);
  const [lastOkAt, setLastOkAt] = useState<string | null>(null);

  const [showAdvanced, setShowAdvanced] = useState(false);
  const [lastDebug, setLastDebug] = useState<any>(null);
  const prevAccountCountRef = useRef<number>(0);
  const [connectionLost, setConnectionLost] = useState(false);
  const [dashboardIntegrationStatus, setDashboardIntegrationStatus] = useState<IntegrationStatusRow[]>([]);
  /** False until first integration-status request for this project settles (avoids false "No integrations" while accounts + status load). */
  const [integrationStatusHydrated, setIntegrationStatusHydrated] = useState(false);
  const primedIntegrationAfterBundleRef = useRef<string | null>(null);
  const [isUserContextOnline, setIsUserContextOnline] = useState(true);
  const [projectCurrency, setProjectCurrency] = useState<ProjectCurrency>("USD");
  const [usdToKztRate, setUsdToKztRate] = useState<number | null>(null);
  const [projectMinDate, setProjectMinDate] = useState<string | null>(null);
  const [backgroundReady, setBackgroundReady] = useState(false);

  const fetchDashboardIntegrationStatus = useCallback(async (pid: string, opts?: { signal?: AbortSignal; force?: boolean }) => {
    const signal = opts?.signal;
    if (!pid) {
      if (!signal?.aborted) {
        setDashboardIntegrationStatus([]);
        setIntegrationStatusHydrated(true);
      }
      return;
    }
    try {
      const res = await getSharedCached(
        `integration-status:${pid}`,
        () =>
          fetch(`/api/oauth/integration/status?project_id=${encodeURIComponent(pid)}`, {
            cache: "no-store",
            signal,
          }),
        { ttlMs: 45_000, force: opts?.force === true }
      );
      const json = (await res.json()) as { success?: boolean; integrations?: IntegrationStatusRow[] };
      if (signal?.aborted) return;
      setDashboardIntegrationStatus(json?.integrations ?? []);
    } catch (e) {
      if (signal?.aborted || isAbortError(e)) return;
      setDashboardIntegrationStatus([]);
    } finally {
      if (!signal?.aborted) setIntegrationStatusHydrated(true);
    }
  }, []);

  /** Historical backfill: source of truth is summary + timeseries backfill metadata. Used for banner and refetch polling. */
  const [historicalBackfill, setHistoricalBackfill] = useState<{
    started: boolean;
    intervals: { start: string; end: string }[];
  } | null>(null);
  const backfillTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const backfillAttemptRef = useRef(0);
  const MAX_BACKFILL_ATTEMPTS = 12;
  const BACKFILL_POLL_INTERVAL_MS = 10000;

  useEffect(() => {
    const prev = prevAccountCountRef.current;
    const curr = dashboardAccounts.length;
    if (curr < prev && prev > 0) setConnectionLost(true);
    else if (curr >= prev) setConnectionLost(false);
    prevAccountCountRef.current = curr;
  }, [dashboardAccounts.length]);

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

  useEffect(() => {
    if (!projectId) {
      setProjectCurrency("USD");
      return;
    }
    let cancelled = false;
    (async () => {
      try {
        const res = await getSharedCached(
          `projects-currency:${projectId}`,
          () =>
            fetch(`/api/projects/currency?project_id=${encodeURIComponent(projectId)}`, {
              cache: "no-store",
            }),
          { ttlMs: 120_000 }
        );
        const json = await res.json();
        if (cancelled) return;
        if (res.ok && json?.success && typeof json.currency === "string") {
          setProjectCurrency(json.currency.toUpperCase() === "KZT" ? "KZT" : "USD");
        }
      } catch {
        if (!cancelled) setProjectCurrency("USD");
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [projectId]);

  useEffect(() => {
    if (projectCurrency !== "KZT") {
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
  }, [projectCurrency, resolvedUi]);

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
        if (cancelled) return;
        setDashboardAccounts(json?.accounts ?? []);
      } catch {
        if (!cancelled) setDashboardAccounts([]);
      }
    })();
    return () => { cancelled = true; };
  }, [projectId]);

  useEffect(() => {
    if (typeof window === "undefined") return;
    const compute = () => {
      const online = navigator.onLine;
      const visible = document.visibilityState === "visible";
      setIsUserContextOnline(online && visible);
    };
    compute();
    window.addEventListener("online", compute);
    window.addEventListener("offline", compute);
    document.addEventListener("visibilitychange", compute);
    return () => {
      window.removeEventListener("online", compute);
      window.removeEventListener("offline", compute);
      document.removeEventListener("visibilitychange", compute);
    };
  }, []);

  useEffect(() => {
    if (!projectId) {
      setDashboardIntegrationStatus([]);
      setIntegrationStatusHydrated(true);
      primedIntegrationAfterBundleRef.current = null;
      return;
    }
    setIntegrationStatusHydrated(false);
    primedIntegrationAfterBundleRef.current = null;
    const ac = new AbortController();
    ignoreAbortRejection(
      fetchDashboardIntegrationStatus(projectId, { signal: ac.signal }),
      "dashboard integration status"
    );
    return () => safeAbortController(ac);
  }, [projectId, fetchDashboardIntegrationStatus]);

  const fetchDashboardIntegrationStatusRef = useRef(fetchDashboardIntegrationStatus);
  fetchDashboardIntegrationStatusRef.current = fetchDashboardIntegrationStatus;
  const dashboardStatusVisRefreshRef = useRef(0);
  useEffect(() => {
    if (!projectId) return;
    const onVis = () => {
      if (document.visibilityState !== "visible") return;
      const now = Date.now();
      if (now - dashboardStatusVisRefreshRef.current < 45_000) return;
      dashboardStatusVisRefreshRef.current = now;
      const ac = new AbortController();
      ignoreAbortRejection(
        fetchDashboardIntegrationStatusRef.current(projectId, { signal: ac.signal }),
        "dashboard integration status (visibility)"
      );
    };
    document.addEventListener("visibilitychange", onVis);
    return () => document.removeEventListener("visibilitychange", onVis);
  }, [projectId]);

  const adaptiveIntegrationStatus = useMemo(() => {
    const staleMin = isUserContextOnline ? ONLINE_STALE_MIN : OFFLINE_STALE_MIN;
    const errorMin = isUserContextOnline ? ONLINE_ERROR_MIN : OFFLINE_ERROR_MIN;
    const now = Date.now();
    const todayUtc = utcTodayYmd();

    function ageMinutes(iso: string | null | undefined): number | null {
      if (!iso) return null;
      const ms = Date.parse(iso);
      if (!Number.isFinite(ms)) return null;
      return Math.max(0, Math.floor((now - ms) / 60000));
    }

    return dashboardIntegrationStatus.map((row) => {
      const current = row.status;
      if (current === "not_connected" || current === "disconnected" || current === "no_accounts") {
        return row;
      }
      if (row.reason === "sync_failed") {
        return { ...row, status: "error" as const };
      }
      // Same rule as server `resolveDataStatus`: fresh data for UTC today → healthy; do not downgrade by sync age.
      if (row.data_max_date && row.data_max_date >= todayUtc) {
        return { ...row, status: "healthy" as const, reason: null };
      }
      const ageMin = ageMinutes(row.last_sync_at);
      if (ageMin == null) return row;
      if (ageMin >= errorMin) return { ...row, status: "error" as const, reason: "sync_old" };
      if (ageMin >= staleMin) return { ...row, status: "stale" as const, reason: "sync_old" };
      return { ...row, status: "healthy" as const, reason: null };
    });
  }, [dashboardIntegrationStatus, isUserContextOnline]);

  const staleStatusTooltip = useMemo(() => {
    const on = `online: stale after ${ONLINE_STALE_MIN} min without sync, error after ${ONLINE_ERROR_MIN} min`;
    const off = `offline: stale after ${OFFLINE_STALE_MIN} min, error after ${OFFLINE_ERROR_MIN} min`;
    return `Data may be behind, or last sync passed the threshold (${on}; ${off}). Data for UTC today is treated as healthy.`;
  }, []);

  // Source options (platforms + source classes) for Sources dropdown.
  useEffect(() => {
    if (!projectId) {
      setActiveSourceOptions([]);
      return;
    }

    let cancelled = false;
    (async () => {
      try {
        const params = new URLSearchParams({
          project_id: projectId,
          start: appliedDateFrom,
          end: appliedDateTo,
        });
        const res = await getSharedCached(
          `dashboard-source-options:${projectId}:${appliedDateFrom}:${appliedDateTo}`,
          () =>
            fetch(`/api/dashboard/source-options?${params.toString()}`, {
              cache: "no-store",
            }),
          { ttlMs: 90_000 }
        );
        const json = await res.json();
        if (cancelled) return;
        if (res.ok && json?.success && Array.isArray(json.options)) {
          setActiveSourceOptions(json.options as SourceOption[]);
        } else {
          // Fallback: platforms only from enabled accounts.
          const platforms = [...new Set(enabledAccounts.map((a) => a.platform))].filter(Boolean);
          const base = platforms.map((id) => ({
            id,
            label: PLATFORM_LABELS[id] ?? id,
            type: "platform" as const,
          }));
          setActiveSourceOptions(base);
        }
      } catch {
        if (cancelled) return;
        const platforms = [...new Set(enabledAccounts.map((a) => a.platform))].filter(Boolean);
        const base = platforms.map((id) => ({
          id,
          label: PLATFORM_LABELS[id] ?? id,
          type: "platform" as const,
        }));
        setActiveSourceOptions(base);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [projectId, appliedDateFrom, appliedDateTo, enabledAccounts]);

  // Abort + гонки
  const abortRef = useRef<AbortController | null>(null);
  const reqSeqRef = useRef(0);

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
  function appliedKey() {
    return `${projectId}:${appliedDateFrom}:${appliedDateTo}:${sourcesKey}:${accountIdsKey}`;
  }

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

  function clearBackfillPolling() {
    if (backfillTimeoutRef.current != null) {
      clearTimeout(backfillTimeoutRef.current);
      backfillTimeoutRef.current = null;
    }
    backfillAttemptRef.current = 0;
    setHistoricalBackfill(null);
  }

  const isSupportedNow = true;

  async function loadFromDb(
    signal?: AbortSignal,
    overrideStart?: string,
    overrideEnd?: string
  ) {
    if (!projectId) {
      setErrorText("Нет project_id в URL. Открой /app?project_id=...");
      return;
    }

    const start = overrideStart ?? appliedDateFrom;
    const end = overrideEnd ?? appliedDateTo;
    if (!start || !end || start > end) return;

    setLoading(true);
    setErrorText(null);

    const mySeq = ++reqSeqRef.current;

    const params = new URLSearchParams({
      project_id: projectId,
      start,
      end,
    });
    if (effectiveSources.length) params.set("sources", effectiveSources.join(","));
    if (effectiveAccountIds.length) params.set("account_ids", effectiveAccountIds.join(","));

    try {
      const qs = params.toString();

      const bundleRes = await fetch(`/api/dashboard/bundle?${qs}`, { cache: "no-store", signal });
      const bundleText = await bundleRes.text();
      const bundleJson = bundleText ? JSON.parse(bundleText) : null;

      if (!bundleRes.ok || !bundleJson?.success) {
        const apiErr = extractApiError(bundleJson);
        throw new Error(apiErr || bundleJson?.error?.message || bundleJson?.error || "bundle: ошибка");
      }

      const sJson = bundleJson.summary;
      const tJson = bundleJson.timeseries;
      const kJson = bundleJson.kpi;
      const cJson = bundleJson.timeseriesConversions;

      console.log("[SUMMARY_RESPONSE_RAW]", { ok: true, totals: sJson?.totals, source: sJson?.source, raw: sJson });
      console.log("[TIMESERIES_RESPONSE_RAW]", { ok: true, pointsCount: tJson?.points?.length, firstSpend: tJson?.points?.[0]?.spend, raw: tJson });

      if (!sJson?.success) {
        const apiErr = extractApiError(sJson);
        throw new Error(apiErr || sJson?.error?.message || sJson?.error || "summary: ошибка");
      }
      if (!tJson?.success) {
        const apiErr = extractApiError(tJson);
        throw new Error(apiErr || tJson?.error?.message || tJson?.error || "timeseries: ошибка");
      }

      if (!kJson?.success) {
        const apiErr = (kJson && (kJson.error || kJson.message)) || "";
        console.warn("[KPI_CONVERSIONS_ERROR]", apiErr || "unknown");
        setKpiSummary(null);
      } else {
        setKpiSummary({
          registrations: Number(kJson.registrations ?? 0) || 0,
          sales: Number(kJson.sales ?? 0) || 0,
          revenue: Number(kJson.revenue ?? 0) || 0,
          has_direct: Boolean(kJson.has_direct),
        });
      }

      if (mySeq !== reqSeqRef.current) return false;

      const apiUpdated = safeIso(sJson?.updated_at) || safeIso(sJson?.server_time);
      setUpdatedAt(apiUpdated || new Date().toISOString());
      setLastOkAt(new Date().toISOString());

      const totals = sJson?.totals ?? {};
      const nextSummary = {
        spend: Number(totals.spend ?? 0) || 0,
        impressions: Number(totals.impressions ?? 0) || 0,
        clicks: Number(totals.clicks ?? 0) || 0,
      };
      console.log("[STATE_SET_SUMMARY]", { totals, parsed: nextSummary });
      setSummary(nextSummary);

      const pts = (tJson?.points ?? []).map((p: any) => ({
        date: String(p.date),
        spend: Number(p.spend ?? 0) || 0,
      })) as Point[];
      console.log("[STATE_SET_POINTS]", { pointsCount: pts.length, firstSpend: pts[0]?.spend, sample: pts.slice(0, 2) });
      setPoints(pts);

      if (cJson?.success && Array.isArray(cJson.points)) {
        setConversionSeries(
          (cJson.points as { date: string; registrations: number; sales: number }[]).map((p) => ({
            date: String(p.date),
            registrations: Number(p.registrations ?? 0) || 0,
            sales: Number(p.sales ?? 0) || 0,
          }))
        );
      } else {
        setConversionSeries([]);
      }

      const backfillMeta = (sJson?.backfill ?? tJson?.backfill) as
        | {
            historical_sync_started?: boolean;
            range_partially_covered?: boolean;
            read_only_no_sync?: boolean;
            intervals?: { start: string; end: string }[];
          }
        | undefined;
      const hasHistoricalBackfill =
        backfillMeta?.historical_sync_started === true || backfillMeta?.range_partially_covered === true;
      const readOnlyCoverageGap =
        backfillMeta?.read_only_no_sync === true && backfillMeta?.range_partially_covered === true;

      if (hasHistoricalBackfill) {
        setHistoricalBackfill({
          started: true,
          intervals: Array.isArray(backfillMeta?.intervals) ? backfillMeta.intervals : [],
        });
        if (backfillAttemptRef.current < MAX_BACKFILL_ATTEMPTS) {
          if (backfillTimeoutRef.current != null) clearTimeout(backfillTimeoutRef.current);
          const scheduleBackfillPoll = () => {
            backfillTimeoutRef.current = setTimeout(() => {
              backfillTimeoutRef.current = null;
              if (typeof window !== "undefined") {
                if (!navigator.onLine || document.visibilityState !== "visible") {
                  scheduleBackfillPoll();
                  return;
                }
              }
              backfillAttemptRef.current += 1;
              const c = makeController();
              ignoreAbortRejection(loadFromDb(c.signal, start, end), "dashboard backfill poll");
            }, BACKFILL_POLL_INTERVAL_MS);
          };
          scheduleBackfillPoll();
        }
      } else {
        clearBackfillPolling();
      }

      setLastDebug({
        bundle: bundleJson,
        summary: sJson,
        timeseries: tJson,
        params: { projectId, start, end, effectiveSources, effectiveAccountIds },
      });

      if (mySeq !== reqSeqRef.current) return false;

      if (entryStaleAutoRefreshPendingRef.current) {
        entryStaleAutoRefreshPendingRef.current = false;
        const fr = bundleJson.freshness as { is_stale?: boolean } | undefined;
        if (
          !hasHistoricalBackfill &&
          fr?.is_stale &&
          typeof window !== "undefined" &&
          navigator.onLine &&
          document.visibilityState === "visible" &&
          !fullResyncPendingRef.current &&
          !isPostRefreshGuardActive()
        ) {
          void refreshAndReloadRef.current();
        }
      }

      if (entryReadOnlyGapRefreshPendingRef.current) {
        if (!readOnlyCoverageGap) {
          entryReadOnlyGapRefreshPendingRef.current = false;
        } else if (
          typeof window !== "undefined" &&
          navigator.onLine &&
          document.visibilityState === "visible" &&
          !fullResyncPendingRef.current &&
          !isPostRefreshGuardActive()
        ) {
          entryReadOnlyGapRefreshPendingRef.current = false;
          void refreshAndReloadRef.current();
        }
      }

      // Sidebar «Сегодня» грузит свои цифры отдельно; без события оно остаётся старым после смены фильтра на главном борде.
      const utcToday = new Date().toISOString().slice(0, 10);
      const localToday = toISO(new Date());
      const rangeTouchesToday =
        (start <= utcToday && end >= utcToday) || (start <= localToday && end >= localToday);
      if (rangeTouchesToday && typeof window !== "undefined") {
        window.setTimeout(() => {
          window.dispatchEvent(new Event(SIDEBAR_TODAY_REFRESH_EVENT));
        }, 0);
      }

      if (mySeq !== reqSeqRef.current) return false;

      // One forced integration-status fetch after first successful bundle per project: session + project context are stable; refreshes stale shared cache.
      if (primedIntegrationAfterBundleRef.current !== projectId) {
        primedIntegrationAfterBundleRef.current = projectId;
        void fetchDashboardIntegrationStatus(projectId, { force: true });
      }
    } catch (e: any) {
      if (isAbortError(e)) return;
      clearBackfillPolling();
      setErrorText(toErrorText(e));
      // Keep previous summary/points visible on error
    } finally {
      // Only the latest in-flight request may clear loading (avoids stale requests turning spinner off early).
      if (mySeq === reqSeqRef.current) setLoading(false);
    }
  }

  async function refreshAndReload(): Promise<boolean> {
    if (!projectId) return false;
    if (isInvalidApplied) return false;
    if (!isSupportedNow) return false;
    if (!billingActionAllowed(resolvedUi, ActionId.sync_refresh)) {
      setErrorText("Синхронизация недоступна в текущем режиме подписки.");
      return false;
    }

    const c = makeController();
    const mySeq = ++reqSeqRef.current;

    setSyncLoading(true);
    setErrorText(null);

    let ok = false;
    try {
      const refreshRange = narrowRefreshRangeForTodayEnd(appliedDateFrom, appliedDateTo);
      const r = await fetch("/api/dashboard/refresh", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          project_id: projectId,
          start: refreshRange.start,
          end: refreshRange.end,
          sources: effectiveSources,
          account_ids: effectiveAccountIds,
        }),
        signal: c.signal,
      });

      const text = await r.text();
      let json: any = null;
      try {
        json = text ? JSON.parse(text) : null;
      } catch {
        json = null;
      }

      if (!r.ok || !json?.success) {
        const apiErr = extractApiError(json);
        const human =
          apiErr ||
          (text ? text.slice(0, 500) : "") ||
          `HTTP ${r.status} ${r.statusText || ""}`.trim();
        throw new Error(`Refresh failed (${r.status} ${r.statusText}): ${human}`.trim());
      }

      if (mySeq !== reqSeqRef.current) return false;

      const fromApi = safeIso(json?.refreshed_at) || safeIso(json?.sync?.refreshed_at);
      setUpdatedAt(fromApi || new Date().toISOString());

      await loadFromDb(c.signal);

      await fetchDashboardIntegrationStatus(projectId, { force: true });
      try {
        sessionStorage.setItem(refreshBaselineKey, String(Date.now()));
      } catch {
        // ignore
      }

      if (typeof window !== "undefined") {
        window.setTimeout(() => {
          window.dispatchEvent(new Event(SIDEBAR_TODAY_REFRESH_EVENT));
        }, 0);
      }
      ok = true;
    } catch (e: any) {
      if (isAbortError(e)) return false;
      setErrorText(toErrorText(e));
      ok = false;
    } finally {
      setSyncLoading(false);
    }

    return ok;
  }

  refreshAndReloadRef.current = refreshAndReload;

  function readRefreshBaselineAgeMs(): number | null {
    if (typeof window === "undefined") return null;
    try {
      const raw = Number(sessionStorage.getItem(refreshBaselineKey) ?? 0) || 0;
      if (!raw) return null;
      return Math.max(0, Date.now() - raw);
    } catch {
      return null;
    }
  }

  function isPostRefreshGuardActive(): boolean {
    const ageMs = readRefreshBaselineAgeMs();
    return ageMs != null && ageMs < POST_REFRESH_GUARD_MS;
  }

  async function checkFreshnessAndMaybeRefresh(reason: "interval" | "visible" | "reconnect"): Promise<boolean> {
    if (!projectId) return false;
    if (!isSupportedNow) return false;
    if (typeof window === "undefined") return false;
    if (!navigator.onLine || document.visibilityState !== "visible") return false;
    if (loading || syncLoading || fullResyncPendingRef.current) return false;
    if (isPostRefreshGuardActive()) return false;

    const now = Date.now();
    if (now - lastFreshnessCheckAtRef.current < FRESHNESS_MIN_CHECK_INTERVAL_MS) return false;
    if (freshnessCheckInFlightRef.current) return freshnessCheckInFlightRef.current;
    lastFreshnessCheckAtRef.current = now;

    const task = (async () => {
      try {
        const r = await fetch(
          `/api/dashboard/freshness?project_id=${encodeURIComponent(projectId)}`,
          { cache: "no-store" }
        );
        const j = await r.json().catch(() => null);
        if (!r.ok || !j?.success || !j?.freshness) return false;
        if (!j.freshness.is_stale) return false;
        if (isPostRefreshGuardActive()) return false;
        if (fullResyncPendingRef.current) return false;
        console.log("[BOARD_AUTO_REFRESH_STALE]", { projectId, plan: j.freshness?.plan, reason });
        const ok = await refreshAndReloadRef.current();
        if (!ok) return false;
        try {
          sessionStorage.setItem(AUTO_REFRESH_SESSION_KEY, String(Date.now()));
        } catch {
          // ignore
        }
        return true;
      } catch {
        return false;
      } finally {
        freshnessCheckInFlightRef.current = null;
      }
    })();

    freshnessCheckInFlightRef.current = task;
    return task;
  }

  async function runFullResync(): Promise<void> {
    if (!projectId) return;
    if (isInvalidApplied) return;
    if (!isSupportedNow) return;
    if (fullResyncPending || syncLoading) return;
    if (!billingActionAllowed(resolvedUi, ActionId.sync_refresh)) {
      setErrorText("Полная синхронизация недоступна в текущем режиме подписки.");
      return;
    }

    const runId = crypto.randomUUID();
    const snapFrom = appliedDateFrom;
    const snapTo = appliedDateTo;
    fullResyncRunIdRef.current = runId;
    setFullResyncPending(true);
    setFullResyncBanner(null);
    setErrorText(null);

    const c = makeController();
    try {
      const r = await fetch("/api/dashboard/refresh", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          project_id: projectId,
          start: snapFrom,
          end: snapTo,
          force_full_sync: true,
          sources: effectiveSources,
          account_ids: effectiveAccountIds,
        }),
        signal: c.signal,
      });
      const text = await r.text();
      let json: any = null;
      try {
        json = text ? JSON.parse(text) : null;
      } catch {
        json = null;
      }

      if (fullResyncRunIdRef.current !== runId) return;
      if (appliedDateFrom !== snapFrom || appliedDateTo !== snapTo) return;

      if (!r.ok || !json?.success) {
        const apiErr = extractApiError(json);
        const human =
          apiErr ||
          (text ? text.slice(0, 500) : "") ||
          `HTTP ${r.status} ${r.statusText || ""}`.trim();
        throw new Error(`Full re-sync failed (${r.status}): ${human}`.trim());
      }

      if (json?.sync?.skipped === true) {
        setFullResyncBanner(
          "Синхронизация пропущена (защита от дублей). Повторите Full re-sync позже или дождитесь фонового обновления."
        );
      }

      if (fullResyncRunIdRef.current !== runId) return;
      if (appliedDateFrom !== snapFrom || appliedDateTo !== snapTo) return;

      const fromApi = safeIso(json?.refreshed_at) || safeIso(json?.sync?.refreshed_at);
      setUpdatedAt(fromApi || new Date().toISOString());

      await loadFromDb(c.signal);

      if (fullResyncRunIdRef.current !== runId) return;
      if (appliedDateFrom !== snapFrom || appliedDateTo !== snapTo) return;

      await fetchDashboardIntegrationStatus(projectId, { force: true });
      try {
        sessionStorage.setItem(refreshBaselineKey, String(Date.now()));
      } catch {
        // ignore
      }

      if (fullResyncRunIdRef.current !== runId) return;
      if (appliedDateFrom !== snapFrom || appliedDateTo !== snapTo) return;

      if (typeof window !== "undefined") {
        window.setTimeout(() => {
          window.dispatchEvent(new Event(SIDEBAR_TODAY_REFRESH_EVENT));
        }, 0);
      }
    } catch (e: any) {
      if (isAbortError(e)) return;
      if (fullResyncRunIdRef.current !== runId) return;
      setErrorText(toErrorText(e));
    } finally {
      if (fullResyncRunIdRef.current === runId) {
        fullResyncRunIdRef.current = null;
        setFullResyncPending(false);
      }
    }
  }

  useEffect(() => {
    const key = `${appliedDateFrom}|${appliedDateTo}`;
    if (prevAppliedRangeKeyRef.current === null) {
      prevAppliedRangeKeyRef.current = key;
      return;
    }
    if (prevAppliedRangeKeyRef.current === key) return;
    prevAppliedRangeKeyRef.current = key;
    if (fullResyncPending) {
      fullResyncRunIdRef.current = null;
      setFullResyncPending(false);
      setFullResyncBanner(
        "Диапазон изменён. Полная синхронизация для предыдущего периода отменена. При необходимости запустите Full re-sync снова."
      );
    }
  }, [appliedDateFrom, appliedDateTo, fullResyncPending]);

  // Load metrics when applied range changes (not on draft changes). Do not run until access is validated.
  const hasLoadedRef = useRef(false);
  const [entrySyncSettled, setEntrySyncSettled] = useState(false);
  useEffect(() => {
    if (projectId) setEntrySyncSettled(true);
    else setEntrySyncSettled(false);
  }, [projectId]);
  useEffect(() => {
    const key = `${projectId}:${appliedDateFrom}:${appliedDateTo}:${sourcesKey}:${accountIdsKey}`;
    console.log("[DASHBOARD_EFFECT]", {
      projectId,
      appliedDateFrom,
      appliedDateTo,
      sourcesKey,
      accountIdsKey,
      key,
      noProject: !projectId,
      invalidApplied: isInvalidApplied,
    });
    if (!projectId) return;
    if (!isSupportedNow) return;
    if (isInvalidApplied) return;
    if (!entrySyncSettled) return;

    hasLoadedRef.current = true;
    const c = makeController();
    console.log("[LOAD_FROM_DB_CALL]", { start: appliedDateFrom, end: appliedDateTo, key });
    ignoreAbortRejection(loadFromDb(c.signal, appliedDateFrom, appliedDateTo), "dashboard loadFromDb");

    return () => {
      abortInFlight();
      clearBackfillPolling();
    };
  }, [projectId, appliedDateFrom, appliedDateTo, sourcesKey, accountIdsKey, entrySyncSettled]);

  /** Interval = stale-check cadence; TTL comes from GET /api/dashboard/freshness (server). */
  const STALE_CHECK_INTERVAL_MS = 15 * 60 * 1000;
  const AUTO_REFRESH_SESSION_KEY = "board_auto_refresh_last_ok_ms";

  // Auto-refresh: periodic server-driven stale-check; refresh only when API reports stale.
  useEffect(() => {
    if (!projectId) return;
    if (!isSupportedNow) return;

    const id = window.setInterval(() => {
      if (typeof window === "undefined") return;
      if (!navigator.onLine) return;
      if (document.visibilityState !== "visible") return;
      if (loading || syncLoading || fullResyncPending) return;

      void checkFreshnessAndMaybeRefresh("interval");
    }, STALE_CHECK_INTERVAL_MS);

    return () => window.clearInterval(id);
  }, [projectId, appliedDateFrom, appliedDateTo, sourcesKey, accountIdsKey, loading, syncLoading, fullResyncPending]);

  useEffect(() => {
    if (!projectId) return;
    const onVisibility = () => {
      if (document.visibilityState !== "visible") return;
      void checkFreshnessAndMaybeRefresh("visible");
    };
    const onReconnect = () => {
      void checkFreshnessAndMaybeRefresh("reconnect");
    };
    document.addEventListener("visibilitychange", onVisibility);
    window.addEventListener("online", onReconnect);
    return () => {
      document.removeEventListener("visibilitychange", onVisibility);
      window.removeEventListener("online", onReconnect);
    };
  }, [projectId, appliedDateFrom, appliedDateTo, sourcesKey, accountIdsKey, loading, syncLoading, fullResyncPending]);

  // Background analytics are staged: only after critical path settles and browser is idle.
  useEffect(() => {
    setBackgroundReady(false);
    if (!projectId) return;
    if (!entrySyncSettled || loading || syncLoading || fullResyncPending || isInvalidApplied) return;
    let cancelled = false;
    const activate = () => {
      if (!cancelled) setBackgroundReady(true);
    };
    if (typeof window !== "undefined" && "requestIdleCallback" in window) {
      const id = (window as Window & { requestIdleCallback: (cb: () => void, opts?: { timeout: number }) => number })
        .requestIdleCallback(activate, { timeout: 1200 });
      return () => {
        cancelled = true;
        if ("cancelIdleCallback" in window) {
          (window as Window & { cancelIdleCallback: (idleId: number) => void }).cancelIdleCallback(id);
        }
      };
    }
    const t = setTimeout(activate, 350);
    return () => {
      cancelled = true;
      clearTimeout(t);
    };
  }, [projectId, entrySyncSettled, loading, syncLoading, fullResyncPending, isInvalidApplied, appliedDateFrom, appliedDateTo, sourcesKey, accountIdsKey]);

  useEffect(() => {
    return () => abortInFlight();
  }, []);

  // Close dropdowns on outside click or Escape
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

  const updatedStr = useMemo(() => {
    const iso = safeIso(updatedAt);
    if (!iso) return "—";
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return "—";
    return `${String(d.getDate()).padStart(2, "0")}.${String(d.getMonth() + 1).padStart(
      2,
      "0"
    )}.${d.getFullYear()}, ${String(d.getHours()).padStart(2, "0")}:${String(
      d.getMinutes()
    ).padStart(2, "0")}`;
  }, [updatedAt]);

  const lastOkStr = useMemo(() => {
    const iso = safeIso(lastOkAt);
    if (!iso) return "—";
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return "—";
    return `${String(d.getDate()).padStart(2, "0")}.${String(d.getMonth() + 1).padStart(
      2,
      "0"
    )}.${d.getFullYear()}, ${String(d.getHours()).padStart(2, "0")}:${String(
      d.getMinutes()
    ).padStart(2, "0")}`;
  }, [lastOkAt]);

  const systemStatus = useMemo(() => {
    if (!integrationStatusHydrated) {
      return {
        status: "sync_delayed" as const,
        label: "Checking…",
        tooltip: "Loading integration and account state…",
      };
    }
    const count = dashboardAccounts.length;
    const integrationShowsActivity = adaptiveIntegrationStatus.some((i) => i.status !== "not_connected");
    if (count === 0 && !integrationShowsActivity) {
      return { status: "no_connections" as const, label: "No integrations", tooltip: "No advertising sources connected." };
    }
    if (connectionLost) return { status: "connection_lost" as const, label: "Connection lost", tooltip: "One or more integrations lost connection." };
    const hasError = adaptiveIntegrationStatus.some((i) => i.status === "error");
    const hasStale = adaptiveIntegrationStatus.some((i) => i.status === "stale");
    const hasDisconnected = adaptiveIntegrationStatus.some((i) => i.status === "disconnected");
    if (hasError) return { status: "error" as const, label: "Error", tooltip: "One or more integrations have sync errors or data not updated today." };
    if (hasStale) return { status: "stale" as const, label: "Stale", tooltip: staleStatusTooltip };
    if (hasDisconnected)
      return {
        status: "disconnected" as const,
        label: "Reconnect required",
        tooltip:
          "OAuth access needs re-authorization (e.g. revoked refresh token). Accounts stay saved; reconnect the platform.",
      };
    return { status: "healthy" as const, label: "Healthy", tooltip: "All integrations are connected and syncing normally." };
  }, [
    integrationStatusHydrated,
    dashboardAccounts.length,
    connectionLost,
    adaptiveIntegrationStatus,
    staleStatusTooltip,
  ]);

  const dataFreshnessStr = useMemo(() => {
    const iso = safeIso(updatedAt);
    if (!iso) return "—";
    const ts = new Date(iso).getTime();
    if (Number.isNaN(ts)) return "—";
    const diffMs = Date.now() - ts;
    const diffMin = Math.floor(diffMs / 60000);
    const diffHours = Math.floor(diffMs / 3600000);
    if (diffMin < 1) return "just now";
    if (diffMin < 60) return `${diffMin} min ago`;
    if (diffHours < 24) return diffHours === 1 ? "1 hour ago" : `${diffHours} hours ago`;
    return updatedStr;
  }, [updatedAt, updatedStr]);

  const INTEGRATION_PLATFORMS = useMemo(
    () => [
      { id: "meta", label: "Meta Ads" },
      { id: "google", label: "Google Ads" },
      { id: "tiktok", label: "TikTok Ads" },
      { id: "yandex", label: "Yandex Ads" },
    ],
    []
  );

  /** Data Status: count only healthy integrations (green). Total = Meta, Google, TikTok. */
  const healthyCount = useMemo(
    () => adaptiveIntegrationStatus.filter((i) => i.status === "healthy").length,
    [adaptiveIntegrationStatus]
  );
  const totalPlatformsCount = 3; // meta, google, tiktok
  const adPlatformsCount = healthyCount;

  const integrationStatusByPlatform = useMemo(() => {
    const map = new Map<string, IntegrationStatusValue>();
    for (const i of adaptiveIntegrationStatus) {
      map.set(i.platform, i.status as IntegrationStatusValue);
    }
    return map;
  }, [adaptiveIntegrationStatus]);
  const integrationRowByPlatform = useMemo(() => {
    const map = new Map<string, IntegrationStatusRow>();
    for (const i of adaptiveIntegrationStatus) {
      map.set(i.platform, i);
    }
    return map;
  }, [adaptiveIntegrationStatus]);

  const platformStatusColor: Record<IntegrationStatusValue | "pending", string> = {
    pending: "#64748b",
    healthy: "#22c55e",
    error: "#ef4444",
    stale: "#f97316",
    no_accounts: "#eab308",
    disconnected: "#94a3b8",
    not_connected: "#94a3b8",
  };
  const platformStatusLabel: Record<IntegrationStatusValue | "pending", string> = {
    pending: "—",
    healthy: "Healthy",
    error: "Error",
    stale: "Stale / OAuth retry",
    no_accounts: "No accounts",
    disconnected: "Reconnect required",
    not_connected: "Not connected",
  };

  const statusStyles: Record<string, { bg: string; color: string }> = {
    healthy: { bg: "rgba(34,197,94,0.15)", color: "#22c55e" },
    error: { bg: "rgba(239,68,68,0.15)", color: "#ef4444" },
    stale: { bg: "rgba(249,115,22,0.15)", color: "#f97316" },
    disconnected: { bg: "rgba(148,163,184,0.15)", color: "#94a3b8" },
    sync_delayed: { bg: "rgba(234,179,8,0.15)", color: "#eab308" },
    connection_lost: { bg: "rgba(239,68,68,0.15)", color: "#ef4444" },
    no_connections: { bg: "rgba(148,163,184,0.15)", color: "#94a3b8" },
  };

  // Derived KPI helpers for CPL / CAC.
  const registrationsCount = kpiSummary?.registrations ?? 0;
  const salesCount = kpiSummary?.sales ?? 0;
  const toProjectSpend = (usd: number) =>
    projectCurrency === "KZT" && usdToKztRate && usdToKztRate > 0 ? usd * usdToKztRate : usd;
  const formatMoneyValue = (v: number) => {
    if (projectCurrency === "KZT") {
      return `₸${new Intl.NumberFormat("ru-RU", { maximumFractionDigits: 0 }).format(Math.round(v))}`;
    }
    return new Intl.NumberFormat("en-US", {
      style: "currency",
      currency: "USD",
      maximumFractionDigits: 2,
      minimumFractionDigits: 0,
    }).format(v);
  };
  const spendValue = toProjectSpend(summary.spend ?? 0);

  const cplValue = registrationsCount > 0 ? spendValue / registrationsCount : null;
  const cacValue = salesCount > 0 ? spendValue / salesCount : null;

  const cplLabel = cplValue !== null ? formatMoneyValue(cplValue) : "—";
  const cacLabel = cacValue !== null ? formatMoneyValue(cacValue) : "—";

  const chartPoints = useMemo((): ChartPoint[] => {
    if (appliedDateFrom > appliedDateTo) return [];
    const dates = dateRange(appliedDateFrom, appliedDateTo);
    return dates.map((date) => {
      const spend = toProjectSpend(points.find((p) => p.date === date)?.spend ?? 0);
      const sales = conversionSeries.find((c) => c.date === date)?.sales ?? 0;
      return {
        date,
        spend,
        registrations: conversionSeries.find((c) => c.date === date)?.registrations ?? 0,
        sales,
        cac: sales > 0 ? spend / sales : null,
      };
    });
  }, [appliedDateFrom, appliedDateTo, points, conversionSeries, projectCurrency, usdToKztRate]);

  // Block-level readiness only: no page-level demo flag. Each section/card decides its own.
  const hasRealKpiData =
    !loading &&
    (Number(summary?.spend ?? 0) > 0 ||
      Number(kpiSummary?.registrations ?? 0) > 0 ||
      Number(kpiSummary?.sales ?? 0) > 0 ||
      Number(kpiSummary?.revenue ?? 0) > 0);
  const hasRealSpendChartData =
    !loading &&
    chartPoints.some(
      (p) =>
        (p.spend && p.spend > 0) ||
        (p.registrations > 0) ||
        (p.sales > 0) ||
        (p.cac != null && p.cac > 0)
    );

  const card = {
    borderRadius: 18,
    border: "1px solid rgba(255,255,255,0.10)",
    background:
      "radial-gradient(1200px 400px at 30% 0%, rgba(125,125,255,0.12), transparent 60%), linear-gradient(180deg, rgba(255,255,255,0.04), rgba(255,255,255,0.02))",
    boxShadow: "0 20px 60px rgba(0,0,0,0.55)",
  } as const;

  const mini = {
    borderRadius: 16,
    border: "1px solid rgba(255,255,255,0.10)",
    background: "rgba(255,255,255,0.03)",
    padding: 18,
  } as const;

  const badge = {
    display: "inline-flex",
    alignItems: "center",
    gap: 8,
    padding: "6px 10px",
    borderRadius: 999,
    border: "1px solid rgba(255,255,255,0.10)",
    background: "rgba(255,255,255,0.04)",
    color: "rgba(255,255,255,0.9)",
    fontSize: 12,
    lineHeight: 1,
    whiteSpace: "nowrap" as const,
  } as const;

  const tag = (text: string, tone: "meta" | "soon" = "meta") => {
    if (tone === "soon") {
      return {
        display: "inline-flex",
        alignItems: "center",
        padding: "6px 10px",
        borderRadius: 999,
        border: "1px solid rgba(255,255,255,0.14)",
        background: "rgba(255,255,255,0.05)",
        color: "rgba(255,255,255,0.75)",
        fontSize: 12,
        fontWeight: 800 as const,
      };
    }
    return {
      display: "inline-flex",
      alignItems: "center",
      padding: "6px 10px",
      borderRadius: 999,
      border: "1px solid rgba(120,255,180,0.35)",
      background: "rgba(120,255,180,0.08)",
      color: "rgba(150,255,200,0.95)",
      fontSize: 12,
      fontWeight: 700 as const,
    };
  };

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
    if (loading || syncLoading) return "loading";
    if (errorText) return "error";
    return "success";
  }, [loading, syncLoading, errorText]);

  const statusLabel = useMemo(() => {
    if (statusState === "loading") return syncLoading ? "Идёт обновление…" : "Загрузка…";
    if (statusState === "error") return "Ошибка";
    return "Готово";
  }, [statusState, syncLoading]);

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

  const sourcesLabel = useMemo(() => {
    if (!effectiveSources || effectiveSources.length === 0) {
      return "All";
    }
    if (effectiveSources.length === activeSourceOptions.length) {
      return "All";
    }
    if (effectiveSources.length === 1) {
      const opt = activeSourceOptions.find((o) => o.id === effectiveSources[0]);
      return opt?.label ?? effectiveSources[0];
    }
    return "Mixed";
  }, [effectiveSources, activeSourceOptions]);
  const accountsLabel = selectedAccountIds.length === 0 ? "All" : `${selectedAccountIds.length} selected`;

  const handleDateBlur = () => {
    const nextFrom = projectMinDate && draftDateFrom < projectMinDate ? projectMinDate : draftDateFrom;
    const nextTo = projectMinDate && draftDateTo < projectMinDate ? projectMinDate : draftDateTo;
    if (nextFrom > nextTo) return;
    if (nextFrom !== draftDateFrom) setDraftDateFrom(nextFrom);
    if (nextTo !== draftDateTo) setDraftDateTo(nextTo);
    if (nextFrom === appliedDateFrom && nextTo === appliedDateTo) return;
    setAppliedDateFrom(nextFrom);
    setAppliedDateTo(nextTo);
    const params = new URLSearchParams(sp.toString());
    if (projectId) params.set("project_id", projectId);
    params.set("start", nextFrom);
    params.set("end", nextTo);
    router.replace(`${window.location.pathname}?${params.toString()}`, { scroll: false });
  };

  return (
    <div style={{ padding: 28, position: "relative" }}>
      {/* Header */}
      <div style={{ marginBottom: 10 }}>
        <div style={{ fontSize: 34, fontWeight: 900, lineHeight: 1.1 }}>Дашборд</div>
        <div style={{ opacity: 0.75, marginTop: 6 }}>
          Spend, Impressions, Clicks из рекламных платформ (Meta, Google, TikTok) через daily_ad_metrics.
        </div>

        {errorText ? (
          <div style={{ marginTop: 10, color: "rgba(255,170,170,0.95)", fontWeight: 700 }}>
            {errorText}
          </div>
        ) : null}
        {dashboardWidgetPack.state === "BLOCKED" || dashboardWidgetPack.state === "LIMITED" ? (
          <div style={{ marginTop: 12 }}>
            <BillingWidgetPlaceholder pack={dashboardWidgetPack} minHeight={dashboardWidgetPack.state === "BLOCKED" ? 100 : 88} />
          </div>
        ) : null}
      </div>

      {/* ✅ Строка фильтров + табы (одной линией) */}
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          gap: 12,
          flexWrap: "wrap",
          marginBottom: 8,
        }}
      >
        <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
          {/* Sources: multi-select — only active/connected platforms */}
          <div style={{ position: "relative" }} ref={sourcesDropdownRef}>
            <button
              type="button"
              style={{ ...tabStyle(false), minWidth: 140 }}
              onClick={() => { setSourcesOpen((v) => !v); setAccountsOpen(false); }}
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
                      <label key={opt.id} style={{ display: "flex", alignItems: "center", gap: 8, cursor: "pointer", marginBottom: 6 }}>
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

          {/* Accounts: multi-select, grouped by platform — only enabled accounts */}
          <div style={{ position: "relative" }} ref={accountsDropdownRef}>
            <button
              type="button"
              style={{ ...tabStyle(false), minWidth: 160 }}
              onClick={() => { setAccountsOpen((v) => !v); setSourcesOpen(false); }}
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
                          <label key={a.id} style={{ display: "flex", alignItems: "center", gap: 8, cursor: "pointer", marginLeft: 8, marginBottom: 4 }}>
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
              onBlur={handleDateBlur}
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

            {/* Done / status indicator: right of date range, color by state */}
            <div
              role="status"
              aria-live="polite"
              title={statusState === "error" ? errorText ?? "Ошибка" : "Статус загрузки данных"}
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

        {/* ✅ “Обновлено/ОК” прямо под хедером справа, отдельным блоком */}
        <div style={{ display: "grid", gap: 6, justifyItems: "end", marginTop: 2 }}>
          <span style={badge} title="Время обновления из API/сервера">
            Обновлено: {updatedStr}
          </span>
          <span style={badge} title="Последний успешный ответ (клиент)">
            OK: {lastOkStr}
          </span>
        </div>
      </div>

      {isInvalidRange ? (
        <div style={{ marginTop: 8, opacity: 0.85, color: "rgba(255,200,160,0.95)" }}>
          Дата начала не может быть позже даты конца
        </div>
      ) : null}

      {historicalBackfill?.started ? (
        <div
          style={{
            marginTop: 10,
            padding: "10px 14px",
            borderRadius: 10,
            background: "rgba(234,179,8,0.12)",
            border: "1px solid rgba(234,179,8,0.3)",
            color: "rgba(255,235,180,0.95)",
            fontSize: 13,
            display: "flex",
            alignItems: "center",
            gap: 8,
            flexWrap: "wrap",
          }}
        >
          <span style={{ fontWeight: 700 }}>Подгружаем исторические данные</span>
          {historicalBackfill.intervals.length > 0 ? (
            <span style={{ opacity: 0.9 }}>
              {historicalBackfill.intervals.map((iv) => `${fmtRuDate(iv.start)} — ${fmtRuDate(iv.end)}`).join("; ")}
            </span>
          ) : null}
          <span style={{ opacity: 0.75, fontSize: 12 }}>
            График обновится автоматически (до {MAX_BACKFILL_ATTEMPTS} попыток, каждые{" "}
            {BACKFILL_POLL_INTERVAL_MS / 1000}&nbsp;с).
          </span>
        </div>
      ) : null}

      {/* KPI cards: Расход, Регистрации, Продажи, ROAS */}
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(4, minmax(200px, 1fr))",
          gap: 16,
          marginTop: 16,
          marginBottom: 16,
          opacity: loading && !syncLoading ? 0.95 : 1,
          transition: "opacity 0.2s ease",
        }}
      >
        <div style={{ ...mini, ...card }}>
          <div style={{ display: "flex", justifyContent: "space-between", gap: 10 }}>
            <div style={{ opacity: 0.75 }}>Расход</div>
            <div style={tag(sourcesLabel)}>{sourcesLabel}</div>
          </div>
          <div style={{ fontSize: 36, fontWeight: 900, marginTop: 10 }}>
            {formatMoneyValue(spendValue)}
          </div>
          <div style={{ opacity: 0.72, marginTop: 6 }}>CPL: {cplLabel} • CAC: {cacLabel}</div>
        </div>

        <div style={{ ...mini, ...card }}>
          <div style={{ display: "flex", justifyContent: "space-between", gap: 10 }}>
            <div style={{ opacity: 0.6 }}>Регистрации</div>
            <div style={tag(sourcesLabel)}>{sourcesLabel}</div>
          </div>
          <div style={{ fontSize: 36, fontWeight: 900, marginTop: 10, opacity: 0.95 }}>
            {kpiSummary ? (kpiSummary.registrations || kpiSummary.registrations === 0 ? kpiSummary.registrations : "—") : "—"}
          </div>
          <div style={{ opacity: 0.6, marginTop: 6 }}>
            {(() => {
              if (!kpiSummary) return "Конверсия лид → продажа: —";
              const { registrations, sales } = kpiSummary;
              if (!registrations || registrations <= 0) return "Конверсия лид → продажа: —";
              const cr = (sales / registrations) * 100;
              return `Конверсия лид → продажа: ${cr.toFixed(1)}%`;
            })()}
          </div>
        </div>

        <div style={{ ...mini, ...card }}>
          <div style={{ display: "flex", justifyContent: "space-between", gap: 10 }}>
            <div style={{ opacity: 0.6 }}>Продажи</div>
            <div style={tag(sourcesLabel)}>{sourcesLabel}</div>
          </div>
          <div style={{ fontSize: 36, fontWeight: 900, marginTop: 10, opacity: 0.95 }}>
            {kpiSummary ? (kpiSummary.sales || kpiSummary.sales === 0 ? kpiSummary.sales : "—") : "—"}
          </div>
          <div style={{ opacity: 0.6, marginTop: 6 }}>
            {kpiSummary ? `Выручка: ${formatMoneyValue(kpiSummary.revenue)}` : "Выручка: —"}
          </div>
        </div>

        <div style={{ ...mini, ...card }}>
          <div style={{ display: "flex", justifyContent: "space-between", gap: 10 }}>
            <div style={{ opacity: 0.6 }}>ROAS</div>
            <div style={tag(sourcesLabel)}>{sourcesLabel}</div>
          </div>
          <div style={{ fontSize: 36, fontWeight: 900, marginTop: 10, opacity: 0.95 }}>
            {(() => {
              if (!kpiSummary) return "—";
              const spend = summary.spend ?? 0;
              const revenue = kpiSummary.revenue ?? 0;
              if (!spend || spend <= 0) return "0.00";
              const roas = revenue / spend;
              return roas.toFixed(2);
            })()}
          </div>
          <div style={{ opacity: 0.6, marginTop: 6 }}>Выручка / расход</div>
        </div>
      </div>

      {/* ROW 2: Динамика расхода | Data Status (исходные пропорции: 2fr 1fr, gap 16) */}
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "2fr 1fr",
          gap: 16,
          marginBottom: 20,
          alignItems: "stretch",
        }}
      >
        <div style={{ ...mini, ...card, padding: 20 }}>
          <div style={{ fontWeight: 900, fontSize: 18, marginBottom: 10 }}>Динамика расхода</div>
          <div style={{ opacity: 0.7, marginBottom: 14 }}>Spend, Registrations, Sales (по выбранному диапазону)</div>

          {dashboardWidgetPack.state === "BLOCKED" ? (
            <BillingWidgetPlaceholder
              pack={{
                ...dashboardWidgetPack,
                title: dashboardWidgetPack.title || "График недоступен",
                hint:
                  dashboardWidgetPack.hint ||
                  "Данные скрыты из‑за ограничений подписки или статуса аккаунта.",
              }}
              minHeight={260}
            />
          ) : (
            <MultiMetricLineChart points={chartPoints} formatMoney={formatMoneyValue} />
          )}
        </div>

        <div style={{ ...mini, ...card, padding: 20 }}>
          <div
            style={{
              fontWeight: 900,
              fontSize: 18,
              marginBottom: fullResyncPending || fullResyncBanner ? 8 : 12,
              display: "flex",
              justifyContent: "space-between",
              alignItems: "center",
              gap: 8,
              flexWrap: "wrap",
            }}
          >
            <span>Data Status</span>
            <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap", justifyContent: "flex-end" }}>
              <button
                type="button"
                onClick={() => {
                  if (syncWallClickable) {
                    requestBillingPricingModal("sync_click");
                    return;
                  }
                  void runFullResync();
                }}
                disabled={Boolean(
                  fullResyncPending ||
                    syncLoading ||
                    loading ||
                    isInvalidApplied ||
                    !projectId ||
                    (!syncAllowed && !syncWallClickable)
                )}
                style={{
                  background: "none",
                  border: "none",
                  padding: 0,
                  margin: 0,
                  cursor:
                    fullResyncPending || syncLoading || loading || isInvalidApplied || !projectId
                      ? "not-allowed"
                      : syncAllowed || syncWallClickable
                        ? "pointer"
                        : "not-allowed",
                  color: "rgba(147,197,253,0.95)",
                  fontSize: 12,
                  fontWeight: 600,
                  textDecoration: "underline",
                  opacity:
                    fullResyncPending ||
                    syncLoading ||
                    loading ||
                    isInvalidApplied ||
                    !projectId ||
                    (!syncAllowed && !syncWallClickable)
                      ? 0.45
                      : 0.95,
                }}
              >
                {fullResyncPending ? "Full re-sync…" : "Full re-sync"}
              </button>
              <span
                title={systemStatus.tooltip}
                style={{
                  display: "inline-flex",
                  alignItems: "center",
                  gap: 6,
                  padding: "4px 8px",
                  borderRadius: 6,
                  background: statusStyles[systemStatus.status].bg,
                  color: statusStyles[systemStatus.status].color,
                  fontWeight: 600,
                  fontSize: 12,
                }}
              >
                <span style={{ width: 6, height: 6, borderRadius: "50%", background: "currentColor", flexShrink: 0 }} />
                <span>
                  {adPlatformsCount} / {totalPlatformsCount}&nbsp;&nbsp;{systemStatus.label}
                </span>
              </span>
            </div>
          </div>
          {(fullResyncPending || fullResyncBanner) && (
            <div
              style={{
                fontSize: 12,
                opacity: 0.78,
                marginBottom: 10,
                lineHeight: 1.4,
                color: "rgba(255,255,255,0.88)",
              }}
            >
              {fullResyncPending
                ? "Полная синхронизация выбранного периода… Может занять несколько минут."
                : fullResyncBanner}
            </div>
          )}

          <div style={{ fontSize: 13, color: "rgba(255,255,255,0.9)" }}>
            {/* Integrations */}
            <div
              style={{
                background: "rgba(255,255,255,0.02)",
                border: "1px solid rgba(255,255,255,0.06)",
                borderRadius: 10,
                padding: "12px 14px",
                marginTop: 4,
                marginBottom: 10,
              }}
            >
              <div
                style={{
                  opacity: 0.7,
                  fontSize: 11,
                  fontWeight: 600,
                  textTransform: "uppercase",
                  letterSpacing: "0.04em",
                  marginBottom: 6,
                }}
              >
                Integrations
              </div>
              {INTEGRATION_PLATFORMS.map((p) => {
                const status: IntegrationStatusValue | "pending" = !integrationStatusHydrated
                  ? "pending"
                  : (integrationStatusByPlatform.get(p.id) ?? "not_connected");
                const dotColor = platformStatusColor[status];
                const label = platformStatusLabel[status];
                const row = integrationRowByPlatform.get(p.id);
                const diagnostics = [
                  row?.reason ? `reason: ${row.reason}` : null,
                  row?.token_reason_code ? `token: ${row.token_reason_code}` : null,
                  row?.last_sync_error ? `sync: ${row.last_sync_error}` : null,
                ]
                  .filter(Boolean)
                  .join(" | ");
                return (
                  <div
                    key={p.id}
                    style={{
                      display: "flex",
                      justifyContent: "space-between",
                      alignItems: "center",
                      gap: 12,
                      marginTop: 2,
                    }}
                  >
                    <span style={{ opacity: 0.9 }}>{p.label}</span>
                    <span
                      style={{
                        display: "inline-flex",
                        alignItems: "center",
                        gap: 6,
                        justifyContent: "flex-end",
                      }}
                    >
                      <span
                        style={{
                          width: 6,
                          height: 6,
                          borderRadius: "50%",
                          background: dotColor,
                          flexShrink: 0,
                        }}
                        title={diagnostics || undefined}
                      />
                      <span title={diagnostics || undefined}>{label}</span>
                    </span>
                  </div>
                );
              })}
            </div>

            {/* Data */}
            <div
              style={{
                background: "rgba(255,255,255,0.02)",
                border: "1px solid rgba(255,255,255,0.06)",
                borderRadius: 10,
                padding: "12px 14px",
                marginTop: 12,
                marginBottom: 10,
              }}
            >
              <div
                style={{
                  opacity: 0.7,
                  fontSize: 11,
                  fontWeight: 600,
                  textTransform: "uppercase",
                  letterSpacing: "0.04em",
                  marginBottom: 6,
                }}
              >
                Data
              </div>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 12, marginTop: 2 }}>
                <span style={{ opacity: 0.7 }}>Date range</span>
                <span style={{ textAlign: "right" }}>
                  {appliedDateFrom && appliedDateTo
                    ? `${fmtRuDate(appliedDateFrom)} – ${fmtRuDate(appliedDateTo)}`
                    : "—"}
                </span>
              </div>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 12, marginTop: 4 }}>
                <span style={{ opacity: 0.7 }}>Last updated</span>
                <span style={{ textAlign: "right" }}>{updatedStr}</span>
              </div>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 12, marginTop: 4 }}>
                <span style={{ opacity: 0.7 }}>Last successful</span>
                <span style={{ textAlign: "right" }}>{lastOkStr}</span>
              </div>
            </div>

            {/* Accounts */}
            <div
              style={{
                background: "rgba(255,255,255,0.02)",
                border: "1px solid rgba(255,255,255,0.06)",
                borderRadius: 10,
                padding: "12px 14px",
                marginTop: 12,
              }}
            >
              <div
                style={{
                  opacity: 0.7,
                  fontSize: 11,
                  fontWeight: 600,
                  textTransform: "uppercase",
                  letterSpacing: "0.04em",
                  marginBottom: 6,
                }}
              >
                Accounts
              </div>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 12, marginTop: 2 }}>
                <span style={{ opacity: 0.7 }}>Ad platforms</span>
                <span style={{ textAlign: "right" }}>{adPlatformsCount}</span>
              </div>
            </div>
          </div>
        </div>
      </div>

      {backgroundReady ? (
        <>
          {dashboardWidgetPack.state === "BLOCKED" ? (
            <BillingWidgetPlaceholder pack={dashboardWidgetPack} minHeight={280} />
          ) : attributionLimited ? (
            <BillingWidgetPlaceholder
              pack={{
                state: "LIMITED",
                reasonCode: "PLAN_LIMIT_ATTRIBUTION_HEAVY",
                title: "Расширенные виджеты атрибуции",
                hint: "На тарифе Starter недоступны тяжёлые блоки атрибуции и карты выручки. Перейдите на Growth для полного набора.",
              }}
              minHeight={220}
            />
          ) : (
            <>
          {/* ROW 3: Помогающая атрибуция | Топ путей пользователей */}
          <div
            style={{
              display: "grid",
              gridTemplateColumns: "1fr 1fr",
              gap: 20,
              marginBottom: 20,
              alignItems: "stretch",
            }}
          >
            <AssistedAttributionCard
              projectId={projectId || null}
              start={appliedDateFrom}
              end={appliedDateTo}
              sources={effectiveSources}
              accountIds={effectiveAccountIds}
              days={
                appliedDateFrom && appliedDateTo
                  ? Math.max(
                      1,
                      Math.ceil(
                        (new Date(appliedDateTo).getTime() -
                          new Date(appliedDateFrom).getTime()) /
                          (24 * 60 * 60 * 1000)
                      )
                    )
                  : 30
              }
            />
            <AttributionFlowCard
              projectId={projectId || null}
              start={appliedDateFrom}
              end={appliedDateTo}
              sources={effectiveSources}
              accountIds={effectiveAccountIds}
              days={
                appliedDateFrom && appliedDateTo
                  ? Math.max(
                      1,
                      Math.ceil(
                        (new Date(appliedDateTo).getTime() -
                          new Date(appliedDateFrom).getTime()) /
                          (24 * 60 * 60 * 1000)
                      )
                    )
                  : 30
              }
            />
          </div>

          {/* ROW 4: Карта выручки по атрибуции */}
          <div style={{ marginBottom: 20 }}>
            <RevenueAttributionMapCard
              projectId={projectId || null}
              start={appliedDateFrom}
              end={appliedDateTo}
              sources={effectiveSources}
              accountIds={effectiveAccountIds}
              days={
                appliedDateFrom && appliedDateTo
                  ? Math.max(
                      1,
                      Math.ceil(
                        (new Date(appliedDateTo).getTime() -
                          new Date(appliedDateFrom).getTime()) /
                          (24 * 60 * 60 * 1000)
                      )
                    )
                  : 30
              }
            />
          </div>

          {/* ROW 5: Поведение конверсии */}
          <div style={{ marginBottom: 20 }}>
            <ConversionBehaviorCard
              projectId={projectId || null}
              start={appliedDateFrom}
              end={appliedDateTo}
              sources={effectiveSources}
              accountIds={effectiveAccountIds}
              days={
                appliedDateFrom && appliedDateTo
                  ? Math.max(
                      1,
                      Math.ceil(
                        (new Date(appliedDateTo).getTime() -
                          new Date(appliedDateFrom).getTime()) /
                          (24 * 60 * 60 * 1000)
                      )
                    )
                  : 30
              }
            />
          </div>
            </>
          )}
        </>
      ) : (
        <div
          style={{
            marginBottom: 20,
            border: "1px dashed rgba(255,255,255,0.16)",
            borderRadius: 12,
            padding: "12px 14px",
            color: "rgba(255,255,255,0.72)",
            fontSize: 13,
          }}
        >
          Дополнительная аналитика загружается после основного экрана...
        </div>
      )}

      {/* ✅ Advanced кнопка в самый низ справа (sandbars) */}
      <button
        type="button"
        onClick={() => setShowAdvanced((v) => !v)}
        style={{
          position: "fixed",
          right: 20,
          bottom: 20,
          height: 38,
          padding: "0 14px",
          borderRadius: 999,
          border: "1px solid rgba(255,255,255,0.10)",
          background: showAdvanced ? "rgba(255,255,255,0.10)" : "rgba(255,255,255,0.06)",
          color: "white",
          cursor: "pointer",
          fontWeight: 900,
          fontSize: 12,
          boxShadow: "0 20px 60px rgba(0,0,0,0.45)",
          zIndex: 50,
          whiteSpace: "nowrap",
        }}
      >
        Advanced {showAdvanced ? "▲" : "▼"}
      </button>

      {/* Advanced panel */}
      {showAdvanced ? (
        <div
          style={{
            ...mini,
            ...card,
            padding: 20,
            marginTop: 16,
          }}
        >
          <div style={{ display: "flex", justifyContent: "space-between", gap: 12 }}>
            <div>
              <div style={{ fontWeight: 900, fontSize: 18 }}>Advanced</div>
              <div style={{ opacity: 0.72, marginTop: 4 }}>
                Debug спрятан сюда, чтобы не мешал дашборду.
              </div>
            </div>
            <button
              type="button"
              onClick={() => {
                try {
                  navigator.clipboard.writeText(JSON.stringify(lastDebug ?? {}, null, 2));
                } catch {}
              }}
              style={{
                height: 30,
                padding: "0 10px",
                borderRadius: 999,
                border: "1px solid rgba(255,255,255,0.10)",
                background: "rgba(255,255,255,0.05)",
                color: "white",
                cursor: "pointer",
                fontWeight: 800,
                fontSize: 12,
                whiteSpace: "nowrap",
              }}
            >
              Copy debug
            </button>
          </div>

          <pre
            style={{
              marginTop: 12,
              padding: 12,
              borderRadius: 12,
              border: "1px solid rgba(255,255,255,0.10)",
              background: "rgba(0,0,0,0.35)",
              overflow: "auto",
              maxHeight: 320,
              fontSize: 12,
              lineHeight: 1.4,
              color: "rgba(255,255,255,0.85)",
            }}
          >
            {JSON.stringify(lastDebug ?? {}, null, 2)}
          </pre>

          <div style={{ opacity: 0.7, marginTop: 10, fontSize: 12 }}>
            Авто-обновление: каждые <b>30 минут</b> (sync + reload).
            <br />
            Диапазон дат: выберите даты — диапазон применится при выходе из полей.
          </div>
        </div>
      ) : null}
    </div>
  );
}