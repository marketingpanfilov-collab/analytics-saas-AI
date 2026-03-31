"use client";

import React, { useEffect, useState } from "react";
import Link from "next/link";
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
      <div className="flex min-h-screen items-center justify-center bg-[#0b0b10] p-6">
        <div className="w-full max-w-5xl rounded-2xl border border-white/10 bg-[rgba(10,10,18,0.96)] p-8">
          <p className="text-white/50">Загрузка…</p>
        </div>
      </div>
    );
  }

  if (state.status === "invalid" || state.status === "revoked" || state.status === "error") {
    return (
      <div className="flex min-h-screen items-center justify-center bg-[#0b0b10] p-6">
        <div className="w-full max-w-xl rounded-2xl border border-white/10 bg-[rgba(10,10,18,0.96)] p-8 text-center">
          <Link href="/" className="mb-4 inline-flex items-center justify-center gap-3 rounded-lg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/40">
            <div className="relative h-10 w-10 rounded-xl border border-white/10 bg-white/6">
              <span className="absolute inset-0 grid place-items-center text-[13px] font-black leading-none text-white">
                BIQ
              </span>
            </div>
            <div className="leading-tight text-left">
              <div className="text-sm font-extrabold text-white/95">BoardIQ</div>
              <div className="text-xs text-white/50">analytics</div>
            </div>
          </Link>
          <h1 className="mb-2 text-xl font-semibold text-white/90">Управленческий отчет</h1>
          <p className="text-white/70">{state.message}</p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-[#0b0b10]">
      <div className="mx-auto w-full max-w-5xl space-y-5 px-6 py-8">
        <header className="rounded-2xl border border-white/10 bg-[rgba(10,10,18,0.96)] p-5">
          <Link href="/" className="mb-4 inline-flex items-center gap-3 rounded-lg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/40">
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
          <h1 className="text-2xl font-extrabold tracking-tight text-white">Управленческий отчет</h1>
          <p className="mt-1 text-sm text-white/50">Режим просмотра по открытой ссылке</p>
        </header>
        <section className="rounded-2xl border border-white/10 bg-[rgba(10,10,18,0.96)] p-5">
          <WeeklyReportContent data={state.data} showSubtitle={true} />
        </section>
      </div>
    </div>
  );
}
