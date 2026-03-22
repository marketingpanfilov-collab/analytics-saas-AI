"use client";

import React, { useCallback, useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";
import WeeklyReportContent from "@/app/app/components/WeeklyReportContent";

type KpiValue = { value: number; delta_percent?: number };
type KpiScore = { value: number; delta_pp?: number };

type WeeklyReportData = {
  has_sufficient_data: boolean;
  summary: string;
  kpis: {
    clicks: KpiValue;
    visits: KpiValue;
    registrations: KpiValue;
    purchases: KpiValue;
    revenue: { value: number; currency: string; delta_percent?: number };
    data_quality_score: KpiScore;
  };
  attribution_highlights: string[];
  data_quality_highlights: string[];
  risks: string[];
  growth_opportunities: string[];
  priority_actions: string[];
};

type ShareStatus = {
  active: boolean;
  url?: string;
  token?: string;
  created_at?: string;
};

export default function WeeklyReportClient() {
  const searchParams = useSearchParams();
  const projectId = searchParams.get("project_id")?.trim() ?? null;

  const [data, setData] = useState<WeeklyReportData | null>(null);
  const [loading, setLoading] = useState(false);
  const [shareStatus, setShareStatus] = useState<ShareStatus | null>(null);
  const [shareLoading, setShareLoading] = useState(false);
  const [shareCreating, setShareCreating] = useState(false);
  const [revokeLoading, setRevokeLoading] = useState(false);
  const [warningOpen, setWarningOpen] = useState(false);
  const [revokeConfirmOpen, setRevokeConfirmOpen] = useState(false);

  const fetchReport = useCallback(async () => {
    if (!projectId) return;
    setLoading(true);
    try {
      const res = await fetch(
        `/api/weekly-board-report?project_id=${encodeURIComponent(projectId)}`,
        { cache: "no-store" }
      );
      const json = await res.json();
      if (json?.success) {
        setData({
          has_sufficient_data: json.has_sufficient_data ?? false,
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
      }
    } catch {
      setData(null);
    } finally {
      setLoading(false);
    }
  }, [projectId]);

  useEffect(() => {
    if (projectId) fetchReport();
    else setData(null);
  }, [projectId, fetchReport]);

  const fetchShareStatus = useCallback(async () => {
    if (!projectId) return;
    setShareLoading(true);
    try {
      const res = await fetch(`/api/weekly-board-report/share?project_id=${encodeURIComponent(projectId)}`, { cache: "no-store" });
      const json = await res.json();
      if (json?.success && json.active) {
        setShareStatus({ active: true, url: json.url, token: json.token, created_at: json.created_at });
      } else {
        setShareStatus({ active: false });
      }
    } catch {
      setShareStatus({ active: false });
    } finally {
      setShareLoading(false);
    }
  }, [projectId]);

  useEffect(() => {
    if (projectId && data?.has_sufficient_data) fetchShareStatus();
    else setShareStatus(null);
  }, [projectId, data?.has_sufficient_data, fetchShareStatus]);

  const createShare = useCallback(async () => {
    if (!projectId) return;
    setWarningOpen(false);
    setShareCreating(true);
    try {
      const res = await fetch("/api/weekly-board-report/share", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ project_id: projectId }),
      });
      const json = await res.json();
      if (json?.success && json.url) {
        setShareStatus({ active: true, url: json.url, token: json.token, created_at: json.created_at });
      }
    } finally {
      setShareCreating(false);
    }
  }, [projectId]);

  const revokeShare = useCallback(async () => {
    const token = shareStatus?.token;
    if (!token) return;
    setRevokeConfirmOpen(false);
    setRevokeLoading(true);
    try {
      const res = await fetch("/api/weekly-board-report/share/revoke", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token }),
      });
      const json = await res.json();
      if (json?.success) setShareStatus({ active: false });
    } finally {
      setRevokeLoading(false);
    }
  }, [shareStatus?.token]);

  const copyShareUrl = useCallback(() => {
    if (!shareStatus?.url) return;
    const full = shareStatus.url.startsWith("http") ? shareStatus.url : (typeof window !== "undefined" ? window.location.origin : "") + shareStatus.url;
    navigator.clipboard.writeText(full);
  }, [shareStatus?.url]);

  if (!projectId) {
    return (
      <div className="min-h-[60vh] bg-[#0b0b10] p-6" style={{ gridColumn: "2 / -1" }}>
        <p className="text-white/70">Выберите проект.</p>
      </div>
    );
  }

  if (loading) {
    return (
      <div className="flex min-h-[60vh] items-center justify-center bg-[#0b0b10]" style={{ gridColumn: "2 / -1" }}>
        <p className="text-white/50">Загрузка Weekly Board Report…</p>
      </div>
    );
  }

  if (!data) {
    return (
      <div className="min-h-[60vh] bg-[#0b0b10] p-6" style={{ gridColumn: "2 / -1" }}>
        <p className="text-white/50">Не удалось загрузить отчёт.</p>
      </div>
    );
  }

  if (!data.has_sufficient_data) {
    return (
      <div className="min-h-[60vh] bg-[#0b0b10] p-6" style={{ gridColumn: "2 / -1" }}>
        <div className="mx-auto max-w-2xl rounded-2xl border border-white/10 bg-white/5 p-12 text-center">
          <h1 className="mb-2 text-xl font-semibold text-white/90">Weekly Board Report</h1>
          <p className="text-white/60">Недостаточно данных для формирования weekly report.</p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-[60vh] bg-[#0b0b10] p-6" style={{ gridColumn: "2 / -1" }}>
      <div className="mx-auto max-w-4xl">
        <header className="mb-6">
          <h1 className="text-2xl font-extrabold tracking-tight text-white">Weekly Board Report</h1>
          <p className="mt-1 text-sm text-white/50">Last 7 days vs previous 7 days</p>
        </header>

        <section className="mb-8 rounded-2xl border border-white/10 bg-white/[0.04] p-4">
          <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-white/70">Export &amp; Share</h2>
          <div className="flex flex-wrap items-center gap-3">
            <a
              href={`/app/weekly-report/export?project_id=${encodeURIComponent(projectId!)}`}
              target="_blank"
              rel="noopener noreferrer"
              className="rounded-lg bg-white/12 px-4 py-2 text-sm font-medium text-white hover:bg-white/18"
            >
              Export / Print
            </a>
            {shareStatus?.active && shareStatus.url ? (
              <>
                <div className="min-w-0 max-w-md flex-1 rounded-lg border border-white/15 bg-white/5 px-3 py-2 font-mono text-xs text-white/80 truncate" title={shareStatus.url.startsWith("http") ? shareStatus.url : (typeof window !== "undefined" ? window.location.origin : "") + shareStatus.url}>
                  {shareStatus.url.startsWith("http") ? shareStatus.url : (typeof window !== "undefined" ? window.location.origin : "") + shareStatus.url}
                </div>
                <button
                  type="button"
                  onClick={copyShareUrl}
                  className="rounded-lg border border-white/20 px-4 py-2 text-sm text-white/90 hover:bg-white/10"
                >
                  Copy
                </button>
                <button
                  type="button"
                  onClick={() => setRevokeConfirmOpen(true)}
                  disabled={revokeLoading}
                  className="rounded-lg border border-amber-500/40 px-4 py-2 text-sm text-amber-200 hover:bg-amber-500/15 disabled:opacity-50"
                >
                  {revokeLoading ? "Отзыв…" : "Отозвать ссылку"}
                </button>
              </>
            ) : (
              <button
                type="button"
                onClick={() => setWarningOpen(true)}
                disabled={shareCreating || shareLoading}
                className="rounded-lg border border-white/25 bg-amber-500/15 px-4 py-2 text-sm font-medium text-amber-200 hover:bg-amber-500/25 disabled:opacity-50"
              >
                {shareCreating ? "Создание…" : "Создать открытую ссылку"}
              </button>
            )}
          </div>
        </section>

        <WeeklyReportContent
          data={{
            summary: data.summary,
            kpis: data.kpis,
            attribution_highlights: data.attribution_highlights,
            data_quality_highlights: data.data_quality_highlights,
            risks: data.risks,
            growth_opportunities: data.growth_opportunities,
            priority_actions: data.priority_actions,
          }}
          showSubtitle={false}
        />
      </div>

      {warningOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4" role="dialog" aria-modal="true" aria-labelledby="share-warning-title">
          <div className="max-w-md rounded-2xl border border-amber-500/40 bg-[#0f0f14] p-6 shadow-xl">
            <h2 id="share-warning-title" className="mb-3 text-lg font-bold text-amber-200">Внимание</h2>
            <p className="mb-4 text-sm leading-relaxed text-white/85">
              Вы собираетесь создать открытую ссылку на отчёт. Любой, у кого будет эта ссылка, сможет просматривать данные отчёта без авторизации. Перед отправкой убедитесь, что вы готовы передать эти данные внешнему пользователю. Это действие может повлечь риски утечки коммерческой информации.
            </p>
            <div className="flex justify-end gap-3">
              <button
                type="button"
                onClick={() => setWarningOpen(false)}
                className="rounded-lg border border-white/20 px-4 py-2 text-sm text-white/90 hover:bg-white/10"
              >
                Отмена
              </button>
              <button
                type="button"
                onClick={createShare}
                className="rounded-lg bg-amber-500/25 px-4 py-2 text-sm font-medium text-amber-200 hover:bg-amber-500/35"
              >
                Создать открытую ссылку
              </button>
            </div>
          </div>
        </div>
      )}

      {revokeConfirmOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4" role="dialog" aria-modal="true" aria-labelledby="revoke-title">
          <div className="max-w-md rounded-2xl border border-white/20 bg-[#0f0f14] p-6 shadow-xl">
            <h2 id="revoke-title" className="mb-3 text-lg font-bold text-white/95">Отозвать ссылку?</h2>
            <p className="mb-4 text-sm text-white/75">
              Вы действительно хотите отозвать открытую ссылку? После этого внешние пользователи больше не смогут открыть отчёт.
            </p>
            <div className="flex justify-end gap-3">
              <button
                type="button"
                onClick={() => setRevokeConfirmOpen(false)}
                className="rounded-lg border border-white/20 px-4 py-2 text-sm text-white/90 hover:bg-white/10"
              >
                Отмена
              </button>
              <button
                type="button"
                onClick={revokeShare}
                className="rounded-lg bg-red-500/25 px-4 py-2 text-sm font-medium text-red-200 hover:bg-red-500/35"
              >
                Отозвать ссылку
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
