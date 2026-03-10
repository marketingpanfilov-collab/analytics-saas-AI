"use client";

import React from "react";

export type CohortRow = {
  cohort: string;     // например "2026-08"
  values: number[];   // M0..M6 (или сколько угодно)
};

function clamp(n: number, min: number, max: number) {
  return Math.max(min, Math.min(max, n));
}

function numberFmt(n: number) {
  return new Intl.NumberFormat("ru-RU").format(Math.round(n));
}

export default function CohortHeatmap({
  rows,
  mode,
}: {
  rows: CohortRow[];
  mode: "money" | "users" | "percent";
}) {
  // для раскраски считаем min/max (кроме percent, там фикс)
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
    // 0..1
    const t = clamp((v - min) / (max - min), 0, 1);

    // Визуально как “heatmap”: ближе к зелёному при больших значениях,
    // ближе к красному при малых (на dark фоне).
    const r = Math.round(180 - 120 * t); // 180 -> 60
    const g = Math.round(70 + 140 * t);  // 70 -> 210
    const b = Math.round(60 + 40 * t);   // 60 -> 100

    return `rgba(${r},${g},${b},0.22)`;
  };

  const displayValue = (v: number) => {
    if (mode === "percent") return `${v.toFixed(0)}%`;
    if (mode === "users") return numberFmt(v);
    // money
    return `${numberFmt(v)} ₸`;
  };

  return (
    <div
      style={{
        borderRadius: 18,
        border: "1px solid rgba(255,255,255,0.10)",
        background: "rgba(255,255,255,0.02)",
        overflow: "hidden",
      }}
    >
      <div style={{ padding: 14, display: "flex", justifyContent: "space-between", gap: 12 }}>
        <div style={{ fontWeight: 900, opacity: 0.9 }}>
          Когортная таблица{" "}
          <span style={{ opacity: 0.6, fontWeight: 800 }}>
            ({mode === "money" ? "оборот" : mode === "users" ? "пользователи" : "retention %"})
          </span>
        </div>
        <div style={{ opacity: 0.6, fontSize: 12 }}>
          Заглушка · позже подключим реальные данные
        </div>
      </div>

      <div style={{ overflowX: "auto" }}>
        <table style={{ width: "100%", borderCollapse: "separate", borderSpacing: 0 }}>
          <thead>
            <tr>
              <th
                style={{
                  textAlign: "left",
                  padding: "10px 12px",
                  borderTop: "1px solid rgba(255,255,255,0.08)",
                  borderBottom: "1px solid rgba(255,255,255,0.08)",
                  background: "rgba(255,255,255,0.03)",
                  position: "sticky",
                  left: 0,
                  zIndex: 2,
                }}
              >
                Месяц
              </th>
              {months.map((m) => (
                <th
                  key={m}
                  style={{
                    textAlign: "left",
                    padding: "10px 12px",
                    borderTop: "1px solid rgba(255,255,255,0.08)",
                    borderBottom: "1px solid rgba(255,255,255,0.08)",
                    background: "rgba(255,255,255,0.03)",
                    whiteSpace: "nowrap",
                  }}
                >
                  {m}
                </th>
              ))}
            </tr>
          </thead>

          <tbody>
            {rows.map((r) => (
              <tr key={r.cohort}>
                <td
                  style={{
                    padding: "10px 12px",
                    borderBottom: "1px solid rgba(255,255,255,0.06)",
                    background: "rgba(0,0,0,0.25)",
                    position: "sticky",
                    left: 0,
                    zIndex: 1,
                    fontWeight: 900,
                    whiteSpace: "nowrap",
                  }}
                >
                  {r.cohort}
                </td>

                {r.values.map((v, idx) => (
                  <td
                    key={idx}
                    style={{
                      padding: "10px 12px",
                      borderBottom: "1px solid rgba(255,255,255,0.06)",
                      background: cellBg(v),
                      whiteSpace: "nowrap",
                    }}
                  >
                    <span style={{ fontWeight: 900 }}>{displayValue(v)}</span>
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}