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
} from "recharts";

export type Point = {
  day: string;
  ltv: number;
  arpu: number;
};

export default function LtvChart({ data }: { data: Point[] }) {
  return (
    <div
      style={{
        borderRadius: 18,
        border: "1px solid rgba(255,255,255,0.10)",
        background:
          "radial-gradient(700px 240px at 30% 0%, rgba(120,120,255,0.16), transparent 60%), rgba(255,255,255,0.03)",
        padding: 14,
      }}
    >
      <div style={{ width: "100%", height: 260 }}>
        <ResponsiveContainer>
          <LineChart data={data}>
            <CartesianGrid stroke="rgba(255,255,255,0.08)" />
            <XAxis dataKey="day" stroke="rgba(255,255,255,0.6)" />
            <YAxis stroke="rgba(255,255,255,0.6)" />
            <Tooltip
              contentStyle={{
                background: "rgba(10,10,14,0.95)",
                border: "1px solid rgba(255,255,255,0.12)",
                borderRadius: 12,
                color: "white",
              }}
            />
            <Line
              type="monotone"
              dataKey="ltv"
              strokeWidth={3}
              dot={false}
              stroke="rgba(120,120,255,0.9)"
            />
            <Line
              type="monotone"
              dataKey="arpu"
              strokeWidth={2}
              dot={false}
              stroke="rgba(110,255,200,0.75)"
            />
          </LineChart>
        </ResponsiveContainer>
      </div>

      <div style={{ display: "flex", gap: 14, marginTop: 10, opacity: 0.8, fontSize: 12 }}>
        <div>— LTV</div>
        <div>— ARPU</div>
      </div>
    </div>
  );
}