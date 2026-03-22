"use client";

import { useEffect, useState, useCallback } from "react";
import { InsightTooltip } from "./InsightTooltip";

type ChannelRow = {
  traffic_source: string;
  direct_conversions: number;
  assisted_conversions: number;
  first_touch_conversions?: number;
};

const SOURCE_LABELS: Record<string, string> = {
  meta: "Meta Ads",
  google: "Google Ads",
  tiktok: "TikTok Ads",
  yandex: "Яндекс Директ",
  direct: "Прямой переход",
};

function trafficSourceLabel(source: string): string {
  if (!source) return "—";
  return SOURCE_LABELS[source.toLowerCase()] ?? source;
}

/** Стиль карточки в единой системе с дашбордом */
const CARD_STYLE = {
  borderRadius: 16,
  border: "1px solid rgba(255,255,255,0.10)",
  background: "rgba(255,255,255,0.03)",
  padding: 18,
  boxShadow: "0 20px 60px rgba(0,0,0,0.55)",
  minHeight: 260,
} as const;

// Приглушённые цвета под dark SaaS
const COLOR_FIRST_TOUCH = "rgba(139,124,201,0.75)";
const COLOR_ASSIST = "rgba(92,142,214,0.75)";
const COLOR_LAST_TOUCH = "rgba(88,184,132,0.85)";
const BAR_HEIGHT = 17;
const BAR_HEIGHT_HOVER = 20;
const SEGMENT_TRANSITION = "transform 0.2s ease";
const DIM_OPACITY = 0.4;
const DIM_TRANSITION = "opacity 0.2s ease";

const DEMO_CHANNELS: ChannelRow[] = [
  { traffic_source: "meta", direct_conversions: 5, assisted_conversions: 7, first_touch_conversions: 18 },
  { traffic_source: "google", direct_conversions: 9, assisted_conversions: 4, first_touch_conversions: 6 },
  { traffic_source: "direct", direct_conversions: 12, assisted_conversions: 0, first_touch_conversions: 0 },
  { traffic_source: "tiktok", direct_conversions: 2, assisted_conversions: 5, first_touch_conversions: 2 },
];

const TOOLTIP_BLOCK_MAIN =
  "Показывает, на каком этапе каналы чаще участвуют в пути пользователя: в начале знакомства с продуктом, в процессе выбора или перед покупкой.";
const TOOLTIP_BLOCK_SECONDARY =
  "Открывает путь — первое касание; Помогает — участие в середине; Закрывает продажу — последнее касание перед конверсией.";

type SegmentKind = "first" | "assist" | "last";
type Props = { projectId: string | null; days?: number };

function roleTextFromCounts(first: number, assist: number, last: number): string {
  if (first === 0 && assist === 0 && last > 0) return "Финальный шаг";
  const max = Math.max(first, assist, last);
  if (max === 0) return "";
  if (first === max && first > last && first > assist) return "Чаще открывает путь";
  if (last === max && last > first && last > assist) return "Чаще закрывает продажу";
  if (assist === max && (assist > first || assist > last)) return "Чаще участвует в середине пути";
  return "Участвует на разных этапах пути";
}

export default function AssistedAttributionCard({ projectId, days = 30 }: Props) {
  const [channels, setChannels] = useState<ChannelRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [tooltipState, setTooltipState] = useState<{
    row: ChannelRow;
    segment: SegmentKind;
    x: number;
    y: number;
  } | null>(null);

  const fetchData = useCallback(async () => {
    if (!projectId) {
      setChannels([]);
      setLoading(false);
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(
        `/api/assisted-attribution?project_id=${encodeURIComponent(projectId)}&days=${days}`,
        { cache: "no-store" }
      );
      const json = await res.json();
      if (!res.ok || !json?.success) {
        setError(json?.error ?? "Ошибка загрузки");
        setChannels([]);
        return;
      }
      setChannels(Array.isArray(json.channels) ? json.channels : []);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Ошибка загрузки");
      setChannels([]);
    } finally {
      setLoading(false);
    }
  }, [projectId, days]);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  const isDemo = !loading && !error && channels.length === 0;
  const displayChannels = channels.length > 0 ? channels : DEMO_CHANNELS;
  const isActive = !loading && !error && !isDemo;

  const HEADER_FRAME = {
    margin: "0 -18px 0 -18px",
    padding: "16px 20px",
    borderBottom: "1px solid rgba(255,255,255,0.06)",
    background: "rgba(255,255,255,0.02)",
  } as const;

  return (
    <div style={{ ...CARD_STYLE, display: "flex", flexDirection: "column" }}>
      {/* Header */}
      <div style={HEADER_FRAME}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 8, marginBottom: 4 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
            <h2 style={{ fontWeight: 700, fontSize: 17, margin: 0, color: "rgba(255,255,255,0.95)" }}>
              Роль каналов в пути к покупке
            </h2>
            <InsightTooltip text={TOOLTIP_BLOCK_MAIN} secondary={TOOLTIP_BLOCK_SECONDARY}>
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
              DEMO ATTRIBUTION
            </span>
          )}
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
        <p style={{ fontSize: 12, color: "rgba(255,255,255,0.55)", margin: 0, lineHeight: 1.4 }}>
          Показывает, на каком этапе каналы чаще участвуют в конверсии: в начале пути, в процессе выбора или перед покупкой.
        </p>
      </div>

      {/* Scrollable body */}
      <div style={{ flex: 1, overflow: "hidden" }}>
        {loading ? (
          <div>
            <div style={{ height: 14, background: "rgba(255,255,255,0.06)", borderRadius: 6, marginBottom: 8, maxWidth: "80%" }} />
            {[1, 2, 3, 4].map((i) => (
              <div key={i} style={{ height: 44, background: "rgba(255,255,255,0.05)", borderRadius: 8, marginBottom: 6 }} />
            ))}
          </div>
        ) : error ? (
          <p style={{ color: "rgba(255,180,140,0.9)", fontSize: 12 }}>{error}</p>
        ) : (
          (() => {
            const TOOLTIP_OFFSET_X = 12;
            const TOOLTIP_OFFSET_Y = 8;
            return (
              <div style={{ maxHeight: "100%", overflowY: "auto", paddingRight: 4 }}>
                {displayChannels.slice(0, 20).map((row, index) => {
                  const first = row.first_touch_conversions ?? 0;
                  const assist = row.assisted_conversions;
                  const last = row.direct_conversions;
                  const total = first + assist + last;
                  const sum = total || 1;
                  const pFirst = (first / sum) * 100;
                  const pAssist = (assist / sum) * 100;
                  const pLast = (last / sum) * 100;
                  const roleText = roleTextFromCounts(first, assist, last);
                  const isHoveredRow = tooltipState?.row.traffic_source === row.traffic_source;
                  const dimRow = tooltipState != null && !isHoveredRow;
                  const rank = index + 1;
                  const medalColor = rank === 1 ? "#C7A86C" : rank === 2 ? "#A9B0B8" : rank === 3 ? "#A06A4F" : null;
                  return (
                    <div
                      key={row.traffic_source}
                      style={{
                        padding: "10px 0",
                        borderBottom: "1px solid rgba(255,255,255,0.06)",
                        opacity: dimRow ? DIM_OPACITY : 1,
                        transition: DIM_TRANSITION,
                      }}
                    >
                      <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                        <span
                          style={{
                            minWidth: 20,
                            height: 20,
                            borderRadius: 6,
                            border: `1px solid ${medalColor ?? "rgba(255,255,255,0.08)"}`,
                            display: "inline-flex",
                            alignItems: "center",
                            justifyContent: "center",
                            fontSize: 10,
                            fontWeight: 600,
                            color: medalColor ?? "rgba(255,255,255,0.5)",
                            background: medalColor ? `${medalColor}22` : "rgba(255,255,255,0.03)",
                            flexShrink: 0,
                          }}
                        >
                          #{rank}
                        </span>
                        <span style={{ fontWeight: 600, fontSize: 14, color: "rgba(255,255,255,0.95)" }}>
                          {trafficSourceLabel(row.traffic_source)}
                        </span>
                      </div>
                      <div style={{ fontSize: 11, color: "rgba(255,255,255,0.6)", marginTop: 4 }}>
                        Открывает путь {first} • Помогает {assist} • Закрывает {last}
                      </div>
                      <div
                        style={{
                          marginTop: 6,
                          height: BAR_HEIGHT,
                          borderRadius: 6,
                          background: "rgba(255,255,255,0.06)",
                          overflow: "visible",
                          display: "flex",
                          width: "100%",
                          alignItems: "center",
                        }}
                      >
                        {pFirst > 0 && (
                          <div
                            style={{
                              width: `${pFirst}%`,
                              minWidth: 4,
                              height: "100%",
                              display: "flex",
                              alignItems: "center",
                              justifyContent: "center",
                              cursor: "pointer",
                            }}
                            onMouseEnter={(e) => {
                              setTooltipState({
                                row,
                                segment: "first",
                                x: e.clientX + TOOLTIP_OFFSET_X,
                                y: e.clientY + TOOLTIP_OFFSET_Y,
                              });
                            }}
                            onMouseMove={(e) => {
                              if (tooltipState?.row.traffic_source === row.traffic_source && tooltipState?.segment === "first") {
                                setTooltipState((prev) => prev ? { ...prev, x: e.clientX + TOOLTIP_OFFSET_X, y: e.clientY + TOOLTIP_OFFSET_Y } : null);
                              }
                            }}
                            onMouseLeave={() => setTooltipState(null)}
                          >
                            <div
                              style={{
                                width: "100%",
                                height: "100%",
                                background: COLOR_FIRST_TOUCH,
                                borderRadius: 6,
                                transition: `${SEGMENT_TRANSITION}, ${DIM_TRANSITION}`,
                                transform: tooltipState?.row.traffic_source === row.traffic_source && tooltipState?.segment === "first"
                                  ? `scaleY(${BAR_HEIGHT_HOVER / BAR_HEIGHT})`
                                  : "scaleY(1)",
                                transformOrigin: "bottom",
                                opacity: isHoveredRow && tooltipState?.segment !== "first" ? DIM_OPACITY : 1,
                              }}
                            />
                          </div>
                        )}
                        {pAssist > 0 && (
                          <div
                            style={{
                              width: `${pAssist}%`,
                              minWidth: 4,
                              height: "100%",
                              display: "flex",
                              alignItems: "center",
                              justifyContent: "center",
                              cursor: "pointer",
                            }}
                            onMouseEnter={(e) => {
                              setTooltipState({
                                row,
                                segment: "assist",
                                x: e.clientX + TOOLTIP_OFFSET_X,
                                y: e.clientY + TOOLTIP_OFFSET_Y,
                              });
                            }}
                            onMouseMove={(e) => {
                              if (tooltipState?.row.traffic_source === row.traffic_source && tooltipState?.segment === "assist") {
                                setTooltipState((prev) => prev ? { ...prev, x: e.clientX + TOOLTIP_OFFSET_X, y: e.clientY + TOOLTIP_OFFSET_Y } : null);
                              }
                            }}
                            onMouseLeave={() => setTooltipState(null)}
                          >
                            <div
                              style={{
                                width: "100%",
                                height: "100%",
                                background: COLOR_ASSIST,
                                borderRadius: 6,
                                transition: `${SEGMENT_TRANSITION}, ${DIM_TRANSITION}`,
                                transform: tooltipState?.row.traffic_source === row.traffic_source && tooltipState?.segment === "assist"
                                  ? `scaleY(${BAR_HEIGHT_HOVER / BAR_HEIGHT})`
                                  : "scaleY(1)",
                                transformOrigin: "bottom",
                                opacity: isHoveredRow && tooltipState?.segment !== "assist" ? DIM_OPACITY : 1,
                              }}
                            />
                          </div>
                        )}
                        {pLast > 0 && (
                          <div
                            style={{
                              width: `${pLast}%`,
                              minWidth: 4,
                              height: "100%",
                              display: "flex",
                              alignItems: "center",
                              justifyContent: "center",
                              cursor: "pointer",
                            }}
                            onMouseEnter={(e) => {
                              setTooltipState({
                                row,
                                segment: "last",
                                x: e.clientX + TOOLTIP_OFFSET_X,
                                y: e.clientY + TOOLTIP_OFFSET_Y,
                              });
                            }}
                            onMouseMove={(e) => {
                              if (tooltipState?.row.traffic_source === row.traffic_source && tooltipState?.segment === "last") {
                                setTooltipState((prev) => prev ? { ...prev, x: e.clientX + TOOLTIP_OFFSET_X, y: e.clientY + TOOLTIP_OFFSET_Y } : null);
                              }
                            }}
                            onMouseLeave={() => setTooltipState(null)}
                          >
                            <div
                              style={{
                                width: "100%",
                                height: "100%",
                                background: COLOR_LAST_TOUCH,
                                borderRadius: 6,
                                transition: `${SEGMENT_TRANSITION}, ${DIM_TRANSITION}`,
                                transform: tooltipState?.row.traffic_source === row.traffic_source && tooltipState?.segment === "last"
                                  ? `scaleY(${BAR_HEIGHT_HOVER / BAR_HEIGHT})`
                                  : "scaleY(1)",
                                transformOrigin: "bottom",
                                opacity: isHoveredRow && tooltipState?.segment !== "last" ? DIM_OPACITY : 1,
                              }}
                            />
                          </div>
                        )}
                      </div>
                      {roleText && (
                        <div style={{ fontSize: 12, color: "rgba(255,255,255,0.55)", marginTop: 6 }}>
                          {roleText}
                        </div>
                      )}
                    </div>
                  );
                })}
                {tooltipState && (() => {
                  const { row: tooltipRow, segment, x, y } = tooltipState;
                  const first = tooltipRow.first_touch_conversions ?? 0;
                  const assist = tooltipRow.assisted_conversions;
                  const last = tooltipRow.direct_conversions;
                  const total = first + assist + last;
                  const sum = total || 1;
                  const pFirst = Math.round((first / sum) * 100);
                  const pAssist = Math.round((assist / sum) * 100);
                  const pLast = Math.round((last / sum) * 100);
                  const title = trafficSourceLabel(tooltipRow.traffic_source);
                  const segmentContent =
                    segment === "first"
                      ? {
                          label: "Открывает путь",
                          value: first,
                          pct: pFirst,
                          desc: "Канал чаще становится первым касанием пользователя с продуктом.",
                        }
                      : segment === "assist"
                        ? {
                            label: "Участвует в пути",
                            value: assist,
                            pct: pAssist,
                            desc: "Канал участвует в процессе выбора, но не является первым или последним касанием.",
                          }
                        : {
                            label: "Закрывает продажу",
                            value: last,
                            pct: pLast,
                            desc: "Канал чаще становится последним касанием перед конверсией.",
                          };
                  return (
                    <div
                      role="tooltip"
                      style={{
                        position: "fixed",
                        left: x,
                        top: y,
                        zIndex: 9999,
                        padding: "12px 14px",
                        borderRadius: 16,
                        background: "rgba(18,18,24,0.98)",
                        border: "1px solid rgba(255,255,255,0.10)",
                        boxShadow: "0 12px 40px rgba(0,0,0,0.45)",
                        fontSize: 12,
                        color: "rgba(255,255,255,0.9)",
                        lineHeight: 1.5,
                        maxWidth: 280,
                        pointerEvents: "none",
                      }}
                    >
                      <div style={{ fontWeight: 600, marginBottom: 8, color: "rgba(255,255,255,0.95)" }}>
                        {title}
                      </div>
                      <div style={{ marginBottom: 4 }}>
                        {segmentContent.label}: {segmentContent.value}
                      </div>
                      <div style={{ marginBottom: 8 }}>
                        Доля в роли канала: {segmentContent.pct}%
                      </div>
                      <div style={{ paddingTop: 8, borderTop: "1px solid rgba(255,255,255,0.08)", color: "rgba(255,255,255,0.7)", fontSize: 11 }}>
                        Описание: {segmentContent.desc}
                      </div>
                    </div>
                  );
                })()}
              </div>
            );
          })()
        )}
      </div>
    </div>
  );
}
