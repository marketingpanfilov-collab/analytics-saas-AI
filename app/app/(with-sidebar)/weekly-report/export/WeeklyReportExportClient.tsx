"use client";

import React, { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import WeeklyReportContent, { type WeeklyReportData } from "@/app/app/components/WeeklyReportContent";

export default function WeeklyReportExportClient() {
  const searchParams = useSearchParams();
  const projectId = searchParams.get("project_id")?.trim() ?? null;
  const start = searchParams.get("start")?.trim();
  const end = searchParams.get("end")?.trim();

  const [data, setData] = useState<WeeklyReportData | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const fetchReport = useCallback(async () => {
    if (!projectId) return;
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(
        `/api/weekly-board-report?project_id=${encodeURIComponent(projectId)}&start=${encodeURIComponent(start ?? "")}&end=${encodeURIComponent(end ?? "")}`,
        { cache: "no-store" }
      );
      const json = await res.json();
      if (json?.success && json?.has_sufficient_data) {
        setData({
          period: json.period ?? undefined,
          currency: json.currency ?? "USD",
          summary: json.summary ?? "",
          kpis: json.kpis ?? {},
          insights_ru: Array.isArray(json.insights_ru) ? json.insights_ru : [],
          risks_ru: Array.isArray(json.risks_ru) ? json.risks_ru : [],
          actions_ru: Array.isArray(json.actions_ru) ? json.actions_ru : [],
          attribution_highlights: Array.isArray(json.attribution_highlights) ? json.attribution_highlights : [],
          risks: Array.isArray(json.risks) ? json.risks : [],
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
  }, [projectId, start, end]);

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
    <div className="weekly-report-export min-h-[60vh] bg-[#0b0b10] p-6" style={{ gridColumn: "2 / -1" }}>
      <style>{`
        @media print {
          html, body {
            background: #0b0b10 !important;
            -webkit-print-color-adjust: exact;
            print-color-adjust: exact;
          }
          body * { visibility: hidden; }
          .weekly-report-export, .weekly-report-export * { visibility: visible; }
          .weekly-report-export { position: absolute; left: 0; top: 0; width: 100%; padding: 24px; background: #0b0b10; min-height: 100vh; }
          .weekly-report-export section {
            background: rgba(10,10,18,0.96) !important;
            border-color: rgba(255,255,255,0.12) !important;
          }
          .no-print { display: none !important; }
        }
      `}</style>
      <div className="mx-auto w-full max-w-5xl space-y-5">
        <section className="no-print rounded-2xl border border-white/10 bg-[rgba(10,10,18,0.96)] p-5">
          <div className="flex flex-wrap items-center gap-3">
            <button
              type="button"
              onClick={handlePrint}
              className="rounded-lg bg-white/15 px-4 py-2 text-sm font-medium text-white hover:bg-white/20"
            >
              Печать / Save as PDF
            </button>
            <a
              href={`/app/weekly-report?project_id=${encodeURIComponent(projectId)}${start ? `&start=${encodeURIComponent(start)}` : ""}${end ? `&end=${encodeURIComponent(end)}` : ""}`}
              className="rounded-lg border border-white/20 px-4 py-2 text-sm text-white/90 hover:bg-white/10"
            >
              Назад к отчёту
            </a>
          </div>
        </section>

        <section className="rounded-2xl border border-white/10 bg-[rgba(10,10,18,0.96)] p-6">
          <Link href="/" className="mb-5 inline-flex items-center gap-3 rounded-lg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/40">
            <div className="relative h-10 w-10 rounded-xl border border-white/10 bg-white/6">
              <span className="absolute inset-0 grid place-items-center text-[13px] font-black leading-none text-white">
                BIQ
              </span>
            </div>
            <div className="leading-tight">
              <div className="text-sm font-extrabold text-white/95">BoardIQ</div>
              <div className="text-xs text-white/50">analytics</div>
            </div>
          </Link>
          <h1 className="mb-2 text-2xl font-extrabold tracking-tight text-white">Управленческий отчет</h1>
          <WeeklyReportContent data={data} printMode showSubtitle />
        </section>
      </div>
    </div>
  );
}
