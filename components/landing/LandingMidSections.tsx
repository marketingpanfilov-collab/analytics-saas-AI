"use client";

import { useEffect, useId, useMemo, useState, type CSSProperties, type ReactNode } from "react";
import { createPortal } from "react-dom";

import { cn } from "@/components/landing/BaseButton";

/**
 * Три средние секции лендинга: преимущества, данные, DDA.
 * Тексты зафиксированы — меняется только визуальная подача.
 */

export type LandingMidSectionDensity = "default" | "spacious";

function landingSectionPad(density: LandingMidSectionDensity) {
  return density === "spacious" ? "py-28 md:py-36" : "py-20";
}

export function AdvantagesSection({ density = "default" }: { density?: LandingMidSectionDensity }) {
  const cols = [
    {
      title: "GA4",
      highlight: false,
      /** Слабый, несобранный сигнал слева направо — без устойчивой структуры */
      barHeights: [40, 24, 32, 18],
      barTone: "muted" as const,
      statusDots: ["bg-rose-400/35", "bg-amber-400/30", "bg-white/15"] as const,
      items: ["Сложный интерфейс", "Нет связи с рекламой", "Нет рекомендаций"],
    },
    {
      title: "Рекламные кабинеты",
      highlight: false,
      /** Промежуточно: частично полезные пики, но без единого ритма */
      barHeights: [36, 44, 30, 42],
      barTone: "split" as const,
      statusDots: ["bg-amber-400/40", "bg-white/22", "bg-amber-400/35"] as const,
      items: ["Разрозненные данные", "Нет общей картины", "Ручная аналитика"],
    },
    {
      title: "BoardIQ",
      highlight: true,
      /** Ровная восходящая progression story — цельная система */
      barHeights: [72, 82, 90, 98],
      barTone: "strong" as const,
      statusDots: ["bg-emerald-400/90", "bg-emerald-400/75", "bg-emerald-300/80"] as const,
      items: ["Единый дашборд", "Авто-аналитика и инсайты", "Рекомендации на основе данных"],
    },
  ];

  return (
    <section
      id="advantages"
      className={cn("landing-mid-scope scroll-mt-24 border-t border-white/10", landingSectionPad(density))}
    >
      <div className="max-w-6xl mx-auto px-6">
        <h2 className="text-3xl font-semibold tracking-tight text-white/95">
          Почему стандартная аналитика не даёт ответа
        </h2>
        <p className={cn("mt-3 max-w-xl text-sm leading-relaxed text-white/45", density === "spacious" ? "mb-12 md:mb-14" : "mb-10")}>
          Отчёты есть. Ответов — нет.
        </p>

        <div className="grid md:grid-cols-3 gap-6">
          {cols.map((col, i) => (
            <div
              key={col.title}
              className={[
                "landing-adv-card group/adv relative flex flex-col overflow-hidden rounded-2xl border p-6",
                "transition-all duration-300 ease-out will-change-transform",
                col.highlight
                  ? "hover:-translate-y-1 hover:scale-[1.01]"
                  : "hover:-translate-y-0.5 hover:scale-[1.008]",
                col.highlight
                  ? "border-emerald-400/28 bg-gradient-to-b from-white/[0.09] to-emerald-500/[0.05] shadow-[0_0_68px_rgba(34,197,94,0.14)] ring-1 ring-emerald-400/20 hover:border-emerald-400/40 hover:shadow-[0_0_88px_rgba(34,197,94,0.2)] hover:ring-emerald-400/28"
                  : "border-white/10 bg-white/[0.03] hover:border-white/18 hover:bg-white/[0.045] hover:shadow-[0_20px_50px_rgba(0,0,0,0.35)]",
              ].join(" ")}
            >
              {col.highlight ? (
                <>
                  <div
                    className="pointer-events-none absolute -right-14 -top-14 h-44 w-44 rounded-full bg-emerald-400/14 blur-3xl landing-mid-glow-pulse"
                    aria-hidden
                  />
                  <div
                    className="pointer-events-none absolute -bottom-10 left-1/2 h-32 w-[92%] -translate-x-1/2 rounded-full bg-emerald-500/[0.09] blur-3xl"
                    aria-hidden
                  />
                  <div
                    className="pointer-events-none absolute left-1/2 top-[52%] h-24 w-[70%] -translate-x-1/2 rounded-full bg-emerald-400/[0.06] blur-2xl"
                    aria-hidden
                  />
                </>
              ) : null}

              <div className="relative flex items-start justify-between gap-3">
                <h3 className="text-lg font-medium">{col.title}</h3>
                <div className="flex gap-1 pt-1" aria-hidden>
                  {col.statusDots.map((dotClass, d) => (
                    <span
                      key={d}
                      className={[
                        "h-1.5 w-1.5 rounded-full",
                        dotClass,
                        col.highlight ? "landing-mid-dot-pulse" : "",
                      ].join(" ")}
                      style={{ animationDelay: `${d * 0.35}s` }}
                    />
                  ))}
                </div>
              </div>

              <div
                className={[
                  "landing-adv-mini relative mt-4 overflow-hidden rounded-lg border px-2 py-2 transition-all duration-300 ease-out",
                  "group-hover/adv:border-white/[0.12] group-hover/adv:bg-black/40",
                  col.highlight
                    ? "border-emerald-400/22 bg-gradient-to-br from-emerald-500/[0.1] via-black/42 to-black/[0.58] ring-1 ring-emerald-400/12 group-hover/adv:border-emerald-400/32 group-hover/adv:from-emerald-500/[0.13] group-hover/adv:shadow-[inset_0_0_32px_rgba(34,197,94,0.1)]"
                    : "border-white/[0.08] bg-black/35",
                ].join(" ")}
                aria-hidden
              >
                {col.highlight ? (
                  <div
                    className="pointer-events-none absolute inset-0 bg-[radial-gradient(ellipse_at_50%_0%,rgba(52,211,153,0.12),transparent_55%)] opacity-90"
                    aria-hidden
                  />
                ) : null}
                <div className="relative flex h-11 items-end justify-between gap-1 px-0.5">
                  {col.barHeights.map((h, j) => (
                    <div
                      key={j}
                      className={[
                        "landing-mid-bar-rise landing-adv-bar flex-1 rounded-[3px] transition-[filter,box-shadow] duration-300 ease-out group-hover/adv:brightness-110",
                        col.highlight
                          ? "origin-bottom bg-gradient-to-t from-emerald-600/60 to-emerald-300/[0.97] shadow-[0_0_14px_rgba(52,211,153,0.24)]"
                          : col.barTone === "split"
                            ? "origin-bottom bg-gradient-to-t from-amber-500/28 to-white/32"
                            : "origin-bottom bg-gradient-to-t from-white/12 to-white/28",
                      ].join(" ")}
                      style={
                        {
                          height: `${h}%`,
                          animationDelay: `${i * 0.12 + j * 0.06}s`,
                        } as CSSProperties
                      }
                    />
                  ))}
                </div>
                <div className="mt-2 h-px w-full bg-gradient-to-r from-transparent via-white/20 to-transparent opacity-60 group-hover/adv:via-white/30" />
              </div>

              <ul className="relative mt-5 space-y-2.5 text-sm text-white/70">
                {col.items.map((item) => (
                  <li key={item} className="flex gap-2.5">
                    <span
                      className={[
                        "mt-2 h-px w-6 shrink-0 rounded-full transition-colors duration-300",
                        col.highlight
                          ? "bg-emerald-400/50 group-hover/adv:bg-emerald-400/65"
                          : "bg-white/20 group-hover/adv:bg-white/30",
                      ].join(" ")}
                      aria-hidden
                    />
                    <span>{item}</span>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}

type DataInsightsMode = "update" | "alerts" | "analytics";

const DATA_INSIGHTS_DAYS = ["Пн", "Вт", "Ср", "Чт", "Пт", "Сб", "Вс"] as const;

const DATA_INSIGHTS_CHART: Record<DataInsightsMode, readonly number[]> = {
  update: [82, 84, 85, 83, 87, 81, 79],
  alerts: [19, 23, 27, 16, 30, 14, 11],
  analytics: [42, 45, 48, 44, 51, 40, 38],
};

function clampDataInsightsDay(day: number): number {
  return Math.min(6, Math.max(0, Math.floor(day)));
}

function dataInsightsFrame(mode: DataInsightsMode, day: number) {
  const d = clampDataInsightsDay(day);
  const u = DATA_INSIGHTS_CHART.update[d];
  const a = DATA_INSIGHTS_CHART.alerts[d];
  const n = DATA_INSIGHTS_CHART.analytics[d];

  switch (mode) {
    case "update":
      return {
        headline: "Расход бюджета",
        primary: `${u}%`,
        secondaries: [
          { label: "CAC", value: `$${(21.1 + d * 0.08).toFixed(1)}` },
          { label: "LTV", value: `$${146 + d * 2}` },
        ],
        viz: "progress" as const,
        progressPct: u,
      };
    case "alerts":
      return {
        headline: "CPA вырос",
        primary: `${a}%`,
        secondaries: [
          { label: "Ошибки", value: `${2 + (d % 4)}` },
          { label: "Бюджет", value: `${Math.min(98, 72 + Math.round(a / 3))}%` },
        ],
        viz: "bars" as const,
        progressPct: Math.min(100, a * 3),
      };
    case "analytics": {
      const roas = 4.2 + n / 55;
      return {
        headline: "ROAS",
        primary: `${roas.toFixed(1)}x`,
        secondaries: [
          { label: "CAC", value: `$${(18.7 + d * 0.11).toFixed(1)}` },
          { label: "ROMI", value: `${172 + (n % 18)}%` },
        ],
        viz: "line" as const,
        progressPct: Math.min(100, 40 + n / 2),
      };
    }
  }
}

/** Общая высота области графика (кривая + подписи дней) */
const DATA_FRAME_MINI_CHART_H = "h-[4.25rem] sm:h-[4.5rem]";

const MINI_LINE_W = 320;
/** Компактный график (правый блок) */
const MINI_LINE_H = 78;
/** Левый график: компактная высота viewBox (пропорции точек сохраняются) */
const MINI_LINE_H_TALL = 120;
const MINI_LINE_PAD = { t: 10, r: 6, b: 4, l: 6 } as const;
const MINI_LINE_PAD_TALL = { t: 14, r: 8, b: 8, l: 8 } as const;

type DataFrameMiniVariant = "update" | "alerts" | "analytics";

function miniLineStroke(variant: DataFrameMiniVariant) {
  switch (variant) {
    case "update":
      return "rgb(251, 191, 36)";
    case "alerts":
      return "rgb(248, 113, 113)";
    default:
      return "rgb(52, 211, 153)";
  }
}

function miniLineStrokeSoft(variant: DataFrameMiniVariant) {
  switch (variant) {
    case "update":
      return "rgba(251, 191, 36, 0.35)";
    case "alerts":
      return "rgba(248, 113, 113, 0.35)";
    default:
      return "rgba(52, 211, 153, 0.35)";
  }
}

/** Короткий тултип для точки левого графика — от режима и значения в серии */
function getMiniLineTooltipText(
  variant: DataFrameMiniVariant,
  dayIndex: number,
  value: number,
  series: readonly number[]
): string {
  const day = DATA_INSIGHTS_DAYS[clampDataInsightsDay(dayIndex)];
  const avg = series.reduce((a, b) => a + b, 0) / Math.max(series.length, 1);
  const maxV = Math.max(...series);
  const minV = Math.min(...series);
  const prev = dayIndex > 0 ? series[dayIndex - 1]! : value;
  const delta = Math.round(value - prev);

  switch (variant) {
    case "update": {
      if (value >= 86) return `${day}: ${value}% — у лимита`;
      if (value === minV) return `${day}: ${value}% — мин. недели`;
      if (dayIndex > 0 && delta !== 0) return `${day}: ${value}% (${delta > 0 ? "+" : ""}${delta}% к вчера)`;
      return `${day}: ${value}% — ${value >= avg ? "выше среднего" : "ниже среднего"}`;
    }
    case "alerts": {
      if (value >= 28) return `${day}: ${value}% — срочный разбор`;
      if (value === maxV) return `${day}: ${value}% — пик риска`;
      if (value <= 14) return `${day}: ${value}% — спокойно`;
      return `${day}: ${value}% — ${value > avg ? "выше нормы" : "в норме"}`;
    }
    case "analytics": {
      if (value >= 48) return `${day}: ${value} — сильный день`;
      if (value <= 40) return `${day}: ${value} — просадка`;
      return `${day}: ${value} — около среднего`;
    }
  }
}

function smoothMiniLinePath(coords: { x: number; y: number }[]): string {
  if (coords.length < 2) return "";
  let d = `M ${coords[0].x} ${coords[0].y}`;
  for (let i = 0; i < coords.length - 1; i++) {
    const p0 = coords[i];
    const p1 = coords[i + 1];
    const dx = p1.x - p0.x;
    const dy = p1.y - p0.y;
    const cx1 = p0.x + dx * 0.35;
    const cy1 = p0.y + dy * 0.22;
    const cx2 = p1.x - dx * 0.35;
    const cy2 = p1.y - dy * 0.22;
    d += ` C ${cx1} ${cy1}, ${cx2} ${cy2}, ${p1.x} ${p1.y}`;
  }
  return d;
}

function miniDayLabelClass(variant: DataFrameMiniVariant, active: boolean) {
  if (!active) return "";
  if (variant === "update") return "text-amber-300/95";
  if (variant === "alerts") return "text-rose-300/85";
  return "text-emerald-300/90";
}

function dataFrameSegmentStyles(variant: DataFrameMiniVariant, active: boolean) {
  if (variant === "update") {
    return active
      ? "bg-amber-400/90 shadow-[0_0_16px_rgba(251,191,36,0.22)]"
      : "bg-amber-400/35 group-hover:bg-amber-400/55";
  }
  if (variant === "alerts") {
    return active
      ? "bg-red-400/90 shadow-[0_0_16px_rgba(248,113,113,0.24)]"
      : "bg-red-400/35 group-hover:bg-red-400/55";
  }
  return active
    ? "bg-emerald-400/90 shadow-[0_0_16px_rgba(52,211,153,0.28)]"
    : "bg-white/15 group-hover:bg-emerald-400/45";
}

type DataInsightsDayHoverSource = "left" | "right";

/** Столбцы по дням (правый блок метрик) — синхрон только по hover, без клика */
function DataFrameSegmentedMiniChart({
  variant,
  series,
  selectedDay,
  onDayHover,
  fillHeight = false,
}: {
  variant: DataFrameMiniVariant;
  series: readonly number[];
  selectedDay: number;
  onDayHover: (day: number | null, source: DataInsightsDayHoverSource) => void;
  /** Заполнить доступную высоту карточки (встроенный блок справа на лендинге) */
  fillHeight?: boolean;
}) {
  const caption = "Динамика по дням";
  const hint = "столбец = день";
  const max = Math.max(...series, 1);

  return (
    <div
      className={cn(
        "w-full border-t border-white/[0.08] pt-3",
        fillHeight && "flex min-h-0 flex-1 flex-col"
      )}
    >
      <div className="mb-1.5 flex shrink-0 flex-wrap items-baseline justify-between gap-x-2 gap-y-0.5">
        <span className="text-[11px] font-medium text-white/45">{caption}</span>
        <span className="hidden text-[10px] text-white/30 sm:inline">{hint}</span>
      </div>
      <div
        className={cn(
          "flex w-full flex-col overflow-hidden",
          fillHeight ? "min-h-0 flex-1" : DATA_FRAME_MINI_CHART_H
        )}
        role="group"
        aria-label="Столбцы по дням недели"
        onMouseLeave={() => onDayHover(null, "right")}
      >
        <div className="flex min-h-0 flex-1 flex-col justify-end gap-1">
          <div className="grid min-h-0 flex-1 grid-cols-7 gap-1 sm:gap-1.5">
            {series.map((v, i) => {
              const h = Math.max((v / max) * 100, 10);
              const active = selectedDay === i;
              return (
                <button
                  key={`seg-${variant}-${i}`}
                  type="button"
                  aria-pressed={active}
                  aria-label={`${DATA_INSIGHTS_DAYS[i]}, значение ${v}`}
                  onMouseEnter={() => onDayHover(i, "right")}
                  className="group flex h-full min-h-0 min-w-0 cursor-pointer flex-col justify-end focus:outline-none focus-visible:ring-2 focus-visible:ring-white/25"
                >
                  <div
                    className={cn(
                      "w-full origin-bottom shrink-0 rounded-[10px] transition-[height,box-shadow,background-color,filter] duration-200 ease-out group-hover:brightness-110",
                      dataFrameSegmentStyles(variant, active)
                    )}
                    style={{ height: `${h}%` }}
                  />
                </button>
              );
            })}
          </div>
          <div className="grid h-3 shrink-0 grid-cols-7 gap-1 text-[8px] font-medium leading-none text-white/35 sm:gap-1.5 sm:text-[9px]">
            {DATA_INSIGHTS_DAYS.map((d, i) => (
              <span
                key={d}
                className={cn(
                  "min-w-0 truncate text-center transition-colors duration-200",
                  miniDayLabelClass(variant, selectedDay === i)
                )}
              >
                {d}
              </span>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

/** Кривая по дням (левый блок) */
function DataFrameLineMiniChart({
  variant,
  series,
  selectedDay,
  onDayHover,
  placement = "right",
}: {
  variant: DataFrameMiniVariant;
  series: readonly number[];
  selectedDay: number;
  onDayHover: (day: number | null, source: DataInsightsDayHoverSource) => void;
  placement?: "left" | "right";
}) {
  const gradId = useId().replace(/:/g, "");
  const stroke = miniLineStroke(variant);
  const strokeSoft = miniLineStrokeSoft(variant);
  const [hoveredPoint, setHoveredPoint] = useState<number | null>(null);
  const [cursorTip, setCursorTip] = useState<{ x: number; y: number } | null>(null);

  const isLeft = placement === "left";
  const w = MINI_LINE_W;
  const h = isLeft ? MINI_LINE_H_TALL : MINI_LINE_H;
  const pad = isLeft ? MINI_LINE_PAD_TALL : MINI_LINE_PAD;
  const innerW = w - pad.l - pad.r;
  const innerH = h - pad.t - pad.b;
  const n = series.length;
  const maxV = Math.max(...series, 1);
  const minV = Math.min(...series);
  const span = maxV - minV || 1;

  /**
   * Центры по X — строго как у ряда подписей дней: сетка `grid-cols-7` на всю ширину
   * без gap (иначе центры колонок с gap не совпадают с равномерным распределением в [pad.l, w−pad.r]).
   */
  const coords = useMemo(() => {
    return series.map((v, i) => {
      const x = n <= 1 ? w / 2 : ((i + 0.5) / n) * w;
      const y = pad.t + innerH - ((v - minV) / span) * innerH;
      return { x, y, v, i };
    });
  }, [series, n, w, innerH, minV, span, pad.t]);

  const lineD = useMemo(() => smoothMiniLinePath(coords.map((c) => ({ x: c.x, y: c.y }))), [coords]);
  const last = coords[coords.length - 1];
  const first = coords[0];
  const areaD =
    coords.length > 0 && lineD
      ? `${lineD} L ${last.x} ${pad.t + innerH} L ${first.x} ${pad.t + innerH} Z`
      : "";

  const tipText =
    isLeft && hoveredPoint != null && coords[hoveredPoint]
      ? getMiniLineTooltipText(variant, hoveredPoint, coords[hoveredPoint].v, series)
      : "";

  useEffect(() => {
    if (!isLeft || hoveredPoint === null) return;
    const move = (e: MouseEvent) => setCursorTip({ x: e.clientX, y: e.clientY });
    window.addEventListener("mousemove", move);
    return () => window.removeEventListener("mousemove", move);
  }, [isLeft, hoveredPoint]);

  const handleLeave = () => {
    setHoveredPoint(null);
    setCursorTip(null);
    onDayHover(null, "left");
  };

  return (
    <div
      className={cn(
        "flex w-full flex-col",
        isLeft ? "min-h-0 shrink-0" : "",
        placement === "right" ? "border-t border-white/[0.08] pt-3" : "pt-0"
      )}
    >
      <div className="mb-1.5 flex flex-wrap items-baseline justify-between gap-x-2 gap-y-0.5">
        <span className="text-[11px] font-medium text-white/45">Динамика по дням</span>
        <span className="hidden text-[10px] text-white/30 sm:inline">точка = день</span>
      </div>
      <div
        className={cn(
          "relative flex w-full flex-col",
          isLeft ? "min-h-0" : DATA_FRAME_MINI_CHART_H
        )}
        role="group"
        aria-label="Кривая по дням недели"
        onMouseLeave={handleLeave}
      >
        {typeof document !== "undefined" &&
        isLeft &&
        hoveredPoint != null &&
        tipText &&
        cursorTip
          ? createPortal(
              <div
                className="pointer-events-none fixed z-[9999] max-w-[16rem] rounded-md border border-white/15 bg-black/92 px-2 py-1 text-[10px] leading-snug text-white/90 shadow-lg backdrop-blur-sm"
                style={{
                  left: cursorTip.x + 12,
                  top: cursorTip.y + 12,
                }}
              >
                {tipText}
              </div>,
              document.body
            )
          : null}
        <div className="flex min-h-0 flex-col justify-end gap-1">
          <div
            className={cn(
              "relative w-full shrink-0",
              isLeft && "aspect-[320/120] max-h-[200px] min-h-[100px] w-full"
            )}
          >
            <svg
              viewBox={`0 0 ${w} ${h}`}
              className="absolute inset-0 block h-full w-full cursor-pointer"
              preserveAspectRatio="xMidYMid meet"
              role="img"
              aria-hidden
            >
              <defs>
                <linearGradient id={gradId} x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor={stroke} stopOpacity="0.22" />
                  <stop offset="100%" stopColor={stroke} stopOpacity="0" />
                </linearGradient>
              </defs>

              {[0, 1, 2, 3].map((k) => {
                const gy = pad.t + (k / 3) * innerH;
                return (
                  <line
                    key={k}
                    x1={pad.l}
                    x2={w - pad.r}
                    y1={gy}
                    y2={gy}
                    stroke="rgba(255,255,255,0.06)"
                    strokeWidth="1"
                    vectorEffect="non-scaling-stroke"
                  />
                );
              })}

              {areaD ? <path d={areaD} fill={`url(#${gradId})`} /> : null}
              {lineD ? (
                <path
                  d={lineD}
                  fill="none"
                  stroke={stroke}
                  strokeWidth={isLeft ? "2.5" : "2.25"}
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  className="transition-[stroke-width] duration-200 ease-out"
                />
              ) : null}

              {coords.map((c) => {
                const active = selectedDay === c.i;
                const isHover = hoveredPoint === c.i;
                const r = active || isHover ? (isLeft ? 5.5 : 7) : isLeft ? 3.5 : 4.5;
                return (
                  <g key={`pt-${c.i}`} className="data-insights-line-point">
                    <circle
                      cx={c.x}
                      cy={c.y}
                      r={isLeft ? 14 : 14}
                      fill="transparent"
                      className="cursor-pointer"
                      onMouseEnter={(e) => {
                        setHoveredPoint(c.i);
                        if (isLeft) setCursorTip({ x: e.clientX, y: e.clientY });
                        onDayHover(c.i, "left");
                      }}
                    />
                    <circle
                      cx={c.x}
                      cy={c.y}
                      r={r}
                      fill={active || isHover ? stroke : "rgba(255,255,255,0.12)"}
                      stroke={active || isHover ? "rgba(255,255,255,0.35)" : strokeSoft}
                      strokeWidth={active || isHover ? 1.5 : 1}
                      className="pointer-events-none transition-all duration-200 ease-out"
                      style={{
                        filter:
                          isHover && isLeft
                            ? `drop-shadow(0 0 8px ${stroke})`
                            : undefined,
                      }}
                    />
                  </g>
                );
              })}
            </svg>
          </div>

          <div className="grid h-3 shrink-0 grid-cols-7 gap-0 text-[8px] font-medium leading-none text-white/35 sm:text-[9px]">
            {DATA_INSIGHTS_DAYS.map((d, i) => (
              <span
                key={d}
                className={cn(
                  "min-w-0 truncate text-center transition-colors duration-200",
                  miniDayLabelClass(variant, selectedDay === i)
                )}
              >
                {d}
              </span>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

function DataInsightsMetricFrame({
  mode,
  day,
  embedded,
  onDayHover,
}: {
  mode: DataInsightsMode;
  day: number;
  embedded?: boolean;
  onDayHover?: (day: number | null, source: DataInsightsDayHoverSource) => void;
}) {
  const frame = dataInsightsFrame(mode, day);
  const viz: ReactNode = (
    <DataFrameSegmentedMiniChart
      variant={mode}
      series={DATA_INSIGHTS_CHART[mode]}
      selectedDay={day}
      onDayHover={onDayHover ?? ((_d, _s) => undefined)}
      fillHeight={!!embedded}
    />
  );

  return (
    <div
      className={cn(
        "relative flex w-full flex-col",
        embedded
          ? "min-h-0 flex-1 flex-col rounded-xl border border-white/[0.08] bg-black/20 p-4 backdrop-blur-sm sm:p-5"
          : "max-w-[560px] rounded-2xl border border-white/10 bg-white/[0.03] p-5 backdrop-blur-xl sm:p-6"
      )}
    >
      <div className="pointer-events-none absolute right-5 top-5 flex items-center gap-1.5" aria-hidden>
        <span className="relative flex h-2 w-2">
          <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-400/25 opacity-50" />
          <span className="relative inline-flex h-2 w-2 rounded-full bg-emerald-400/90" />
        </span>
      </div>

      <div
        key={`${mode}-${day}`}
        className={cn(
          "pr-6 transition-opacity duration-500",
          embedded && "flex min-h-0 flex-1 flex-col"
        )}
      >
        <div className="flex shrink-0 items-start justify-between gap-3">
          <div>
            <h3 className="text-sm font-medium text-white/60">{frame.headline}</h3>
            <div className="mt-2 text-3xl font-extrabold tabular-nums tracking-tight text-white transition-all duration-500 sm:text-4xl">
              {frame.primary}
            </div>
          </div>
        </div>

        <div className="mt-5 grid shrink-0 grid-cols-2 gap-4 text-sm">
          {frame.secondaries.map((row) => (
            <div key={row.label}>
              <div className="text-white/50">{row.label}</div>
              <div className="mt-0.5 font-semibold tabular-nums text-white/90 transition-all duration-500">{row.value}</div>
            </div>
          ))}
        </div>

        <div className={cn("mt-4", embedded ? "mt-3 flex min-h-0 flex-1 flex-col" : "")}>{viz}</div>
      </div>
    </div>
  );
}

const DATA_INSIGHTS_TABS: { id: DataInsightsMode; label: string }[] = [
  { id: "update", label: "Обновление" },
  { id: "alerts", label: "Проблемы" },
  { id: "analytics", label: "Аналитика" },
];

export function DataInsightsSection({ density = "default" }: { density?: LandingMidSectionDensity }) {
  const [mode, setMode] = useState<DataInsightsMode>("update");
  const [selectedDay, setSelectedDay] = useState(2);

  const handleDayHover = (i: number | null, _source: DataInsightsDayHoverSource) => {
    if (i === null) return;
    setSelectedDay(clampDataInsightsDay(i));
  };

  return (
    <section
      id="data"
      className={cn("landing-mid-scope scroll-mt-24 border-t border-white/10", landingSectionPad(density))}
    >
      <div className="landing-data-scope mx-auto max-w-6xl px-6">
        <div
          className={cn(
            "grid grid-cols-1 items-stretch lg:grid-cols-2",
            density === "spacious" ? "gap-14 md:gap-16" : "gap-12"
          )}
        >
          <div className="flex min-h-0 w-full min-w-0 flex-col">
            <h2 className="text-3xl font-semibold tracking-tight text-white/95">
              Данные, которые работают за вас
            </h2>

            <p className="mt-6 max-w-xl text-base leading-relaxed text-white/70">
              BoardIQ анализирует данные в реальном времени и уведомляет о ключевых изменениях.
            </p>

            <div className="mt-8 flex w-full flex-col">
              <div className="flex w-full flex-col rounded-2xl border border-white/10 bg-white/[0.03] p-5 backdrop-blur-xl sm:p-6">
                <DataFrameLineMiniChart
                  placement="left"
                  variant={mode}
                  series={DATA_INSIGHTS_CHART[mode]}
                  selectedDay={selectedDay}
                  onDayHover={handleDayHover}
                />
              </div>
            </div>
          </div>

          <div className="flex min-h-0 w-full min-w-0 flex-col rounded-2xl border border-white/10 bg-white/[0.03] p-5 pb-4 backdrop-blur-xl sm:p-6 lg:flex lg:h-full lg:min-h-0 lg:flex-col">
            <div className="flex shrink-0 flex-wrap gap-2">
              {DATA_INSIGHTS_TABS.map((tab) => (
                <button
                  key={tab.id}
                  type="button"
                  onClick={() => setMode(tab.id)}
                  className={cn(
                    "cursor-pointer rounded-full border px-3 py-1.5 text-xs font-semibold transition-all duration-300 focus:outline-none focus-visible:ring-2 focus-visible:ring-white/25",
                    mode === tab.id
                      ? "border-white/25 bg-white/[0.12] text-white shadow-[0_0_20px_rgba(255,255,255,0.08)]"
                      : "border-white/10 bg-white/[0.02] text-white/50 hover:border-white/18 hover:bg-white/[0.06] hover:text-white/85 hover:shadow-[0_0_16px_rgba(255,255,255,0.06)]"
                  )}
                >
                  {tab.label}
                </button>
              ))}
            </div>

            <div className="mt-4 flex min-h-0 flex-1 flex-col lg:min-h-0">
              <DataInsightsMetricFrame embedded mode={mode} day={selectedDay} onDayHover={handleDayHover} />
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}

type DDAModelKind = "lastclick" | "boardiq";

const DDA_TOUCHPOINTS = [
  { id: "meta", label: "Meta Ads", short: "Meta" },
  { id: "site", label: "Сайт / органика", short: "Сайт" },
  { id: "email", label: "Email", short: "Email" },
] as const;

/** Кредит по каналам: last-click = весь на последнем касании; DDA — распределённый */
const DDA_CREDIT_LAST = [0, 0, 100] as const;
const DDA_CREDIT_BOARDIQ = [32, 38, 30] as const;

function ddaBoardiqFill(index: number): string {
  if (index === 0) return "bg-[#fcbb00e6]";
  if (index === 1) return "bg-[#e8947ee6]";
  return "bg-[#00d294e6]";
}

function ddaBoardiqTextClass(index: number): string {
  if (index === 0) return "text-[#fcbb00e6]";
  if (index === 1) return "text-[#e8947ee6]";
  return "text-[#00d294e6]";
}

/** Акцентные цвета DDA (литералы для Tailwind JIT) */
function ddaSegmentFill(model: DDAModelKind, index: number): string {
  if (model === "lastclick") {
    if (index === 2) return "bg-[#ff6568e6]";
    return "bg-gradient-to-b from-zinc-500/55 to-zinc-600/55";
  }
  return ddaBoardiqFill(index);
}

function DDAJourneyInfographic({ model }: { model: DDAModelKind }) {
  const credits = model === "lastclick" ? DDA_CREDIT_LAST : DDA_CREDIT_BOARDIQ;
  const lastWins = model === "lastclick";
  const [hoveredCreditIdx, setHoveredCreditIdx] = useState<number | null>(null);

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between gap-1 text-[10px] font-medium uppercase tracking-[0.12em] text-white/35 sm:text-[11px]">
        <span>Путь пользователя</span>
        <span className="hidden sm:inline">→ конверсия</span>
      </div>

      <div className="relative">
        <div
          className={cn(
            "pointer-events-none absolute left-[12%] right-[12%] top-[22px] h-px sm:top-[26px]",
            lastWins ? "landing-dda-flow-line--rose" : "landing-dda-flow-line--dda"
          )}
          aria-hidden
        />
        <div className="relative flex justify-between gap-1 sm:gap-2">
          {DDA_TOUCHPOINTS.map((tp, i) => {
            const active = lastWins ? i === 2 : credits[i]! >= 28;
            return (
              <div key={tp.id} className="flex min-w-0 flex-1 flex-col items-center">
                <div
                  className={cn(
                    "landing-dda-node relative flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl border text-[11px] font-bold transition-all duration-200 sm:h-12 sm:w-12 sm:text-xs",
                    !active && "border-white/10 bg-zinc-800/35 text-white/50",
                    hoveredCreditIdx === i && "ring-2 ring-white/35 ring-offset-2 ring-offset-black/40",
                    active &&
                      lastWins &&
                      "border-[#ff6568e6] bg-[rgba(255,101,104,0.15)] text-white landing-dda-node-pulse-rose",
                    active &&
                      !lastWins &&
                      (i === 0
                        ? "border-[#fcbb00e6] bg-[rgba(252,187,0,0.15)] text-white landing-dda-node-pulse-gold"
                        : i === 1
                          ? "border-[rgb(232,148,126)] bg-[rgba(232,148,126,0.18)] text-white landing-dda-node-pulse-mauve"
                          : "border-[#00d294e6] bg-[rgba(0,210,148,0.15)] text-white landing-dda-node-pulse-green")
                  )}
                >
                  {i + 1}
                </div>
                <span className="mt-2 max-w-[4.5rem] truncate text-center text-[10px] text-white/45 sm:max-w-none sm:text-[11px]">
                  {tp.short}
                </span>
              </div>
            );
          })}
        </div>
      </div>

      <div className="border-t border-white/[0.08] pt-4">
        <div className="mb-3 flex items-center justify-between gap-2">
          <span className="text-[11px] font-medium text-white/45">Распределение кредита</span>
          <span
            className={cn(
              "rounded-full border border-white/10 bg-white/[0.05] px-2 py-0.5 text-[10px] font-semibold",
              lastWins ? "text-[#ff6568e6]" : "text-white/75"
            )}
          >
            {lastWins ? "Один победитель" : "Мульти-тач"}
          </span>
        </div>

        <div className="landing-dda-segbar flex h-12 w-full overflow-hidden rounded-xl border border-white/10 bg-zinc-800/55 shadow-inner ring-1 ring-white/[0.06]">
          {credits.map((pct, i) => (
            <div
              key={DDA_TOUCHPOINTS[i]!.id}
              className={cn(
                "relative z-0 flex min-w-0 items-center justify-center transition-all duration-300 ease-out",
                ddaSegmentFill(model, i),
                i < 2 ? "border-r border-white/[0.06]" : "",
                hoveredCreditIdx !== null && hoveredCreditIdx !== i && "opacity-[0.38]",
                hoveredCreditIdx === i && "z-[1] opacity-100 ring-2 ring-white/25 ring-inset"
              )}
              style={{ flex: `0 0 ${pct}%` }}
            >
              {pct >= 6 ? (
                <span className="text-xs font-bold tabular-nums text-white/95 drop-shadow-sm">{pct}%</span>
              ) : null}
            </div>
          ))}
        </div>

        <div key={model} className="mt-4 space-y-2.5">
          {DDA_TOUCHPOINTS.map((tp, i) => (
            <div
              key={tp.id}
              className={cn(
                "landing-dda-channel-row landing-mid-signal-row rounded-lg px-2 py-1.5 transition-all duration-200",
                hoveredCreditIdx === i && "bg-white/[0.07] ring-1 ring-white/15"
              )}
            >
              <div className="flex items-center justify-between gap-2 text-[11px] sm:text-xs">
                <span
                  className={cn(
                    "truncate transition-colors",
                    hoveredCreditIdx === i ? "text-white/90" : "text-white/50"
                  )}
                >
                  {tp.label}
                </span>
                <span
                  className={cn(
                    "shrink-0 cursor-default tabular-nums font-semibold transition-colors",
                    lastWins && credits[i] === 100 && "text-[#ff6568e6]",
                    !lastWins && ddaBoardiqTextClass(i),
                    hoveredCreditIdx === i && "brightness-110"
                  )}
                  onMouseEnter={() => setHoveredCreditIdx(i)}
                  onMouseLeave={() => setHoveredCreditIdx(null)}
                >
                  {credits[i]}%
                </span>
              </div>
              <div className="relative mt-1.5 h-2 overflow-hidden rounded-full bg-zinc-600/45">
                <div
                  className={cn(
                    "h-full rounded-full transition-[filter] duration-200",
                    ddaSegmentFill(model, i),
                    hoveredCreditIdx === i && "brightness-110"
                  )}
                  style={
                    {
                      width: `${credits[i]}%`,
                      transition: "width 0.7s cubic-bezier(0.22, 1, 0.36, 1)",
                    } as CSSProperties
                  }
                />
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

function DDACardSummary({ model }: { model: DDAModelKind }) {
  const last = model === "lastclick";
  const rows = last
    ? [
        { label: "Ранние каналы", value: "0%" },
        { label: "Искажение ROI", value: "Высокое" },
      ]
    : [
        { label: "Точки касания", value: "Все учтены" },
        { label: "Бюджет", value: "Под ROI" },
      ];

  return (
    <div className="mt-6 border-t border-white/[0.08] pt-5">
      <div className="grid grid-cols-2 gap-3">
        {rows.map((row, ri) => (
          <div key={row.label} className="rounded-lg border border-white/[0.08] bg-white/[0.03] px-3 py-2.5">
            <div className="text-[11px] text-white/45">{row.label}</div>
            <div
              className={cn(
                "mt-0.5 text-sm font-semibold tabular-nums",
                last ? "text-[#ff6568e6]" : ri === 0 ? "text-[#fcbb00e6]" : "text-[#00d294e6]"
              )}
            >
              {row.value}
            </div>
          </div>
        ))}
      </div>
      <p className="mt-4 text-xs leading-relaxed text-white/45 sm:text-sm">
        {last
          ? "Как в типичных кабинетах: весь кредит уходит на последний клик — ранние каналы обнуляются."
          : "Как в блоке преимуществ BoardIQ: справедливый вес каналов и единая картина по воронке."}
      </p>
    </div>
  );
}

export function DDASection({ density = "default" }: { density?: LandingMidSectionDensity }) {
  return (
    <section
      id="dda"
      className={cn("landing-mid-scope scroll-mt-24 border-t border-white/10", landingSectionPad(density))}
    >
      <div className="landing-data-scope mx-auto max-w-6xl px-6">
        <h2 className="text-3xl font-semibold tracking-tight text-white/95">
          Data Driven Attribution (DDA)
        </h2>
        <p className="mt-6 max-w-3xl text-base leading-relaxed text-white/70">
          Сравните классический last-click и data-driven модель BoardIQ: те же метрики — разная логика распределения кредита по
          пути пользователя.
        </p>

        <div
          className={cn(
            "mt-10 grid grid-cols-1 items-stretch lg:grid-cols-2",
            density === "spacious" ? "gap-14 md:gap-16" : "gap-12"
          )}
        >
          {/* Last-click — серая карточка, красный только акцент */}
          <div className="flex min-h-0 w-full min-w-0 flex-col">
            <h3 className="flex items-center gap-2 text-lg font-semibold tracking-tight text-white/90">
              <span className="h-2 w-2 shrink-0 rounded-full bg-[#ff6568e6]" aria-hidden />
              Last-click
            </h3>
            <p className="mt-2 max-w-xl text-sm leading-relaxed text-white/55">100% кредита на последнее касание.</p>

            <div className="relative mt-6 flex w-full flex-col overflow-hidden rounded-2xl border border-white/10 bg-white/[0.03] p-5 ring-1 ring-white/[0.06] backdrop-blur-xl sm:p-6">
              <div
                className="pointer-events-none absolute -right-14 -top-14 h-40 w-40 rounded-full bg-white/[0.06] blur-3xl landing-mid-glow-pulse"
                aria-hidden
              />
              <div
                className="pointer-events-none absolute -bottom-10 left-1/4 h-24 w-1/2 rounded-full bg-zinc-500/[0.08] blur-3xl"
                aria-hidden
              />
              <div className="relative">
                <DDAJourneyInfographic model="lastclick" />
                <DDACardSummary model="lastclick" />
              </div>
            </div>
          </div>

          {/* DDA — та же серая база, зелёный только акцент */}
          <div className="flex min-h-0 w-full min-w-0 flex-col">
            <h3 className="flex items-center gap-2 text-lg font-semibold tracking-tight text-white/90">
              <span className="h-2 w-2 shrink-0 rounded-full bg-[#fcbb00e6]" aria-hidden />
              DDA в BoardIQ
            </h3>
            <p className="mt-2 max-w-xl text-sm leading-relaxed text-white/55">Вклад каналов по всему пути.</p>

            <div className="relative mt-6 flex w-full flex-col overflow-hidden rounded-2xl border border-white/10 bg-white/[0.03] p-5 ring-1 ring-white/[0.06] backdrop-blur-xl sm:p-6">
              <div
                className="pointer-events-none absolute -right-14 -top-14 h-44 w-44 rounded-full bg-white/[0.06] blur-3xl landing-mid-glow-pulse"
                aria-hidden
              />
              <div
                className="pointer-events-none absolute -bottom-12 left-1/3 h-28 w-1/2 rounded-full bg-zinc-500/[0.08] blur-3xl"
                aria-hidden
              />
              <div className="relative">
                <DDAJourneyInfographic model="boardiq" />
                <DDACardSummary model="boardiq" />
              </div>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
