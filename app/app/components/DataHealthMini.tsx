"use client";

import { useState, useRef, useEffect, useLayoutEffect, useCallback, type CSSProperties } from "react";
import { createPortal } from "react-dom";
import { acquireBodyScrollLock } from "@/app/lib/bodyScrollLock";
import { MOBILE_APP_SHEET_Z, MobileSheetHeaderCloseButton } from "./mobile/MobileBottomSheet";
import { PLAN_RESTRICTED_ANALYTICS_MESSAGE } from "@/app/lib/planRestrictedCopy";
import { useBillingBootstrap } from "./BillingBootstrapProvider";
import { useBillingPricingModalRequest } from "./BillingPricingModalProvider";

const BREAKDOWN_MAX = {
  click_capture_quality: 20,
  visit_attribution_quality: 25,
  conversion_attribution_quality: 30,
  purchase_completeness: 15,
  registration_completeness: 10,
} as const;

const BREAKDOWN_LABELS: Record<keyof typeof BREAKDOWN_MAX, string> = {
  click_capture_quality: "Сбор кликов",
  visit_attribution_quality: "Визиты",
  conversion_attribution_quality: "Конверсии",
  purchase_completeness: "Покупки",
  registration_completeness: "Регистрации",
};

export type DataHealthBreakdown = {
  click_capture_quality: number;
  visit_attribution_quality: number;
  conversion_attribution_quality: number;
  purchase_completeness: number;
  registration_completeness: number;
};

export type DataHealthIssue = {
  code: string;
  title: string;
  description: string;
  percent: number;
  missing_count: number;
  total_count: number;
  severity: "low" | "medium" | "high";
  category: string;
  low_sample?: boolean;
};

export type DataHealthRecommendation = {
  code: string;
  title: string;
  description: string;
  action_text?: string;
  priority: "high" | "medium" | "low";
  impact?: string[];
  related_issue_codes: string[];
};

export type DataQualityPayload = {
  has_data: boolean;
  score: number | null;
  label: string;
  breakdown: DataHealthBreakdown | null;
  issues: DataHealthIssue[];
  recommendations: DataHealthRecommendation[];
};

type DataHealthMiniProps = {
  projectId: string | null;
  /** Optional preloaded data (e.g. from Topbar). If not provided, data is fetched when panel opens. */
  initialData?: DataQualityPayload | null;
  /** Пока Topbar грузит /api/data-quality (Growth/Scale) — для mobile context strip */
  dataQualityPrefetchPending?: boolean;
  /** Одна строка под primary topbar на mobile; панель — bottom sheet на узкой ширине */
  variant?: "default" | "mobileContextStrip";
};

function getStatusFromScore(score: number): { label: string; color: string } {
  if (score < 40) return { label: "Низкое", color: "#ff5a5a" };
  if (score < 70) return { label: "Требует улучшения", color: "#ff9f43" };
  if (score < 90) return { label: "Хорошее", color: "#3ddc97" };
  return { label: "Отличное", color: "#2ecc71" };
}

function ShieldIcon({ size = 24 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" aria-hidden="true" style={{ display: "block", flexShrink: 0 }}>
      <path
        d="M12 2L4 5v6.09c0 5.05 3.41 9.76 8 10.91 4.59-1.15 8-5.86 8-10.91V5l-8-3z"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinejoin="round"
        fill="none"
      />
    </svg>
  );
}

function GaugeSvg({ value, size = 72 }: { value: number; size?: number }) {
  const v = Math.max(0, Math.min(100, value));
  const red = "#ff5a5a";
  const orange = "#ff9f43";
  const green = "#3ddc97";
  const brightGreen = "#2ecc71";
  const cx = size / 2;
  const cy = size / 2;
  const r = size / 2 - 5;
  const strokeWidth = 6;
  const rInner = r - strokeWidth / 2;
  const circumference = 2 * Math.PI * rInner;
  const offset = circumference - (v / 100) * circumference;
  return (
    <div style={{ position: "relative", width: size, height: size, flexShrink: 0 }}>
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} style={{ transform: "rotate(-90deg)" }}>
        <circle cx={cx} cy={cy} r={rInner} fill="none" stroke="rgba(255,255,255,0.08)" strokeWidth={strokeWidth} />
        <circle
          cx={cx}
          cy={cy}
          r={rInner}
          fill="none"
          stroke={v < 40 ? red : v < 70 ? orange : v < 90 ? green : brightGreen}
          strokeWidth={strokeWidth}
          strokeLinecap="round"
          strokeDasharray={circumference}
          strokeDashoffset={offset}
          style={{ transition: "stroke-dashoffset 0.3s ease" }}
        />
      </svg>
      <div style={{ position: "absolute", inset: 0, display: "flex", alignItems: "center", justifyContent: "center" }}>
        <span style={{ fontSize: Math.round(size * 0.28), fontWeight: 700, color: "white", lineHeight: 1 }}>{Math.round(v)}%</span>
      </div>
    </div>
  );
}

export default function DataHealthMini({
  projectId,
  initialData = null,
  dataQualityPrefetchPending = false,
  variant = "default",
}: DataHealthMiniProps) {
  const { bootstrap, loading: billingBootstrapLoading } = useBillingBootstrap();
  const { requestBillingPricingModal } = useBillingPricingModalRequest();
  /** Только Growth / Scale: оценка и рекомендации (см. попап и Topbar prefetch). */
  const hasPaidDataQualityAccess =
    bootstrap?.effective_plan === "growth" || bootstrap?.effective_plan === "scale";

  const [popoverOpen, setPopoverOpen] = useState(false);
  const [data, setData] = useState<DataQualityPayload | null>(initialData ?? null);
  const [loading, setLoading] = useState(false);
  const [layoutNarrow, setLayoutNarrow] = useState(false);
  const anchorRef = useRef<HTMLDivElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const [sheetPortalReady, setSheetPortalReady] = useState(false);

  useLayoutEffect(() => {
    setSheetPortalReady(true);
  }, []);

  useEffect(() => {
    if (typeof window === "undefined") return;
    const mq = window.matchMedia("(max-width: 1023px)");
    const sync = () => setLayoutNarrow(mq.matches);
    sync();
    mq.addEventListener("change", sync);
    return () => mq.removeEventListener("change", sync);
  }, []);

  const useBottomSheet = variant === "mobileContextStrip" && layoutNarrow;

  const fetchData = useCallback(async () => {
    if (!projectId) return;
    setLoading(true);
    try {
      const r = await fetch(`/api/data-quality?project_id=${encodeURIComponent(projectId)}&days=30`, {
        cache: "no-store",
      });
      const j = (await r.json()) as {
        success?: boolean;
        has_data?: boolean;
        score?: number | null;
        label?: string;
        breakdown?: DataQualityPayload["breakdown"];
        issues?: DataHealthIssue[];
        recommendations?: DataHealthRecommendation[];
      };
      if (j?.success && j?.has_data !== undefined) {
        setData({
          has_data: j.has_data ?? false,
          score: j.score ?? null,
          label: j.label ?? "No data",
          breakdown: j.breakdown ?? null,
          issues: Array.isArray(j.issues) ? j.issues : [],
          recommendations: Array.isArray(j.recommendations) ? j.recommendations : [],
        });
      } else {
        setData({
          has_data: false,
          score: null,
          label: "No data",
          breakdown: null,
          issues: [],
          recommendations: [],
        });
      }
    } catch {
      setData({
        has_data: false,
        score: null,
        label: "No data",
        breakdown: null,
        issues: [],
        recommendations: [],
      });
    } finally {
      setLoading(false);
    }
  }, [projectId]);

  // Качество данных по API — только на Growth/Scale; на бесплатном/базовом тарифе запрос не делаем
  useEffect(() => {
    if (popoverOpen && projectId && !data && !loading && hasPaidDataQualityAccess) {
      fetchData();
    }
  }, [popoverOpen, projectId, data, loading, fetchData, hasPaidDataQualityAccess]);

  // Sync initialData into local state when it becomes available from parent
  useEffect(() => {
    if (initialData != null) setData(initialData);
  }, [initialData]);

  useEffect(() => {
    if (!popoverOpen) return;
    function onDocClick(e: MouseEvent) {
      const el = panelRef.current;
      const anchor = anchorRef.current;
      if (el?.contains(e.target as Node) || anchor?.contains(e.target as Node)) return;
      setPopoverOpen(false);
    }
    document.addEventListener("mousedown", onDocClick);
    return () => document.removeEventListener("mousedown", onDocClick);
  }, [popoverOpen]);

  useEffect(() => {
    if (!popoverOpen || !useBottomSheet) return;
    return acquireBodyScrollLock();
  }, [popoverOpen, useBottomSheet]);

  useEffect(() => {
    if (!popoverOpen) return;
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") setPopoverOpen(false);
    }
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [popoverOpen]);

  const score = data?.score ?? 0;
  const hasData = data?.has_data ?? false;
  const v = Math.max(0, Math.min(100, score));
  const status = getStatusFromScore(v);

  const onDataQualityUpgradeClick = useCallback(() => {
    if (billingBootstrapLoading) return;
    requestBillingPricingModal("data_quality_starter", { force: true });
  }, [requestBillingPricingModal, billingBootstrapLoading]);

  /**
   * Mobile context strip: тот же формат, что и desktop (две строки → одна строка «Качество данных: …»).
   * Процент и label — из getStatusFromScore(v), те же пороги, что у desktop; без новых статусов.
   */
  const mobileContextStripDisplay =
    variant === "mobileContextStrip"
      ? (() => {
          const prefetchWait =
            Boolean(dataQualityPrefetchPending) ||
            (loading && hasPaidDataQualityAccess && !!projectId && data == null);
          if (hasPaidDataQualityAccess && projectId && prefetchWait) {
            return { dot: "rgba(148, 163, 184, 0.85)", text: "Качество данных: Загрузка..." };
          }
          if (!hasPaidDataQualityAccess) {
            return { dot: "rgba(251, 191, 36, 0.95)", text: "Качество данных: 0% · Нет доступа" };
          }
          if (!projectId) {
            return { dot: "rgba(161, 161, 170, 0.85)", text: "Качество данных: Нет проекта" };
          }
          if (!hasData) {
            return { dot: "rgba(161, 161, 170, 0.85)", text: "Качество данных: Нет данных" };
          }
          return {
            dot: status.color,
            text: `Качество данных: ${Math.round(v)}% · ${status.label}`,
          };
        })()
      : null;

  const panelSurfaceStyle: CSSProperties = {
    position: useBottomSheet ? "fixed" : "absolute",
    top: useBottomSheet ? "auto" : "100%",
    bottom: useBottomSheet ? 0 : "auto",
    left: useBottomSheet ? 0 : "auto",
    right: useBottomSheet ? 0 : 0,
    marginTop: useBottomSheet ? 0 : 6,
    zIndex: useBottomSheet ? MOBILE_APP_SHEET_Z : 100,
    width: useBottomSheet ? "100%" : "min(500px, calc(100vw - 24px))",
    /* Десктоп: не % от узкого anchor — иначе max-width = ширина триггера (~98px) и текст ломается в столбик. */
    maxWidth: useBottomSheet ? "100%" : "min(500px, calc(100vw - 24px))",
    minWidth: 0,
    maxHeight: useBottomSheet ? "min(88dvh, 640px)" : "min(80vh, 520px)",
    display: useBottomSheet ? "flex" : undefined,
    flexDirection: useBottomSheet ? "column" : undefined,
    overflow: useBottomSheet ? "hidden" : "auto",
    WebkitOverflowScrolling: useBottomSheet ? undefined : "touch",
    boxSizing: "border-box",
    background: "rgba(18,18,24,0.98)",
    border: "1px solid rgba(255,255,255,0.1)",
    borderRadius: useBottomSheet ? "16px 16px 0 0" : 12,
    boxShadow: useBottomSheet ? "0 -12px 48px rgba(0,0,0,0.55)" : "0 12px 32px rgba(0,0,0,0.45)",
    padding: 0,
    fontSize: 13,
    animation: useBottomSheet ? "dataQualitySheetIn 0.28s cubic-bezier(0.22, 1, 0.36, 1)" : "dataQualityPanelIn 0.15s ease-out",
  };

  const dataQualityPanelBody = (
    <>
      {!hasPaidDataQualityAccess ? (
        <div className={useBottomSheet ? "px-4 pb-5 pt-5 sm:px-5 sm:pt-6" : "p-5"}>
          <div className="mb-1.5 text-base font-bold leading-tight text-white sm:text-[16px]">Качество данных</div>
          <p className="mb-0 text-[14px] leading-snug text-white/65 sm:text-[13px] sm:leading-[1.45]">
            {PLAN_RESTRICTED_ANALYTICS_MESSAGE}
          </p>
          <button
            type="button"
            onClick={onDataQualityUpgradeClick}
            className="mt-4 flex w-full min-h-[48px] cursor-pointer items-center justify-center rounded-xl bg-emerald-600 px-4 py-3 text-[15px] font-semibold text-white transition-colors hover:bg-emerald-500 focus:outline-none focus-visible:ring-2 focus-visible:ring-emerald-400/80 active:bg-emerald-700 sm:mt-3.5 sm:min-h-0 sm:rounded-[10px] sm:py-2.5 sm:text-sm"
          >
            Сменить тариф
          </button>
        </div>
      ) : loading ? (
        <div style={{ padding: 24, textAlign: "center", color: "rgba(255,255,255,0.6)", fontSize: 13 }}>
          Загрузка…
        </div>
      ) : !hasData ? (
        <div style={{ padding: 20, paddingBottom: 20 }}>
          <div style={{ fontWeight: 700, fontSize: 16, color: "white", marginBottom: 6 }}>Качество данных</div>
          <p style={{ color: "rgba(255,255,255,0.65)", margin: 0, lineHeight: 1.45, fontSize: 13 }}>
            Недостаточно данных для анализа качества.
          </p>
        </div>
      ) : (
        <>
          {/* Panel header — compact */}
          <div
            style={{
              display: useBottomSheet ? "flex" : undefined,
              alignItems: useBottomSheet ? "center" : undefined,
              gap: useBottomSheet ? 12 : undefined,
              padding: useBottomSheet ? "14px 12px 12px 18px" : "14px 18px 12px",
              borderBottom: "1px solid rgba(255,255,255,0.08)",
            }}
          >
            <div style={{ flex: useBottomSheet ? 1 : undefined, minWidth: 0 }}>
              <h2 style={{ fontWeight: 700, fontSize: 16, color: "white", margin: "0 0 2px" }}>Качество данных</h2>
              <p style={{ fontSize: 12, color: "rgba(255,255,255,0.55)", margin: 0, lineHeight: 1.35 }}>
                Показывает, насколько корректно работает атрибуция рекламы.
              </p>
            </div>
            {useBottomSheet ? (
              <div className="shrink-0">
                <MobileSheetHeaderCloseButton onClick={() => setPopoverOpen(false)} />
              </div>
            ) : null}
          </div>

          {/* Score area — compact: gauge left, label + status right */}
          <div style={{ padding: "14px 18px", display: "flex", alignItems: "center", gap: 14, borderBottom: "1px solid rgba(255,255,255,0.06)" }}>
            <GaugeSvg value={v} size={72} />
            <div>
              <div style={{ fontWeight: 700, fontSize: 15, color: "white" }}>Качество данных</div>
              <div style={{ fontWeight: 600, fontSize: 13, color: status.color, marginTop: 2 }}>{status.label}</div>
            </div>
          </div>

          {/* Breakdown — compact */}
          {data?.breakdown && (
            <div style={{ padding: "12px 18px" }}>
              <div style={{ fontWeight: 600, color: "rgba(255,255,255,0.88)", marginBottom: 8, fontSize: 12 }}>
                Детализация
              </div>
              <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                {(Object.keys(BREAKDOWN_MAX) as (keyof typeof BREAKDOWN_MAX)[]).map((key) => {
                  const val = data.breakdown![key];
                  const max = BREAKDOWN_MAX[key];
                  const pct = max > 0 ? Math.round((val / max) * 100) : 0;
                  return (
                    <div key={key}>
                      <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 2, fontSize: 12 }}>
                        <span style={{ color: "rgba(255,255,255,0.82)" }}>{BREAKDOWN_LABELS[key]}</span>
                        <span style={{ color: "rgba(255,255,255,0.65)", fontVariantNumeric: "tabular-nums" }}>
                          {val} / {max}
                        </span>
                      </div>
                      <div style={{ height: 6, borderRadius: 3, background: "rgba(255,255,255,0.08)", overflow: "hidden" }}>
                        <div
                          style={{
                            height: "100%",
                            width: `${pct}%`,
                            background: pct >= 70 ? "#3ddc97" : pct >= 40 ? "#ff9f43" : "#ff5a5a",
                            borderRadius: 3,
                            transition: "width 0.25s ease",
                          }}
                        />
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          {/* Issues — compact rows */}
          {data?.issues && data.issues.length > 0 && (
            <div style={{ padding: "12px 18px", borderTop: "1px solid rgba(255,255,255,0.06)" }}>
              <div style={{ fontWeight: 600, color: "rgba(255,255,255,0.88)", marginBottom: 6, fontSize: 12 }}>
                Обнаруженные проблемы
              </div>
              <div style={{ display: "flex", flexDirection: "column", gap: 6, maxHeight: 140, overflowY: "auto" }}>
                {data.issues.slice(0, 8).map((i) => (
                  <div
                    key={i.code}
                    style={{
                      display: "flex",
                      gap: 8,
                      padding: "8px 10px",
                      borderRadius: 8,
                      background: "rgba(255,255,255,0.03)",
                      border: "1px solid rgba(255,255,255,0.05)",
                    }}
                  >
                    <span style={{ fontSize: 14, flexShrink: 0 }} aria-hidden>
                      ⚠
                    </span>
                    <div style={{ minWidth: 0 }}>
                      <div style={{ fontWeight: 600, color: "white", fontSize: 12 }}>
                        {i.percent > 0 ? `${i.percent}% — ` : ""}
                        {i.title}
                        {i.low_sample && " (мало событий)"}
                      </div>
                      <div style={{ fontSize: 11, color: "rgba(255,255,255,0.6)", marginTop: 2, lineHeight: 1.35 }}>
                        {i.description}
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Recommendations — compact rows */}
          {data?.recommendations && data.recommendations.length > 0 && (
            <div style={{ padding: "12px 18px", borderTop: "1px solid rgba(255,255,255,0.06)" }}>
              <div style={{ fontWeight: 600, color: "rgba(255,255,255,0.88)", marginBottom: 6, fontSize: 12 }}>
                Рекомендации
              </div>
              <div style={{ display: "flex", flexDirection: "column", gap: 6, maxHeight: 120, overflowY: "auto" }}>
                {data.recommendations.slice(0, 5).map((r) => (
                  <div
                    key={r.code}
                    style={{
                      display: "flex",
                      gap: 8,
                      padding: "8px 10px",
                      borderRadius: 8,
                      background: "rgba(61,220,151,0.05)",
                      border: "1px solid rgba(61,220,151,0.12)",
                    }}
                  >
                    <span style={{ fontSize: 14, flexShrink: 0 }} aria-hidden>
                      💡
                    </span>
                    <div style={{ minWidth: 0 }}>
                      <div style={{ fontWeight: 600, color: "rgba(255,255,255,0.92)", fontSize: 12 }}>{r.title}</div>
                      <div style={{ fontSize: 11, color: "rgba(255,255,255,0.65)", marginTop: 2, lineHeight: 1.35 }}>
                        {r.description || r.action_text}
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

        </>
      )}
    </>
  );

  const panelInnerMarkup = (
    <>
      <style>{`
            @keyframes dataQualityPanelIn {
              from { opacity: 0; transform: translateY(-6px); }
              to { opacity: 1; transform: translateY(0); }
            }
            @keyframes dataQualitySheetIn {
              from { opacity: 0; transform: translate3d(0, 18px, 0); }
              to { opacity: 1; transform: translate3d(0, 0, 0); }
            }
          `}</style>
      {useBottomSheet ? (
        <>
          <div
            style={{
              flex: 1,
              minHeight: 0,
              overflow: "auto",
              WebkitOverflowScrolling: "touch",
            }}
          >
            <div style={{ display: "flex", justifyContent: "center", paddingTop: 10, paddingBottom: 4, flexShrink: 0 }}>
              <div style={{ width: 36, height: 4, borderRadius: 999, background: "rgba(255,255,255,0.2)" }} aria-hidden />
            </div>
            {dataQualityPanelBody}
          </div>
          <div className="shrink-0 border-t border-white/[0.06] px-4 pt-3 pb-[max(16px,env(safe-area-inset-bottom))]">
            <button
              type="button"
              className="w-full rounded-xl border border-red-500/45 bg-red-500/[0.12] py-3 text-center text-[15px] font-semibold leading-snug text-red-200/95 transition-colors hover:border-red-500/55 hover:bg-red-500/[0.18] active:bg-red-500/[0.14]"
              onClick={() => setPopoverOpen(false)}
            >
              Закрыть
            </button>
          </div>
        </>
      ) : (
        dataQualityPanelBody
      )}
    </>
  );

  return (
    <div
      style={{
        position: "relative",
        display: "flex",
        alignItems: "center",
        width: variant === "mobileContextStrip" ? "100%" : undefined,
      }}
    >
      <div
        ref={anchorRef}
        role="button"
        tabIndex={0}
        onClick={() => setPopoverOpen((o) => !o)}
        onKeyDown={(e) => (e.key === "Enter" || e.key === " ") && setPopoverOpen((o) => !o)}
        aria-expanded={popoverOpen}
        aria-haspopup="dialog"
        aria-label={mobileContextStripDisplay?.text ?? "Качество данных"}
        style={
          variant === "mobileContextStrip"
            ? {
                display: "flex",
                flexDirection: "row",
                alignItems: "center",
                justifyContent: "flex-start",
                gap: 10,
                width: "100%",
                minHeight: 36,
                padding: "8px 14px",
                borderRadius: 0,
                cursor: "pointer",
                outline: "none",
                border: "none",
                borderTop: "1px solid rgba(255,255,255,0.07)",
                background: "linear-gradient(180deg, rgba(255,255,255,0.045) 0%, rgba(255,255,255,0.02) 100%)",
                boxShadow: "inset 0 1px 0 rgba(255,255,255,0.04)",
                transition: "background 0.2s ease",
                lineHeight: 1.35,
              }
            : {
                display: "flex",
                flexDirection: "column",
                alignItems: "flex-start",
                justifyContent: "center",
                minWidth: 98,
                height: 40,
                padding: "0 10px",
                borderRadius: 10,
                cursor: "pointer",
                outline: "none",
                border: "1px solid rgba(255,255,255,0.08)",
                background: "rgba(255,255,255,0.04)",
                transition: "background 0.2s ease, box-shadow 0.2s ease",
                lineHeight: 1.25,
              }
        }
        onMouseEnter={(e) => {
          if (variant === "mobileContextStrip") {
            e.currentTarget.style.background =
              "linear-gradient(180deg, rgba(255,255,255,0.065) 0%, rgba(255,255,255,0.035) 100%)";
            return;
          }
          e.currentTarget.style.background = "rgba(255,255,255,0.08)";
          e.currentTarget.style.boxShadow = "0 0 0 1px rgba(255,255,255,0.06)";
        }}
        onMouseLeave={(e) => {
          if (variant === "mobileContextStrip") {
            e.currentTarget.style.background =
              "linear-gradient(180deg, rgba(255,255,255,0.045) 0%, rgba(255,255,255,0.02) 100%)";
            return;
          }
          e.currentTarget.style.background = "rgba(255,255,255,0.04)";
          e.currentTarget.style.boxShadow = "none";
        }}
      >
        {variant === "mobileContextStrip" && mobileContextStripDisplay ? (
          <div
            style={{
              display: "flex",
              alignItems: "flex-start",
              gap: 10,
              minWidth: 0,
              flex: 1,
              fontSize: 11,
              fontWeight: 500,
              letterSpacing: "0.01em",
              color: "rgba(212,212,222,0.92)",
            }}
          >
            <span
              aria-hidden
              style={{
                width: 8,
                height: 8,
                borderRadius: 999,
                flexShrink: 0,
                marginTop: 4,
                background: mobileContextStripDisplay.dot,
                boxShadow: "0 0 0 1px rgba(0,0,0,0.35)",
              }}
            />
            <span
              style={{
                minWidth: 0,
                overflow: "hidden",
                display: "-webkit-box",
                WebkitBoxOrient: "vertical" as const,
                WebkitLineClamp: 2,
                whiteSpace: "normal",
                lineHeight: 1.35,
                wordBreak: "break-word",
              }}
            >
              {mobileContextStripDisplay.text}
            </span>
          </div>
        ) : (
          <>
            <div style={{ display: "flex", alignItems: "center", gap: 5 }}>
              <span style={{ color: "rgba(255,255,255,0.9)" }}>
                <ShieldIcon size={14} />
              </span>
              <span style={{ fontSize: 11, fontWeight: 600, color: "rgba(255,255,255,0.9)" }}>Качество данных</span>
            </div>
            {!hasPaidDataQualityAccess ? (
              <span style={{ fontSize: 12, fontWeight: 700, color: "#3ddc97", marginTop: 1, marginLeft: 19 }}>
                Нет доступа
              </span>
            ) : hasData ? (
              <span style={{ fontSize: 12, fontWeight: 700, color: status.color, marginTop: 1, marginLeft: 19 }}>
                {Math.round(v)}% · {status.label}
              </span>
            ) : (
              <span style={{ fontSize: 11, fontWeight: 600, color: "rgba(255,255,255,0.5)", marginTop: 1 }}>
                {projectId ? "—" : "Нет проекта"}
              </span>
            )}
          </>
        )}
      </div>

      {popoverOpen &&
        (useBottomSheet && sheetPortalReady
          ? createPortal(
              <>
                <button
                  type="button"
                  aria-label="Закрыть"
                  onClick={() => setPopoverOpen(false)}
                  style={{
                    position: "fixed",
                    inset: 0,
                    zIndex: MOBILE_APP_SHEET_Z - 1,
                    background: "rgba(0,0,0,0.55)",
                    backdropFilter: "blur(3px)",
                    WebkitBackdropFilter: "blur(3px)",
                    border: "none",
                    padding: 0,
                    margin: 0,
                    cursor: "pointer",
                  }}
                />
                <div
                  ref={panelRef}
                  role="dialog"
                  aria-modal="true"
                  aria-label="Качество данных"
                  style={panelSurfaceStyle}
                  onClick={(e) => e.stopPropagation()}
                >
                  {panelInnerMarkup}
                </div>
              </>,
              document.body
            )
          : !useBottomSheet ? (
              <div ref={panelRef} role="dialog" aria-label="Качество данных" style={panelSurfaceStyle}>
                {panelInnerMarkup}
              </div>
            ) : null)}
    </div>
  );
}
