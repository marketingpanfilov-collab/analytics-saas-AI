"use client";

import React, { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import WeeklyReportContent, { type WeeklyReportData } from "@/app/app/components/WeeklyReportContent";
import { useBillingBootstrap } from "@/app/app/components/BillingBootstrapProvider";
import { billingActionAllowed } from "@/app/lib/billingBootstrapClient";
import { ActionId } from "@/app/lib/billingUiContract";

export default function WeeklyReportExportClient() {
  const searchParams = useSearchParams();
  const { resolvedUi } = useBillingBootstrap();
  const canExportReport = useMemo(
    () => billingActionAllowed(resolvedUi, ActionId.export),
    [resolvedUi]
  );
  const projectId = searchParams.get("project_id")?.trim() ?? null;
  const start = searchParams.get("start")?.trim();
  const end = searchParams.get("end")?.trim();
  const sourcesParam = searchParams.get("sources")?.trim();
  const accountIdsParam = searchParams.get("account_ids")?.trim();
  const sourcesFilter = useMemo(
    () =>
      sourcesParam
        ? sourcesParam.split(",").map((s) => s.trim()).filter(Boolean)
        : [],
    [sourcesParam]
  );
  const accountIdsFilter = useMemo(
    () =>
      accountIdsParam
        ? accountIdsParam.split(",").map((s) => s.trim()).filter(Boolean)
        : [],
    [accountIdsParam]
  );

  const [data, setData] = useState<WeeklyReportData | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [printConsuming, setPrintConsuming] = useState(false);
  const [printLimitMessage, setPrintLimitMessage] = useState<string | null>(null);

  const fetchReport = useCallback(async () => {
    if (!canExportReport || !projectId) return;
    setLoading(true);
    setError(null);
    try {
      const qs = new URLSearchParams({
        project_id: projectId,
        start: start ?? "",
        end: end ?? "",
      });
      if (sourcesFilter.length) qs.set("sources", sourcesFilter.join(","));
      if (accountIdsFilter.length) qs.set("account_ids", accountIdsFilter.join(","));
      const res = await fetch(`/api/weekly-board-report?${qs.toString()}`, { cache: "no-store" });
      const json = await res.json();
      if (res.status === 403 && json?.code === "WEEKLY_REPORT_LIMIT_REACHED") {
        setData(null);
        const used = Number(json.used) ?? 0;
        const limit = Number(json.limit) ?? 0;
        setError(
          `Достигнут лимит отчётов на тарифе Starter за месяц (UTC): ${used} из ${limit}. Откройте страницу в новом месяце или смените тариф.`
        );
        return;
      }
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
  }, [projectId, start, end, canExportReport, sourcesFilter, accountIdsFilter]);

  useEffect(() => {
    if (projectId && canExportReport) fetchReport();
    else setData(null);
  }, [projectId, fetchReport, canExportReport]);

  const handlePrint = useCallback(async () => {
    if (!canExportReport || !projectId) return;
    setPrintLimitMessage(null);
    setPrintConsuming(true);
    try {
      const exportNonce =
        typeof crypto !== "undefined" && typeof crypto.randomUUID === "function"
          ? crypto.randomUUID()
          : `${Date.now()}-${Math.random().toString(16).slice(2)}-${Math.random().toString(16).slice(2)}`;
      const res = await fetch("/api/weekly-board-report/consume-export", {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          project_id: projectId,
          start: start ?? null,
          end: end ?? null,
          sources: sourcesFilter,
          account_ids: accountIdsFilter,
          export_nonce: exportNonce,
        }),
      });
      const json = await res.json().catch(() => ({}));
      if (res.status === 403 && json?.code === "WEEKLY_REPORT_LIMIT_REACHED") {
        const used = Number(json.used) ?? 0;
        const limit = Number(json.limit) ?? 0;
        setPrintLimitMessage(
          `Достигнут лимит отчётов на тарифе Starter за месяц (UTC): ${used} из ${limit}. Печать и PDF недоступны до следующего месяца или смены тарифа.`
        );
        return;
      }
      if (!json?.success) {
        setPrintLimitMessage(
          typeof json?.error === "string" ? json.error : "Не удалось подтвердить печать. Попробуйте снова."
        );
        return;
      }
      window.print();
    } catch {
      setPrintLimitMessage("Не удалось подтвердить печать. Попробуйте снова.");
    } finally {
      setPrintConsuming(false);
    }
  }, [canExportReport, projectId, start, end, sourcesFilter, accountIdsFilter]);

  if (!canExportReport) {
    return (
      <div className="min-h-[60vh] bg-[#0b0b10] p-6" style={{ gridColumn: "2 / -1" }}>
        <p className="text-white/70">Экспорт и печать отчёта недоступны при текущем статусе подписки.</p>
        <Link
          href="/app/weekly-report"
          className="mt-4 inline-block rounded-lg border border-white/20 px-4 py-2 text-sm text-white/90 hover:bg-white/10"
        >
          Назад к отчёту
        </Link>
      </div>
    );
  }

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
          @page {
            margin: 8mm;
            size: auto;
          }
          html, body {
            background: #0b0b10 !important;
            width: 100% !important;
            max-width: none !important;
            margin: 0 !important;
            padding: 0 !important;
            height: auto !important;
            max-height: none !important;
            overflow: visible !important;
            -webkit-print-color-adjust: exact;
            print-color-adjust: exact;
          }
          /* Скрываем прочий UI; без position:fixed — иначе PDF обрезается одной страницей */
          body * { visibility: hidden; }
          .weekly-report-export,
          .weekly-report-export * {
            visibility: visible;
          }
          .weekly-report-export {
            position: relative !important;
            left: auto !important;
            top: auto !important;
            width: 100% !important;
            max-width: none !important;
            min-width: 0 !important;
            min-height: 0 !important;
            height: auto !important;
            margin: 0 !important;
            box-sizing: border-box !important;
            padding: 0 !important;
            background: #0b0b10 !important;
            overflow: visible !important;
            break-inside: auto !important;
            page-break-inside: auto !important;
            grid-column: unset !important;
          }
          /* Любой Tailwind max-w-* на тех же узлах — снимаем целиком поддерево */
          .weekly-report-export,
          .weekly-report-export * {
            max-width: none !important;
          }
          .weekly-report-export-inner {
            width: 100% !important;
            min-width: 0 !important;
            margin: 0 !important;
            padding-left: 0 !important;
            padding-right: 0 !important;
          }
          .weekly-report-export section {
            width: 100% !important;
            min-width: 0 !important;
            box-sizing: border-box !important;
            padding: 14px 12px !important;
            background: rgba(10,10,18,0.96) !important;
            border-color: rgba(255,255,255,0.12) !important;
          }
          .no-print { display: none !important; }
          /* Сетка KPI на всю ширину листа (не «узкий sm» от превью браузера) */
          .weekly-report-export .weekly-report-print-kpi-grid {
            display: grid !important;
            grid-template-columns: repeat(3, minmax(0, 1fr)) !important;
            gap: 10px !important;
          }
          @media print and (max-width: 520px) {
            .weekly-report-export .weekly-report-print-kpi-grid {
              grid-template-columns: repeat(2, minmax(0, 1fr)) !important;
            }
          }
          .weekly-report-export .weekly-report-print-kpi-cell {
            break-inside: avoid;
            page-break-inside: avoid;
          }
        }
      `}</style>
      <div className="weekly-report-export-inner mx-auto w-full max-w-5xl space-y-5">
        <section className="no-print rounded-2xl border border-white/10 bg-[rgba(10,10,18,0.96)] p-5">
          {printLimitMessage && (
            <p className="mb-3 text-sm text-amber-200/95">{printLimitMessage}</p>
          )}
          <div className="flex flex-wrap items-center gap-3">
            <button
              type="button"
              onClick={() => void handlePrint()}
              disabled={!canExportReport || printConsuming}
              className="rounded-lg bg-white/15 px-4 py-2 text-sm font-medium text-white hover:bg-white/20 disabled:opacity-50"
            >
              {printConsuming ? "Проверка лимита…" : "Печать / Save as PDF"}
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
