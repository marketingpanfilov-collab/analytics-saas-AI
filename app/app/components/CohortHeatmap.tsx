"use client";

import React, { useState } from "react";

export type CohortRow = {
  cohort: string;
  values: number[];
};

function clamp(n: number, min: number, max: number) {
  return Math.max(min, Math.min(max, n));
}

function numberFmt(n: number) {
  return new Intl.NumberFormat("ru-RU").format(Math.round(n));
}

const MONTH_NAMES: Record<string, string> = {
  "01": "Jan", "02": "Feb", "03": "Mar", "04": "Apr", "05": "May", "06": "Jun",
  "07": "Jul", "08": "Aug", "09": "Sep", "10": "Oct", "11": "Nov", "12": "Dec",
};
function formatCohortDisplay(ym: string): string {
  if (!ym || !/^\d{4}-\d{2}$/.test(ym)) return ym;
  const [, m] = ym.split("-");
  return `${MONTH_NAMES[m] ?? m} ${ym.slice(0, 4)}`;
}

const TOOLTIP_STYLE: React.CSSProperties = {
  position: "fixed",
  zIndex: 50,
  background: "rgba(18,20,24,0.96)",
  border: "1px solid rgba(255,255,255,0.08)",
  borderRadius: 14,
  padding: "14px 16px",
  fontSize: 13,
  lineHeight: 1.45,
  boxShadow: "0 10px 30px rgba(0,0,0,0.45)",
  pointerEvents: "none",
  minWidth: 220,
  maxWidth: 280,
};

const M_HEADER_TOOLTIPS: Record<string, string> = {
  M0: "Initial month (first purchase)",
  M1: "Retention after 1 month since first purchase",
  M2: "Retention after 2 months since first purchase",
  M3: "Retention after 3 months since first purchase",
  M4: "Retention after 4 months since first purchase",
  M5: "Retention after 5 months since first purchase",
  M6: "Retention after 6 months since first purchase",
};

export default function CohortHeatmap({
  rows,
  mode,
  cohortLabel = "",
  isDemo = false,
  retentionRows,
  usersRows,
  revenueRows,
  formatMoney,
}: {
  rows: CohortRow[];
  mode: "money" | "users" | "percent";
  cohortLabel?: string;
  isDemo?: boolean;
  retentionRows?: CohortRow[];
  usersRows?: CohortRow[];
  revenueRows?: CohortRow[];
  formatMoney?: (n: number) => string;
}) {
  const [hoverCell, setHoverCell] = useState<{ cohort: string; index: number; x: number; y: number } | null>(null);
  const [headerHover, setHeaderHover] = useState<string | null>(null);
  const fmtMoney = formatMoney ?? ((n: number) => `₸ ${numberFmt(n)}`);

  let min = Infinity;
  let max = -Infinity;
  rows.forEach((r) => {
    r.values.forEach((v) => {
      if (mode === "percent") {
        min = 0;
        max = 100;
      } else {
        min = Math.min(min, v);
        max = Math.max(max, v);
      }
    });
  });
  if (!isFinite(min) || !isFinite(max) || min === max) {
    min = 0;
    max = 1;
  }

  const months = Array.from({ length: rows[0]?.values.length ?? 0 }, (_, i) => `M${i}`);

  const cellBg = (v: number) => {
    const t = clamp((v - min) / (max - min), 0, 1);
    const intensity = mode === "percent" ? v / 100 : t;
    return `rgba(16, 185, 129, ${Math.max(0.1, intensity)})`;
  };

  const displayValue = (v: number) => {
    if (mode === "percent") return `${v.toFixed(0)}%`;
    if (mode === "users") return numberFmt(v);
    return fmtMoney(v);
  };

  const getCellData = (cohort: string, index: number) => {
    const ret = retentionRows?.find((r) => r.cohort === cohort)?.values[index];
    const usr = usersRows?.find((r) => r.cohort === cohort)?.values[index];
    const m0 = usersRows?.find((r) => r.cohort === cohort)?.values[0];
    const rev = revenueRows?.find((r) => r.cohort === cohort)?.values[index];
    return { retention: ret, users: usr, m0: m0 ?? 0, revenue: rev };
  };

  return (
    <div style={{ overflowX: "auto", borderRadius: 16, border: "1px solid rgba(255,255,255,0.08)", background: "#161616" }}>
      <table style={{ width: "100%", minWidth: 800, borderCollapse: "collapse", fontSize: 12 }}>
        <thead>
          <tr style={{ opacity: 0.4 }}>
            <th style={{ textAlign: "left", padding: 16, borderBottom: "1px solid rgba(255,255,255,0.08)", fontWeight: 500 }}>Cohort</th>
            {months.map((m) => (
              <th
                key={m}
                style={{ textAlign: "center", padding: 16, borderBottom: "1px solid rgba(255,255,255,0.08)", fontWeight: 500, position: "relative", cursor: "help" }}
                onMouseEnter={() => setHeaderHover(m)}
                onMouseLeave={() => setHeaderHover(null)}
              >
                {m}
                {headerHover === m && (
                  <div
                    style={{
                      ...TOOLTIP_STYLE,
                      position: "absolute",
                      left: "50%",
                      bottom: "100%",
                      transform: "translate(-50%, -8px)",
                      marginBottom: 4,
                      whiteSpace: "nowrap",
                    }}
                  >
                    <div style={{ fontWeight: 600, marginBottom: 4 }}>{m}</div>
                    <div style={{ opacity: 0.7, fontSize: 10 }}>
                      {M_HEADER_TOOLTIPS[m] ?? `Retention after ${m.slice(1)} months`}
                    </div>
                  </div>
                )}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.cohort} style={{ transition: "background 0.15s ease" }}>
              <td
                style={{
                  padding: 16,
                  borderBottom: "1px solid rgba(255,255,255,0.06)",
                  fontWeight: 500,
                  opacity: 0.6,
                  position: "sticky",
                  left: 0,
                  background: "#161616",
                  zIndex: 1,
                }}
              >
                {formatCohortDisplay(r.cohort)}
              </td>
              {r.values.map((v, idx) => (
                <td
                  key={idx}
                  style={{
                    padding: 16,
                    textAlign: "center",
                    borderBottom: "1px solid rgba(255,255,255,0.06)",
                    position: "relative",
                    cursor: "default",
                  }}
                  onMouseEnter={(e) => setHoverCell({ cohort: r.cohort, index: idx, x: e.clientX, y: e.clientY })}
                  onMouseLeave={() => setHoverCell(null)}
                >
                  <div
                    style={{
                      position: "absolute",
                      inset: 4,
                      borderRadius: 6,
                      background: cellBg(v),
                      transition: "opacity 0.15s ease, filter 0.15s ease",
                      filter: hoverCell?.cohort === r.cohort && hoverCell?.index === idx ? "brightness(1.15)" : undefined,
                    }}
                  />
                  <span style={{ position: "relative", fontWeight: 500 }}>{displayValue(v)}</span>
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
      {hoverCell && (() => {
        const cellData = getCellData(hoverCell.cohort, hoverCell.index);
        return (
          <div
            style={{
              ...TOOLTIP_STYLE,
              left: hoverCell.x,
              top: hoverCell.y - 8,
              transform: "translate(-50%, -100%)",
              marginBottom: 8,
            }}
          >
            <div style={{ fontSize: 12, fontWeight: 700, marginBottom: 8 }}>{formatCohortDisplay(hoverCell.cohort)}</div>
            <div style={{ display: "flex", flexDirection: "column", gap: 6, opacity: 0.9 }}>
              <div style={{ display: "flex", justifyContent: "space-between", gap: 16 }}>
                <span style={{ opacity: 0.6 }}>Period</span>
                <span style={{ fontWeight: 500 }}>M{hoverCell.index}</span>
              </div>
              {retentionRows && (
                <div style={{ display: "flex", justifyContent: "space-between", gap: 16 }}>
                  <span style={{ opacity: 0.6 }}>Retention</span>
                  <span style={{ fontWeight: 600 }}>{cellData.retention != null ? `${cellData.retention}%` : "—"}</span>
                </div>
              )}
              {usersRows && (
                <div style={{ display: "flex", justifyContent: "space-between", gap: 16 }}>
                  <span style={{ opacity: 0.6 }}>Users</span>
                  <span style={{ fontWeight: 600 }}>
                    {cellData.users != null && cellData.m0 != null
                      ? `${numberFmt(cellData.users)} / ${numberFmt(cellData.m0)}`
                      : cellData.users != null
                        ? numberFmt(cellData.users)
                        : "—"}
                  </span>
                </div>
              )}
              {revenueRows && (
                <div style={{ display: "flex", justifyContent: "space-between", gap: 16 }}>
                  <span style={{ opacity: 0.6 }}>Revenue</span>
                  <span style={{ fontWeight: 600 }}>{cellData.revenue != null ? fmtMoney(cellData.revenue) : "—"}</span>
                </div>
              )}
            </div>
            {isDemo && (
              <div style={{ fontSize: 9, fontWeight: 700, opacity: 0.8, color: "rgb(251,113,133)", textTransform: "uppercase", letterSpacing: "0.05em", marginTop: 8, paddingTop: 6, borderTop: "1px solid rgba(255,255,255,0.08)" }}>
                Demo data
              </div>
            )}
          </div>
        );
      })()}
    </div>
  );
}
