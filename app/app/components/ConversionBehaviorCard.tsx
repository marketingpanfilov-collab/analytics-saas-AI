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
const MEDAL_GOLD = "#C7A86C";
const MEDAL_SILVER = "#A9B0B8";
const MEDAL_BRONZE = "#A06A4F";

const DEMO_TIME: TimeBucket[] = [
  { label: "0–1 час", percent: 18 },
  { label: "1–6 часов", percent: 27 },
  { label: "6–24 часа", percent: 31 },
  { label: "1–3 дня", percent: 17 },
  { label: "3–7 дней", percent: 5 },
  { label: "7+ дней", percent: 2 },
];

const DEMO_TOUCH: TouchBucket[] = [
  { label: "1 касание", percent: 12 },
  { label: "2 касания", percent: 23 },
  { label: "3 касания", percent: 34 },
  { label: "4 касания", percent: 20 },
  { label: "5+ касаний", percent: 11 },
];

type Props = {
  projectId: string | null;
  days?: number;
};

export function ConversionBehaviorCard({ projectId, days = 30 }: Props) {
  const [timeBuckets, setTimeBuckets] = useState<TimeBucket[]>([]);
  const [touchBuckets, setTouchBuckets] = useState<TouchBucket[]>([]);
  const [loading, setLoading] = useState(true);
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
    try {
      // Placeholder: when API exists, fetch real data
      const res = await fetch(
        `/api/conversion-behavior?project_id=${encodeURIComponent(projectId)}&days=${days}`,
        { cache: "no-store" }
      ).catch(() => null);
      if (res?.ok) {
        const json = await res.json().catch(() => ({}));
        if (Array.isArray(json?.time)) setTimeBuckets(json.time);
        if (Array.isArray(json?.touch)) setTouchBuckets(json.touch);
      }
    } finally {
      setLoading(false);
    }
  }, [projectId, days]);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  const isDemo = !loading && timeBuckets.length === 0 && touchBuckets.length === 0;
  const displayTime = timeBuckets.length > 0 ? timeBuckets : DEMO_TIME;
  const displayTouch = touchBuckets.length > 0 ? touchBuckets : DEMO_TOUCH;

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
              DEMO BEHAVIOR
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
            sortedTime.map((row, i) =>
              renderBarRow(row.label, row.percent, maxTimePct, BAR_TIME_GRADIENT, "time", i, i + 1)
            )
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
            sortedTouch.map((row, i) =>
              renderBarRow(row.label, row.percent, maxTouchPct, BAR_TOUCH_GRADIENT, "touch", i, i + 1)
            )
          )}
        </div>
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
