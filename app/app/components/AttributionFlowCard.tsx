"use client";

import { useCallback, useEffect, useState } from "react";
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

const EMPTY_DATA_HELP_TEXT =
  "Если данные должны быть, проверьте, что путь пользователя собирается корректно.";
const EMPTY_DATA_HELP_STEPS =
  "1) Pixel/CRM: события purchase и registration не теряются.\n2) UTM в рекламе: ссылки размечены корректно.\n3) Фильтры: период и источники выбраны верно.\n4) Синхронизация: дождитесь обновления.";

type Props = {
  projectId: string | null;
  days?: number;
  start?: string | null;
  end?: string | null;
  sources?: string[];
  accountIds?: string[];
};

const TOOLTIP_OFFSET = { x: 12, y: 8 };
const VISIBLE_PATHS = 4;
const PATH_CARD_MIN_HEIGHT = 92;
const PATH_CARD_GAP = 12;
const PATH_CARD_BASE = {
  borderRadius: 12,
  border: "1px solid rgba(255,255,255,0.08)",
  background: "rgba(255,255,255,0.02)",
  padding: 12,
  minHeight: PATH_CARD_MIN_HEIGHT,
  boxSizing: "border-box" as const,
  cursor: "default",
  transition: "transform 0.2s ease, border-color 0.2s ease, box-shadow 0.2s ease",
} as const;
const PATH_CARD_HOVER = {
  transform: "scale(1.01)",
  border: "1px solid rgba(255,255,255,0.14)",
  boxShadow: "0 4px 16px rgba(0,0,0,0.2)",
} as const;

export function AttributionFlowCard({
  projectId,
  days = 30,
  start,
  end,
  sources = [],
  accountIds = [],
}: Props) {
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
      const q = new URLSearchParams({
        project_id: projectId,
        days: String(days),
        ...(start ? { start } : {}),
        ...(end ? { end } : {}),
        ...(sources.length ? { sources: sources.join(",") } : {}),
        ...(accountIds.length ? { account_ids: accountIds.join(",") } : {}),
      });
      const res = await fetch(`/api/attribution-flow?${q.toString()}`, { cache: "no-store" });
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
  }, [projectId, days, start, end, sources, accountIds]);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  const isEmpty = !loading && !error && paths.length === 0;
  const sortedPaths = [...paths].sort((a, b) => b.conversions - a.conversions);
  const displayPaths = sortedPaths;

  const hasRealData = displayPaths.length > 0;
  const isActive = !loading && !error && hasRealData;
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
          {isActive && (
            <span
              style={{
                padding: "3px 8px",
                borderRadius: 999,
                fontSize: 10,
                fontWeight: 600,
                background: "rgba(34,197,94,0.18)",
                border: "1px solid rgba(34,197,94,0.6)",
                color: "rgba(34,197,94,0.95)",
                textTransform: "uppercase",
                letterSpacing: 0.4,
              }}
            >
              Активно
            </span>
          )}
        </div>
        <p
          style={{
            fontSize: 12,
            color: "rgba(255,255,255,0.55)",
            margin: 0,
            lineHeight: 1.4,
            minHeight: 34,
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
        <div style={{ minHeight: 140, display: "flex", alignItems: "center", justifyContent: "center", textAlign: "center", padding: "0 16px" }}>
          <p
            style={{
              color: "rgba(255,180,140,0.9)",
              fontSize: 12,
              margin: 0,
            }}
          >
            {error}
          </p>
        </div>
      ) : !hasRealData ? (
        <div style={{ height: "100%", minHeight: 140, display: "flex", alignItems: "center", justifyContent: "center", textAlign: "center", padding: "0 16px" }}>
          <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 8 }}>
          <p
            style={{
              fontSize: 12,
              color: "rgba(255,255,255,0.7)",
              margin: 0,
            }}
          >
            Недостаточно данных для анализа путей пользователей за выбранный период.
          </p>
          <InsightTooltip text={EMPTY_DATA_HELP_TEXT} secondary={EMPTY_DATA_HELP_STEPS}>
            <span style={{ fontSize: 12, color: "rgba(255,255,255,0.58)", textDecoration: "underline dotted", cursor: "help" }}>
              Почему так и что проверить?
            </span>
          </InsightTooltip>
          </div>
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
            className="scrollbar-hidden"
            style={{
              height: "100%",
              overflowY: "auto",
              maxHeight: VISIBLE_PATHS * PATH_CARD_MIN_HEIGHT + (VISIBLE_PATHS - 1) * PATH_CARD_GAP,
              paddingRight: 8,
              scrollbarWidth: "thin",
              scrollbarColor: "rgba(255,255,255,0.15) transparent",
            }}
          >
            <div style={{ display: "flex", flexDirection: "column", gap: PATH_CARD_GAP }}>
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

