"use client";

import React from "react";

export type WeeklyReportKpis = {
  clicks?: { value: number; delta_percent?: number };
  visits?: { value: number; delta_percent?: number };
  registrations?: { value: number; delta_percent?: number };
  purchases?: { value: number; delta_percent?: number };
  revenue?: { value: number; currency: string; delta_percent?: number };
  data_quality_score?: { value: number; delta_pp?: number };
};

export type WeeklyReportData = {
  summary: string;
  kpis: WeeklyReportKpis;
  attribution_highlights: string[];
  data_quality_highlights: string[];
  risks: string[];
  growth_opportunities: string[];
  priority_actions: string[];
};

function formatNum(n: number): string {
  if (n >= 1_000_000) return (n / 1_000_000).toFixed(1) + "M";
  if (n >= 1_000) return (n / 1_000).toFixed(1) + "k";
  return n.toLocaleString();
}
function formatDelta(delta: number | undefined): string {
  if (delta == null) return "";
  const sign = delta >= 0 ? "+" : "";
  return ` (${sign}${delta}%)`;
}
function formatDeltaPp(delta: number | undefined): string {
  if (delta == null) return "";
  const sign = delta >= 0 ? "+" : "";
  return ` (${sign}${delta} pp)`;
}

type Props = {
  data: WeeklyReportData;
  /** Print-friendly: hide decorative elements, use simpler layout */
  printMode?: boolean;
  /** Show "Last 7 days vs previous 7 days" subtitle */
  showSubtitle?: boolean;
};

export default function WeeklyReportContent({ data, printMode, showSubtitle = true }: Props) {
  const k = data.kpis ?? {};

  return (
    <div className={printMode ? "min-h-0" : ""}>
      {showSubtitle && (
        <p className="mb-6 text-sm text-white/50">Last 7 days vs previous 7 days</p>
      )}
      <section className={printMode ? "mb-6" : "mb-8"}>
        <h2 className={`font-semibold text-white/95 ${printMode ? "text-base mb-2" : "mb-3 text-lg"}`}>Weekly Summary</h2>
        <p className="leading-relaxed text-white/85">{data.summary}</p>
      </section>

      <section className={printMode ? "mb-6" : "mb-8"}>
        <h2 className={`font-semibold text-white/95 ${printMode ? "text-base mb-2" : "mb-4 text-lg"}`}>KPI Snapshot</h2>
        <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 md:grid-cols-6">
          {[
            { key: "clicks", label: "Clicks", v: k.clicks },
            { key: "visits", label: "Visits", v: k.visits },
            { key: "registrations", label: "Registrations", v: k.registrations },
            { key: "purchases", label: "Purchases", v: k.purchases },
            {
              key: "revenue",
              label: "Revenue",
              text: k.revenue
                ? `${k.revenue.currency === "USD" ? "$" : ""}${formatNum(k.revenue.value ?? 0)}${k.revenue.currency !== "USD" ? ` ${k.revenue.currency}` : ""}${formatDelta(k.revenue.delta_percent)}`
                : "—",
            },
            {
              key: "dq",
              label: "Data Quality",
              text: k.data_quality_score != null ? `${k.data_quality_score.value}%${formatDeltaPp(k.data_quality_score.delta_pp)}` : "—",
            },
          ].map(({ key, label, v, text }) => (
            <div key={key} className="rounded-xl border border-white/10 bg-white/[0.03] p-4">
              <div className="text-xs text-white/50">{label}</div>
              <div className="mt-1 text-lg font-semibold text-white">
                {typeof text === "string" ? text : v ? `${formatNum(v.value ?? 0)}${formatDelta(v.delta_percent)}` : "—"}
              </div>
            </div>
          ))}
        </div>
      </section>

      {data.attribution_highlights?.length > 0 && (
        <section className={printMode ? "mb-6" : "mb-8"}>
          <h2 className={`font-semibold text-white/95 ${printMode ? "text-base mb-2" : "mb-3 text-lg"}`}>Attribution Highlights</h2>
          <ul className="list-inside list-disc space-y-2 text-sm text-white/80">
            {data.attribution_highlights.map((h, i) => (
              <li key={i}>{h}</li>
            ))}
          </ul>
        </section>
      )}

      {data.data_quality_highlights?.length > 0 && (
        <section className={printMode ? "mb-6" : "mb-8"}>
          <h2 className={`font-semibold text-white/95 ${printMode ? "text-base mb-2" : "mb-3 text-lg"}`}>Data Quality Highlights</h2>
          <ul className="list-inside list-disc space-y-2 text-sm text-white/80">
            {data.data_quality_highlights.map((h, i) => (
              <li key={i}>{h}</li>
            ))}
          </ul>
        </section>
      )}

      {data.risks?.length > 0 && (
        <section className={`rounded-2xl border border-amber-500/20 bg-amber-500/5 p-6 ${printMode ? "mb-6" : "mb-8"}`}>
          <h2 className={`font-semibold text-amber-200/95 ${printMode ? "text-base mb-2" : "mb-3 text-lg"}`}>Risks &amp; Issues</h2>
          <ul className="list-inside list-disc space-y-2 text-sm text-white/80">
            {data.risks.map((r, i) => (
              <li key={i}>{r}</li>
            ))}
          </ul>
        </section>
      )}

      {data.growth_opportunities?.length > 0 && (
        <section className={`rounded-2xl border border-emerald-500/20 bg-emerald-500/5 p-6 ${printMode ? "mb-6" : "mb-8"}`}>
          <h2 className={`font-semibold text-emerald-200/95 ${printMode ? "text-base mb-2" : "mb-3 text-lg"}`}>Growth Opportunities</h2>
          <ul className="list-inside list-disc space-y-2 text-sm text-white/80">
            {data.growth_opportunities.map((o, i) => (
              <li key={i}>{o}</li>
            ))}
          </ul>
        </section>
      )}

      {data.priority_actions?.length > 0 && (
        <section className={`rounded-2xl border border-white/10 bg-white/[0.03] p-6 ${printMode ? "mb-6" : ""}`}>
          <h2 className={`font-semibold text-white/95 ${printMode ? "text-base mb-2" : "mb-3 text-lg"}`}>Priority Actions</h2>
          <ol className="list-inside list-decimal space-y-2 text-sm font-medium text-white/90">
            {data.priority_actions.map((a, i) => (
              <li key={i}>{a}</li>
            ))}
          </ol>
        </section>
      )}
    </div>
  );
}
