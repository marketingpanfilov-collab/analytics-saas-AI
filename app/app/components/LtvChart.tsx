"use client";

import React from "react";
import {
  ResponsiveContainer,
  LineChart,
  Line,
  XAxis,
  YAxis,
  Tooltip,
  CartesianGrid,
  ReferenceLine,
} from "recharts";

export type Point = {
  day: string;
  ltv: number;
  arpu: number;
};

const TOOLTIP_STYLE = {
  background: "rgba(18,20,24,0.96)",
  border: "1px solid rgba(255,255,255,0.08)",
  borderRadius: 14,
  padding: "14px 16px",
  boxShadow: "0 10px 30px rgba(0,0,0,0.45)",
  minWidth: 220,
  maxWidth: 280,
  fontSize: 13,
  lineHeight: 1.45,
};

const dayOrder: Record<string, number> = { D1: 1, D7: 7, D14: 14, D30: 30, D60: 60, D90: 90 };

function LtvTooltipContent({
  active,
  payload,
  label,
  cohortLabel,
  isDemo,
  data,
  setActiveDay,
  formatMoney,
}: {
  active?: boolean;
  payload?: Array<{ payload: Point }>;
  label?: string;
  cohortLabel: string;
  isDemo: boolean;
  data: Point[];
  setActiveDay: (day: string | null) => void;
  formatMoney: (n: number) => string;
}) {
  React.useEffect(() => {
    setActiveDay(active && label ? label : null);
    return () => setActiveDay(null);
  }, [active, label, setActiveDay]);

  if (!active || !payload?.length || !label) return null;
  const point = payload[0].payload as Point;
  const ltv = point.ltv != null && Number.isFinite(point.ltv) ? point.ltv : null;
  const arpu = point.arpu != null && Number.isFinite(point.arpu) ? point.arpu : null;
  const sorted = [...data].sort((a, b) => (dayOrder[a.day] ?? 0) - (dayOrder[b.day] ?? 0));
  const idx = sorted.findIndex((p) => p.day === label);
  const prev = idx > 0 ? sorted[idx - 1] : null;
  const growthLtv = prev != null && ltv != null && prev.ltv != null && Number.isFinite(prev.ltv)
    ? ltv - prev.ltv
    : null;

  return (
    <div style={TOOLTIP_STYLE}>
      <div style={{ fontSize: 13, fontWeight: 700, marginBottom: 10 }}>{label}</div>
      <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
        <div style={{ display: "flex", justifyContent: "space-between", gap: 16 }}>
          <span style={{ opacity: 0.6 }}>LTV</span>
          <span style={{ fontWeight: 600, color: "rgb(16,185,129)" }}>{ltv != null ? formatMoney(ltv) : "—"}</span>
        </div>
        <div style={{ display: "flex", justifyContent: "space-between", gap: 16 }}>
          <span style={{ opacity: 0.6 }}>ARPU</span>
          <span style={{ fontWeight: 600, color: "rgb(96,165,250)" }}>{arpu != null ? formatMoney(arpu) : "—"}</span>
        </div>
        <div style={{ display: "flex", justifyContent: "space-between", gap: 16 }}>
          <span style={{ opacity: 0.6 }}>Cohort</span>
          <span style={{ fontWeight: 500 }}>{cohortLabel}</span>
        </div>
        {growthLtv != null && (
          <div style={{ display: "flex", justifyContent: "space-between", gap: 16, paddingTop: 6, borderTop: "1px solid rgba(255,255,255,0.08)" }}>
            <span style={{ opacity: 0.6 }}>Growth vs prev.</span>
            <span style={{ fontWeight: 500, color: growthLtv >= 0 ? "rgb(16,185,129)" : "rgb(239,68,68)" }}>
              {growthLtv >= 0 ? "+" : ""}{formatMoney(growthLtv)}
            </span>
          </div>
        )}
        {isDemo && (
          <div style={{ fontSize: 9, fontWeight: 700, opacity: 0.7, color: "rgb(251,113,133)", textTransform: "uppercase", letterSpacing: "0.05em", marginTop: 4 }}>
            Demo data
          </div>
        )}
      </div>
    </div>
  );
}

const defaultFormatMoney = (n: number) => "₸ " + new Intl.NumberFormat("ru-RU").format(Math.round(n));

export default function LtvChart({
  data,
  cohortLabel = "—",
  isDemo = false,
  formatMoney = defaultFormatMoney,
}: {
  data: Point[];
  cohortLabel?: string;
  isDemo?: boolean;
  formatMoney?: (n: number) => string;
}) {
  const [activeDay, setActiveDay] = React.useState<string | null>(null);

  return (
    <div style={{ width: "100%" }}>
      <div style={{ width: "100%", height: 300 }}>
        <ResponsiveContainer>
          <LineChart
            data={data}
            margin={{ top: 8, right: 8, left: 0, bottom: 8 }}
          >
            <CartesianGrid stroke="rgba(255,255,255,0.06)" vertical={false} />
            <XAxis dataKey="day" stroke="rgba(255,255,255,0.35)" tick={{ fontSize: 10 }} axisLine={false} tickLine={false} />
            <YAxis stroke="rgba(255,255,255,0.35)" tick={{ fontSize: 10 }} axisLine={false} tickLine={false} width={36} />
            {activeDay && <ReferenceLine x={activeDay} stroke="rgba(255,255,255,0.15)" strokeWidth={1} />}
            <Tooltip
              content={(props) => <LtvTooltipContent {...(props as any)} cohortLabel={cohortLabel} isDemo={isDemo} data={data} setActiveDay={setActiveDay} formatMoney={formatMoney} />}
              cursor={{ stroke: "rgba(255,255,255,0.08)", strokeWidth: 1 }}
              position={{ y: 0 }}
              wrapperStyle={{ outline: "none" }}
            />
            <Line
              type="monotone"
              dataKey="ltv"
              strokeWidth={2}
              dot={{
                fill: "rgb(16,185,129)",
                strokeWidth: 0,
                r: 3,
              }}
              activeDot={{
                r: 6,
                fill: "rgb(16,185,129)",
                stroke: "rgba(255,255,255,0.4)",
                strokeWidth: 2,
                style: { filter: "drop-shadow(0 0 6px rgba(16,185,129,0.6))" },
              }}
              stroke="rgb(16,185,129)"
            />
            <Line
              type="monotone"
              dataKey="arpu"
              strokeWidth={2}
              dot={{
                fill: "rgb(96,165,250)",
                strokeWidth: 0,
                r: 3,
              }}
              activeDot={{
                r: 6,
                fill: "rgb(96,165,250)",
                stroke: "rgba(255,255,255,0.4)",
                strokeWidth: 2,
                style: { filter: "drop-shadow(0 0 6px rgba(96,165,250,0.6))" },
              }}
              stroke="rgb(96,165,250)"
            />
          </LineChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}
