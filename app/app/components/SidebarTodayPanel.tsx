"use client";

import { useMemo, type Dispatch, type SetStateAction } from "react";
import {
  fmtProjectCurrency,
  type ProjectCurrency,
} from "@/app/lib/currency";

type DeviationStatus = "good" | "warn" | "bad" | "neutral";

/** Продажи: >=100% green, 80-99% yellow, below red. */
function classifySalesDeviation(ratio: number): DeviationStatus {
  if (!Number.isFinite(ratio) || ratio < 0) return "neutral";
  if (ratio >= 1) return "good";
  if (ratio >= 0.8) return "warn";
  return "bad";
}

function badgeColors(status: DeviationStatus): { bg: string; border: string; text: string } {
  switch (status) {
    case "good":
      return {
        bg: "rgba(34,197,94,0.12)",
        border: "rgba(34,197,94,0.4)",
        text: "rgba(187,247,208,0.95)",
      };
    case "warn":
      return {
        bg: "rgba(234,179,8,0.12)",
        border: "rgba(234,179,8,0.4)",
        text: "rgba(254,249,195,0.95)",
      };
    case "bad":
      return {
        bg: "rgba(239,68,68,0.14)",
        border: "rgba(239,68,68,0.5)",
        text: "rgba(254,202,202,0.98)",
      };
    default:
      return {
        bg: "rgba(148,163,184,0.10)",
        border: "rgba(148,163,184,0.35)",
        text: "rgba(226,232,240,0.9)",
      };
  }
}

function fmtPct(n: number) {
  const clamped = Math.max(-199, Math.min(199, n));
  return clamped.toFixed(0).replace(".", ",") + "%";
}

export type MetricKey = "spend" | "sales" | "roas" | "cac" | "cpr";
export type TodayPlanState = "loadingFact" | "activePlan" | "planExhausted" | "noPlan";

export type Metric = {
  key: MetricKey;
  title: string;
  fact: number | null;
  plan: number | null;
  format: "money" | "num" | "roas";
  state: TodayPlanState;
};

function classifyRoasDeviation(ratio: number): DeviationStatus {
  if (!Number.isFinite(ratio) || ratio < 0) return "neutral";
  if (ratio >= 1) return "good";
  if (ratio >= 0.8) return "warn";
  return "bad";
}

function classifyLowerIsBetterStrict(ratio: number): DeviationStatus {
  if (!Number.isFinite(ratio) || ratio < 0) return "neutral";
  return ratio <= 1 ? "good" : "bad";
}

function classifySpendByRatio(ratio: number): DeviationStatus {
  if (!Number.isFinite(ratio) || ratio < 0) return "neutral";
  if (ratio > 1.03) return "bad";
  if (ratio >= 0.9) return "good";
  return "warn";
}

function formatMetricValue(
  metric: Metric,
  value: number | null,
  currency: ProjectCurrency,
  usdToKztRate: number | null
) {
  if (value == null) return "—";
  if (metric.format === "money") return fmtProjectCurrency(value, currency, usdToKztRate);
  if (metric.format === "roas") return value.toFixed(2).replace(".", ",");
  return new Intl.NumberFormat("ru-RU").format(Math.round(value));
}

export function MetricRow({
  m,
  currency,
  usdToKztRate,
  variant,
}: {
  m: Metric;
  currency: ProjectCurrency;
  usdToKztRate: number | null;
  variant: "sidebar" | "mobileDrawer";
}) {
  const ratio = m.plan != null && m.plan > 0 && m.fact != null ? m.fact / m.plan : null;
  const delta = m.plan != null && m.plan > 0 && m.fact != null ? ((m.fact - m.plan) / m.plan) * 100 : null;

  const status = (() => {
    if (m.state === "loadingFact" || m.state === "noPlan") return "neutral";
    if (m.state === "planExhausted") {
      if (m.key === "sales") return (m.fact ?? 0) > 0 ? "good" : "neutral";
      if (m.key === "spend") return (m.fact ?? 0) > 0 ? "bad" : "neutral";
      return "neutral";
    }
    if (ratio == null) return "neutral";
    if (m.key === "sales") return classifySalesDeviation(ratio);
    if (m.key === "roas") return classifyRoasDeviation(ratio);
    if (m.key === "spend") return classifySpendByRatio(ratio);
    if (m.key === "cac" || m.key === "cpr") return classifyLowerIsBetterStrict(ratio);
    return "neutral";
  })();

  const colors = badgeColors(status);
  const badgeText =
    m.state === "loadingFact" || m.state === "noPlan" || delta == null
      ? "—"
      : `${delta > 0 ? "+" : ""}${fmtPct(delta)}`;

  const pad = variant === "mobileDrawer" ? 14 : 12;
  const titleSize = variant === "mobileDrawer" ? 15 : undefined;
  const badgeFont = variant === "mobileDrawer" ? 12 : 11;

  return (
    <div
      style={{
        padding: pad,
        borderRadius: variant === "mobileDrawer" ? 16 : 14,
        border: "1px solid rgba(255,255,255,0.10)",
        background: "rgba(255,255,255,0.02)",
        minWidth: 0,
      }}
    >
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          gap: 10,
          alignItems: "center",
          minWidth: 0,
        }}
      >
        <div
          style={{
            fontWeight: 900,
            minWidth: 0,
            overflow: "hidden",
            textOverflow: "ellipsis",
            whiteSpace: "nowrap",
            fontSize: titleSize,
          }}
        >
          {m.title}
        </div>

        <div
          style={{
            display: "inline-flex",
            alignItems: "center",
            gap: 5,
            padding: variant === "mobileDrawer" ? "5px 10px" : "4px 8px",
            borderRadius: 999,
            background: colors.bg,
            border: `1px solid ${colors.border}`,
            color: colors.text,
            fontWeight: 900,
            fontSize: badgeFont,
            lineHeight: 1.2,
            whiteSpace: "nowrap",
            flexShrink: 0,
          }}
          title="Отклонение факт vs план"
        >
          {badgeText}
          <span
            style={{
              width: 6,
              height: 6,
              borderRadius: 999,
              background: colors.text,
              opacity: 0.9,
              flexShrink: 0,
            }}
          />
        </div>
      </div>

      <div style={{ display: "grid", gap: variant === "mobileDrawer" ? 8 : 6, marginTop: variant === "mobileDrawer" ? 12 : 10, minWidth: 0 }}>
        <div
          style={{
            display: "flex",
            justifyContent: "space-between",
            gap: 10,
            opacity: 0.75,
            minWidth: 0,
          }}
        >
          <span style={{ minWidth: 0, fontSize: variant === "mobileDrawer" ? 14 : undefined }}>Факт</span>
          <span
            style={{
              fontWeight: 900,
              opacity: 1,
              whiteSpace: "nowrap",
              fontVariantNumeric: "tabular-nums",
              flexShrink: 0,
              fontSize: variant === "mobileDrawer" ? 15 : undefined,
            }}
          >
            {formatMetricValue(m, m.fact, currency, usdToKztRate)}
          </span>
        </div>

        <div
          style={{
            display: "flex",
            justifyContent: "space-between",
            gap: 10,
            opacity: 0.75,
            minWidth: 0,
          }}
        >
          <span style={{ minWidth: 0, fontSize: variant === "mobileDrawer" ? 14 : undefined }}>План</span>
          <span
            style={{
              fontWeight: 900,
              opacity: 1,
              whiteSpace: "nowrap",
              fontVariantNumeric: "tabular-nums",
              flexShrink: 0,
              fontSize: variant === "mobileDrawer" ? 15 : undefined,
            }}
          >
            {formatMetricValue(m, m.plan, currency, usdToKztRate)}
          </span>
        </div>
        {m.state === "loadingFact" && (
          <div style={{ fontSize: variant === "mobileDrawer" ? 12 : 11, opacity: 0.55 }}>Загрузка плана...</div>
        )}
        {m.state === "planExhausted" && (
          <div style={{ fontSize: variant === "mobileDrawer" ? 12 : 11, opacity: 0.72 }}>План исчерпан</div>
        )}
      </div>
    </div>
  );
}

const cardStyle = {
  borderRadius: 18,
  border: "1px solid rgba(255,255,255,0.10)",
  background:
    "radial-gradient(700px 240px at 30% 0%, rgba(120,120,255,0.18), transparent 60%), rgba(255,255,255,0.03)",
  boxShadow: "0 18px 60px rgba(0,0,0,0.45)",
  padding: 14,
  overflow: "hidden",
};

const cardStyleMobile = {
  borderRadius: 20,
  border: "1px solid rgba(255,255,255,0.10)",
  background: "linear-gradient(180deg, rgba(255,255,255,0.05), rgba(255,255,255,0.02))",
  boxShadow: "0 12px 40px rgba(0,0,0,0.35)",
  padding: 18,
  overflow: "hidden",
};

export type SidebarTodayPanelProps = {
  variant: "sidebar" | "mobileDrawer";
  todayOpen: boolean;
  setTodayOpen: Dispatch<SetStateAction<boolean>>;
  projectId: string | null;
  canEditPlan: boolean;
  planPerformanceState: "no_plan" | "on_track" | "behind";
  setPlanModalOpen: (open: boolean) => void;
  totalSalesPlan: number;
  factSalesToday: number | null;
  salesPlanState: TodayPlanState;
  dailySalesPlan: number;
  topMetrics: Metric[];
  extendedMetrics: Metric[];
  projectCurrency: ProjectCurrency;
  usdToKztRate: number | null;
  setTodayMetricsFrameOpen: (open: boolean) => void;
  /** Только mobile drawer: красный «Закрыть» вместо «Открыть на весь экран». */
  onCloseDrawer?: () => void;
};

export function SidebarTodayPanel({
  variant,
  todayOpen,
  setTodayOpen,
  projectId,
  canEditPlan,
  planPerformanceState,
  setPlanModalOpen,
  totalSalesPlan,
  factSalesToday,
  salesPlanState,
  dailySalesPlan,
  topMetrics,
  extendedMetrics,
  projectCurrency,
  usdToKztRate,
  setTodayMetricsFrameOpen,
  onCloseDrawer,
}: SidebarTodayPanelProps) {
  const isMobile = variant === "mobileDrawer";
  const wrapStyle = isMobile ? cardStyleMobile : cardStyle;
  const marginBottom = isMobile ? 0 : 14;

  const dateSubtitle = useMemo(() => {
    return new Date().toLocaleDateString("ru-RU", {
      weekday: "long",
      day: "numeric",
      month: "long",
    });
  }, []);

  return (
    <div style={{ ...wrapStyle, padding: isMobile ? 18 : 14, marginBottom }}>
      {isMobile ? (
        <div style={{ marginBottom: 18 }}>
          <div style={{ fontSize: 22, fontWeight: 900, lineHeight: 1.2, color: "white" }}>
            Отчет за сегодня
          </div>
          <div style={{ fontSize: 13, color: "rgba(255,255,255,0.45)", marginTop: 8, textTransform: "capitalize" }}>
            {dateSubtitle}
          </div>
        </div>
      ) : (
        <button
          type="button"
          onClick={() => setTodayOpen((v) => !v)}
          style={{
            width: "100%",
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            gap: 10,
            background: "transparent",
            border: "none",
            color: "white",
            padding: 0,
            cursor: "pointer",
            minWidth: 0,
          }}
        >
          <div style={{ fontSize: 34, fontWeight: 900, lineHeight: 1.05, minWidth: 0 }}>Сегодня</div>

          <div
            style={{
              width: 34,
              height: 34,
              borderRadius: 12,
              border: "1px solid rgba(255,255,255,0.10)",
              background: "rgba(255,255,255,0.03)",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              transform: todayOpen ? "rotate(180deg)" : "rotate(0deg)",
              transition: "transform 160ms ease",
              flexShrink: 0,
            }}
            aria-hidden="true"
          >
            <span style={{ lineHeight: 1, fontSize: 14 }}>▾</span>
          </div>
        </button>
      )}

      {projectId && canEditPlan && (() => {
        const dotColor =
          planPerformanceState === "no_plan"
            ? "rgba(239,68,68,0.95)"
            : planPerformanceState === "on_track"
              ? "rgba(34,197,94,0.95)"
              : "rgba(234,179,8,0.95)";
        const tooltip =
          planPerformanceState === "no_plan"
            ? "План на текущий месяц не задан.\nДобавьте план продаж для корректной аналитики."
            : planPerformanceState === "on_track"
              ? "План выполняется.\nФактические показатели соответствуют плану."
              : "Ежемесячный план не выполняется.\nРекомендуется откорректировать его на более реалистичный.";
        return (
          <div style={{ marginTop: isMobile ? 4 : 10 }}>
            <button
              type="button"
              onClick={() => setPlanModalOpen(true)}
              title={tooltip}
              style={{
                width: "100%",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                gap: 8,
                padding: isMobile ? "12px 14px" : "8px 12px",
                borderRadius: 12,
                border: "1px solid rgba(255,255,255,0.12)",
                background: "rgba(255,255,255,0.04)",
                color: "rgba(255,255,255,0.85)",
                fontSize: isMobile ? 14 : 12,
                fontWeight: 600,
                cursor: "pointer",
                minHeight: isMobile ? 48 : undefined,
              }}
            >
              <span
                style={{
                  width: 8,
                  height: 8,
                  borderRadius: 999,
                  background: dotColor,
                  flexShrink: 0,
                }}
                title={tooltip}
                aria-hidden="true"
              />
              Редактировать план
            </button>
          </div>
        );
      })()}

      {totalSalesPlan > 0 && (
        <div
          style={{
            marginTop: isMobile ? 18 : 16,
            padding: isMobile ? "14px 16px" : "12px 14px",
            borderRadius: 14,
            border: "1px solid rgba(255,255,255,0.10)",
            background: "rgba(0,0,0,0.35)",
            display: "grid",
            gap: 10,
            fontSize: isMobile ? 12 : 11,
            color: "rgba(255,255,255,0.85)",
          }}
        >
          {(() => {
            const fact = factSalesToday ?? 0;
            const isLoadingPlan = salesPlanState === "loadingFact";
            const planValue = isLoadingPlan ? null : dailySalesPlan;
            const raw = (planValue ?? 0) > 0 ? fact / (planValue ?? 1) : 0;
            const clamped = Math.max(0, Math.min(raw, 1));
            const pct = (planValue ?? 0) > 0 ? raw * 100 : 0;
            return (
              <>
                <div
                  style={{
                    height: isMobile ? 8 : 6,
                    borderRadius: 999,
                    background: "rgba(24,24,35,0.9)",
                    overflow: "hidden",
                  }}
                >
                  <div
                    style={{
                      width: `${clamped * 100}%`,
                      height: "100%",
                      borderRadius: 999,
                      background:
                        planPerformanceState === "no_plan"
                          ? "rgba(234,179,8,0.65)"
                          : planPerformanceState === "on_track"
                            ? "rgba(34,197,94,0.85)"
                            : "rgba(239,68,68,0.85)",
                      transition: "width 180ms ease-out",
                    }}
                  />
                </div>
                <div
                  style={{
                    display: "flex",
                    justifyContent: "space-between",
                    alignItems: "center",
                    gap: 8,
                    flexWrap: "wrap",
                  }}
                >
                  <span>
                    {salesPlanState === "planExhausted"
                      ? "План исчерпан"
                      : isLoadingPlan
                        ? "Загрузка..."
                        : `${pct.toFixed(0)}% плана`}
                  </span>
                  <span style={{ textAlign: "right" }}>
                    {new Intl.NumberFormat("ru-RU").format(Math.round(fact))} /{" "}
                    {isLoadingPlan
                      ? "..."
                      : new Intl.NumberFormat("ru-RU").format(Math.round(dailySalesPlan))}{" "}
                    продаж
                  </span>
                </div>
              </>
            );
          })()}
        </div>
      )}

      <div style={{ display: "grid", gap: isMobile ? 12 : 10, marginTop: isMobile ? 16 : 12, minWidth: 0 }}>
        {topMetrics.map((m) => (
          <MetricRow key={m.key} m={m} currency={projectCurrency} usdToKztRate={usdToKztRate} variant={variant} />
        ))}

        {isMobile || todayOpen ? (
          <div style={{ display: "grid", gap: isMobile ? 12 : 10, minWidth: 0 }}>
            {extendedMetrics.map((m) => (
              <MetricRow key={m.key} m={m} currency={projectCurrency} usdToKztRate={usdToKztRate} variant={variant} />
            ))}
            {isMobile && onCloseDrawer ? (
              <button
                type="button"
                onClick={onCloseDrawer}
                style={{
                  width: "100%",
                  marginTop: 4,
                  padding: "14px 12px",
                  border: "none",
                  background: "transparent",
                  color: "rgba(248, 113, 113, 0.95)",
                  fontSize: 15,
                  fontWeight: 600,
                  cursor: "pointer",
                  textAlign: "center",
                  minHeight: 48,
                }}
              >
                Закрыть
              </button>
            ) : null}
          </div>
        ) : (
          <button
            type="button"
            onClick={() => setTodayMetricsFrameOpen(true)}
            style={{
              width: "100%",
              margin: 0,
              padding: isMobile ? "12px 14px" : "10px 12px",
              borderRadius: 12,
              border: "1px solid rgba(255,255,255,0.10)",
              background: "rgba(255,255,255,0.04)",
              color: "rgba(255,255,255,0.72)",
              fontSize: isMobile ? 14 : 12,
              fontWeight: 600,
              cursor: "pointer",
              textAlign: "center",
              transition: "background 0.15s ease, border-color 0.15s ease",
              minHeight: isMobile ? 48 : undefined,
            }}
            onMouseEnter={(e) => {
              e.currentTarget.style.background = "rgba(255,255,255,0.08)";
              e.currentTarget.style.borderColor = "rgba(255,255,255,0.16)";
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.background = "rgba(255,255,255,0.04)";
              e.currentTarget.style.borderColor = "rgba(255,255,255,0.10)";
            }}
          >
            Показать ROAS / CAC / CPR
          </button>
        )}
      </div>
    </div>
  );
}
