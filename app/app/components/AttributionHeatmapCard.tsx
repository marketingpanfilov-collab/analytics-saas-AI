"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { InsightTooltip } from "./InsightTooltip";

type HeatmapChannel = {
  source: string;
  first_touch: number;
  assist_touch: number;
  last_touch: number;
};

type ApiResponse =
  | { success: true; channels: HeatmapChannel[] }
  | { success: false; error: string };

// Unified card visuals with dashboard
const CARD_STYLE = {
  borderRadius: 16,
  border: "1px solid rgba(255,255,255,0.10)",
  background: "rgba(255,255,255,0.03)",
  padding: 18,
  boxShadow: "0 20px 60px rgba(0,0,0,0.55)",
  minHeight: 260,
} as const;

// Palette aligned with Spend chart / product design
const PRIMARY_ACCENT = "rgba(130,255,200,0.95)";
const PRIMARY_ACCENT_SOFT = "rgba(90,230,170,0.95)";
const SECONDARY_ACCENT = "rgba(190,170,255,0.95)";
const SECONDARY_ACCENT_SOFT = "rgba(160,140,240,0.95)";

const SOURCE_LABELS: Record<string, string> = {
  meta: "Meta Ads",
  google: "Google Ads",
  tiktok: "TikTok Ads",
  yandex: "Яндекс Директ",
  direct: "Прямой переход",
  organic_search: "Органический поиск",
  referral: "Реферальный переход",
};

const TOOLTIP_FIRST =
  "Канал, через который пользователь впервые пришёл на сайт.";
const TOOLTIP_ASSIST =
  "Канал, который участвовал в цепочке до покупки.";
const TOOLTIP_LAST =
  "Канал, после которого произошла регистрация или покупка.";

const TOOLTIP_BLOCK =
  "Показывает, какие источники чаще приводят пользователей, участвуют в пути и закрывают покупки.";

function srcLabel(source: string | null | undefined): string {
  if (!source) return "—";
  const key = source.toLowerCase();
  return SOURCE_LABELS[key] ?? source;
}

const DEMO_CHANNELS: HeatmapChannel[] = [
  { source: "meta", first_touch: 40, assist_touch: 18, last_touch: 5 },
  { source: "google", first_touch: 12, assist_touch: 34, last_touch: 18 },
  { source: "direct", first_touch: 8, assist_touch: 10, last_touch: 22 },
];

type Props = {
  projectId: string | null;
  days?: number;
};

export function AttributionHeatmapCard({ projectId, days = 30 }: Props) {
  const [channels, setChannels] = useState<HeatmapChannel[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

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
        `/api/attribution-heatmap?project_id=${encodeURIComponent(
          projectId
        )}&days=${days}`,
        { cache: "no-store" }
      );
      const json = (await res.json()) as ApiResponse;
      if (!res.ok || !json.success) {
        setError((json as any)?.error ?? "Ошибка загрузки");
        setChannels([]);
        return;
      }
      setChannels(json.channels ?? []);
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
  const displayChannels = isDemo
    ? DEMO_CHANNELS
    : channels.length > 0
      ? channels
      : [];

  const maxFirst = useMemo(
    () => Math.max(...displayChannels.map((c) => c.first_touch || 0), 0),
    [displayChannels]
  );
  const maxAssist = useMemo(
    () => Math.max(...displayChannels.map((c) => c.assist_touch || 0), 0),
    [displayChannels]
  );
  const maxLast = useMemo(
    () => Math.max(...displayChannels.map((c) => c.last_touch || 0), 0),
    [displayChannels]
  );

  const isActive = !loading && !error && !isDemo && displayChannels.length > 0;

  const summaryLine = useMemo(() => {
    if (!displayChannels.length) return "";
    const byFirst = [...displayChannels].sort(
      (a, b) => (b.first_touch || 0) - (a.first_touch || 0)
    )[0];
    const byLast = [...displayChannels].sort(
      (a, b) => (b.last_touch || 0) - (a.last_touch || 0)
    )[0];
    const firstName = byFirst ? srcLabel(byFirst.source) : null;
    const lastName = byLast ? srcLabel(byLast.source) : null;
    if (firstName && lastName && firstName !== lastName) {
      return `${firstName} чаще открывает путь пользователя, а ${lastName} чаще завершает покупку.`;
    }
    if (firstName) {
      return `${firstName} чаще выступает первым касанием.`;
    }
    if (lastName) {
      return `${lastName} чаще выступает последним касанием перед покупкой.`;
    }
    return "";
  }, [displayChannels]);

  const anyData =
    displayChannels.length > 0 &&
    (maxFirst > 0 || maxAssist > 0 || maxLast > 0);

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
            <h2
              style={{
                fontWeight: 700,
                fontSize: 17,
                margin: 0,
                color: "rgba(255,255,255,0.95)",
              }}
            >
              Роль каналов в пути пользователя
            </h2>
            <InsightTooltip text={TOOLTIP_BLOCK}>
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
        <p
          style={{
            fontSize: 12,
            color: "rgba(255,255,255,0.55)",
            margin: 0,
            lineHeight: 1.4,
          }}
        >
          Показывает, какие источники чаще приводят пользователей, участвуют в пути и закрывают покупки.
        </p>
      </div>

      {/* Scrollable body */}
      <div style={{ flex: 1, overflow: "hidden" }}>
        {loading ? (
          <div>
            {[1, 2, 3, 4].map((i) => (
              <div
                key={i}
                style={{
                  height: 36,
                  background: "rgba(255,255,255,0.05)",
                  borderRadius: 8,
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
            }}
          >
            {error}
          </p>
        ) : !anyData ? (
          <p
            style={{
              fontSize: 13,
              color: "rgba(255,255,255,0.82)",
            }}
          >
            Недостаточно данных для анализа.
          </p>
        ) : (
          <div style={{ maxHeight: "100%", overflowY: "auto", paddingRight: 4 }}>
            <div>
              {displayChannels.slice(0, 20).map((ch) => {
                const f = ch.first_touch || 0;
                const a = ch.assist_touch || 0;
                const l = ch.last_touch || 0;
                const total = f + a + l || 1;

                const firstWidth = Math.max(
                  4,
                  Math.round((f / total) * 100)
                );
                const assistWidth = Math.max(
                  2,
                  Math.round((a / total) * 100)
                );
                const lastWidth = Math.max(
                  2,
                  Math.round((l / total) * 100)
                );

                let role: string;
                if (f >= a && f >= l) {
                  role = "Чаще открывает путь";
                } else if (l >= f && l >= a) {
                  role = "Чаще завершает путь";
                } else {
                  role = "Чаще участвует в середине пути";
                }

                const roleColor =
                  role === "Чаще открывает путь"
                    ? SECONDARY_ACCENT
                    : role === "Чаще завершает путь"
                      ? PRIMARY_ACCENT
                      : "rgba(200,200,255,0.9)";

                return (
                  <div
                    key={ch.source}
                    style={{
                      padding: "8px 0",
                      borderBottom: "1px solid rgba(255,255,255,0.05)",
                    }}
                  >
                    <div
                      style={{
                        fontSize: 13,
                        fontWeight: 600,
                        color: "rgba(255,255,255,0.9)",
                      }}
                    >
                      {srcLabel(ch.source)}
                    </div>
                    <div
                      style={{
                        fontSize: 12,
                        color: "rgba(255,255,255,0.7)",
                        marginTop: 2,
                      }}
                    >
                      {f} в начале · {a} в середине · {l} в закрытии
                    </div>
                    <div
                      style={{
                        display: "flex",
                        alignItems: "center",
                        gap: 8,
                        marginTop: 4,
                      }}
                    >
                      <div
                        style={{
                          flex: 1,
                          height: 8,
                          borderRadius: 999,
                          background: "rgba(255,255,255,0.04)",
                          overflow: "hidden",
                          display: "flex",
                        }}
                      >
                        {f > 0 && (
                          <div
                            style={{
                              width: `${firstWidth}%`,
                              background: `linear-gradient(90deg, ${SECONDARY_ACCENT}, ${SECONDARY_ACCENT_SOFT})`,
                            }}
                          />
                        )}
                        {a > 0 && (
                          <div
                            style={{
                              width: `${assistWidth}%`,
                              background:
                                "linear-gradient(90deg, rgba(255,215,160,0.95), rgba(245,190,130,0.95))",
                            }}
                          />
                        )}
                        {l > 0 && (
                          <div
                            style={{
                              width: `${lastWidth}%`,
                              background: `linear-gradient(90deg, ${PRIMARY_ACCENT}, ${PRIMARY_ACCENT_SOFT})`,
                            }}
                          />
                        )}
                      </div>
                      <div
                        style={{
                          fontSize: 11,
                          color: roleColor,
                          whiteSpace: "nowrap",
                        }}
                      >
                        {role}
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>

            {/* Summary insight */}
            {summaryLine && (
              <p
                style={{
                  fontSize: 11,
                  color: "rgba(255,255,255,0.72)",
                  marginTop: 8,
                  marginBottom: 4,
                  lineHeight: 1.4,
                }}
              >
                {summaryLine}
              </p>
            )}

            {/* Legend / interpretation row */}
            <p
              style={{
                fontSize: 11,
                color: "rgba(255,255,255,0.5)",
                margin: 0,
                lineHeight: 1.35,
              }}
            >
              Цвета сегментов показывают начало пути, участие в середине и завершение покупки.
            </p>
          </div>
        )}
      </div>
    </div>
  );
}

