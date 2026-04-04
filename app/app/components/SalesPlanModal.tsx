"use client";

import { useEffect, useState, useMemo } from "react";
import { useBillingBootstrap } from "@/app/app/components/BillingBootstrapProvider";
import { billingActionAllowed } from "@/app/lib/billingBootstrapClient";
import { ActionId } from "@/app/lib/billingUiContract";
import {
  fmtProjectCurrency,
  fmtUsd,
  type ProjectCurrency,
} from "@/app/lib/currency";

export type MonthlyPlan = {
  id?: string;
  project_id: string;
  month: number;
  year: number;
  sales_plan_count: number | null;
  sales_plan_budget: number | null;
  repeat_sales_count: number | null;
  repeat_sales_budget: number | null;
  planned_revenue: number | null;
  primary_avg_check: number | null;
  repeat_avg_check: number | null;
};

const modalOverlay = {
  position: "fixed" as const,
  inset: 0,
  background: "rgba(0,0,0,0.6)",
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
  zIndex: 100,
  padding: 20,
};

const modalPanel = {
  borderRadius: 18,
  border: "1px solid rgba(255,255,255,0.12)",
  background:
    "radial-gradient(800px 360px at 50% 0%, rgba(80,80,140,0.25), transparent 55%), rgba(18,18,24,0.98)",
  boxShadow: "0 24px 80px rgba(0,0,0,0.5)",
  maxWidth: 960,
  width: "100%",
  maxHeight: "90vh",
  overflowY: "auto" as const,
  padding: 0,
};

function toNum(v: unknown): number {
  if (v === null || v === undefined || v === "") return 0;
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}

function normalizeDecimalInput(raw: string): string {
  return raw.replace(",", ".").trim();
}

function formatDecimalForInput(v: unknown, maxDecimals = 6): string {
  if (v === null || v === undefined || v === "") return "";
  const n = Number(v);
  if (!Number.isFinite(n)) return "";
  return n.toFixed(maxDecimals).replace(/\.?0+$/, "");
}

function fmtNum(n: number) {
  return new Intl.NumberFormat("ru-RU").format(Math.round(n));
}

function fmtMoney(n: number, currency: ProjectCurrency, usdToKztRate: number | null) {
  return fmtProjectCurrency(n, currency, usdToKztRate);
}

const kztHintStyle = {
  fontSize: 11,
  color: "rgba(255,255,255,0.5)",
  fontWeight: 400 as const,
  marginTop: 2,
};

export default function SalesPlanModal({
  open,
  onClose,
  projectId,
  month,
  year,
  initialPlan,
  factSpendToYesterday,
  remainingDaysInMonth,
  onSaved,
  planPerformanceState,
  currency,
  usdToKztRate,
}: {
  open: boolean;
  onClose: () => void;
  projectId: string;
  month: number;
  year: number;
  initialPlan: MonthlyPlan | null;
  /** Факт расхода с 1-го числа месяца до вчера (UTC), как в блоке «Сегодня». null — загрузка. */
  factSpendToYesterday?: number | null;
  /** Оставшиеся календарные дни месяца включая сегодня (UTC). */
  remainingDaysInMonth?: number;
  onSaved?: () => void;
  planPerformanceState?: "no_plan" | "on_track" | "behind";
  currency: ProjectCurrency;
  usdToKztRate: number | null;
}) {
  const { resolvedUi } = useBillingBootstrap();
  const canSavePlan = useMemo(
    () => billingActionAllowed(resolvedUi, ActionId.sync_refresh),
    [resolvedUi]
  );
  const [tab, setTab] = useState<"plan" | "forecast">("plan");

  // Inputs — новая логика "от обратного"
  const [salesPlanCount, setSalesPlanCount] = useState<string>("");
  const [salesPlanCac, setSalesPlanCac] = useState<string>("");
  const [primaryAvgCheck, setPrimaryAvgCheck] = useState<string>("");

  const [repeatSalesCount, setRepeatSalesCount] = useState<string>("");
  const [repeatSalesCpr, setRepeatSalesCpr] = useState<string>("");
  const [repeatAvgCheck, setRepeatAvgCheck] = useState<string>("");

  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);

  // Инициализация из существующего плана — мягкая:
  // подтягиваем количества и, если возможно, приблизительный CAC/CPR.
  useEffect(() => {
    if (!open) return;
    setTab("plan");
    const sc = initialPlan?.sales_plan_count ?? null;
    const sb = initialPlan?.sales_plan_budget ?? null;
    const rc = initialPlan?.repeat_sales_count ?? null;
    const rb = initialPlan?.repeat_sales_budget ?? null;

    setSalesPlanCount(sc != null ? String(sc) : "");
    setRepeatSalesCount(rc != null ? String(rc) : "");

    if (sc && sb != null) {
      const approxCac = sc > 0 ? sb / sc : 0;
      setSalesPlanCac(approxCac > 0 ? formatDecimalForInput(approxCac) : "");
    } else {
      setSalesPlanCac("");
    }

    if (rc && rb != null) {
      const approxCpr = rc > 0 ? rb / rc : 0;
      setRepeatSalesCpr(approxCpr > 0 ? formatDecimalForInput(approxCpr) : "");
    } else {
      setRepeatSalesCpr("");
    }

    setPrimaryAvgCheck(initialPlan?.primary_avg_check != null ? formatDecimalForInput(initialPlan.primary_avg_check) : "");
    setRepeatAvgCheck(initialPlan?.repeat_avg_check != null ? formatDecimalForInput(initialPlan.repeat_avg_check) : "");
    setSaveError(null);
  }, [open, initialPlan]);

  // Числовые значения
  const sc = Math.max(0, Math.round(toNum(salesPlanCount)));
  const cac = Math.max(0, toNum(normalizeDecimalInput(salesPlanCac)));
  const primaryAvg = Math.max(0, toNum(normalizeDecimalInput(primaryAvgCheck)));

  const rc = Math.max(0, Math.round(toNum(repeatSalesCount)));
  const cpr = Math.max(0, toNum(normalizeDecimalInput(repeatSalesCpr)));
  const repeatAvg = Math.max(0, toNum(normalizeDecimalInput(repeatAvgCheck)));

  // Автоматические расчёты
  const primaryBudget = sc * cac;
  const primaryRevenue = sc * primaryAvg;

  const repeatBudget = rc * cpr;
  const repeatRevenue = rc * repeatAvg;

  const totalSales = sc + rc;
  const totalBudget = primaryBudget + repeatBudget;
  const totalRevenue = primaryRevenue + repeatRevenue;
  const roas = totalBudget > 0 ? totalRevenue / totalBudget : 0;

  const summary = useMemo(
    () => ({
      totalSales,
      primaryBudget,
      repeatBudget,
      totalBudget,
      primaryRevenue,
      repeatRevenue,
      totalRevenue,
      cac,
      cpr,
      roas,
    }),
    [
      totalSales,
      primaryBudget,
      repeatBudget,
      totalBudget,
      primaryRevenue,
      repeatRevenue,
      totalRevenue,
      cac,
      cpr,
      roas,
    ]
  );

  async function handleSave() {
    if (!canSavePlan) {
      setSaveError("Действие недоступно при текущем статусе подписки");
      return;
    }
    setSaving(true);
    setSaveError(null);
    try {
      const res = await fetch("/api/project-monthly-plans", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          project_id: projectId,
          month,
          year,
          sales_plan_count: salesPlanCount === "" ? null : sc,
          sales_plan_budget: primaryBudget > 0 ? primaryBudget : null,
          repeat_sales_count: repeatSalesCount === "" ? null : rc,
          repeat_sales_budget: repeatBudget > 0 ? repeatBudget : null,
          planned_revenue: totalRevenue > 0 ? totalRevenue : null,
          primary_avg_check: primaryAvgCheck === "" ? null : primaryAvg,
          repeat_avg_check: repeatAvgCheck === "" ? null : repeatAvg,
        }),
      });
      const json = await res.json();
      if (!res.ok) {
        setSaveError(json?.error ?? "Ошибка сохранения");
        return;
      }
      onSaved?.();
      onClose();
    } catch (e) {
      setSaveError(e instanceof Error ? e.message : "Ошибка сохранения");
    } finally {
      setSaving(false);
    }
  }

  if (!open) return null;

  const monthName = new Date(year, month - 1, 1).toLocaleDateString("ru-RU", {
    month: "long",
    year: "numeric",
  });

  return (
    <div
      style={modalOverlay}
      onClick={(e) => e.target === e.currentTarget && onClose()}
      role="dialog"
      aria-modal="true"
      aria-labelledby="sales-plan-modal-title"
    >
      <div className="scrollbar-hidden" style={modalPanel} onClick={(e) => e.stopPropagation()}>
        <div
          style={{
            position: "sticky",
            top: 0,
            zIndex: 5,
            minHeight: 68,
            padding: "12px 28px",
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            background:
              "linear-gradient(to bottom, rgba(18,18,24,0.98), rgba(18,18,24,0.94))",
            borderBottom: "1px solid rgba(255,255,255,0.08)",
          }}
        >
          <h2
            id="sales-plan-modal-title"
            style={{
              margin: 0,
              fontSize: 22,
              fontWeight: 800,
              color: "white",
            }}
          >
            План на {monthName}
          </h2>
          <button
            type="button"
            onClick={onClose}
            aria-label="Закрыть"
            title="Закрыть"
            style={{
              width: 32,
              height: 32,
              borderRadius: 10,
              border: "1px solid rgba(255,255,255,0.18)",
              background: "rgba(255,255,255,0.06)",
              color: "rgba(255,255,255,0.92)",
              cursor: "pointer",
              display: "inline-flex",
              alignItems: "center",
              justifyContent: "center",
              padding: 0,
            }}
          >
            <svg
              width="14"
              height="14"
              viewBox="0 0 14 14"
              aria-hidden="true"
              focusable="false"
              style={{ display: "block" }}
            >
              <path
                d="M2 2 L12 12 M12 2 L2 12"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
              />
            </svg>
          </button>
        </div>

        <div style={{ padding: "10px 28px 28px 28px" }}>
        {/* Tabs */}
        <div
          style={{
            display: "flex",
            gap: 4,
            marginBottom: 20,
            borderBottom: "1px solid rgba(255,255,255,0.1)",
            paddingBottom: 12,
          }}
        >
          <button
            type="button"
            onClick={() => setTab("plan")}
            style={{
              padding: "8px 14px",
              borderRadius: 10,
              border: "none",
              background: tab === "plan" ? "rgba(255,255,255,0.12)" : "transparent",
              color: tab === "plan" ? "white" : "rgba(255,255,255,0.7)",
              fontWeight: 600,
              fontSize: 13,
              cursor: "pointer",
            }}
          >
            План продаж
          </button>
          <button
            type="button"
            disabled
            style={{
              padding: "8px 14px",
              borderRadius: 10,
              border: "none",
              background: "transparent",
              color: "rgba(255,255,255,0.4)",
              fontWeight: 600,
              fontSize: 13,
              cursor: "not-allowed",
            }}
            title="Скоро"
          >
            Прогноз
          </button>
        </div>

        {tab === "plan" && (
          <>
            <div
              style={{
                marginBottom: 12,
                padding: "10px 12px",
                borderRadius: 10,
                border: "1px solid rgba(239,68,68,0.5)",
                background: "rgba(239,68,68,0.12)",
                fontSize: 12,
                color: "rgba(254,226,226,0.95)",
              }}
            >
              Все значения плана вводятся в долларах США (USD), независимо от валюты отображения
              проекта.
            </div>

            <div
              style={{
                display: "grid",
                gridTemplateColumns: "minmax(0, 1.7fr) minmax(0, 1.3fr)",
                gap: 20,
                alignItems: "flex-start",
              }}
            >
              {/* Левая колонка — ввод плана */}
              <div style={{ display: "grid", gap: 20 }}>
                {/* Первичные продажи */}
                <div>
                  <div
                    style={{
                      fontSize: 12,
                      fontWeight: 700,
                      color: "rgba(255,255,255,0.6)",
                      marginBottom: 10,
                      textTransform: "uppercase",
                      letterSpacing: "0.04em",
                    }}
                  >
                    Первичные продажи
                  </div>
                  <div style={{ display: "grid", gap: 10 }}>
                    <label style={{ display: "grid", gap: 4 }}>
                      <span style={{ fontSize: 13, color: "rgba(255,255,255,0.85)" }}>
                        План продаж (кол-во)
                      </span>
                      <input
                        type="number"
                        min={0}
                        value={salesPlanCount}
                        onChange={(e) => setSalesPlanCount(e.target.value)}
                        style={{
                          padding: "10px 12px",
                          borderRadius: 10,
                          border: "1px solid rgba(255,255,255,0.15)",
                          background: "rgba(255,255,255,0.05)",
                          color: "white",
                          fontSize: 14,
                        }}
                      />
                    </label>
                    <label style={{ display: "grid", gap: 4 }}>
                      <span style={{ fontSize: 13, color: "rgba(255,255,255,0.85)" }}>CAC</span>
                      <input
                        type="number"
                        min={0}
                        step="any"
                        value={salesPlanCac}
                        onChange={(e) => setSalesPlanCac(normalizeDecimalInput(e.target.value))}
                        style={{
                          padding: "10px 12px",
                          borderRadius: 10,
                          border: "1px solid rgba(255,255,255,0.15)",
                          background: "rgba(255,255,255,0.05)",
                          color: "white",
                          fontSize: 14,
                        }}
                      />
                      {currency === "KZT" && usdToKztRate && cac > 0 && (
                        <span style={kztHintStyle}>≈ {fmtProjectCurrency(cac, "KZT", usdToKztRate)}</span>
                      )}
                    </label>
                    <label style={{ display: "grid", gap: 4 }}>
                      <span style={{ fontSize: 13, color: "rgba(255,255,255,0.85)" }}>
                        Средний чек первичной продажи
                      </span>
                      <input
                        type="number"
                        min={0}
                        step="any"
                        value={primaryAvgCheck}
                        onChange={(e) => setPrimaryAvgCheck(normalizeDecimalInput(e.target.value))}
                        style={{
                          padding: "10px 12px",
                          borderRadius: 10,
                          border: "1px solid rgba(255,255,255,0.15)",
                          background: "rgba(255,255,255,0.05)",
                          color: "white",
                          fontSize: 14,
                        }}
                      />
                      {currency === "KZT" && usdToKztRate && primaryAvg > 0 && (
                        <span style={kztHintStyle}>≈ {fmtProjectCurrency(primaryAvg, "KZT", usdToKztRate)}</span>
                      )}
                    </label>
                    <div
                      style={{
                        marginTop: 6,
                        fontSize: 12,
                        color: "rgba(255,255,255,0.6)",
                        display: "grid",
                        gap: 4,
                      }}
                    >
                      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start" }}>
                        <span>Бюджет первичных продаж</span>
                        <span style={{ fontWeight: 700, color: "white", display: "flex", flexDirection: "column", alignItems: "flex-end" }}>
                          {primaryBudget > 0 ? (
                            <>
                              {fmtMoney(primaryBudget, currency, usdToKztRate)}
                              {currency === "KZT" && usdToKztRate && (
                                <span style={kztHintStyle}>≈ {fmtUsd(primaryBudget)}</span>
                              )}
                            </>
                          ) : "—"}
                        </span>
                      </div>
                      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start" }}>
                        <span>Выручка первичных продаж</span>
                        <span style={{ fontWeight: 700, color: "white", display: "flex", flexDirection: "column", alignItems: "flex-end" }}>
                          {primaryRevenue > 0 ? (
                            <>
                              {fmtMoney(primaryRevenue, currency, usdToKztRate)}
                              {currency === "KZT" && usdToKztRate && (
                                <span style={kztHintStyle}>≈ {fmtUsd(primaryRevenue)}</span>
                              )}
                            </>
                          ) : "—"}
                        </span>
                      </div>
                    </div>
                  </div>
                </div>

                {/* Повторные продажи */}
                <div>
                  <div
                    style={{
                      fontSize: 12,
                      fontWeight: 700,
                      color: "rgba(255,255,255,0.6)",
                      marginBottom: 10,
                      textTransform: "uppercase",
                      letterSpacing: "0.04em",
                    }}
                  >
                    Повторные продажи
                  </div>
                  <div style={{ display: "grid", gap: 10 }}>
                    <label style={{ display: "grid", gap: 4 }}>
                      <span style={{ fontSize: 13, color: "rgba(255,255,255,0.85)" }}>
                        Повторные продажи (кол-во)
                      </span>
                      <input
                        type="number"
                        min={0}
                        value={repeatSalesCount}
                        onChange={(e) => setRepeatSalesCount(e.target.value)}
                        style={{
                          padding: "10px 12px",
                          borderRadius: 10,
                          border: "1px solid rgba(255,255,255,0.15)",
                          background: "rgba(255,255,255,0.05)",
                          color: "white",
                          fontSize: 14,
                        }}
                      />
                    </label>
                    <label style={{ display: "grid", gap: 4 }}>
                      <span style={{ fontSize: 13, color: "rgba(255,255,255,0.85)" }}>CPR</span>
                      <input
                        type="number"
                        min={0}
                        step="any"
                        value={repeatSalesCpr}
                        onChange={(e) => setRepeatSalesCpr(normalizeDecimalInput(e.target.value))}
                        style={{
                          padding: "10px 12px",
                          borderRadius: 10,
                          border: "1px solid rgba(255,255,255,0.15)",
                          background: "rgba(255,255,255,0.05)",
                          color: "white",
                          fontSize: 14,
                        }}
                      />
                      {currency === "KZT" && usdToKztRate && cpr > 0 && (
                        <span style={kztHintStyle}>≈ {fmtProjectCurrency(cpr, "KZT", usdToKztRate)}</span>
                      )}
                    </label>
                    <label style={{ display: "grid", gap: 4 }}>
                      <span style={{ fontSize: 13, color: "rgba(255,255,255,0.85)" }}>
                        Средний чек повторной продажи
                      </span>
                      <input
                        type="number"
                        min={0}
                        step="any"
                        value={repeatAvgCheck}
                        onChange={(e) => setRepeatAvgCheck(normalizeDecimalInput(e.target.value))}
                        style={{
                          padding: "10px 12px",
                          borderRadius: 10,
                          border: "1px solid rgba(255,255,255,0.15)",
                          background: "rgba(255,255,255,0.05)",
                          color: "white",
                          fontSize: 14,
                        }}
                      />
                      {currency === "KZT" && usdToKztRate && repeatAvg > 0 && (
                        <span style={kztHintStyle}>≈ {fmtProjectCurrency(repeatAvg, "KZT", usdToKztRate)}</span>
                      )}
                    </label>
                    <div
                      style={{
                        marginTop: 6,
                        fontSize: 12,
                        color: "rgba(255,255,255,0.6)",
                        display: "grid",
                        gap: 4,
                      }}
                    >
                      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start" }}>
                        <span>Бюджет повторных продаж</span>
                        <span style={{ fontWeight: 700, color: "white", display: "flex", flexDirection: "column", alignItems: "flex-end" }}>
                          {repeatBudget > 0 ? (
                            <>
                              {fmtMoney(repeatBudget, currency, usdToKztRate)}
                              {currency === "KZT" && usdToKztRate && (
                                <span style={kztHintStyle}>≈ {fmtUsd(repeatBudget)}</span>
                              )}
                            </>
                          ) : "—"}
                        </span>
                      </div>
                      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start" }}>
                        <span>Выручка повторных продаж</span>
                        <span style={{ fontWeight: 700, color: "white", display: "flex", flexDirection: "column", alignItems: "flex-end" }}>
                          {repeatRevenue > 0 ? (
                            <>
                              {fmtMoney(repeatRevenue, currency, usdToKztRate)}
                              {currency === "KZT" && usdToKztRate && (
                                <span style={kztHintStyle}>≈ {fmtUsd(repeatRevenue)}</span>
                              )}
                            </>
                          ) : "—"}
                        </span>
                      </div>
                    </div>
                  </div>
                </div>
              </div>

              {/* Правая колонка — сводка (marginTop выровнен по верхней границе первого input слева) */}
              <div style={{ display: "grid", gap: 12, alignSelf: "flex-start", marginTop: 44 }}>
                <div
                  style={{
                    borderRadius: 18,
                    border: "1px solid rgba(255,255,255,0.16)",
                    background:
                      "radial-gradient(340px 220px at 0% 0%, rgba(120,120,255,0.24), transparent 55%), rgba(10,10,18,0.98)",
                    padding: 16,
                    display: "grid",
                    gap: 10,
                  }}
                >
                  <div
                    style={{
                      fontSize: 13,
                      fontWeight: 700,
                      letterSpacing: "0.04em",
                      textTransform: "uppercase",
                      color: "rgba(255,255,255,0.7)",
                      marginBottom: 4,
                    }}
                  >
                    Итоги месяца
                  </div>

                  <div
                    style={{
                      display: "flex",
                      justifyContent: "space-between",
                      fontSize: 13,
                      color: "rgba(255,255,255,0.85)",
                    }}
                  >
                    <span>Всего продаж</span>
                    <span style={{ fontWeight: 700, color: "white" }}>
                      {summary.totalSales > 0 ? fmtNum(summary.totalSales) : "—"}
                    </span>
                  </div>

                  <div
                    style={{
                      display: "flex",
                      justifyContent: "space-between",
                      fontSize: 13,
                      color: "rgba(255,255,255,0.85)",
                    }}
                  >
                    <span>Общий бюджет</span>
                    <span style={{ fontWeight: 700, color: "white" }}>
                      {summary.totalBudget > 0
                        ? fmtMoney(summary.totalBudget, currency, usdToKztRate)
                        : "—"}
                    </span>
                  </div>

                  {(() => {
                    const daysInMonth = new Date(year, month, 0).getDate();
                    const now = new Date();
                    const isCurrentMonthUtc =
                      year === now.getUTCFullYear() && month === now.getUTCMonth() + 1;
                    const remainingDays =
                      remainingDaysInMonth ??
                      (isCurrentMonthUtc
                        ? Math.max(1, daysInMonth - Math.max(0, now.getUTCDate() - 1))
                        : Math.max(1, daysInMonth));
                    const spendFactLoaded = typeof factSpendToYesterday === "number";
                    const useCatchUp =
                      isCurrentMonthUtc && initialPlan != null && spendFactLoaded;
                    const remainingBudget = Math.max(
                      0,
                      summary.totalBudget -
                        (useCatchUp && typeof factSpendToYesterday === "number"
                          ? factSpendToYesterday
                          : 0)
                    );
                    const dailyBudgetPlan: number | null =
                      summary.totalBudget > 0 && daysInMonth > 0
                        ? useCatchUp
                          ? remainingBudget / remainingDays
                          : !isCurrentMonthUtc ||
                              initialPlan == null ||
                              factSpendToYesterday === undefined
                            ? summary.totalBudget / daysInMonth
                            : null
                        : null;
                    const showLoading =
                      isCurrentMonthUtc && initialPlan != null && factSpendToYesterday === null;
                    return (
                      <div
                        style={{
                          display: "flex",
                          justifyContent: "space-between",
                          fontSize: 13,
                          color: "rgba(255,255,255,0.85)",
                        }}
                      >
                        <span>Дневной план (остаток / дни)</span>
                        <span style={{ fontWeight: 700, color: "white" }}>
                          {summary.totalBudget <= 0
                            ? "—"
                            : showLoading
                              ? "…"
                              : dailyBudgetPlan != null
                                ? fmtMoney(dailyBudgetPlan, currency, usdToKztRate)
                                : "—"}
                        </span>
                      </div>
                    );
                  })()}

                  <div
                    style={{
                      display: "flex",
                      justifyContent: "space-between",
                      fontSize: 13,
                      color: "rgba(255,255,255,0.85)",
                    }}
                  >
                    <span>Общая выручка</span>
                    <span style={{ fontWeight: 700, color: "white" }}>
                      {summary.totalRevenue > 0
                        ? fmtMoney(summary.totalRevenue, currency, usdToKztRate)
                        : "—"}
                    </span>
                  </div>

                  <div
                    style={{
                      display: "flex",
                      justifyContent: "space-between",
                      fontSize: 13,
                      color: "rgba(255,255,255,0.85)",
                    }}
                  >
                    <span>ROAS</span>
                    <span style={{ fontWeight: 700, color: "white" }}>
                      {summary.totalBudget > 0
                        ? summary.roas.toFixed(2).replace(".", ",")
                        : "—"}
                    </span>
                  </div>

                  <div
                    style={{
                      marginTop: 6,
                      paddingTop: 8,
                      borderTop: "1px solid rgba(255,255,255,0.12)",
                      display: "grid",
                      gap: 4,
                      fontSize: 12,
                      color: "rgba(255,255,255,0.8)",
                    }}
                  >
                    <div style={{ display: "flex", justifyContent: "space-between" }}>
                      <span>CAC (первичные)</span>
                      <span style={{ fontWeight: 700, color: "white" }}>
                        {sc > 0 && cac > 0 ? fmtMoney(cac, currency, usdToKztRate) : "—"}
                      </span>
                    </div>
                    <div style={{ display: "flex", justifyContent: "space-between" }}>
                      <span>CPR (повторные)</span>
                      <span style={{ fontWeight: 700, color: "white" }}>
                        {rc > 0 && cpr > 0 ? fmtMoney(cpr, currency, usdToKztRate) : "—"}
                      </span>
                    </div>
                  </div>
                </div>

                {/* Статус плана */}
                <div
                  style={{
                    borderRadius: 16,
                    border: "1px solid rgba(255,255,255,0.16)",
                    background: "rgba(10,10,18,0.96)",
                    padding: 14,
                    display: "grid",
                    gap: 6,
                    fontSize: 13,
                    color: "rgba(255,255,255,0.86)",
                  }}
                >
                  <div
                    style={{
                      fontSize: 12,
                      fontWeight: 700,
                      letterSpacing: "0.04em",
                      textTransform: "uppercase",
                      color: "rgba(255,255,255,0.7)",
                    }}
                  >
                    Статус плана
                  </div>
                  <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                    <span>
                      {planPerformanceState === "no_plan"
                        ? "🔴 План не задан"
                        : planPerformanceState === "on_track"
                          ? "🟢 План выполняется"
                          : "🟡 План отстаёт"}
                    </span>
                  </div>
                </div>

                {/* Контрольные метрики */}
                <div
                  style={{
                    borderRadius: 16,
                    border: "1px solid rgba(255,255,255,0.16)",
                    background: "rgba(10,10,18,0.96)",
                    padding: 14,
                    display: "grid",
                    gap: 6,
                    fontSize: 13,
                    color: "rgba(255,255,255,0.86)",
                  }}
                >
                  <div
                    style={{
                      fontSize: 12,
                      fontWeight: 700,
                      letterSpacing: "0.04em",
                      textTransform: "uppercase",
                      color: "rgba(255,255,255,0.7)",
                    }}
                  >
                    Контрольные метрики
                  </div>
                  <div style={{ display: "flex", justifyContent: "space-between" }}>
                    <span>Blended CAC</span>
                    <span style={{ fontWeight: 700 }}>
                      {summary.totalSales > 0 && summary.totalBudget > 0
                        ? fmtMoney(summary.totalBudget / summary.totalSales, currency, usdToKztRate)
                        : "—"}
                    </span>
                  </div>
                  <div style={{ display: "flex", justifyContent: "space-between" }}>
                    <span>CPR (повторные)</span>
                    <span style={{ fontWeight: 700 }}>
                      {rc > 0 && cpr > 0 ? fmtMoney(cpr, currency, usdToKztRate) : "—"}
                    </span>
                  </div>
                  <div style={{ display: "flex", justifyContent: "space-between" }}>
                    <span>Доля повторных продаж</span>
                    <span style={{ fontWeight: 700 }}>
                      {summary.totalSales > 0
                        ? `${((rc / summary.totalSales) * 100).toFixed(1).replace(".", ",")}%`
                        : "—"}
                    </span>
                  </div>
                </div>

                {/* Кнопки действия — под правой колонкой, под блоком "Контрольные метрики" */}
                <div
                  style={{
                    display: "flex",
                    gap: 10,
                    justifyContent: "flex-end",
                    marginTop: 30,
                    paddingTop: 4,
                  }}
                >
                  <button
                    type="button"
                    onClick={onClose}
                    style={{
                      padding: "10px 18px",
                      borderRadius: 10,
                      border: "1px solid rgba(255,255,255,0.2)",
                      background: "transparent",
                      color: "rgba(255,255,255,0.9)",
                      fontWeight: 600,
                      fontSize: 14,
                      cursor: "pointer",
                    }}
                  >
                    Отмена
                  </button>
                  <button
                    type="button"
                    onClick={handleSave}
                    disabled={!canSavePlan || saving}
                    style={{
                      padding: "10px 18px",
                      borderRadius: 10,
                      border: "none",
                      background: "rgba(120,120,255,0.35)",
                      color: "white",
                      fontWeight: 600,
                      fontSize: 14,
                      cursor: saving ? "wait" : "pointer",
                    }}
                  >
                    {saving ? "Сохранение…" : "Сохранить"}
                  </button>
                </div>
              </div>
            </div>

            {saveError && (
              <div
                style={{
                  marginTop: 16,
                  marginBottom: 12,
                  padding: "10px 12px",
                  borderRadius: 10,
                  background: "rgba(220,38,38,0.15)",
                  border: "1px solid rgba(220,38,38,0.35)",
                  color: "rgba(255,200,200,0.95)",
                  fontSize: 13,
                }}
              >
                {saveError}
              </div>
            )}
          </>
        )}
        </div>
      </div>
    </div>
  );
}

