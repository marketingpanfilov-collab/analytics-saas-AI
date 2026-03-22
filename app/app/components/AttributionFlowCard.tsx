"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { InsightTooltip } from "./InsightTooltip";

type FlowPath = {
  path: string[];
  conversions: number;
  percent: number;
};

type ApiResponse =
  | { success: true; paths: FlowPath[] }
  | { success: false; error: string };

const CARD_STYLE = {
  borderRadius: 16,
  border: "1px solid rgba(255,255,255,0.10)",
  background: "rgba(255,255,255,0.03)",
  padding: 18,
  boxShadow: "0 20px 60px rgba(0,0,0,0.55)",
  minHeight: 260,
  display: "flex",
  flexDirection: "column",
} as const;

const BADGE_BASE = {
  padding: "6px 10px",
  borderRadius: 10,
  background: "rgba(255,255,255,0.05)",
  fontSize: 13,
  fontWeight: 500,
} as const;

const SOURCE_LABELS: Record<string, string> = {
  meta: "Meta Ads",
  google: "Google Ads",
  tiktok: "TikTok Ads",
  yandex: "Яндекс Директ",
  direct: "Прямой переход",
  organic_search: "Органический поиск",
  referral: "Реферальный переход",
};

function srcLabel(source: string): string {
  if (source === "purchase") return "Покупка";
  const key = source.toLowerCase();
  return SOURCE_LABELS[key] ?? source;
}

// Muted colors consistent with dashboard
const SOURCE_COLORS: Record<string, string> = {
  meta: "rgba(92,142,214,0.85)",
  google: "rgba(214,142,92,0.85)",
  tiktok: "rgba(139,124,201,0.85)",
  yandex: "rgba(200,180,120,0.85)",
  direct: "rgba(148,163,184,0.75)",
  organic_search: "rgba(148,163,184,0.75)",
  referral: "rgba(148,163,184,0.75)",
  purchase: "rgba(88,184,132,0.85)",
};

function badgeColor(step: string): string {
  const key = step.toLowerCase();
  return SOURCE_COLORS[key] ?? "rgba(255,255,255,0.12)";
}

const DEMO_PATHS: FlowPath[] = [
  { path: ["meta", "google", "purchase"], conversions: 42, percent: 42 },
  { path: ["direct", "purchase"], conversions: 28, percent: 28 },
  { path: ["tiktok", "meta", "purchase"], conversions: 15, percent: 15 },
  { path: ["google", "purchase"], conversions: 10, percent: 10 },
  { path: ["direct", "meta", "purchase"], conversions: 5, percent: 5 },
];

type Props = {
  projectId: string | null;
  days?: number;
};

const TOOLTIP_OFFSET = { x: 12, y: 8 };
const PATH_CARD_BASE = {
  borderRadius: 12,
  border: "1px solid rgba(255,255,255,0.08)",
  background: "rgba(255,255,255,0.02)",
  padding: 12,
  cursor: "default",
  transition: "transform 0.2s ease, border-color 0.2s ease, box-shadow 0.2s ease",
} as const;
const PATH_CARD_HOVER = {
  transform: "scale(1.01)",
  border: "1px solid rgba(255,255,255,0.14)",
  boxShadow: "0 4px 16px rgba(0,0,0,0.2)",
} as const;

export function AttributionFlowCard({ projectId, days = 30 }: Props) {
  const [paths, setPaths] = useState<FlowPath[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [tooltip, setTooltip] = useState<{ path: FlowPath; x: number; y: number } | null>(null);

  const fetchData = useCallback(async () => {
    if (!projectId) {
      setPaths([]);
      setLoading(false);
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(
        `/api/attribution-flow?project_id=${encodeURIComponent(
          projectId
        )}&days=${days}`,
        { cache: "no-store" }
      );
      const json = (await res.json()) as ApiResponse;
      if (!res.ok || !json.success) {
        setError((json as any)?.error ?? "Ошибка загрузки");
        setPaths([]);
        return;
      }
      setPaths(json.paths ?? []);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Ошибка загрузки");
      setPaths([]);
    } finally {
      setLoading(false);
    }
  }, [projectId, days]);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  const isDemo = !loading && !error && paths.length === 0;
  const sortedPaths = isDemo ? DEMO_PATHS : [...paths].sort((a, b) => b.conversions - a.conversions);
  const displayPaths = sortedPaths.slice(0, 5);

  const hasRealData = !isDemo && displayPaths.length > 0;
  const pathChainLabel = (p: FlowPath) => p.path.map((s) => srcLabel(s)).join(" → ");

  const HEADER_FRAME = {
    margin: "0 -18px 0 -18px",
    padding: "16px 20px",
    borderBottom: "1px solid rgba(255,255,255,0.06)",
    background: "rgba(255,255,255,0.02)",
  } as const;

  return (
    <div style={CARD_STYLE}>
      {/* Header */}
      <div style={HEADER_FRAME}>
        <div
          style={{
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
            gap: 8,
            marginBottom: 4,
          }}
        >
          <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
            <h2
              style={{
                fontWeight: 700,
                fontSize: 17,
                margin: 0,
                color: "rgba(255,255,255,0.95)",
              }}
            >
              Топ путей пользователей
            </h2>
            <InsightTooltip
              text="Показывает самые частые маршруты пользователей до покупки."
              secondary="Например, пользователь мог сначала прийти из рекламы, затем вернуться напрямую и только потом совершить покупку."
            >
              <span
                style={{
                  display: "inline-flex",
                  width: 16,
                  height: 16,
                  borderRadius: "50%",
                  border: "1px solid rgba(255,255,255,0.22)",
                  color: "rgba(255,255,255,0.5)",
                  fontSize: 11,
                  fontWeight: 600,
                  alignItems: "center",
                  justifyContent: "center",
                  flexShrink: 0,
                }}
                aria-label="Подсказка"
              >
                ?
              </span>
            </InsightTooltip>
          </div>
          {isDemo && (
            <span
              style={{
                padding: "3px 8px",
                borderRadius: 6,
                fontSize: 10,
                fontWeight: 600,
                background: "rgba(248,113,113,0.18)",
                border: "1px solid rgba(248,113,113,0.5)",
                color: "rgba(248,113,113,0.95)",
                textTransform: "uppercase",
                letterSpacing: 0.4,
              }}
            >
              DEMO PATH DATA
            </span>
          )}
        </div>
        <p
          style={{
            fontSize: 12,
            color: "rgba(255,255,255,0.55)",
            margin: 0,
            lineHeight: 1.4,
          }}
        >
          Показывает самые частые маршруты пользователей до покупки.
        </p>
      </div>

      <div style={{ flex: 1, minHeight: 0, overflow: "hidden", display: "flex", flexDirection: "column" }}>
      {loading ? (
        <div>
          {[1, 2, 3].map((i) => (
            <div
              key={i}
              style={{
                height: 64,
                background: "rgba(255,255,255,0.05)",
                borderRadius: 10,
                marginBottom: 6,
              }}
            />
          ))}
        </div>
      ) : error ? (
        <p
          style={{
            color: "rgba(255,180,140,0.9)",
            fontSize: 12,
            marginBottom: 10,
          }}
        >
          {error}
        </p>
      ) : !hasRealData && !isDemo ? (
        <div>
          <p
            style={{
              fontSize: 13,
              color: "rgba(255,255,255,0.82)",
              marginBottom: 10,
            }}
          >
            Недостаточно данных для анализа путей пользователей.
          </p>
          <Link
            href={
              projectId
                ? `/app/attribution-debugger?project_id=${encodeURIComponent(
                    projectId
                  )}`
                : "/app/attribution-debugger"
            }
            style={{
              display: "inline-flex",
              alignItems: "center",
              padding: "8px 14px",
              borderRadius: 10,
              border: "1px solid rgba(255,255,255,0.10)",
              background: "rgba(255,255,255,0.04)",
              color: "rgba(255,255,255,0.82)",
              fontSize: 12,
              fontWeight: 600,
              textDecoration: "none",
            }}
          >
            Перейти в проверку атрибуции
          </Link>
        </div>
      ) : (
        <div
          style={{
            flex: 1,
            minHeight: 0,
            overflow: "hidden",
            marginTop: 12,
          }}
        >
          <div
            style={{
              height: "100%",
              overflowY: "auto",
              paddingRight: 8,
              scrollbarWidth: "thin",
              scrollbarColor: "rgba(255,255,255,0.15) transparent",
            }}
          >
            <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
            {displayPaths.map((p, index) => {
              const rank = index + 1;
              const percentLabel = p.percent != null ? `${p.percent}%` : "—";
              const isHovered = tooltip && tooltip.path === p;
              return (
                <div
                  key={`${p.path.join(">")}-${index}`}
                  style={{
                    ...PATH_CARD_BASE,
                    ...(isHovered ? PATH_CARD_HOVER : {}),
                  }}
                  onMouseEnter={(e) => {
                    setTooltip({
                      path: p,
                      x: e.clientX + TOOLTIP_OFFSET.x,
                      y: e.clientY + TOOLTIP_OFFSET.y,
                    });
                  }}
                  onMouseMove={(e) => {
                    setTooltip((prev) =>
                      prev && prev.path === p
                        ? { ...prev, x: e.clientX + TOOLTIP_OFFSET.x, y: e.clientY + TOOLTIP_OFFSET.y }
                        : prev
                    );
                  }}
                  onMouseLeave={() => setTooltip(null)}
                >
                  <div
                    style={{
                      display: "flex",
                      justifyContent: "space-between",
                      alignItems: "center",
                      marginBottom: 8,
                      fontSize: 12,
                      color: "rgba(255,255,255,0.85)",
                    }}
                  >
                    <span style={{ display: "flex", alignItems: "center", gap: 6 }}>
                      <span
                        style={{
                          minWidth: 20,
                          height: 20,
                          borderRadius: 6,
                          border: `1px solid ${rank <= 3 ? (rank === 1 ? "#C7A86C" : rank === 2 ? "#A9B0B8" : "#A06A4F") : "rgba(255,255,255,0.08)"}`,
                          display: "inline-flex",
                          alignItems: "center",
                          justifyContent: "center",
                          fontSize: 10,
                          fontWeight: 600,
                          color: rank <= 3 ? (rank === 1 ? "#C7A86C" : rank === 2 ? "#A9B0B8" : "#A06A4F") : "rgba(255,255,255,0.5)",
                          background: rank <= 3 ? (rank === 1 ? "#C7A86C22" : rank === 2 ? "#A9B0B822" : "#A06A4F22") : "rgba(255,255,255,0.03)",
                          flexShrink: 0,
                        }}
                      >
                        #{rank}
                      </span>
                      <span style={{ fontWeight: 600 }}>
                        Path {rank} • {percentLabel}
                      </span>
                    </span>
                    <span style={{ fontSize: 11, color: "rgba(255,255,255,0.55)" }}>
                      {p.conversions} конверсий
                    </span>
                  </div>
                  <div
                    style={{
                      display: "flex",
                      alignItems: "center",
                      gap: 6,
                      flexWrap: "wrap",
                    }}
                  >
                    {p.path.map((s, i) => (
                      <span key={`${s}-${i}`} style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
                        <span
                          style={{
                            ...BADGE_BASE,
                            color: "rgba(255,255,255,0.95)",
                            background: s === "purchase" ? "rgba(88,184,132,0.2)" : "rgba(255,255,255,0.05)",
                            borderLeft: `3px solid ${badgeColor(s)}`,
                          }}
                        >
                          {srcLabel(s)}
                        </span>
                        {i < p.path.length - 1 && (
                          <span style={{ fontSize: 14, color: "rgba(255,255,255,0.35)" }}>→</span>
                        )}
                      </span>
                    ))}
                  </div>
                </div>
              );
            })}
            </div>
          </div>
        </div>
      )}
      </div>

      {tooltip && (
        <div
          role="tooltip"
          style={{
            position: "fixed",
            left: tooltip.x,
            top: tooltip.y,
            zIndex: 9999,
            padding: "12px 14px",
            borderRadius: 16,
            background: "rgba(18,18,24,0.98)",
            border: "1px solid rgba(255,255,255,0.10)",
            boxShadow: "0 12px 40px rgba(0,0,0,0.45)",
            fontSize: 12,
            color: "rgba(255,255,255,0.9)",
            lineHeight: 1.5,
            maxWidth: 320,
            pointerEvents: "none",
          }}
        >
          <div style={{ marginBottom: 6, fontWeight: 500 }}>
            {pathChainLabel(tooltip.path)}
          </div>
          <div style={{ marginBottom: 4, color: "rgba(255,255,255,0.7)" }}>
            {tooltip.path.conversions} конверсий
          </div>
          <div style={{ marginBottom: 4, color: "rgba(255,255,255,0.7)" }}>
            Доля всех путей: {tooltip.path.percent}%
          </div>
          <div style={{ marginBottom: 4, color: "rgba(255,255,255,0.7)" }}>
            Длина пути: {tooltip.path.path.length} {tooltip.path.path.length === 1 ? "шаг" : tooltip.path.path.length < 5 ? "шага" : "шагов"}
          </div>
          {displayPaths[0] === tooltip.path && (
            <div style={{ color: "rgba(255,255,255,0.6)", fontSize: 11 }}>
              Наиболее частый маршрут до покупки
            </div>
          )}
        </div>
      )}
    </div>
  );
}

