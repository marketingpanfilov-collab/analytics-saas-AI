"use client";

import Link from "next/link";
import { usePathname, useSearchParams, useRouter } from "next/navigation";
import { useMemo, useState, useEffect, useCallback, useRef } from "react";
import { createPortal } from "react-dom";
import { acquireBodyScrollLock } from "@/app/lib/bodyScrollLock";
import { setActiveProjectId } from "@/app/lib/activeProjectClient";
import SalesPlanModal, { type MonthlyPlan } from "./SalesPlanModal";
import { type ProjectCurrency } from "@/app/lib/currency";
import {
  SidebarTodayPanel,
  MetricRow,
  type Metric,
  type TodayPlanState,
} from "./SidebarTodayPanel";
import { SIDEBAR_TODAY_REFRESH_EVENT } from "@/app/lib/sidebarTodayRefreshEvent";
import { getSharedCached } from "@/app/lib/sharedDataCache";
import { POST_REFRESH_GUARD_MS, REFRESH_BASELINE_SESSION_KEY } from "@/app/lib/refreshOrchestration";
import { useBillingBootstrap } from "@/app/app/components/BillingBootstrapProvider";
import { useOptionalAppMobileNav } from "@/app/app/components/AppMobileNavContext";
import { billingActionAllowed } from "@/app/lib/billingBootstrapClient";
import { ActionId } from "@/app/lib/billingUiContract";

type ProjectItem = { id: string; name: string | null; organization_id: string | null };

const itemStyle = (active: boolean) => ({
  display: "block",
  padding: "10px 12px",
  borderRadius: 10,
  textDecoration: "none",
  color: "white",
  background: active ? "rgba(255,255,255,0.10)" : "transparent",
  border: active ? "1px solid rgba(255,255,255,0.10)" : "1px solid transparent",
});

function safeGetProjectIdFromStorage() {
  try {
    return localStorage.getItem("active_project_id");
  } catch {
    return null;
  }
}
function safeSetProjectIdToStorage(v: string) {
  try {
    localStorage.setItem("active_project_id", v);
  } catch {}
}

function ymdUtc(date: Date): string {
  return date.toISOString().slice(0, 10);
}

function utcDateFromYmd(ymd: string): Date {
  const [y, m, d] = ymd.split("-").map(Number);
  return new Date(Date.UTC(y, (m ?? 1) - 1, d ?? 1, 0, 0, 0, 0));
}

function todayYmdUtc() {
  return ymdUtc(new Date());
}

function monthStartYmdUtc(now: Date) {
  return ymdUtc(new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1, 0, 0, 0, 0)));
}

function yesterdayYmdUtc(todayYmd: string) {
  const d = utcDateFromYmd(todayYmd);
  d.setUTCDate(d.getUTCDate() - 1);
  return ymdUtc(d);
}


export default function Sidebar() {
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const router = useRouter();
  const { resolvedUi } = useBillingBootstrap();
  const mobileNav = useOptionalAppMobileNav();
  const mobileNavRef = useRef(mobileNav);
  mobileNavRef.current = mobileNav;

  const [todayOpen, setTodayOpen] = useState(false);
  const [todayMetricsFrameOpen, setTodayMetricsFrameOpen] = useState(false);
  /** Сразу из query, чтобы первый fetch (план месяца и т.д.) не шёл с null на /app/settings?project_id=… */
  const [projectId, setProjectId] = useState<string | null>(() => searchParams.get("project_id")?.trim() ?? null);
  const [todaySpend, setTodaySpend] = useState<number | null>(null);
  const [projects, setProjects] = useState<ProjectItem[]>([]);
  const [projectsLoading, setProjectsLoading] = useState(true);
  const [switcherOpen, setSwitcherOpen] = useState(false);
  const switcherRef = useRef<HTMLDivElement>(null);
  const [canEditPlan, setCanEditPlan] = useState(false);
  const [currentMonthPlan, setCurrentMonthPlan] = useState<MonthlyPlan | null>(null);
  const [planModalOpen, setPlanModalOpen] = useState(false);
  const [factSalesThisMonth, setFactSalesThisMonth] = useState<number | null>(null);
  const [factSalesToday, setFactSalesToday] = useState<number | null>(null);
  const [todayRevenue, setTodayRevenue] = useState<number | null>(null);
  const [factSalesToYesterday, setFactSalesToYesterday] = useState<number | null>(null);
  const [factSpendToYesterday, setFactSpendToYesterday] = useState<number | null>(null);
  const [projectCurrency, setProjectCurrency] = useState<ProjectCurrency>("USD");
  const [usdToKztRate, setUsdToKztRate] = useState<number | null>(null);
  const todayUtc = useMemo(() => todayYmdUtc(), []);
  const yesterdayUtc = useMemo(() => yesterdayYmdUtc(todayYmdUtc()), []);
  const monthStartUtc = useMemo(() => monthStartYmdUtc(new Date()), []);

  useEffect(() => {
    const fromUrl = searchParams.get("project_id");
    const isProjectSelectionPage = pathname === "/app/projects" || pathname.startsWith("/app/projects/");
    if (fromUrl) {
      setProjectId(fromUrl);
      safeSetProjectIdToStorage(fromUrl);
      return;
    }
    if (isProjectSelectionPage) {
      setProjectId(null);
      return;
    }
    const fromStore = safeGetProjectIdFromStorage();
    if (fromStore) setProjectId(fromStore);
  }, [pathname, searchParams]);

  /* Только при смене маршрута. Не завязывать на mobileNav из контекста — объект пересоздаётся при todayDrawerOpen и мгновенно закрывал drawer. */
  useEffect(() => {
    mobileNavRef.current?.setMobileNavOpen(false);
    mobileNavRef.current?.setTodayDrawerOpen(false);
  }, [pathname]);

  useEffect(() => {
    let mounted = true;
    (async () => {
      try {
        const res = await getSharedCached("projects:list", () => fetch("/api/projects", { cache: "no-store" }), {
          ttlMs: 90_000,
        });
        const json = (await res.json()) as {
          success?: boolean;
          projects?: ProjectItem[];
        };
        if (mounted && json?.success && Array.isArray(json.projects)) {
          setProjects(json.projects);
        }
      } catch {
        if (mounted) setProjects([]);
      } finally {
        if (mounted) setProjectsLoading(false);
      }
    })();
    return () => {
      mounted = false;
    };
  }, []);

  useEffect(() => {
    if (!projectId) return;
    let mounted = true;
    (async () => {
      try {
        const res = await getSharedCached(
          `projects-currency:${projectId}`,
          () =>
            fetch(`/api/projects/currency?project_id=${encodeURIComponent(projectId)}`, {
              cache: "no-store",
            }),
          { ttlMs: 120_000 }
        );
        const json = await res.json();
        if (!mounted) return;
        if (res.ok && json?.success && typeof json.currency === "string") {
          const curr = json.currency.toUpperCase();
          if (curr === "KZT" || curr === "USD") {
            setProjectCurrency(curr);
          }
        }
      } catch {
        // ignore, keep default USD
      }
    })();
    return () => {
      mounted = false;
    };
  }, [projectId]);

  useEffect(() => {
    if (projectCurrency !== "KZT") {
      setUsdToKztRate(null);
      return;
    }
    let mounted = true;
    (async () => {
      try {
        if (!billingActionAllowed(resolvedUi, ActionId.sync_refresh)) return;
        const res = await fetch("/api/system/update-rates", { method: "POST" });
        const json = await res.json();
        if (!mounted) return;
        const rate = Number(json?.rate ?? 0);
        if (res.ok && json?.success && rate > 0) {
          setUsdToKztRate(rate);
        } else {
          setUsdToKztRate(null);
        }
      } catch {
        if (mounted) setUsdToKztRate(null);
      }
    })();
    return () => {
      mounted = false;
    };
  }, [projectCurrency, resolvedUi]);

  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (switcherRef.current && !switcherRef.current.contains(e.target as Node)) {
        setSwitcherOpen(false);
      }
    };
    if (switcherOpen) {
      document.addEventListener("mousedown", handleClickOutside);
      return () => document.removeEventListener("mousedown", handleClickOutside);
    }
  }, [switcherOpen]);

  const fetchTodaySpend = useCallback(async () => {
    if (!projectId) {
      setTodaySpend(null);
      return;
    }
    try {
      const res = await fetch(
        `/api/dashboard/summary?project_id=${encodeURIComponent(projectId)}&start=${todayUtc}&end=${todayUtc}`,
        { cache: "no-store" }
      );
      const json = (await res.json()) as { success?: boolean; totals?: { spend?: number } };
      if (json?.success && json?.totals) {
        const spend = Number(json.totals.spend ?? 0) || 0;
        setTodaySpend(spend);
      } else {
        setTodaySpend(null);
      }
    } catch {
      setTodaySpend(null);
    }
  }, [projectId, todayUtc]);

  const fetchSpendRange = useCallback(
    async (start: string, end: string): Promise<number | null> => {
      if (!projectId) return null;
      try {
        const res = await fetch(
          `/api/dashboard/summary?project_id=${encodeURIComponent(projectId)}&start=${start}&end=${end}`,
          { cache: "no-store" }
        );
        const json = (await res.json()) as { success?: boolean; totals?: { spend?: number } };
        if (json?.success && json?.totals) return Number(json.totals.spend ?? 0) || 0;
        return null;
      } catch {
        return null;
      }
    },
    [projectId]
  );

  const fetchSalesRange = useCallback(
    async (start: string, end: string): Promise<number | null> => {
      if (!projectId) return null;
      try {
        const res = await fetch(
          `/api/dashboard/timeseries-conversions?project_id=${encodeURIComponent(projectId)}&start=${start}&end=${end}`,
          { cache: "no-store" }
        );
        const json = (await res.json()) as { success?: boolean; points?: { sales?: number }[] };
        if (json?.success && Array.isArray(json.points)) {
          return json.points.reduce((s, p) => s + (Number(p.sales ?? 0) || 0), 0);
        }
        return null;
      } catch {
        return null;
      }
    },
    [projectId]
  );

  const fetchCurrentMonthPlan = useCallback(async () => {
    if (!projectId) {
      setCurrentMonthPlan(null);
      setCanEditPlan(false);
      console.log("[Sidebar fetchCurrentMonthPlan] no projectId, set canEditPlan=false");
      return;
    }
    const now = new Date();
    const month = now.getMonth() + 1;
    const year = now.getFullYear();
    try {
      const res = await fetch(
        `/api/project-monthly-plans?project_id=${encodeURIComponent(projectId)}&month=${month}&year=${year}`,
        { cache: "no-store" }
      );
      const json = (await res.json()) as {
        success?: boolean;
        plan?: MonthlyPlan | null;
        canEdit?: boolean;
      };
      if (json?.success) {
        // DEBUG: canEditPlan is set ONLY from GET /api/project-monthly-plans response (json.canEdit)
        if (typeof json.canEdit === "boolean") {
          setCanEditPlan(json.canEdit);
        }
        if (json.plan) {
          setCurrentMonthPlan({
            ...json.plan,
            project_id: projectId,
            month,
            year,
          });
        } else {
          setCurrentMonthPlan(null);
        }
      } else {
        setCurrentMonthPlan(null);
        // DEBUG: success: false — canEditPlan not updated, stays previous value
        console.log("[Sidebar fetchCurrentMonthPlan] success: false", { projectId, json });
      }
      // DEBUG: log raw API response to verify canEdit and success
      console.log("[Sidebar fetchCurrentMonthPlan] response", {
        projectId,
        success: json?.success,
        canEdit: json?.canEdit,
        hasPlan: !!json?.plan,
      });
    } catch (err) {
      setCurrentMonthPlan(null);
      // DEBUG: if API fails, canEditPlan is never set from response (stays false or previous)
      console.log("[Sidebar fetchCurrentMonthPlan] catch", { projectId, err });
    }
  }, [projectId]);

  useEffect(() => {
    fetchCurrentMonthPlan();
  }, [fetchCurrentMonthPlan]);

  const fetchFactSalesThisMonth = useCallback(async () => {
    if (!projectId) {
      setFactSalesThisMonth(null);
      return;
    }
    const total = await fetchSalesRange(monthStartUtc, todayUtc);
    setFactSalesThisMonth(total);
  }, [projectId, fetchSalesRange, monthStartUtc, todayUtc]);

  useEffect(() => {
    if (!projectId || !currentMonthPlan) {
      setFactSalesThisMonth(null);
      return;
    }
    fetchFactSalesThisMonth();
  }, [projectId, currentMonthPlan, fetchFactSalesThisMonth]);

  const fetchFactSalesToday = useCallback(async () => {
    if (!projectId) {
      setFactSalesToday(null);
      return;
    }
    const total = await fetchSalesRange(todayUtc, todayUtc);
    setFactSalesToday(total);
  }, [projectId, fetchSalesRange, todayUtc]);

  const fetchTodayKpi = useCallback(async () => {
    if (!projectId) {
      setTodayRevenue(null);
      return;
    }
    try {
      const res = await fetch(
        `/api/dashboard/kpi?project_id=${encodeURIComponent(projectId)}&start=${todayUtc}&end=${todayUtc}`,
        { cache: "no-store" }
      );
      const json = (await res.json()) as { success?: boolean; sales?: number; revenue?: number };
      if (json?.success) {
        setTodayRevenue(Number(json.revenue ?? 0) || 0);
        // Keep sales fact consistent with the same KPI source if it is available.
        if (typeof json.sales === "number") {
          setFactSalesToday(Number(json.sales) || 0);
        }
      } else {
        setTodayRevenue(null);
      }
    } catch {
      setTodayRevenue(null);
    }
  }, [projectId, todayUtc]);

  const fetchFactToYesterday = useCallback(async () => {
    if (!projectId) {
      setFactSalesToYesterday(null);
      setFactSpendToYesterday(null);
      return;
    }
    const yesterdayDate = utcDateFromYmd(yesterdayUtc);
    const monthStartDate = utcDateFromYmd(monthStartUtc);
    if (yesterdayDate < monthStartDate) {
      setFactSalesToYesterday(0);
      setFactSpendToYesterday(0);
      return;
    }
    const [sales, spend] = await Promise.all([
      fetchSalesRange(monthStartUtc, yesterdayUtc),
      fetchSpendRange(monthStartUtc, yesterdayUtc),
    ]);
    setFactSalesToYesterday(sales);
    setFactSpendToYesterday(spend);
  }, [projectId, yesterdayUtc, monthStartUtc, fetchSalesRange, fetchSpendRange]);

  useEffect(() => {
    if (!projectId || !currentMonthPlan) {
      setFactSalesToday(null);
      setTodayRevenue(null);
      return;
    }
    fetchFactSalesToday();
    fetchTodayKpi();
  }, [projectId, currentMonthPlan, fetchFactSalesToday, fetchTodayKpi]);

  useEffect(() => {
    if (!projectId || !currentMonthPlan) {
      setFactSalesToYesterday(null);
      setFactSpendToYesterday(null);
      return;
    }
    fetchFactToYesterday();
  }, [projectId, currentMonthPlan, fetchFactToYesterday]);

  const refreshTodayWidget = useCallback(async () => {
    const tasks: Promise<unknown>[] = [fetchTodaySpend()];
    if (currentMonthPlan) {
      tasks.push(fetchFactSalesToday(), fetchFactSalesThisMonth(), fetchFactToYesterday(), fetchTodayKpi());
    }
    await Promise.all(tasks);
  }, [fetchTodaySpend, fetchFactSalesToday, fetchFactSalesThisMonth, fetchFactToYesterday, fetchTodayKpi, currentMonthPlan]);

  const isDashboardPostRefreshGuardActive = useCallback(() => {
    if (typeof window === "undefined") return false;
    const key = `${REFRESH_BASELINE_SESSION_KEY}:${projectId}`;
    try {
      const raw = Number(sessionStorage.getItem(key) ?? 0) || 0;
      if (!raw) return false;
      return Date.now() - raw < POST_REFRESH_GUARD_MS;
    } catch {
      return false;
    }
  }, [projectId]);

  useEffect(() => {
    if (!projectId) return;
    void refreshTodayWidget();
    const id = window.setInterval(() => {
      if (typeof window === "undefined") return;
      if (!navigator.onLine) return;
      if (document.visibilityState !== "visible") return;
      if (isDashboardPostRefreshGuardActive()) return;
      void refreshTodayWidget();
    }, 15 * 60 * 1000);
    const onRefresh = () => {
      if (isDashboardPostRefreshGuardActive()) return;
      void refreshTodayWidget();
    };
    window.addEventListener(SIDEBAR_TODAY_REFRESH_EVENT, onRefresh);
    return () => {
      window.clearInterval(id);
      window.removeEventListener(SIDEBAR_TODAY_REFRESH_EVENT, onRefresh);
    };
  }, [projectId, refreshTodayWidget, isDashboardPostRefreshGuardActive]);

  const hasCurrentMonthPlan = currentMonthPlan !== null;
  const primaryCountPlan = currentMonthPlan?.sales_plan_count ?? 0;
  const repeatCountPlan = currentMonthPlan?.repeat_sales_count ?? 0;
  const primaryBudgetPlan = currentMonthPlan?.sales_plan_budget ?? 0;
  const repeatBudgetPlan = currentMonthPlan?.repeat_sales_budget ?? 0;
  const totalBudgetPlan = primaryBudgetPlan + repeatBudgetPlan;
  const totalSalesPlan = primaryCountPlan + repeatCountPlan;
  const plannedRevenue = currentMonthPlan?.planned_revenue ?? 0;
  const planCac = primaryCountPlan > 0 && primaryBudgetPlan > 0 ? primaryBudgetPlan / primaryCountPlan : null;
  const planCpr = repeatCountPlan > 0 && repeatBudgetPlan > 0 ? repeatBudgetPlan / repeatCountPlan : null;
  const planRoas =
    totalBudgetPlan > 0 && plannedRevenue > 0 ? plannedRevenue / totalBudgetPlan : null;

  // Календарные параметры месяца в UTC (чтобы today/yesterday границы совпадали с API).
  const now = new Date();
  const daysInMonth = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 0)).getUTCDate();
  const utcDay = now.getUTCDate();
  const elapsedDaysBeforeToday = Math.max(0, utcDay - 1);
  const remainingDays = Math.max(1, daysInMonth - elapsedDaysBeforeToday);

  /** Остаток плана и дневная цель: (план месяца − факт с 1-го до вчера) / оставшиеся дни (вкл. сегодня), UTC как в API. */
  const remainingSalesPlan = Math.max(0, totalSalesPlan - (factSalesToYesterday ?? 0));
  const remainingBudgetPlan = Math.max(0, totalBudgetPlan - (factSpendToYesterday ?? 0));
  const hasSpendPlan = currentMonthPlan != null && (currentMonthPlan.sales_plan_budget != null || currentMonthPlan.repeat_sales_budget != null);
  const salesPlanLoading = hasCurrentMonthPlan && factSalesToYesterday == null;
  const spendPlanLoading = hasCurrentMonthPlan && hasSpendPlan && factSpendToYesterday == null;
  const dailySalesPlan = totalSalesPlan > 0 ? remainingSalesPlan / remainingDays : 0;
  const dailyBudgetPlan = totalBudgetPlan > 0 ? remainingBudgetPlan / remainingDays : 0;
  const salesPlanState: TodayPlanState = !hasCurrentMonthPlan || totalSalesPlan <= 0
    ? "noPlan"
    : salesPlanLoading
      ? "loadingFact"
      : dailySalesPlan <= 0
        ? "planExhausted"
        : "activePlan";
  const spendPlanState: TodayPlanState = !hasCurrentMonthPlan || !hasSpendPlan
    ? "noPlan"
    : spendPlanLoading
      ? "loadingFact"
      : totalBudgetPlan > 0 && remainingBudgetPlan <= 0
        ? "planExhausted"
        : "activePlan";

  const factRoas = todayRevenue != null && todaySpend != null && todaySpend > 0 ? todayRevenue / todaySpend : null;
  const factCac =
    todaySpend != null && factSalesToday != null && factSalesToday > 0 ? todaySpend / factSalesToday : null;
  const roasPlanState: TodayPlanState = planRoas != null ? "activePlan" : "noPlan";
  const cacPlanState: TodayPlanState = planCac != null ? "activePlan" : "noPlan";
  const cprPlanState: TodayPlanState = planCpr != null ? "activePlan" : "noPlan";

  const planPerformanceState = useMemo((): "no_plan" | "on_track" | "behind" => {
    if (!hasCurrentMonthPlan || totalSalesPlan <= 0) return "no_plan";
    const plannedSales = totalSalesPlan;
    const now = new Date();
    const currentDay = now.getUTCDate();
    const daysInMonth = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 0)).getUTCDate();
    const progressOfMonth = currentDay / daysInMonth;
    const expectedSales = plannedSales * progressOfMonth;
    const factSales = factSalesThisMonth ?? 0;
    return factSales >= expectedSales ? "on_track" : "behind";
  }, [hasCurrentMonthPlan, totalSalesPlan, factSalesThisMonth]);

  const withProjectId = useCallback(
    (path: string) => {
      if (!projectId) return path;
      const hasQuery = path.includes("?");
      const sep = hasQuery ? "&" : "?";
      return `${path}${sep}project_id=${encodeURIComponent(projectId)}`;
    },
    [projectId]
  );

  const handlePlanSaved = useCallback(async () => {
    await fetchCurrentMonthPlan();
    await refreshTodayWidget();
  }, [fetchCurrentMonthPlan, refreshTodayWidget]);

  const activeProjectName =
    projectId && projects.length > 0
      ? (projects.find((p) => p.id === projectId)?.name ?? null) || "Проект"
      : null;

  useEffect(() => {
    const label = activeProjectName ?? (projectId ? "Проект" : "Проект не выбран");
    mobileNavRef.current?.setTodayDrawerProjectLabel(label);
  }, [activeProjectName, projectId]);

  const handleSelectProject = useCallback(
    (id: string) => {
      setActiveProjectId(id);
      setProjectId(id);
      setSwitcherOpen(false);
      if (billingActionAllowed(resolvedUi, ActionId.navigate_app)) {
        void fetch(`/api/projects/${encodeURIComponent(id)}/touch`, { method: "POST" }).catch(() => null);
      }
      router.push(`/app?project_id=${encodeURIComponent(id)}`);
    },
    [router, resolvedUi]
  );

  const topMetrics: Metric[] = useMemo(
    () => [
      {
        key: "spend",
        title: "Расход",
        fact: todaySpend,
        plan: spendPlanState === "loadingFact" ? null : hasSpendPlan ? dailyBudgetPlan : null,
        format: "money",
        state: spendPlanState,
      },
      {
        key: "sales",
        title: "Продажи",
        fact: factSalesToday,
        plan: salesPlanState === "activePlan" || salesPlanState === "planExhausted" ? dailySalesPlan : null,
        format: "num",
        state: salesPlanState,
      },
    ],
    [
      todaySpend,
      spendPlanState,
      hasSpendPlan,
      dailyBudgetPlan,
      factSalesToday,
      dailySalesPlan,
      salesPlanState,
    ]
  );
  const extendedMetrics: Metric[] = useMemo(
    () => [
      {
        key: "roas",
        title: "ROAS",
        fact: factRoas,
        plan: planRoas,
        format: "roas",
        state: roasPlanState,
      },
      {
        key: "cac",
        title: "CAC",
        fact: factCac,
        plan: planCac,
        format: "money",
        state: cacPlanState,
      },
      {
        key: "cpr",
        title: "CPR",
        fact: null,
        plan: planCpr,
        format: "money",
        state: cprPlanState,
      },
    ],
    [factRoas, planRoas, roasPlanState, factCac, planCac, cacPlanState, planCpr, cprPlanState]
  );

  const sidebarBackground =
    "radial-gradient(800px 260px at 30% 0%, rgba(120,120,255,0.16), transparent 60%), linear-gradient(180deg, rgba(255,255,255,0.05), rgba(255,255,255,0.01))";

  const todayPanelProps = {
    todayOpen,
    setTodayOpen,
    projectId,
    canEditPlan,
    planPerformanceState,
    setPlanModalOpen,
    totalSalesPlan,
    factSalesToday,
    salesPlanState,
    dailySalesPlan,
    topMetrics,
    extendedMetrics,
    projectCurrency,
    usdToKztRate,
    setTodayMetricsFrameOpen,
  };

  useEffect(() => {
    if (!todayMetricsFrameOpen) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setTodayMetricsFrameOpen(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [todayMetricsFrameOpen]);

  useEffect(() => {
    if (!todayMetricsFrameOpen) return;
    return acquireBodyScrollLock();
  }, [todayMetricsFrameOpen]);

  return (
    <>
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        minHeight: "100vh",
        minWidth: 260,
        width: 260,
        maxWidth: 260,
        borderRight: "1px solid rgba(255,255,255,0.08)",
        background: sidebarBackground,
      }}
    >
      <aside style={{ padding: 16, flex: 1, display: "flex", flexDirection: "column", minHeight: 0 }}>
      {/* Project switcher */}
      <div ref={switcherRef} style={{ position: "relative", marginBottom: 12 }}>
        <button
          type="button"
          onClick={() => setSwitcherOpen((v) => !v)}
          style={{
            width: "100%",
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            gap: 8,
            padding: "10px 12px",
            borderRadius: 10,
            border: "1px solid rgba(255,255,255,0.12)",
            background: switcherOpen ? "rgba(255,255,255,0.08)" : "rgba(255,255,255,0.04)",
            color: "white",
            fontSize: 14,
            fontWeight: 600,
            textAlign: "left",
            cursor: "pointer",
            minWidth: 0,
          }}
          aria-expanded={switcherOpen}
          aria-haspopup="listbox"
        >
          <span style={{ minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
            {projectsLoading
              ? "Загрузка…"
              : activeProjectName ?? (projectId ? "Проект" : "Выберите проект")}
          </span>
          <span
            style={{
              flexShrink: 0,
              opacity: 0.7,
              transform: switcherOpen ? "rotate(180deg)" : "rotate(0deg)",
              transition: "transform 0.15s ease",
            }}
          >
            ▾
          </span>
        </button>

        {switcherOpen && (
          <div
            role="listbox"
            style={{
              position: "absolute",
              top: "100%",
              left: 0,
              right: 0,
              marginTop: 4,
              borderRadius: 12,
              border: "1px solid rgba(255,255,255,0.12)",
              background: "rgba(11,11,16,0.98)",
              boxShadow: "0 12px 40px rgba(0,0,0,0.5)",
              padding: 6,
              maxHeight: 280,
              overflowY: "auto",
              zIndex: 50,
            }}
          >
            {projects.length === 0 && !projectsLoading ? (
              <div style={{ padding: "12px 10px", fontSize: 13, color: "rgba(255,255,255,0.6)" }}>
                Нет проектов
              </div>
            ) : (
              projects.map((p) => {
                const isActive = p.id === projectId;
                return (
                  <button
                    key={p.id}
                    type="button"
                    role="option"
                    aria-selected={isActive}
                    onClick={() => handleSelectProject(p.id)}
                    style={{
                      width: "100%",
                      display: "flex",
                      alignItems: "center",
                      gap: 8,
                      padding: "10px 12px",
                      borderRadius: 8,
                      border: "none",
                      background: isActive ? "rgba(255,255,255,0.10)" : "transparent",
                      color: "white",
                      fontSize: 13,
                      fontWeight: isActive ? 600 : 500,
                      textAlign: "left",
                      cursor: "pointer",
                      minWidth: 0,
                    }}
                    onMouseEnter={(e) => {
                      if (!isActive) {
                        e.currentTarget.style.background = "rgba(255,255,255,0.06)";
                      }
                    }}
                    onMouseLeave={(e) => {
                      e.currentTarget.style.background = isActive ? "rgba(255,255,255,0.10)" : "transparent";
                    }}
                  >
                    {isActive ? (
                      <span style={{ flexShrink: 0, color: "rgba(110,255,200,0.95)" }}>✓</span>
                    ) : (
                      <span style={{ flexShrink: 0, width: 14, opacity: 0 }}>✓</span>
                    )}
                    <span style={{ minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                      {p.name || "Без названия"}
                    </span>
                  </button>
                );
              })
            )}
            <div
              style={{
                height: 1,
                background: "rgba(255,255,255,0.08)",
                margin: "6px 0",
              }}
            />
            <Link
              href="/app/projects/new"
              style={{
                display: "flex",
                alignItems: "center",
                gap: 8,
                padding: "10px 12px",
                borderRadius: 8,
                color: "rgba(255,255,255,0.85)",
                fontSize: 13,
                textDecoration: "none",
              }}
              onClick={() => setSwitcherOpen(false)}
              onMouseEnter={(e) => {
                e.currentTarget.style.background = "rgba(255,255,255,0.06)";
              }}
              onMouseLeave={(e) => {
                e.currentTarget.style.background = "transparent";
              }}
            >
              <span style={{ opacity: 0.8 }}>+</span> Создать проект
            </Link>
            <Link
              href="/app/projects"
              style={{
                display: "flex",
                alignItems: "center",
                gap: 8,
                padding: "10px 12px",
                borderRadius: 8,
                color: "rgba(255,255,255,0.85)",
                fontSize: 13,
                textDecoration: "none",
              }}
              onClick={() => setSwitcherOpen(false)}
              onMouseEnter={(e) => {
                e.currentTarget.style.background = "rgba(255,255,255,0.06)";
              }}
              onMouseLeave={(e) => {
                e.currentTarget.style.background = "transparent";
              }}
            >
              Все проекты
            </Link>
          </div>
        )}
      </div>

      {/* Сегодня */}
      <SidebarTodayPanel variant="sidebar" {...todayPanelProps} />

      {/* Навигация */}
      <div style={{ display: "grid", gap: 8 }}>
        <Link href={withProjectId("/app")} style={itemStyle(pathname === "/app")}>
          📊 Дашборд
        </Link>

        <Link href={withProjectId("/app/reports")} style={itemStyle(pathname.startsWith("/app/reports"))}>
          📑 Отчёты
        </Link>

        <Link href={withProjectId("/app/ltv")} style={itemStyle(pathname.startsWith("/app/ltv"))}>
          📈 LTV
        </Link>

        <Link href={withProjectId("/app/weekly-report")} style={itemStyle(pathname.startsWith("/app/weekly-report"))}>
          📊 Shared Board Report
        </Link>

        <Link href={withProjectId("/app/conversion-data")} style={itemStyle(pathname.startsWith("/app/conversion-data"))}>
          🧾 Conversion Data
        </Link>

        <div
          style={{
            height: 1,
            background: "rgba(255,255,255,0.10)",
            opacity: 0.45,
            margin: "10px 2px",
          }}
        />

        <Link href={withProjectId("/app/utm-builder")} style={itemStyle(pathname.startsWith("/app/utm-builder"))}>
          🔗 UTM Builder
        </Link>

        <Link href={withProjectId("/app/accounts")} style={itemStyle(pathname.startsWith("/app/accounts"))}>
          🌎 Аккаунты
        </Link>

        <Link href={withProjectId("/app/pixels")} style={itemStyle(pathname.startsWith("/app/pixels"))}>
          {"🛜 Pixel & CRM"}
        </Link>

        <Link
          href={withProjectId("/app/settings")}
          style={itemStyle(pathname.startsWith("/app/settings"))}
        >
          ⚙️ Настройки
        </Link>

        <Link href={withProjectId("/app/support")} style={itemStyle(pathname.startsWith("/app/support"))}>
          🛟 Поддержка
        </Link>
      </div>

      <div style={{ marginTop: "auto", paddingTop: 14 }}>
        <div
          style={{
            height: 1,
            background: "rgba(255,255,255,0.10)",
            opacity: 0.45,
            margin: "0 2px 12px",
          }}
        />
        <div
          style={{
            fontSize: 12,
            color: "rgba(255,255,255,0.45)",
            textAlign: "center",
          }}
        >
          v2.1 Production
        </div>
      </div>

      {projectId ? (
        <SalesPlanModal
          open={planModalOpen}
          onClose={() => setPlanModalOpen(false)}
          projectId={projectId}
          month={new Date().getMonth() + 1}
          year={new Date().getFullYear()}
          initialPlan={currentMonthPlan}
          factSpendToYesterday={factSpendToYesterday}
          remainingDaysInMonth={remainingDays}
          onSaved={() => {
            void handlePlanSaved();
          }}
          planPerformanceState={planPerformanceState}
          currency={projectCurrency}
          usdToKztRate={usdToKztRate}
        />
      ) : null}
    </aside>
    </div>
    {mobileNav?.todayDrawerPortalContainer && mobileNav?.todayDrawerOpen
      ? createPortal(
          <SidebarTodayPanel
            variant="mobileDrawer"
            {...todayPanelProps}
            onCloseDrawer={() => mobileNavRef.current?.setTodayDrawerOpen(false)}
          />,
          mobileNav.todayDrawerPortalContainer
        )
      : null}
    {todayMetricsFrameOpen && typeof document !== "undefined"
      ? createPortal(
          <div
            role="dialog"
            aria-modal="true"
            aria-labelledby="sidebar-today-metrics-title"
            style={{
              position: "fixed",
              inset: 0,
              zIndex: 4000,
              background: "rgba(8,8,12,0.88)",
              backdropFilter: "blur(8px)",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              padding: 20,
              boxSizing: "border-box",
            }}
            onClick={() => setTodayMetricsFrameOpen(false)}
          >
            <div
              style={{
                position: "relative",
                maxWidth: 440,
                width: "100%",
                maxHeight: "min(92vh, 640px)",
                overflowY: "auto",
                borderRadius: 20,
                border: "1px solid rgba(255,255,255,0.12)",
                background: "rgba(18,18,26,0.98)",
                padding: "26px 24px 24px",
                boxShadow: "0 24px 80px rgba(0,0,0,0.65)",
                boxSizing: "border-box",
              }}
              onClick={(e) => e.stopPropagation()}
            >
              <div
                style={{
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "space-between",
                  gap: 8,
                  marginBottom: 4,
                  minHeight: 40,
                }}
              >
                <div style={{ width: 40, flexShrink: 0 }} aria-hidden />
                <h2
                  id="sidebar-today-metrics-title"
                  style={{
                    margin: 0,
                    flex: 1,
                    fontSize: 22,
                    fontWeight: 900,
                    lineHeight: 1.2,
                    color: "white",
                    textAlign: "center",
                  }}
                >
                  ROAS, CAC, CPR
                </h2>
                <button
                  type="button"
                  onClick={() => setTodayMetricsFrameOpen(false)}
                  style={{
                    width: 40,
                    height: 40,
                    flexShrink: 0,
                    margin: 0,
                    padding: 0,
                    border: "1px solid rgba(255,255,255,0.2)",
                    background: "rgba(255,255,255,0.06)",
                    color: "white",
                    borderRadius: 10,
                    cursor: "pointer",
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    lineHeight: 0,
                  }}
                  aria-label="Закрыть"
                >
                  <span style={{ fontSize: 18, lineHeight: 1, display: "block" }}>✕</span>
                </button>
              </div>
              <p
                style={{
                  margin: "6px 0 0",
                  fontSize: 13,
                  lineHeight: 1.45,
                  color: "rgba(255,255,255,0.55)",
                  textAlign: "center",
                }}
              >
                Показатели на сегодня и отклонение от дневного плана
              </p>
              <div style={{ display: "grid", gap: 12, marginTop: 22, minWidth: 0 }}>
                {extendedMetrics.map((m) => (
                  <MetricRow
                    key={m.key}
                    m={m}
                    currency={projectCurrency}
                    usdToKztRate={usdToKztRate}
                    variant="sidebar"
                  />
                ))}
              </div>
            </div>
          </div>,
          document.body
        )
      : null}
    </>
  );
}