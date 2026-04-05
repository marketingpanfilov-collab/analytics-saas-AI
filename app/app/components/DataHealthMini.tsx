"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, useRef, useEffect, useCallback } from "react";
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

export default function DataHealthMini({ projectId, initialData = null }: DataHealthMiniProps) {
  const router = useRouter();
  const { bootstrap } = useBillingBootstrap();
  const { requestBillingPricingModal } = useBillingPricingModalRequest();
  const isStarterPlan = bootstrap?.effective_plan === "starter";

  const [popoverOpen, setPopoverOpen] = useState(false);
  const [data, setData] = useState<DataQualityPayload | null>(initialData ?? null);
  const [loading, setLoading] = useState(false);
  const anchorRef = useRef<HTMLDivElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);

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

  // When panel opens and we have projectId, fetch if no data yet (Starter — без запроса)
  useEffect(() => {
    if (popoverOpen && projectId && !data && !loading && !isStarterPlan) {
      fetchData();
    }
  }, [popoverOpen, projectId, data, loading, fetchData, isStarterPlan]);

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

  const score = data?.score ?? 0;
  const hasData = data?.has_data ?? false;
  const v = Math.max(0, Math.min(100, score));
  const status = getStatusFromScore(v);

  const onStarterChangePlan = useCallback(() => {
    const opened = requestBillingPricingModal("data_quality_starter", { force: true });
    if (!opened) router.push("/app/settings");
  }, [requestBillingPricingModal, router]);

  return (
    <div style={{ position: "relative", display: "flex", alignItems: "center" }}>
      <div
        ref={anchorRef}
        role="button"
        tabIndex={0}
        onClick={() => setPopoverOpen((o) => !o)}
        onKeyDown={(e) => (e.key === "Enter" || e.key === " ") && setPopoverOpen((o) => !o)}
        aria-expanded={popoverOpen}
        aria-haspopup="dialog"
        style={{
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
        }}
        onMouseEnter={(e) => {
          e.currentTarget.style.background = "rgba(255,255,255,0.08)";
          e.currentTarget.style.boxShadow = "0 0 0 1px rgba(255,255,255,0.06)";
        }}
        onMouseLeave={(e) => {
          e.currentTarget.style.background = "rgba(255,255,255,0.04)";
          e.currentTarget.style.boxShadow = "none";
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 5 }}>
          <span style={{ color: "rgba(255,255,255,0.9)" }}>
            <ShieldIcon size={14} />
          </span>
          <span style={{ fontSize: 11, fontWeight: 600, color: "rgba(255,255,255,0.9)" }}>Качество данных</span>
        </div>
        {isStarterPlan ? (
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
      </div>

      {popoverOpen && (
        <div
          ref={panelRef}
          role="dialog"
          aria-label="Качество данных"
          style={{
            position: "absolute",
            top: "100%",
            right: 0,
            marginTop: 6,
            zIndex: 100,
            width: "min(500px, calc(100vw - 24px))",
            maxHeight: "min(80vh, 520px)",
            overflow: "auto",
            background: "rgba(18,18,24,0.98)",
            border: "1px solid rgba(255,255,255,0.1)",
            borderRadius: 12,
            boxShadow: "0 12px 32px rgba(0,0,0,0.45)",
            padding: 0,
            fontSize: 13,
            animation: "dataQualityPanelIn 0.15s ease-out",
          }}
        >
          <style>{`
            @keyframes dataQualityPanelIn {
              from { opacity: 0; transform: translateY(-6px); }
              to { opacity: 1; transform: translateY(0); }
            }
          `}</style>

          {isStarterPlan ? (
            <div style={{ padding: 20 }}>
              <div style={{ fontWeight: 700, fontSize: 16, color: "white", marginBottom: 6 }}>Качество данных</div>
              <p style={{ color: "rgba(255,255,255,0.65)", margin: 0, lineHeight: 1.45, fontSize: 13 }}>
                На тарифе Starter этот показатель недоступен. На Growth и Scale отображаются оценка качества данных и
                рекомендации по атрибуции.
              </p>
              <button
                type="button"
                onClick={onStarterChangePlan}
                className="mt-3.5 w-full cursor-pointer rounded-[10px] bg-emerald-600 px-4 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-emerald-500 focus:outline-none focus-visible:ring-2 focus-visible:ring-emerald-400/80"
              >
                Сменить тариф
              </button>
            </div>
          ) : loading ? (
            <div style={{ padding: 24, textAlign: "center", color: "rgba(255,255,255,0.6)", fontSize: 13 }}>
              Загрузка…
            </div>
          ) : !hasData ? (
            <div style={{ padding: 20 }}>
              <div style={{ fontWeight: 700, fontSize: 16, color: "white", marginBottom: 6 }}>Качество данных</div>
              <p style={{ color: "rgba(255,255,255,0.65)", margin: 0, lineHeight: 1.45, fontSize: 13 }}>
                Недостаточно данных для анализа качества.
              </p>
            </div>
          ) : (
            <>
              {/* Panel header — compact */}
              <div style={{ padding: "14px 18px 12px", borderBottom: "1px solid rgba(255,255,255,0.08)" }}>
                <h2 style={{ fontWeight: 700, fontSize: 16, color: "white", margin: "0 0 2px" }}>Качество данных</h2>
                <p style={{ fontSize: 12, color: "rgba(255,255,255,0.55)", margin: 0, lineHeight: 1.35 }}>
                  Показывает, насколько корректно работает атрибуция рекламы.
                </p>
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
                        <span style={{ fontSize: 14, flexShrink: 0 }} aria-hidden>⚠</span>
                        <div style={{ minWidth: 0 }}>
                          <div style={{ fontWeight: 600, color: "white", fontSize: 12 }}>
                            {i.percent > 0 ? `${i.percent}% — ` : ""}{i.title}
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
                        <span style={{ fontSize: 14, flexShrink: 0 }} aria-hidden>💡</span>
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

              {/* CTA — compact */}
              <div style={{ padding: "12px 18px 16px", borderTop: "1px solid rgba(255,255,255,0.08)" }}>
                <Link
                  href={projectId ? `/app/attribution-debugger?project_id=${encodeURIComponent(projectId)}` : "/app/attribution-debugger"}
                  style={{
                    display: "block",
                    textAlign: "center",
                    padding: "10px 16px",
                    borderRadius: 10,
                    background: "rgba(255,255,255,0.08)",
                    border: "1px solid rgba(255,255,255,0.12)",
                    color: "white",
                    fontWeight: 600,
                    fontSize: 13,
                    textDecoration: "none",
                    transition: "background 0.2s, border-color 0.2s",
                  }}
                  onMouseEnter={(e) => {
                    e.currentTarget.style.background = "rgba(255,255,255,0.12)";
                    e.currentTarget.style.borderColor = "rgba(255,255,255,0.2)";
                  }}
                  onMouseLeave={(e) => {
                    e.currentTarget.style.background = "rgba(255,255,255,0.08)";
                    e.currentTarget.style.borderColor = "rgba(255,255,255,0.12)";
                  }}
                >
                  Открыть проверку атрибуции
                </Link>
              </div>
            </>
          )}
        </div>
      )}
    </div>
  );
}
