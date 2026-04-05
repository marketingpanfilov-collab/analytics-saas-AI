"use client";

import React from "react";

export type ExecutiveKpi = {
  label: string;
  group: "finance" | "product" | "marketing";
  value: number | null;
  format: "money" | "number" | "percent" | "ratio";
  note?: string;
  delta_percent?: number;
  plan_value?: number | null;
  fact_value?: number | null;
  plan_progress?: number | null;
};

export type WeeklyReportData = {
  period?: {
    start: string;
    end: string;
    prev_start: string;
    prev_end: string;
  };
  currency?: string;
  summary: string;
  kpis: Record<string, ExecutiveKpi>;
  insights_ru?: string[];
  risks_ru?: string[];
  actions_ru?: string[];
  attribution_highlights?: string[];
  risks?: string[];
  priority_actions?: string[];
};

function formatNum(n: number): string {
  if (n >= 1_000_000) return (n / 1_000_000).toFixed(1) + "M";
  if (n >= 1_000) return (n / 1_000).toFixed(1) + "k";
  return n.toLocaleString();
}

function formatDateRu(ymd: string): string {
  const d = new Date(`${ymd}T00:00:00.000Z`);
  return new Intl.DateTimeFormat("ru-RU", {
    day: "numeric",
    month: "long",
    year: "numeric",
    timeZone: "UTC",
  }).format(d);
}

function formatValue(kpi: ExecutiveKpi, currency: string): string {
  if (kpi.value == null) return "—";
  if (kpi.format === "money") {
    if (currency === "KZT") return `${formatNum(kpi.value)} ₸`;
    return `$${formatNum(kpi.value)}`;
  }
  if (kpi.format === "percent") return `${(kpi.value * 100).toFixed(1)}%`;
  if (kpi.format === "ratio") return kpi.value.toFixed(2);
  return formatNum(kpi.value);
}

function formatDelta(delta: number | undefined): string {
  if (delta == null) return "";
  const sign = delta >= 0 ? "+" : "";
  return ` (${sign}${delta}%)`;
}

type Props = {
  data: WeeklyReportData;
  /** Print-friendly: hide decorative elements, use simpler layout */
  printMode?: boolean;
  /** Show "Last 7 days vs previous 7 days" subtitle */
  showSubtitle?: boolean;
};

export default function WeeklyReportContent({ data, printMode, showSubtitle = true }: Props) {
  const kpis = Object.entries(data.kpis ?? {});
  const currency = data.currency === "KZT" ? "KZT" : "USD";
  const insights = data.insights_ru ?? data.attribution_highlights ?? [];
  const risks = data.risks_ru ?? data.risks ?? [];
  const actions = data.actions_ru ?? data.priority_actions ?? [];

  const grouped = {
    finance: kpis.filter(([, k]) => k.group === "finance"),
    product: kpis.filter(([, k]) => k.group === "product"),
    marketing: kpis.filter(([, k]) => k.group === "marketing"),
  };

  const renderGrid = (list: Array<[string, ExecutiveKpi]>) => (
    <div
      className={
        printMode
          ? "weekly-report-print-kpi-grid grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3"
          : "grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-3"
      }
    >
      {list.map(([key, kpi]) => (
        <div
          key={key}
          className={
            printMode
              ? "weekly-report-print-kpi-cell rounded-xl border border-white/10 bg-white/[0.03] p-3"
              : "rounded-xl border border-white/10 bg-white/[0.03] p-4"
          }
        >
          <div className="text-xs text-white/50">{kpi.label}</div>
          <div className="mt-1 text-lg font-semibold text-white">
            {formatValue(kpi, currency)}
            {formatDelta(kpi.delta_percent)}
          </div>
          {(kpi.plan_value != null || kpi.plan_progress != null) && (
            <div className="mt-2 text-xs text-white/55">
              {kpi.plan_value != null && <>План: {formatValue({ ...kpi, value: kpi.plan_value }, currency)} · </>}
              Факт: {formatValue({ ...kpi, value: kpi.fact_value ?? kpi.value }, currency)}
              {kpi.plan_progress != null && <> · Выполнение: {(kpi.plan_progress * 100).toFixed(1)}%</>}
            </div>
          )}
          {kpi.note && <div className="mt-2 text-xs text-white/55">{kpi.note}</div>}
        </div>
      ))}
    </div>
  );

  return (
    <div className={printMode ? "min-h-0" : ""}>
      {showSubtitle && (
        <p className="mb-6 text-sm text-white/50">
          {data.period
            ? `с ${formatDateRu(data.period.start)} по ${formatDateRu(data.period.end)} (сравнение с ${formatDateRu(data.period.prev_start)} по ${formatDateRu(data.period.prev_end)})`
            : "Отчёт за выбранный диапазон"}
        </p>
      )}
      <section className={printMode ? "mb-6" : "mb-8"}>
        <div className="rounded-2xl border border-white/10 bg-white/[0.03] p-5">
          <h2 className={`font-semibold text-white/95 ${printMode ? "text-base mb-2" : "mb-3 text-lg"}`}>
            Executive Summary
          </h2>
          <p className="whitespace-pre-line leading-relaxed text-white/85">{data.summary}</p>
        </div>
      </section>

      <section className={printMode ? "mb-6" : "mb-8"}>
        <div className="rounded-2xl border border-white/10 bg-white/[0.03] p-5">
          <h2 className={`font-semibold text-white/95 ${printMode ? "text-base mb-2" : "mb-4 text-lg"}`}>
            Ключевые метрики
          </h2>
          <div className="space-y-6">
            <div>
              <h3 className="mb-3 text-sm font-semibold uppercase tracking-wide text-white/70">Финансы</h3>
              {renderGrid(grouped.finance)}
            </div>
            <div>
              <h3 className="mb-3 text-sm font-semibold uppercase tracking-wide text-white/70">Продукт</h3>
              {renderGrid(grouped.product)}
            </div>
            <div>
              <h3 className="mb-3 text-sm font-semibold uppercase tracking-wide text-white/70">Маркетинг</h3>
              {renderGrid(grouped.marketing)}
            </div>
          </div>
        </div>
      </section>

      {insights.length > 0 && (
        <section className={printMode ? "mb-6" : "mb-8"}>
          <div className="rounded-2xl border border-white/10 bg-white/[0.03] p-5">
            <h2 className={`font-semibold text-white/95 ${printMode ? "text-base mb-2" : "mb-3 text-lg"}`}>
              Инсайты
            </h2>
            <ul className="list-inside list-disc space-y-2 text-sm text-white/80">
              {insights.map((h, i) => (
                <li key={i}>{h}</li>
              ))}
            </ul>
          </div>
        </section>
      )}

      {risks.length > 0 && (
        <section className={`rounded-2xl border border-amber-500/20 bg-amber-500/5 p-6 ${printMode ? "mb-6" : "mb-8"}`}>
          <h2 className={`font-semibold text-amber-200/95 ${printMode ? "text-base mb-2" : "mb-3 text-lg"}`}>
            Риски
          </h2>
          <ul className="list-inside list-disc space-y-2 text-sm text-white/80">
            {risks.map((r, i) => (
              <li key={i}>{r}</li>
            ))}
          </ul>
        </section>
      )}

      {actions.length > 0 && (
        <section className={`rounded-2xl border border-white/10 bg-white/[0.03] p-6 ${printMode ? "mb-6" : ""}`}>
          <h2 className={`font-semibold text-white/95 ${printMode ? "text-base mb-2" : "mb-3 text-lg"}`}>
            Приоритетные действия
          </h2>
          <ol className="list-inside list-decimal space-y-2 text-sm font-medium text-white/90">
            {actions.map((a, i) => (
              <li key={i}>{a}</li>
            ))}
          </ol>
        </section>
      )}
    </div>
  );
}
