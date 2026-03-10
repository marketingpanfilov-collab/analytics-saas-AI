"use client";

import { useMemo, useState } from "react";

type RangeKey = "today" | "7d" | "30d";
type Channel = "Meta" | "Google" | "TikTok";
type MetricKey = "spend" | "cac" | "buyers";

type Series = { name: string; values: number[]; kind?: "primary" | "soft" };

type CampaignSpend = {
  channel: Channel;
  name: string;
  spend: number;
  buyers: number;
  cac: number;
};

const glassCard: React.CSSProperties = {
  borderRadius: 18,
  border: "1px solid rgba(255,255,255,0.10)",
  background:
    "radial-gradient(700px 240px at 30% 0%, rgba(120,120,255,0.14), transparent 60%), rgba(255,255,255,0.03)",
  boxShadow: "0 18px 60px rgba(0,0,0,0.45)",
};

const cardPad: React.CSSProperties = { padding: 16 };

const smallMuted: React.CSSProperties = { opacity: 0.72, fontSize: 13, lineHeight: 1.35 };

const pillBase: React.CSSProperties = {
  height: 34,
  padding: "0 10px",
  borderRadius: 999,
  border: "1px solid rgba(255,255,255,0.12)",
  background: "rgba(255,255,255,0.04)",
  color: "rgba(255,255,255,0.90)",
  fontWeight: 900,
  cursor: "pointer",
  whiteSpace: "nowrap",
};

const pillActive: React.CSSProperties = {
  ...pillBase,
  background: "rgba(120,120,255,0.18)",
  border: "1px solid rgba(120,120,255,0.28)",
};

function fmtKzt(n: number) {
  return new Intl.NumberFormat("ru-RU").format(Math.round(n)) + " ₸";
}
function fmtNum(n: number) {
  return new Intl.NumberFormat("ru-RU").format(Math.round(n));
}

function MetricLabel({ m }: { m: MetricKey }) {
  if (m === "spend") return <>Расход</>;
  if (m === "cac") return <>CAC</>;
  return <>Покупатели</>;
}

function MetricUnit({ m }: { m: MetricKey }) {
  if (m === "spend") return "₸";
  if (m === "cac") return "₸";
  return "";
}

/** Simple SVG line chart */
function LineChart({
  title,
  subtitle,
  series,
  labels,
}: {
  title: string;
  subtitle?: string;
  series: Series[];
  labels: string[];
}) {
  const W = 980;
  const H = 260;
  const pad = 34;
  const innerW = W - pad * 2;
  const innerH = H - pad * 2;

  const all = series.flatMap((s) => s.values);
  const max = Math.max(1, ...all);
  const min = 0;

  const x = (i: number, n: number) => pad + (n <= 1 ? 0 : (innerW * i) / (n - 1));
  const y = (v: number) => pad + innerH - ((v - min) / (max - min)) * innerH;

  const pathFor = (vals: number[]) =>
    vals
      .map((v, i) => `${i === 0 ? "M" : "L"} ${x(i, vals.length).toFixed(2)} ${y(v).toFixed(2)}`)
      .join(" ");

  return (
    <div style={{ ...glassCard, ...cardPad }}>
      <div style={{ display: "flex", justifyContent: "space-between", gap: 12, alignItems: "flex-start" }}>
        <div style={{ minWidth: 0 }}>
          <div style={{ fontSize: 20, fontWeight: 950 }}>{title}</div>
          {subtitle ? <div style={{ ...smallMuted, marginTop: 6 }}>{subtitle}</div> : null}
        </div>

        <div style={{ display: "flex", gap: 10, flexWrap: "wrap", justifyContent: "flex-end" }}>
          {series.map((s) => (
            <span
              key={s.name}
              style={{
                display: "inline-flex",
                alignItems: "center",
                gap: 8,
                padding: "6px 10px",
                borderRadius: 999,
                border: "1px solid rgba(255,255,255,0.12)",
                background: "rgba(255,255,255,0.04)",
                fontWeight: 900,
                fontSize: 12,
                color: "rgba(255,255,255,0.85)",
                whiteSpace: "nowrap",
              }}
              title={s.name}
            >
              <span
                style={{
                  width: 10,
                  height: 10,
                  borderRadius: 999,
                  background: s.kind === "soft" ? "rgba(180,180,255,0.75)" : "rgba(120,255,210,0.85)",
                }}
              />
              {s.name}
            </span>
          ))}
        </div>
      </div>

      <div style={{ marginTop: 14, overflow: "hidden" }}>
        <svg
          viewBox={`0 0 ${W} ${H}`}
          width="100%"
          height="260"
          style={{
            display: "block",
            borderRadius: 14,
            background: "rgba(0,0,0,0.16)",
            border: "1px solid rgba(255,255,255,0.10)",
          }}
        >
          {[0, 0.25, 0.5, 0.75, 1].map((t) => {
            const yy = pad + innerH * t;
            return (
              <line
                key={t}
                x1={pad}
                x2={W - pad}
                y1={yy}
                y2={yy}
                stroke="rgba(255,255,255,0.08)"
                strokeWidth="1"
              />
            );
          })}

          {series.map((s, idx) => (
            <path
              key={s.name}
              d={pathFor(s.values)}
              fill="none"
              stroke={s.kind === "soft" ? "rgba(180,180,255,0.75)" : "rgba(120,255,210,0.85)"}
              strokeWidth={idx === 0 ? 3 : 2}
              strokeLinejoin="round"
              strokeLinecap="round"
            />
          ))}

          {/* points for first series */}
          {series[0]?.values?.map((v, i) => (
            <circle
              key={i}
              cx={x(i, series[0].values.length)}
              cy={y(v)}
              r={4.2}
              fill="rgba(120,255,210,0.9)"
              stroke="rgba(0,0,0,0.25)"
              strokeWidth="1"
            />
          ))}

          {/* x labels */}
          {labels.map((lab, i) => {
            const xx = x(i, labels.length);
            return (
              <text
                key={lab}
                x={xx}
                y={H - 10}
                textAnchor={i === 0 ? "start" : i === labels.length - 1 ? "end" : "middle"}
                fontSize="12"
                fill="rgba(255,255,255,0.55)"
              >
                {lab}
              </text>
            );
          })}
        </svg>
      </div>
    </div>
  );
}

/** Campaign spend list (top 3 max) */
function CampaignSpendList({
  title,
  rows,
  metric,
}: {
  title: string;
  rows: CampaignSpend[];
  metric: MetricKey;
}) {
  const max = Math.max(1, ...rows.map((r) => (metric === "spend" ? r.spend : metric === "cac" ? r.cac : r.buyers)));

  const valText = (r: CampaignSpend) => {
    if (metric === "spend") return fmtKzt(r.spend);
    if (metric === "cac") return fmtKzt(r.cac);
    return fmtNum(r.buyers);
  };

  const valNum = (r: CampaignSpend) => (metric === "spend" ? r.spend : metric === "cac" ? r.cac : r.buyers);

  return (
    <div style={{ ...glassCard, ...cardPad, minHeight: 220 }}>
      <div style={{ fontSize: 16, fontWeight: 950 }}>{title}</div>
      <div style={{ ...smallMuted, marginTop: 6 }}>
        Топ-3 по каналу (без W1/W2). Метрика: <b><MetricLabel m={metric} /></b>
      </div>

      <div style={{ marginTop: 12, display: "grid", gap: 10 }}>
        {rows.slice(0, 3).map((r) => {
          const w = Math.max(6, (valNum(r) / max) * 100);
          return (
            <div
              key={r.name}
              style={{
                borderRadius: 14,
                border: "1px solid rgba(255,255,255,0.10)",
                background: "rgba(255,255,255,0.02)",
                padding: 12,
                minWidth: 0,
              }}
            >
              <div style={{ display: "flex", justifyContent: "space-between", gap: 12, alignItems: "baseline" }}>
                <div style={{ fontWeight: 950, minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                  {r.name}
                </div>
                <div style={{ fontWeight: 950, opacity: 0.95, whiteSpace: "nowrap" }}>{valText(r)}</div>
              </div>

              <div
                style={{
                  marginTop: 10,
                  height: 10,
                  borderRadius: 999,
                  border: "1px solid rgba(255,255,255,0.10)",
                  background: "rgba(0,0,0,0.18)",
                  overflow: "hidden",
                }}
              >
                <div
                  style={{
                    width: `${w}%`,
                    height: "100%",
                    borderRadius: 999,
                    background: "rgba(120,120,255,0.40)",
                  }}
                />
              </div>

              <div style={{ ...smallMuted, marginTop: 8 }}>
                Buyers: <b>{fmtNum(r.buyers)}</b> • CAC: <b>{fmtKzt(r.cac)}</b>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

export default function MetricsDynamicsBlock({
  range,
}: {
  range: RangeKey;
}) {
  const [metric, setMetric] = useState<MetricKey>("spend");

  const labels = useMemo(() => {
    if (range === "today") return ["00:00", "06:00", "12:00", "18:00", "24:00"];
    if (range === "7d") return ["Пн", "Вт", "Ср", "Чт", "Пт", "Сб", "Вс"];
    return ["Нед 1", "Нед 2", "Нед 3", "Нед 4", "Нед 5"];
  }, [range]);

  /** Заглушки: заменишь на реальные данные */
  const data = useMemo(() => {
    const n = labels.length;

    // базовые ряды по каналам
    const metaSpend = Array.from({ length: n }, (_, i) => Math.round(160_000 + i * 22_000 + (i % 2 ? 15_000 : 6_000)));
    const googleSpend = Array.from({ length: n }, (_, i) => Math.round(90_000 + i * 14_000 + (i % 2 ? 7_000 : 3_000)));
    const tiktokSpend = Array.from({ length: n }, (_, i) => Math.round(55_000 + i * 9_000 + (i % 2 ? 6_000 : 2_000)));

    // CAC — условно “плавает”
    const metaCac = Array.from({ length: n }, (_, i) => Math.round(22_000 + i * 900 + (i % 2 ? 1800 : 700)));
    const googleCac = Array.from({ length: n }, (_, i) => Math.round(18_000 + i * 750 + (i % 2 ? 1200 : 600)));
    const tiktokCac = Array.from({ length: n }, (_, i) => Math.round(24_000 + i * 650 + (i % 2 ? 1500 : 650)));

    // Buyers — дискретные числа
    const metaBuyers = Array.from({ length: n }, (_, i) => Math.max(0, Math.round(6 + i * 1.2 + (i % 2 ? 1 : 0))));
    const googleBuyers = Array.from({ length: n }, (_, i) => Math.max(0, Math.round(4 + i * 0.9 + (i % 2 ? 1 : 0))));
    const tiktokBuyers = Array.from({ length: n }, (_, i) => Math.max(0, Math.round(3 + i * 0.7 + (i % 2 ? 1 : 0))));

    const pick = (m: MetricKey) => {
      if (m === "spend") return { meta: metaSpend, google: googleSpend, tiktok: tiktokSpend };
      if (m === "cac") return { meta: metaCac, google: googleCac, tiktok: tiktokCac };
      return { meta: metaBuyers, google: googleBuyers, tiktok: tiktokBuyers };
    };

    const picked = pick(metric);
    const total = picked.meta.map((v, i) => v + picked.google[i] + picked.tiktok[i]);

    // топ-3 кампании на канал
    const campaigns: CampaignSpend[] = [
      { channel: "Meta", name: "Retargeting 7d (Catalog)", spend: 223_401, buyers: 11, cac: 18_500 },
      { channel: "Meta", name: "Broad Advantage+ (Sales)", spend: 445_900, buyers: 14, cac: 31_850 },
      { channel: "Meta", name: "Lookalike 1% (Leads → Sales)", spend: 112_500, buyers: 3, cac: 37_500 },

      { channel: "Google", name: "Brand Search (Exact)", spend: 167_300, buyers: 9, cac: 19_200 },
      { channel: "Google", name: "Shopping — Best Sellers", spend: 92_800, buyers: 5, cac: 18_560 },
      { channel: "Google", name: "Remarketing (RLSA)", spend: 64_900, buyers: 2, cac: 32_450 },

      { channel: "TikTok", name: "UGC Creatives (Spark)", spend: 98_700, buyers: 4, cac: 24_700 },
      { channel: "TikTok", name: "Creators — Hook Test", spend: 56_200, buyers: 2, cac: 28_100 },
      { channel: "TikTok", name: "Warm Retargeting (Viewers)", spend: 41_900, buyers: 1, cac: 41_900 },
    ];

    return {
      total,
      meta: picked.meta,
      google: picked.google,
      tiktok: picked.tiktok,
      campaigns,
    };
  }, [labels, metric]);

  const seriesTotal: Series[] = useMemo(
    () => [
      { name: `Total ${metric === "buyers" ? "Buyers" : metric.toUpperCase()}`, values: data.total, kind: "primary" },
      { name: "Meta", values: data.meta, kind: "soft" },
      { name: "Google", values: data.google, kind: "soft" },
      { name: "TikTok", values: data.tiktok, kind: "soft" },
    ],
    [data, metric]
  );

  const subtitle = useMemo(() => {
    if (metric === "spend") return "Spend Trend + разрез по каналам. Ниже — топ-3 кампании по расходам.";
    if (metric === "cac") return "CAC динамика по каналам. Ниже — топ-3 кампании по CAC (порог/сравнение позже).";
    return "Покупатели (buyers) по каналам. Ниже — топ-3 кампании по покупателям.";
  }, [metric]);

  const campMeta = useMemo(() => data.campaigns.filter((c) => c.channel === "Meta"), [data.campaigns]);
  const campGoogle = useMemo(() => data.campaigns.filter((c) => c.channel === "Google"), [data.campaigns]);
  const campTikTok = useMemo(() => data.campaigns.filter((c) => c.channel === "TikTok"), [data.campaigns]);

  return (
    <div style={{ display: "grid", gap: 14 }}>
      {/* header + metric switches */}
      <div style={{ ...glassCard, ...cardPad, display: "flex", justifyContent: "space-between", gap: 12, alignItems: "center" }}>
        <div style={{ minWidth: 0 }}>
          <div style={{ fontSize: 18, fontWeight: 950 }}>Динамика метрик</div>
          <div style={{ ...smallMuted, marginTop: 6 }}>
            Показатели по каналам: <b>расход</b>, <b>CAC</b>, <b>покупатели</b>. Переключай метрику.
          </div>
        </div>

        <div style={{ display: "flex", gap: 8, flexWrap: "wrap", justifyContent: "flex-end" }}>
          <button style={metric === "spend" ? pillActive : pillBase} onClick={() => setMetric("spend")}>
            Расход
          </button>
          <button style={metric === "cac" ? pillActive : pillBase} onClick={() => setMetric("cac")}>
            CAC
          </button>
          <button style={metric === "buyers" ? pillActive : pillBase} onClick={() => setMetric("buyers")}>
            Покупатели
          </button>
        </div>
      </div>

      {/* main total chart */}
      <LineChart
        title={`Динамика — ${metric === "spend" ? "Spend" : metric === "cac" ? "CAC" : "Покупатели"} (по каналам)`}
        subtitle={subtitle}
        labels={labels}
        series={seriesTotal}
      />

      {/* per-channel mini charts */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(3, minmax(0, 1fr))", gap: 14 }}>
        <LineChart
          title={`Meta — ${metric === "spend" ? "Spend" : metric === "cac" ? "CAC" : "Покупатели"}`}
          subtitle={`Динамика Meta за период • единица: ${MetricUnit({ m: metric })}`}
          labels={labels}
          series={[{ name: "Meta", values: data.meta, kind: "primary" }]}
        />
        <LineChart
          title={`Google — ${metric === "spend" ? "Spend" : metric === "cac" ? "CAC" : "Покупатели"}`}
          subtitle={`Динамика Google Ads за период • единица: ${MetricUnit({ m: metric })}`}
          labels={labels}
          series={[{ name: "Google", values: data.google, kind: "primary" }]}
        />
        <LineChart
          title={`TikTok — ${metric === "spend" ? "Spend" : metric === "cac" ? "CAC" : "Покупатели"}`}
          subtitle={`Динамика TikTok Ads за период • единица: ${MetricUnit({ m: metric })}`}
          labels={labels}
          series={[{ name: "TikTok", values: data.tiktok, kind: "primary" }]}
        />
      </div>

      {/* top-3 campaigns per channel */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(3, minmax(0, 1fr))", gap: 14 }}>
        <CampaignSpendList title="Meta — кампании" rows={campMeta} metric={metric} />
        <CampaignSpendList title="Google — кампании" rows={campGoogle} metric={metric} />
        <CampaignSpendList title="TikTok — кампании" rows={campTikTok} metric={metric} />
      </div>
    </div>
  );
}