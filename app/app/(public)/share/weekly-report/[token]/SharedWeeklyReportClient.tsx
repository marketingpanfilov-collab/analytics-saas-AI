"use client";

import React, { useEffect, useState } from "react";
import WeeklyReportContent, { type WeeklyReportData } from "@/app/app/components/WeeklyReportContent";

type Props = { token: string };

type FetchState =
  | { status: "loading" }
  | { status: "error"; message: string }
  | { status: "revoked"; message: string }
  | { status: "invalid"; message: string }
  | { status: "ok"; data: WeeklyReportData };

export default function SharedWeeklyReportClient({ token }: Props) {
  const [state, setState] = useState<FetchState>({ status: "loading" });

  useEffect(() => {
    if (!token) {
      setState({ status: "invalid", message: "Ссылка недействительна" });
      return;
    }
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch(`/api/weekly-board-report/share/${encodeURIComponent(token)}`, {
          cache: "no-store",
        });
        const json = await res.json();
        if (cancelled) return;
        if (res.status === 404 || json?.error === "invalid_link") {
          setState({ status: "invalid", message: json?.message ?? "Ссылка недействительна" });
          return;
        }
        if (res.status === 410 || json?.error === "revoked") {
          setState({ status: "revoked", message: json?.message ?? "Эта ссылка была отозвана и больше недоступна" });
          return;
        }
        if (!res.ok || !json?.success) {
          setState({ status: "error", message: json?.message ?? "Отчёт недоступен" });
          return;
        }
        setState({
          status: "ok",
          data: {
            summary: json.summary ?? "",
            kpis: json.kpis ?? {},
            attribution_highlights: Array.isArray(json.attribution_highlights) ? json.attribution_highlights : [],
            data_quality_highlights: Array.isArray(json.data_quality_highlights) ? json.data_quality_highlights : [],
            risks: Array.isArray(json.risks) ? json.risks : [],
            growth_opportunities: Array.isArray(json.growth_opportunities) ? json.growth_opportunities : [],
            priority_actions: Array.isArray(json.priority_actions) ? json.priority_actions : [],
          },
        });
      } catch {
        if (!cancelled) setState({ status: "error", message: "Отчёт недоступен" });
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [token]);

  if (state.status === "loading") {
    return (
      <div className="flex min-h-screen items-center justify-center bg-[#0b0b10]">
        <p className="text-white/50">Загрузка…</p>
      </div>
    );
  }

  if (state.status === "invalid" || state.status === "revoked" || state.status === "error") {
    return (
      <div className="flex min-h-screen items-center justify-center bg-[#0b0b10] p-6">
        <div className="max-w-md rounded-2xl border border-white/10 bg-white/5 p-8 text-center">
          <h1 className="mb-2 text-xl font-semibold text-white/90">Shared Board Report</h1>
          <p className="text-white/70">{state.message}</p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-[#0b0b10]">
      <div className="mx-auto max-w-4xl px-6 py-8">
        <header className="mb-8">
          <h1 className="text-2xl font-extrabold tracking-tight text-white">Shared Board Report</h1>
          <p className="mt-1 text-sm text-white/50">Shared report (read-only)</p>
        </header>
        <WeeklyReportContent data={state.data} showSubtitle={true} />
      </div>
    </div>
  );
}
