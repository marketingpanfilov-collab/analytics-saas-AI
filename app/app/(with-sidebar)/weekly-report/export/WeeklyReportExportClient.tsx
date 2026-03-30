"use client";

import React, { useCallback, useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";
import WeeklyReportContent, { type WeeklyReportData } from "@/app/app/components/WeeklyReportContent";

export default function WeeklyReportExportClient() {
  const searchParams = useSearchParams();
  const projectId = searchParams.get("project_id")?.trim() ?? null;

  const [data, setData] = useState<WeeklyReportData | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const fetchReport = useCallback(async () => {
    if (!projectId) return;
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(
        `/api/weekly-board-report?project_id=${encodeURIComponent(projectId)}`,
        { cache: "no-store" }
      );
      const json = await res.json();
      if (json?.success && json?.has_sufficient_data) {
        setData({
          summary: json.summary ?? "",
          kpis: json.kpis ?? {},
          attribution_highlights: Array.isArray(json.attribution_highlights) ? json.attribution_highlights : [],
          data_quality_highlights: Array.isArray(json.data_quality_highlights) ? json.data_quality_highlights : [],
          risks: Array.isArray(json.risks) ? json.risks : [],
          growth_opportunities: Array.isArray(json.growth_opportunities) ? json.growth_opportunities : [],
          priority_actions: Array.isArray(json.priority_actions) ? json.priority_actions : [],
        });
      } else {
        setData(null);
        setError("Недостаточно данных для отчёта.");
      }
    } catch {
      setData(null);
      setError("Не удалось загрузить отчёт.");
    } finally {
      setLoading(false);
    }
  }, [projectId]);

  useEffect(() => {
    if (projectId) fetchReport();
    else setData(null);
  }, [projectId, fetchReport]);

  const handlePrint = useCallback(() => {
    window.print();
  }, []);

  if (!projectId) {
    return (
      <div className="min-h-[60vh] bg-[#0b0b10] p-6" style={{ gridColumn: "2 / -1" }}>
        <p className="text-white/70">Укажите project_id в адресе для экспорта.</p>
      </div>
    );
  }

  if (loading) {
    return (
      <div className="flex min-h-[60vh] items-center justify-center bg-[#0b0b10]" style={{ gridColumn: "2 / -1" }}>
        <p className="text-white/50">Загрузка…</p>
      </div>
    );
  }

  if (error || !data) {
    return (
      <div className="min-h-[60vh] bg-[#0b0b10] p-6" style={{ gridColumn: "2 / -1" }}>
        <p className="text-white/70">{error ?? "Нет данных."}</p>
      </div>
    );
  }

  return (
    <div className="weekly-report-export" style={{ gridColumn: "2 / -1" }}>
      <style>{`
        @media print {
          body * { visibility: hidden; }
          .weekly-report-export, .weekly-report-export * { visibility: visible; }
          .weekly-report-export { position: absolute; left: 0; top: 0; width: 100%; padding: 24px; background: #0b0b10; min-height: 100vh; }
          .no-print { display: none !important; }
        }
      `}</style>
      <div className="no-print mb-6 flex gap-3">
        <button
          type="button"
          onClick={handlePrint}
          className="rounded-lg bg-white/15 px-4 py-2 text-sm font-medium text-white hover:bg-white/20"
        >
          Печать / Save as PDF
        </button>
        <a
          href={`/app/weekly-report?project_id=${encodeURIComponent(projectId)}`}
          className="rounded-lg border border-white/20 px-4 py-2 text-sm text-white/90 hover:bg-white/10"
        >
          Назад к отчёту
        </a>
      </div>
      <div className="mx-auto max-w-4xl rounded-2xl border border-white/10 bg-white/[0.03] p-6 print:border-0 print:bg-transparent">
        <h1 className="mb-2 text-2xl font-extrabold tracking-tight text-white">Shared Board Report</h1>
        <WeeklyReportContent data={data} printMode showSubtitle />
      </div>
    </div>
  );
}
