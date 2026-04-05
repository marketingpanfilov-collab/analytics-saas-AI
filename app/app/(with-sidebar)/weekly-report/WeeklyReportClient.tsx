"use client";

import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useSearchParams } from "next/navigation";
import WeeklyReportContent from "@/app/app/components/WeeklyReportContent";
import { useBillingBootstrap } from "@/app/app/components/BillingBootstrapProvider";
import PlanRestrictedOverlay from "@/app/app/components/PlanRestrictedOverlay";
import { useBillingPricingModalRequest } from "@/app/app/components/BillingPricingModalProvider";
import {
  billingActionAllowed,
  canOfferBillingInlinePricing,
  isBillingBlocking,
} from "@/app/lib/billingBootstrapClient";
import { ActionId } from "@/app/lib/billingUiContract";

type WeeklyReportData = {
  has_sufficient_data: boolean;
  period?: { start: string; end: string; prev_start: string; prev_end: string };
  currency?: string;
  summary: string;
  kpis: Record<string, any>;
  insights_ru?: string[];
  risks_ru?: string[];
  actions_ru?: string[];
  attribution_highlights?: string[];
  risks?: string[];
  priority_actions?: string[];
};

type ShareStatus = {
  active: boolean;
  url?: string;
  token?: string;
  created_at?: string;
};

type WeeklyUsageState = {
  used: number;
  limit: number | null;
  unlimited: boolean;
  usage_month_utc: string;
};

const STARTER_WEEKLY_LIMIT_OVERLAY_COPY =
  "Лимит отчетов для тарифа Starter исчерпан. Чтобы снять ограничение, оформите подписку Growth или Scale.";

export default function WeeklyReportClient() {
  const searchParams = useSearchParams();
  const projectId = searchParams.get("project_id")?.trim() ?? null;
  const { resolvedUi, bootstrap, loading: bootstrapLoading, overLimitApplyGraceUntilMs, relaxOverLimitForPendingWebhook } =
    useBillingBootstrap();
  const { requestBillingPricingModal } = useBillingPricingModalRequest();
  const canExportReport = useMemo(
    () => billingActionAllowed(resolvedUi, ActionId.export),
    [resolvedUi]
  );
  const billingBlockingOpts = useMemo(
    () => ({ overLimitApplyGraceUntilMs, relaxOverLimitForPendingWebhook }),
    [overLimitApplyGraceUntilMs, relaxOverLimitForPendingWebhook]
  );
  const exportWall = useMemo(
    () =>
      !canExportReport &&
      isBillingBlocking(resolvedUi, billingBlockingOpts) &&
      canOfferBillingInlinePricing(resolvedUi),
    [billingBlockingOpts, canExportReport, resolvedUi]
  );
  const today = new Date().toISOString().slice(0, 10);
  const monthStart = `${today.slice(0, 8)}01`;
  const urlStart = searchParams.get("start")?.trim();
  const urlEnd = searchParams.get("end")?.trim();
  const [dateFrom, setDateFrom] = useState(/^\d{4}-\d{2}-\d{2}$/.test(urlStart ?? "") ? (urlStart as string) : monthStart);
  const [dateTo, setDateTo] = useState(/^\d{4}-\d{2}-\d{2}$/.test(urlEnd ?? "") ? (urlEnd as string) : today);
  const [projectMinDate, setProjectMinDate] = useState<string | null>(null);

  const [data, setData] = useState<WeeklyReportData | null>(null);
  /** Полноэкранный лоадер только до первого ответа API; при смене дат — скелетон только в блоке отчёта. */
  const [reportLoading, setReportLoading] = useState(false);
  const [shareStatus, setShareStatus] = useState<ShareStatus | null>(null);
  const [shareLoading, setShareLoading] = useState(false);
  const [shareCreating, setShareCreating] = useState(false);
  const [revokeLoading, setRevokeLoading] = useState(false);
  const [shareNotice, setShareNotice] = useState<string | null>(null);
  const [warningOpen, setWarningOpen] = useState(false);
  const [revokeConfirmOpen, setRevokeConfirmOpen] = useState(false);
  const [shareCopied, setShareCopied] = useState(false);
  const [weeklyUsage, setWeeklyUsage] = useState<WeeklyUsageState | null>(null);
  const [weeklyLimitHit, setWeeklyLimitHit] = useState(false);
  const shareCopyResetRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const previousRangeRef = useRef<{ from: string; to: string }>({ from: dateFrom, to: dateTo });
  /** Skip auto-revoke when dates were adjusted programmatically (e.g. clamp to project min date). */
  const ignoreNextRangeChangeForRevokeRef = useRef(false);
  const autoRevokingRef = useRef(false);
  const reportFetchAbortRef = useRef<AbortController | null>(null);

  const fetchWeeklyUsage = useCallback(async () => {
    if (!projectId) return;
    try {
      const res = await fetch(
        `/api/weekly-board-report/usage?project_id=${encodeURIComponent(projectId)}`,
        { cache: "no-store" }
      );
      const json = await res.json();
      if (json?.success) {
        setWeeklyUsage({
          used: Number(json.used) || 0,
          limit: json.limit == null ? null : Number(json.limit),
          unlimited: Boolean(json.unlimited),
          usage_month_utc: String(json.usage_month_utc ?? ""),
        });
      }
    } catch {
      /* ignore */
    }
  }, [projectId]);

  useEffect(() => {
    if (!projectId || bootstrapLoading) return;
    void fetchWeeklyUsage();
  }, [projectId, bootstrapLoading, fetchWeeklyUsage]);

  const fetchReport = useCallback(
    async (signal?: AbortSignal) => {
      if (!projectId) return;
      setReportLoading(true);
      try {
        const qs = new URLSearchParams({
          project_id: projectId,
          start: dateFrom,
          end: dateTo,
        });
        const res = await fetch(`/api/weekly-board-report?${qs.toString()}`, {
          cache: "no-store",
          signal,
        });
        const json = await res.json();
        if (signal?.aborted) return;
        if (res.status === 403 && json?.code === "WEEKLY_REPORT_LIMIT_REACHED") {
          setWeeklyLimitHit(true);
          setWeeklyUsage({
            used: Number(json.used) ?? 0,
            limit: Number(json.limit) ?? 10,
            unlimited: false,
            usage_month_utc: String(json.usage_month_utc ?? ""),
          });
          setData(null);
          return;
        }
        if (json?.success) {
          setWeeklyLimitHit(false);
          setData({
            has_sufficient_data: json.has_sufficient_data ?? false,
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
          void fetchWeeklyUsage();
        } else {
          setData(null);
        }
      } catch (e) {
        if (signal?.aborted || (e instanceof DOMException && e.name === "AbortError")) return;
        setData(null);
      } finally {
        if (!signal?.aborted) setReportLoading(false);
      }
    },
    [projectId, dateFrom, dateTo, fetchWeeklyUsage]
  );

  useEffect(() => {
    if (!projectId) {
      setData(null);
      setReportLoading(false);
      return;
    }
    reportFetchAbortRef.current?.abort();
    const ac = new AbortController();
    reportFetchAbortRef.current = ac;
    void fetchReport(ac.signal);
    return () => {
      ac.abort();
    };
  }, [projectId, dateFrom, dateTo, fetchReport]);

  useEffect(() => {
    if (!projectId) {
      setProjectMinDate(null);
      return;
    }
    let cancelled = false;
    (async () => {
      const { supabase } = await import("@/app/lib/supabaseClient");
      const { data } = await supabase.from("projects").select("created_at").eq("id", projectId).maybeSingle();
      if (cancelled) return;
      const v = typeof data?.created_at === "string" ? data.created_at.slice(0, 10) : null;
      setProjectMinDate(v);
      if (!v) return;
      setDateFrom((df) => {
        if (df >= v) return df;
        ignoreNextRangeChangeForRevokeRef.current = true;
        return v;
      });
      setDateTo((dt) => {
        if (dt >= v) return dt;
        ignoreNextRangeChangeForRevokeRef.current = true;
        return v;
      });
    })();
    return () => {
      cancelled = true;
    };
  }, [projectId]);

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
    if (!canExportReport || !projectId) return;
    setWarningOpen(false);
    setShareCreating(true);
    try {
      const res = await fetch("/api/weekly-board-report/share", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ project_id: projectId, start: dateFrom, end: dateTo }),
      });
      const json = await res.json();
      if (res.status === 403 && json?.code === "WEEKLY_REPORT_LIMIT_REACHED") {
        setWeeklyLimitHit(true);
        setWeeklyUsage({
          used: Number(json.used) ?? 0,
          limit: Number(json.limit) ?? 10,
          unlimited: false,
          usage_month_utc: String(json.usage_month_utc ?? ""),
        });
        setShareNotice("Достигнут лимит отчётов на тарифе Starter. Обновите тариф, чтобы продолжить.");
        return;
      }
      if (json?.success && json.url) {
        setShareStatus({ active: true, url: json.url, token: json.token, created_at: json.created_at });
        setShareNotice(null);
        const wu = json.weekly_usage as
          | { used?: unknown; limit?: unknown; unlimited?: unknown; usage_month_utc?: unknown }
          | undefined;
        if (wu && typeof wu.used === "number") {
          const lim = wu.limit == null ? null : Number(wu.limit);
          setWeeklyUsage({
            used: wu.used,
            limit: Number.isFinite(lim as number) ? lim : null,
            unlimited: Boolean(wu.unlimited),
            usage_month_utc: String(wu.usage_month_utc ?? ""),
          });
          if (lim != null && Number.isFinite(lim) && wu.used >= lim) setWeeklyLimitHit(true);
          else setWeeklyLimitHit(false);
        } else {
          void fetchWeeklyUsage();
        }
      }
    } finally {
      setShareCreating(false);
    }
  }, [projectId, dateFrom, dateTo, canExportReport, fetchWeeklyUsage]);

  const revokeShare = useCallback(async () => {
    const token = shareStatus?.token;
    if (!canExportReport || !token) return;
    setRevokeConfirmOpen(false);
    setRevokeLoading(true);
    try {
      const res = await fetch("/api/weekly-board-report/share/revoke", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token }),
      });
      const json = await res.json();
      if (json?.success) {
        setShareStatus({ active: false });
        setShareNotice(null);
        setShareCopied(false);
      }
    } finally {
      setRevokeLoading(false);
    }
  }, [shareStatus?.token, canExportReport]);

  useEffect(() => {
    const prev = previousRangeRef.current;
    const changed = prev.from !== dateFrom || prev.to !== dateTo;
    if (ignoreNextRangeChangeForRevokeRef.current) {
      ignoreNextRangeChangeForRevokeRef.current = false;
      previousRangeRef.current = { from: dateFrom, to: dateTo };
      return;
    }
    previousRangeRef.current = { from: dateFrom, to: dateTo };
    if (!changed) return;
    if (!canExportReport || !shareStatus?.active || !shareStatus.token) return;
    if (autoRevokingRef.current) return;

    autoRevokingRef.current = true;
    (async () => {
      try {
        await fetch("/api/weekly-board-report/share/revoke", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ token: shareStatus.token }),
        });
        setShareStatus({ active: false });
        setShareNotice("Диапазон изменён — открытая ссылка автоматически отозвана.");
      } finally {
        autoRevokingRef.current = false;
      }
    })();
  }, [dateFrom, dateTo, shareStatus?.active, shareStatus?.token, canExportReport]);

  useEffect(() => {
    return () => {
      if (shareCopyResetRef.current) clearTimeout(shareCopyResetRef.current);
    };
  }, []);

  useEffect(() => {
    setShareCopied(false);
  }, [shareStatus?.url]);

  const copyShareUrl = useCallback(() => {
    if (!shareStatus?.url) return;
    const full = shareStatus.url.startsWith("http") ? shareStatus.url : (typeof window !== "undefined" ? window.location.origin : "") + shareStatus.url;
    navigator.clipboard.writeText(full);
    setShareCopied(true);
    if (shareCopyResetRef.current) clearTimeout(shareCopyResetRef.current);
    shareCopyResetRef.current = setTimeout(() => setShareCopied(false), 2800);
  }, [shareStatus?.url]);

  const effectivePlan = bootstrap?.effective_plan ?? null;
  const quotaExhausted = useMemo(
    () =>
      effectivePlan === "starter" &&
      (weeklyLimitHit ||
        (weeklyUsage != null &&
          weeklyUsage.limit != null &&
          weeklyUsage.used >= weeklyUsage.limit)),
    [effectivePlan, weeklyLimitHit, weeklyUsage]
  );

  const usageCard = useMemo(() => {
    if (bootstrapLoading) return null;
    if (effectivePlan === "growth" || effectivePlan === "scale") {
      return (
        <div className="rounded-xl border border-white/10 bg-white/[0.04] px-4 py-3 text-sm text-white/65">
          Без ограничений по количеству отчётов на тарифе {effectivePlan === "growth" ? "Growth" : "Scale"}.
        </div>
      );
    }
    if (effectivePlan !== "starter" || !weeklyUsage || weeklyUsage.limit == null) return null;
    const lim = weeklyUsage.limit;
    const used = weeklyUsage.used;
    const remaining = Math.max(0, lim - used);
    const ratio = lim > 0 ? Math.min(1, used / lim) : 0;
    const near = used >= lim - 2 && used < lim;
    return (
      <div
        className={
          "rounded-xl border px-4 py-3 text-sm " +
          (near ? "border-amber-500/35 bg-amber-500/10 text-amber-100" : "border-white/10 bg-white/[0.04] text-white/85")
        }
      >
        <div className="font-medium text-white/95">
          Использовано {used} из {lim} в этом месяце (UTC): открытая ссылка — одна на период и фильтры; каждая печать
          или сохранение в PDF — отдельное списание (повторы тоже считаются). Осталось {remaining}{" "}
          {remaining === 1 ? "использование" : remaining >= 2 && remaining <= 4 ? "использования" : "использований"}.
        </div>
        <div className="mt-2 h-2 w-full overflow-hidden rounded-full bg-white/10">
          <div
            className={near ? "h-full rounded-full bg-amber-400/80" : "h-full rounded-full bg-emerald-500/70"}
            style={{ width: `${ratio * 100}%` }}
          />
        </div>
      </div>
    );
  }, [bootstrapLoading, effectivePlan, weeklyUsage]);

  if (!projectId) {
    return (
      <div className="min-h-[60vh] bg-[#0b0b10] p-6" style={{ gridColumn: "2 / -1" }}>
        <p className="text-white/70">Выберите проект.</p>
      </div>
    );
  }

  return (
    <PlanRestrictedOverlay
      allowedPlans={["starter", "growth", "scale"]}
      message={STARTER_WEEKLY_LIMIT_OVERLAY_COPY}
      quotaExhausted={quotaExhausted}
      quotaMessage={STARTER_WEEKLY_LIMIT_OVERLAY_COPY}
      upgradeSource="weekly_report_limit"
    >
      <div className="min-h-[60vh] bg-[#0b0b10] p-6" style={{ gridColumn: "2 / -1" }}>
        {reportLoading && !data ? (
          <div className="flex min-h-[60vh] items-center justify-center">
            <div className="w-full max-w-5xl rounded-2xl border border-white/10 bg-[rgba(10,10,18,0.96)] p-8">
              <p className="text-white/50">Загрузка отчёта…</p>
            </div>
          </div>
        ) : !data ? (
          <div className="mx-auto w-full max-w-5xl space-y-4">
            {usageCard}
            <div className="rounded-2xl border border-white/10 bg-[rgba(10,10,18,0.96)] p-8">
              <p className="text-white/50">
                {weeklyLimitHit
                  ? "Достигнут лимит отчётов на тарифе Starter за текущий месяц (UTC)."
                  : "Не удалось загрузить отчёт."}
              </p>
            </div>
          </div>
        ) : !data.has_sufficient_data ? (
          <div className="mx-auto w-full max-w-5xl space-y-4">
            {usageCard}
            <div className="mx-auto max-w-2xl rounded-2xl border border-white/10 bg-[rgba(10,10,18,0.96)] p-12 text-center">
              <h1 className="mb-2 text-xl font-semibold text-white/90">Shared Board Report</h1>
              <p className="text-white/60">Недостаточно данных для формирования weekly report.</p>
            </div>
          </div>
        ) : (
          <div className="mx-auto w-full max-w-5xl space-y-5">
        {usageCard}
        {shareNotice && (
          <div className="rounded-xl border border-amber-500/35 bg-amber-500/10 px-4 py-3 text-center text-sm leading-relaxed text-amber-100">
            {shareNotice}
          </div>
        )}
        <section className="rounded-2xl border border-white/10 bg-[rgba(10,10,18,0.96)] p-5">
          <div className="flex flex-col gap-5 lg:flex-row lg:items-start lg:justify-between">
            <div>
              <h1 className="text-2xl font-extrabold tracking-tight text-white">Shared Board Report</h1>
              <p className="mt-1 text-sm text-white/50">Отчёт за выбранный диапазон</p>
              <div className="mt-4 flex flex-wrap items-center gap-3">
                <input
                  type="date"
                  value={dateFrom}
                  onChange={(e) => setDateFrom(e.target.value)}
                  max={dateTo}
                  min={projectMinDate ?? undefined}
                  className="rounded-lg border border-white/15 bg-[rgba(15,15,25,0.95)] px-3 py-2 text-sm text-white"
                />
                <input
                  type="date"
                  value={dateTo}
                  onChange={(e) => setDateTo(e.target.value)}
                  min={dateFrom}
                  max={today}
                  className="rounded-lg border border-white/15 bg-[rgba(15,15,25,0.95)] px-3 py-2 text-sm text-white"
                />
              </div>
            </div>

            <div className="w-full min-w-0 max-w-xl shrink-0 lg:ml-auto">
              <h2 className="mb-3 text-right text-sm font-semibold uppercase tracking-wide text-white/70">Export &amp; Share</h2>
              <div className="flex flex-col items-end gap-2.5">
                {canExportReport ? (
                  <a
                    href={`/app/weekly-report/export?project_id=${encodeURIComponent(projectId!)}&start=${encodeURIComponent(dateFrom)}&end=${encodeURIComponent(dateTo)}`}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex rounded-lg bg-white/10 px-2.5 py-1.5 text-xs font-medium text-white/90 hover:bg-white/14"
                  >
                    Export / Print
                  </a>
                ) : exportWall ? (
                  <button
                    type="button"
                    onClick={() => requestBillingPricingModal("export_click")}
                    className="inline-flex rounded-lg bg-white/10 px-2.5 py-1.5 text-xs font-medium text-white/90 hover:bg-white/14"
                  >
                    Export / Print
                  </button>
                ) : (
                  <span className="inline-flex cursor-not-allowed rounded-lg bg-white/5 px-2.5 py-1.5 text-xs font-medium text-white/40">
                    Export / Print
                  </span>
                )}
                {shareStatus?.active && shareStatus.url ? (
                  <div className="flex w-full min-w-0 flex-col gap-2 sm:flex-row sm:items-stretch sm:gap-2">
                    <button
                      type="button"
                      onClick={() => {
                        setShareCopied(false);
                        setRevokeConfirmOpen(true);
                      }}
                      disabled={!canExportReport || revokeLoading}
                      className="inline-flex shrink-0 self-start rounded-lg border border-amber-500/30 px-2.5 py-1.5 text-xs text-amber-200 hover:bg-amber-500/12 disabled:opacity-50 sm:self-center"
                    >
                      {revokeLoading ? "Отзыв…" : "Отозвать ссылку"}
                    </button>
                    <button
                      type="button"
                      onClick={copyShareUrl}
                      disabled={!canExportReport}
                      className="inline-flex shrink-0 self-start rounded-lg border border-white/15 px-2.5 py-1.5 text-xs text-white/85 hover:bg-white/8 disabled:opacity-50 sm:self-center"
                    >
                      Copy
                    </button>
                    <div
                      className={
                        "relative min-h-[2.25rem] min-w-0 flex-1 overflow-hidden rounded-lg border px-3 py-2 transition-colors " +
                        (shareCopied
                          ? "border-emerald-500/55 bg-emerald-500/[0.12] shadow-[0_0_0_1px_rgba(52,211,153,0.25)]"
                          : "border-white/15 bg-white/5")
                      }
                    >
                      <div
                        className="min-w-0 font-mono text-xs text-white/85"
                        title={
                          shareStatus.url.startsWith("http")
                            ? shareStatus.url
                            : (typeof window !== "undefined" ? window.location.origin : "") + shareStatus.url
                        }
                      >
                        <span className="block min-w-0 truncate whitespace-nowrap">
                          {shareStatus.url.startsWith("http")
                            ? shareStatus.url
                            : (typeof window !== "undefined" ? window.location.origin : "") + shareStatus.url}
                        </span>
                      </div>
                      {shareCopied && (
                        <div
                          className="pointer-events-none absolute inset-0 flex items-center justify-center rounded-[inherit] bg-[#0b0b10]/88 px-2 ring-1 ring-inset ring-emerald-500/35"
                          aria-live="polite"
                        >
                          <span className="text-center text-xs font-semibold text-emerald-300">Ссылка скопирована</span>
                        </div>
                      )}
                    </div>
                  </div>
                ) : (
                  <button
                    type="button"
                    onClick={() => setWarningOpen(true)}
                    disabled={!canExportReport || shareCreating || shareLoading}
                    className="inline-flex rounded-lg border border-white/20 bg-amber-500/12 px-2.5 py-1.5 text-xs font-medium text-amber-200 hover:bg-amber-500/18 disabled:opacity-50"
                  >
                    {shareCreating ? "Создание…" : "Создать открытую ссылку"}
                  </button>
                )}
              </div>
            </div>
          </div>
        </section>

        <section className="relative rounded-2xl border border-white/10 bg-[rgba(10,10,18,0.96)] p-5">
          {reportLoading ? (
            <div className="flex min-h-[280px] items-center justify-center py-12">
              <p className="text-sm text-white/50">Обновление отчёта…</p>
            </div>
          ) : (
            <WeeklyReportContent
              data={{
                period: data.period,
                currency: data.currency,
                summary: data.summary,
                kpis: data.kpis,
                insights_ru: data.insights_ru,
                risks_ru: data.risks_ru,
                actions_ru: data.actions_ru,
                attribution_highlights: data.attribution_highlights,
                risks: data.risks,
                priority_actions: data.priority_actions,
              }}
              showSubtitle={false}
            />
          )}
        </section>
          </div>
        )}

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
    </PlanRestrictedOverlay>
  );
}
