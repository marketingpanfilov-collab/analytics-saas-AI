"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { InsightTooltip } from "./InsightTooltip";

type TimeBucket = { label: string; percent: number };
type TouchBucket = { label: string; percent: number };

const CARD_STYLE = {
  borderRadius: 16,
  border: "1px solid rgba(255,255,255,0.10)",
  background: "rgba(255,255,255,0.03)",
  padding: 18,
  boxShadow: "0 20px 60px rgba(0,0,0,0.55)",
  display: "flex",
  flexDirection: "column",
} as const;

const HEADER_FRAME = {
  margin: "0 -18px 0 -18px",
  padding: "16px 20px",
  borderBottom: "1px solid rgba(255,255,255,0.06)",
  background: "rgba(255,255,255,0.02)",
} as const;

const BAR_EMPTY = "rgba(255,255,255,0.06)";
const BAR_HEIGHT = 13;
const BAR_RADIUS = 6; /* track and fill: square corners, not pill */
const BAR_TIME = "#6E7ACF";
const BAR_TIME_GRADIENT = "linear-gradient(90deg, #5E6AB8 0%, #6E7ACF 50%, #7E8AE0 100%)";
const BAR_TOUCH = "#D8846F";
const BAR_TOUCH_GRADIENT = "linear-gradient(90deg, #C87662 0%, #D8846F 50%, #E8947E 100%)";
const DIM_OPACITY = 0.4;
const SCROLL_ROWS_VISIBLE = 6;
const ROW_HEIGHT = 50;
const MEDAL_GOLD = "#C7A86C";
const MEDAL_SILVER = "#A9B0B8";
const MEDAL_BRONZE = "#A06A4F";

const EMPTY_DATA_HELP_TEXT =
  "Если данные должны быть, проверьте, что есть путь до покупки и корректные события.";
const EMPTY_DATA_HELP_STEPS =
  "1) Pixel/CRM: события purchase/registration приходят стабильно.\n2) Visitor_id и визиты: связка не теряется.\n3) UTM: ссылки в рекламе размечены.\n4) Период и синк: выбран верно и успел обновиться.";

type Props = {
  projectId: string | null;
  days?: number;
  start?: string | null;
  end?: string | null;
  sources?: string[];
  accountIds?: string[];
};

export function ConversionBehaviorCard({
  projectId,
  days = 30,
  start,
  end,
  sources = [],
  accountIds = [],
}: Props) {
  const [timeBuckets, setTimeBuckets] = useState<TimeBucket[]>([]);
  const [touchBuckets, setTouchBuckets] = useState<TouchBucket[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [tooltip, setTooltip] = useState<{
    type: "time" | "touch";
    index: number;
    label: string;
    percent: number;
    x: number;
    y: number;
  } | null>(null);

  const fetchData = useCallback(async () => {
    if (!projectId) {
      setTimeBuckets([]);
      setTouchBuckets([]);
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
      const res = await fetch(`/api/conversion-behavior?${q.toString()}`, { cache: "no-store" });
      const json = await res.json().catch(() => ({}));
      if (!res.ok || json?.success === false) {
        setError(json?.error ?? "Ошибка загрузки поведения конверсии");
        setTimeBuckets([]);
        setTouchBuckets([]);
      } else {
        setTimeBuckets(Array.isArray(json?.time) ? json.time : []);
        setTouchBuckets(Array.isArray(json?.touch) ? json.touch : []);
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "Ошибка загрузки поведения конверсии");
      setTimeBuckets([]);
      setTouchBuckets([]);
    } finally {
      setLoading(false);
    }
  }, [projectId, days, start, end, sources, accountIds]);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  const isEmpty = !loading && !error && timeBuckets.length === 0 && touchBuckets.length === 0;
  const isActive = !loading && !error && !isEmpty;
  const displayTime = timeBuckets;
  const displayTouch = touchBuckets;

  const sortedTime = useMemo(
    () => [...displayTime].sort((a, b) => b.percent - a.percent),
    [displayTime]
  );
  const sortedTouch = useMemo(
    () => [...displayTouch].sort((a, b) => b.percent - a.percent),
    [displayTouch]
  );

  const maxTimePct = Math.max(...sortedTime.map((r) => r.percent), 1);
  const maxTouchPct = Math.max(...sortedTouch.map((r) => r.percent), 1);

  function rankBadgeStyle(rank: number) {
    const isTop3 = rank <= 3;
    const color =
      rank === 1 ? MEDAL_GOLD : rank === 2 ? MEDAL_SILVER : rank === 3 ? MEDAL_BRONZE : "rgba(255,255,255,0.15)";
    return {
      minWidth: 22,
      height: 22,
      borderRadius: 999,
      border: `1px solid ${isTop3 ? color : "rgba(255,255,255,0.1)"}`,
      background: isTop3 ? `${color}22` : "rgba(255,255,255,0.04)",
      display: "inline-flex" as const,
      alignItems: "center" as const,
      justifyContent: "center" as const,
      fontSize: 10,
      fontWeight: 600,
      color: isTop3 ? color : "rgba(255,255,255,0.55)",
      flexShrink: 0,
    };
  }

  function renderBarRow(
    label: string,
    percent: number,
    maxPct: number,
    barGradient: string,
    type: "time" | "touch",
    index: number,
    rank: number
  ) {
    const widthPct = maxPct > 0 ? (percent / maxPct) * 100 : 0;
    const isHovered = tooltip?.type === type && tooltip?.index === index;
    const hasHoverInColumn = tooltip?.type === type;
    const dim = hasHoverInColumn && !isHovered;
    return (
      <div
        key={`${type}-${index}-${label}`}
        style={{
          display: "flex",
          flexDirection: "column",
          gap: 6,
          padding: "8px 0",
          minHeight: ROW_HEIGHT,
          boxSizing: "border-box",
          borderBottom: "1px solid rgba(255,255,255,0.05)",
          transition: "background 0.2s ease, opacity 0.2s ease",
          background: isHovered ? "rgba(255,255,255,0.04)" : "transparent",
          borderRadius: 6,
          cursor: "default",
          opacity: dim ? DIM_OPACITY : 1,
        }}
        onMouseEnter={(e) =>
          setTooltip({
            type,
            index,
            label,
            percent,
            x: e.clientX + 12,
            y: e.clientY + 8,
          })
        }
        onMouseMove={(e) =>
          setTooltip((prev) =>
            prev && prev.type === type && prev.index === index
              ? { ...prev, x: e.clientX + 12, y: e.clientY + 8 }
              : prev
          )
        }
        onMouseLeave={() => setTooltip(null)}
      >
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 6, minWidth: 0 }}>
            <span style={rankBadgeStyle(rank)}>#{rank}</span>
            <span
              style={{
                fontSize: 12,
                fontWeight: 500,
                color: "rgba(255,255,255,0.9)",
              }}
            >
              {label}
            </span>
          </div>
          <span
            style={{
              flexShrink: 0,
              fontSize: 12,
              fontWeight: 600,
              color: "rgba(255,255,255,0.85)",
            }}
          >
            {percent}%
          </span>
        </div>
        <div
          style={{
            height: BAR_HEIGHT,
            borderRadius: BAR_RADIUS,
            background: BAR_EMPTY,
            overflow: "hidden",
            boxShadow: "inset 0 1px 2px rgba(0,0,0,0.08)",
          }}
        >
          <div
            style={{
              width: `${widthPct}%`,
              height: "100%",
              background: barGradient,
              borderRadius: BAR_RADIUS,
              minWidth: percent > 0 ? 6 : 0,
              transition: "width 0.2s ease, opacity 0.2s ease, box-shadow 0.2s ease",
              opacity: isHovered ? 1 : 0.9,
              boxShadow: isHovered ? "0 1px 4px rgba(0,0,0,0.15)" : "none",
            }}
          />
        </div>
      </div>
    );
  }

  return (
    <div style={CARD_STYLE}>
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
              Поведение конверсии
            </h2>
            <InsightTooltip text="Время и глубина пути до покупки.">
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
          }}
        >
          Показывает, сколько времени обычно проходит до покупки и сколько касаний требуется пользователю до конверсии.
        </p>
      </div>

      {error ? (
        <div style={{ minHeight: 140, display: "flex", alignItems: "center", justifyContent: "center", textAlign: "center", padding: "0 16px", marginTop: 14 }}>
          <p style={{ color: "rgba(255,180,140,0.9)", fontSize: 12, margin: 0 }}>{error}</p>
        </div>
      ) : isEmpty ? (
        <div style={{ minHeight: 140, display: "flex", alignItems: "center", justifyContent: "center", textAlign: "center", padding: "0 16px", marginTop: 14 }}>
          <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 8 }}>
            <p style={{ color: "rgba(255,255,255,0.7)", fontSize: 12, margin: 0 }}>
              Нет данных поведения конверсии за выбранный период.
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
          display: "grid",
          gridTemplateColumns: "1fr 1fr",
          gap: 24,
          paddingTop: 16,
          minHeight: 200,
        }}
      >
        <div
          style={{
            padding: "12px 14px",
            borderRadius: 12,
            background: "rgba(255,255,255,0.02)",
            border: "1px solid rgba(255,255,255,0.06)",
          }}
        >
          <div
            style={{
              fontSize: 13,
              fontWeight: 600,
              color: "rgba(255,255,255,0.9)",
              marginBottom: 10,
            }}
          >
            Время до покупки
          </div>
          {loading ? (
            <div>
              {[1, 2, 3, 4, 5, 6].map((i) => (
                <div
                  key={i}
                  style={{
                    height: 28,
                    background: "rgba(255,255,255,0.05)",
                    borderRadius: 6,
                    marginBottom: 4,
                  }}
                />
              ))}
            </div>
          ) : (
            <div className="scrollbar-hidden" style={{ maxHeight: SCROLL_ROWS_VISIBLE * ROW_HEIGHT, overflowY: "auto", paddingRight: 4 }}>
              {sortedTime.map((row, i) =>
                renderBarRow(row.label, row.percent, maxTimePct, BAR_TIME_GRADIENT, "time", i, i + 1)
              )}
            </div>
          )}
        </div>

        <div
          style={{
            padding: "12px 14px",
            borderRadius: 12,
            background: "rgba(255,255,255,0.02)",
            border: "1px solid rgba(255,255,255,0.06)",
          }}
        >
          <div
            style={{
              fontSize: 13,
              fontWeight: 600,
              color: "rgba(255,255,255,0.9)",
              marginBottom: 10,
            }}
          >
            Касания до покупки
          </div>
          {loading ? (
            <div>
              {[1, 2, 3, 4, 5].map((i) => (
                <div
                  key={i}
                  style={{
                    height: 28,
                    background: "rgba(255,255,255,0.05)",
                    borderRadius: 6,
                    marginBottom: 4,
                  }}
                />
              ))}
            </div>
          ) : (
            <div className="scrollbar-hidden" style={{ maxHeight: SCROLL_ROWS_VISIBLE * ROW_HEIGHT, overflowY: "auto", paddingRight: 4 }}>
              {sortedTouch.map((row, i) =>
                renderBarRow(row.label, row.percent, maxTouchPct, BAR_TOUCH_GRADIENT, "touch", i, i + 1)
              )}
            </div>
          )}
        </div>
      </div>
      )}

      {tooltip && (
        <div
          role="tooltip"
          style={{
            position: "fixed",
            left: tooltip.x,
            top: tooltip.y,
            zIndex: 9999,
            padding: "12px 14px",
            borderRadius: 12,
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
          <div style={{ fontWeight: 600, marginBottom: 6 }}>{tooltip.label}</div>
          <div style={{ color: "rgba(255,255,255,0.75)", fontSize: 12 }}>
            {tooltip.type === "time"
              ? `${tooltip.percent}% покупок совершаются в течение этого периода после первого касания.`
              : `${tooltip.percent}% пользователей. Чаще всего требуется ${tooltip.label} до покупки.`}
          </div>
        </div>
      )}
    </div>
  );
}
