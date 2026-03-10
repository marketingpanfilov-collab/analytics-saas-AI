"use client";

import { useMemo, useState } from "react";

type Point = { d: string; meta: number; google: number; tiktok: number };
type MetricKey = "spend" | "leads" | "sales" | "roas";

const wrap: React.CSSProperties = {
  borderRadius: 18,
  border: "1px solid rgba(255,255,255,0.10)",
  background:
    "radial-gradient(700px 240px at 30% 0%, rgba(120,120,255,0.12), transparent 60%), rgba(255,255,255,0.03)",
  boxShadow: "0 18px 60px rgba(0,0,0,0.45)",
  padding: 16,
};

function fmtShort(n: number) {
  if (n >= 1_000_000) return (n / 1_000_000).toFixed(1).replace(".", ",") + "M";
  if (n >= 1_000) return (n / 1_000).toFixed(1).replace(".", ",") + "K";
  return String(Math.round(n));
}

function buildPath(values: number[], w: number, h: number, pad = 10) {
  const min = Math.min(...values);
  const max = Math.max(...values);
  const span = max - min || 1;

  return values
    .map((v, i) => {
      const x = pad + (i * (w - pad * 2)) / (values.length - 1 || 1);
      const y = pad + (1 - (v - min) / span) * (h - pad * 2);
      return `${i === 0 ? "M" : "L"} ${x.toFixed(2)} ${y.toFixed(2)}`;
    })
    .join(" ");
}

export default function ChannelTrendsChart() {
  const [metric, setMetric] = useState<MetricKey>("spend");

  // заглушка данных (позже подцепишь из БД)
  const data = useMemo<Point[]>(
    () => [
      { d: "01", meta: 120, google: 80, tiktok: 40 },
      { d: "02", meta: 140, google: 70, tiktok: 55 },
      { d: "03", meta: 110, google: 90, tiktok: 60 },
      { d: "04", meta: 160, google: 95, tiktok: 58 },
      { d: "05", meta: 180, google: 110, tiktok: 72 },
      { d: "06", meta: 150, google: 120, tiktok: 68 },
      { d: "07", meta: 210, google: 130, tiktok: 80 },
    ],
    []
  );

  // трансформация под метрику (чтобы визуально отличалось)
  const series = useMemo(() => {
    // базовые “spend” условно
    const base = data.map((p) => ({ meta: p.meta, google: p.google, tiktok: p.tiktok }));
    if (metric === "spend") return base;
    if (metric === "leads") return base.map((x) => ({ meta: x.meta * 1.7, google: x.google * 1.2, tiktok: x.tiktok * 1.5 }));
    if (metric === "sales") return base.map((x) => ({ meta: x.meta * 0.28, google: x.google * 0.22, tiktok: x.tiktok * 0.18 }));
    // roas
    return base.map((x) => ({ meta: 3 + x.meta / 120, google: 2.6 + x.google / 140, tiktok: 2.8 + x.tiktok / 110 }));
  }, [data, metric]);

  const W = 820;
  const H = 260;

  const metaVals = series.map((p) => p.meta);
  const googleVals = series.map((p) => p.google);
  const tiktokVals = series.map((p) => p.tiktok);

  const all = [...metaVals, ...googleVals, ...tiktokVals];
  const min = Math.min(...all);
  const max = Math.max(...all);

  const metaPath = buildPath(metaVals, W, H);
  const googlePath = buildPath(googleVals, W, H);
  const tiktokPath = buildPath(tiktokVals, W, H);

  return (
    <div style={wrap}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10 }}>
        <div style={{ fontWeight: 950, fontSize: 22 }}>Динамика метрик</div>

        <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
          {(["spend", "leads", "sales", "roas"] as MetricKey[]).map((k) => (
            <button
              key={k}
              type="button"
              onClick={() => setMetric(k)}
              style={{
                height: 34,
                padding: "0 10px",
                borderRadius: 12,
                border: "1px solid rgba(255,255,255,0.14)",
                background: metric === k ? "rgba(120,120,255,0.18)" : "rgba(255,255,255,0.04)",
                color: "white",
                fontWeight: 850,
                cursor: "pointer",
                opacity: metric === k ? 1 : 0.8,
              }}
            >
              {k === "spend" ? "Spend" : k === "leads" ? "Leads" : k === "sales" ? "Sales" : "ROAS"}
            </button>
          ))}
        </div>
      </div>

      <div style={{ opacity: 0.7, marginTop: 6, fontSize: 13 }}>
        По каналам: Meta / Google / TikTok (пока заглушка, подключим из БД)
      </div>

      <div style={{ marginTop: 12, overflow: "hidden", borderRadius: 16, border: "1px dashed rgba(255,255,255,0.12)" }}>
        <svg viewBox={`0 0 ${W} ${H}`} width="100%" height={H} preserveAspectRatio="none">
          {/* grid */}
          {[0, 1, 2, 3, 4].map((i) => {
            const y = 10 + (i * (H - 20)) / 4;
            return <line key={i} x1="10" x2={W - 10} y1={y} y2={y} stroke="rgba(255,255,255,0.08)" />;
          })}

          <path d={metaPath} stroke="rgba(110,255,200,0.95)" strokeWidth="2.2" fill="none" />
          <path d={googlePath} stroke="rgba(180,180,255,0.95)" strokeWidth="2.2" fill="none" />
          <path d={tiktokPath} stroke="rgba(255,180,120,0.95)" strokeWidth="2.2" fill="none" />
        </svg>
      </div>

      <div style={{ display: "flex", gap: 10, marginTop: 10, flexWrap: "wrap", opacity: 0.85, fontSize: 13 }}>
        <span>Min: <b>{fmtShort(min)}</b></span>
        <span>Max: <b>{fmtShort(max)}</b></span>
        <span style={{ marginLeft: "auto", display: "flex", gap: 12 }}>
          <span><span style={{ display: "inline-block", width: 10, height: 10, borderRadius: 99, background: "rgba(110,255,200,0.95)", marginRight: 6 }} />Meta</span>
          <span><span style={{ display: "inline-block", width: 10, height: 10, borderRadius: 99, background: "rgba(180,180,255,0.95)", marginRight: 6 }} />Google</span>
          <span><span style={{ display: "inline-block", width: 10, height: 10, borderRadius: 99, background: "rgba(255,180,120,0.95)", marginRight: 6 }} />TikTok</span>
        </span>
      </div>
    </div>
  );
}