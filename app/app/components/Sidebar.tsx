"use client";

import Link from "next/link";
import { usePathname, useSearchParams, useRouter } from "next/navigation";
import { useMemo, useState, useEffect, useCallback, useRef } from "react";
import { setActiveProjectId } from "@/app/lib/activeProjectClient";
import SalesPlanModal, { type MonthlyPlan } from "./SalesPlanModal";
import {
  fmtProjectCurrency,
  type ProjectCurrency,
} from "@/app/lib/currency";

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

const cardStyle = {
  borderRadius: 18,
  border: "1px solid rgba(255,255,255,0.10)",
  background:
    "radial-gradient(700px 240px at 30% 0%, rgba(120,120,255,0.18), transparent 60%), rgba(255,255,255,0.03)",
  boxShadow: "0 18px 60px rgba(0,0,0,0.45)",
  padding: 14,
  overflow: "hidden", // ✅ фикс: чтобы «Сегодня» не раздувал/не ломал ширину сайдбара
};

type DeviationStatus = "good" | "warn" | "bad" | "neutral";

function classifyGenericDeviation(delta: number): DeviationStatus {
  if (!Number.isFinite(delta)) return "neutral";
  const abs = Math.abs(delta);
  if (abs <= 0.3) return "good";
  if (abs <= 0.6) return "warn";
  return "bad";
}

function classifySpendDeviation(delta: number): DeviationStatus {
  if (!Number.isFinite(delta)) return "neutral";
  // delta = (fact - plan) / plan
  if (delta <= 0) {
    // недорасход: зелёный или жёлтый, но не красный
    const abs = Math.abs(delta);
    if (abs <= 0.3) return "good";
    return "warn";
  }
  // перерасход: используем общие пороги
  return classifyGenericDeviation(delta);
}

function badgeColors(status: DeviationStatus): { bg: string; border: string; text: string } {
  switch (status) {
    case "good":
      return {
        bg: "rgba(34,197,94,0.12)",
        border: "rgba(34,197,94,0.4)",
        text: "rgba(187,247,208,0.95)",
      };
    case "warn":
      return {
        bg: "rgba(234,179,8,0.12)",
        border: "rgba(234,179,8,0.4)",
        text: "rgba(254,249,195,0.95)",
      };
    case "bad":
      return {
        bg: "rgba(239,68,68,0.14)",
        border: "rgba(239,68,68,0.5)",
        text: "rgba(254,202,202,0.98)",
      };
    default:
      return {
        bg: "rgba(148,163,184,0.10)",
        border: "rgba(148,163,184,0.35)",
        text: "rgba(226,232,240,0.9)",
      };
  }
}

function fmtKzt(n: number) {
  return new Intl.NumberFormat("ru-RU").format(Math.round(n)) + " ₸";
}
function fmtPct(n: number) {
  const clamped = Math.max(-199, Math.min(199, n));
  return clamped.toFixed(0).replace(".", ",") + "%";
}

type MetricKey = "spend" | "sales" | "roas" | "cac" | "cpr";

type Metric = {
  key: MetricKey;
  title: string;
  fact: number;
  plan: number;
  format: "kzt" | "num" | "roas";
};

function formatValue(m: Metric, v: number) {
  if (m.format === "kzt") return fmtKzt(v).replace(" ₸", "₸");
  if (m.format === "roas") return String(v).replace(".", ",");
  return new Intl.NumberFormat("ru-RU").format(Math.round(v));
}

function deltaPct(fact: number, plan: number) {
  if (!plan) return 0;
  return ((fact - plan) / plan) * 100;
}

function MetricRow({ m }: { m: Metric }) {
  const d = deltaPct(m.fact, m.plan);
  const rel = m.plan ? (m.fact - m.plan) / m.plan : 0;
  const status = classifyGenericDeviation(rel);
  const colors = badgeColors(status);
  const sign = d > 0 ? "+" : "";
  return (
    <div
      style={{
        padding: 12,
        borderRadius: 14,
        border: "1px solid rgba(255,255,255,0.10)",
        background: "rgba(255,255,255,0.02)",
        minWidth: 0, // ✅ фикс: даём блоку сжиматься в узком сайдбаре
      }}
    >
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          gap: 10,
          alignItems: "center",
          minWidth: 0, // ✅ фикс
        }}
      >
        <div
          style={{
            fontWeight: 900,
            minWidth: 0, // ✅ фикс
            overflow: "hidden", // ✅ фикс
            textOverflow: "ellipsis", // ✅ фикс
            whiteSpace: "nowrap", // ✅ фикс
          }}
        >
          {m.title}
        </div>

        <div
          style={{
            display: "inline-flex",
            alignItems: "center",
            gap: 5,
            padding: "4px 8px",
            borderRadius: 999,
              background: colors.bg,
              border: `1px solid ${colors.border}`,
              color: colors.text,
            fontWeight: 900,
            fontSize: 11,
            lineHeight: 1.2,
            whiteSpace: "nowrap",
            flexShrink: 0,
          }}
          title="Отклонение факт vs план"
        >
          {sign}
          {fmtPct(d)}
          <span
            style={{
              width: 6,
              height: 6,
              borderRadius: 999,
              background: colors.text,
              opacity: 0.9,
              flexShrink: 0,
            }}
          />
        </div>
      </div>

      <div style={{ display: "grid", gap: 6, marginTop: 10, minWidth: 0 }}>
        <div
          style={{
            display: "flex",
            justifyContent: "space-between",
            gap: 10,
            opacity: 0.75,
            minWidth: 0, // ✅ фикс
          }}
        >
          <span style={{ minWidth: 0 }}>Факт</span>
          <span
            style={{
              fontWeight: 900,
              opacity: 1,
              whiteSpace: "nowrap", // ✅ фикс: не переносим числа
              fontVariantNumeric: "tabular-nums", // ✅ фикс: стабильная ширина цифр
              flexShrink: 0, // ✅ фикс
            }}
          >
            {formatValue(m, m.fact)}
          </span>
        </div>

        <div
          style={{
            display: "flex",
            justifyContent: "space-between",
            gap: 10,
            opacity: 0.75,
            minWidth: 0, // ✅ фикс
          }}
        >
          <span style={{ minWidth: 0 }}>План</span>
          <span
            style={{
              fontWeight: 900,
              opacity: 1,
              whiteSpace: "nowrap",
              fontVariantNumeric: "tabular-nums",
              flexShrink: 0,
            }}
          >
            {formatValue(m, m.plan)}
          </span>
        </div>
      </div>
    </div>
  );
}

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

function todayYmd() {
  const d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

const TODAY_SPEND_PLAN_USD = 20;

function fmtUsd(n: number) {
  return "$" + n.toFixed(2).replace(/\B(?=(\d{3})+(?!\d))/g, ",");
}

type TodaySpendCardProps = {
  todaySpend: number | null;
  planBudget: number | null;
  currency: ProjectCurrency;
  usdToKztRate: number | null;
};

function TodaySpendCard({ todaySpend, planBudget, currency, usdToKztRate }: TodaySpendCardProps) {
  const hasPlanBudget = planBudget != null && planBudget > 0;
  const plan = hasPlanBudget ? planBudget! : TODAY_SPEND_PLAN_USD;
  const fact = todaySpend ?? 0;
  const deltaRel = hasPlanBudget && plan > 0 ? (fact - plan) / plan : 0;
  const status = classifySpendDeviation(deltaRel);
  const colors = badgeColors(status);
  const pct = hasPlanBudget && plan > 0 ? deltaRel * 100 : 0;

  return (
    <div
      style={{
        padding: 12,
        borderRadius: 14,
        border: "1px solid rgba(255,255,255,0.10)",
        background: "rgba(255,255,255,0.02)",
        minWidth: 0,
      }}
    >
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          gap: 10,
          alignItems: "center",
          minWidth: 0,
        }}
      >
        <div style={{ fontWeight: 900, minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
          Расход
        </div>
        <div
          style={{
            display: "inline-flex",
            alignItems: "center",
            gap: 5,
            padding: "4px 8px",
            borderRadius: 999,
            background: colors.bg,
            border: `1px solid ${colors.border}`,
            color: colors.text,
            fontWeight: 900,
            fontSize: 11,
            lineHeight: 1.2,
            whiteSpace: "nowrap",
            flexShrink: 0,
          }}
          title="Отклонение факт vs план"
        >
          {hasPlanBudget ? `${pct >= 0 ? "+" : ""}${fmtPct(pct)}` : "—"}
        </div>
      </div>
      <div style={{ display: "grid", gap: 6, marginTop: 10, minWidth: 0 }}>
        <div
          style={{
            display: "flex",
            justifyContent: "space-between",
            gap: 10,
            opacity: 0.75,
            minWidth: 0,
          }}
        >
          <span style={{ minWidth: 0 }}>Факт</span>
          <span
            style={{
              fontWeight: 900,
              opacity: 1,
              whiteSpace: "nowrap",
              fontVariantNumeric: "tabular-nums",
              flexShrink: 0,
            }}
          >
            {todaySpend != null ? fmtProjectCurrency(todaySpend, currency, usdToKztRate) : "—"}
          </span>
        </div>
        <div
          style={{
            display: "flex",
            justifyContent: "space-between",
            gap: 10,
            opacity: 0.75,
            minWidth: 0,
          }}
        >
          <span style={{ minWidth: 0 }}>План</span>
          <span
            style={{
              fontWeight: 900,
              opacity: 1,
              whiteSpace: "nowrap",
              fontVariantNumeric: "tabular-nums",
              flexShrink: 0,
            }}
          >
            {hasPlanBudget ? fmtProjectCurrency(plan, currency, usdToKztRate) : "—"}
          </span>
        </div>
      </div>
    </div>
  );
}

export default function Sidebar() {
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const router = useRouter();

  const [todayOpen, setTodayOpen] = useState(false);
  const [projectId, setProjectId] = useState<string | null>(null);
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
  const [projectCurrency, setProjectCurrency] = useState<ProjectCurrency>("USD");
  const [usdToKztRate, setUsdToKztRate] = useState<number | null>(null);

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

  useEffect(() => {
    let mounted = true;
    (async () => {
      try {
        const res = await fetch("/api/projects", { cache: "no-store" });
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
        const res = await fetch(`/api/projects/currency?project_id=${encodeURIComponent(projectId)}`, {
          cache: "no-store",
        });
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
  }, [projectCurrency]);

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
    const today = todayYmd();
    try {
      const res = await fetch(
        `/api/dashboard/summary?project_id=${encodeURIComponent(projectId)}&start=${today}&end=${today}`,
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
  }, [projectId]);

  const startParam = searchParams.get("start");
  const endParam = searchParams.get("end");

  useEffect(() => {
    if (!projectId) return;
    fetchTodaySpend();
  }, [projectId, startParam, endParam, fetchTodaySpend]);

  useEffect(() => {
    if (!projectId) return;
    const interval = setInterval(fetchTodaySpend, 30 * 60 * 1000);
    return () => clearInterval(interval);
  }, [projectId, fetchTodaySpend]);

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
    const now = new Date();
    const year = now.getFullYear();
    const month = now.getMonth() + 1;
    const start = `${year}-${String(month).padStart(2, "0")}-01`;
    const end = todayYmd();
    try {
      const res = await fetch(
        `/api/dashboard/timeseries?project_id=${encodeURIComponent(projectId)}&start=${start}&end=${end}`,
        { cache: "no-store" }
      );
      const json = (await res.json()) as { success?: boolean; points?: { sales?: number }[] };
      if (json?.success && Array.isArray(json.points)) {
        const total = json.points.reduce((s, p) => s + (Number(p.sales ?? 0) || 0), 0);
        setFactSalesThisMonth(total);
      } else {
        setFactSalesThisMonth(null);
      }
    } catch {
      setFactSalesThisMonth(null);
    }
  }, [projectId]);

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
    const today = todayYmd();
    try {
      const res = await fetch(
        `/api/dashboard/timeseries?project_id=${encodeURIComponent(projectId)}&start=${today}&end=${today}`,
        { cache: "no-store" }
      );
      const json = (await res.json()) as { success?: boolean; points?: { sales?: number }[] };
      if (json?.success && Array.isArray(json.points)) {
        const total = json.points.reduce((s, p) => s + (Number(p.sales ?? 0) || 0), 0);
        setFactSalesToday(total);
      } else {
        setFactSalesToday(null);
      }
    } catch {
      setFactSalesToday(null);
    }
  }, [projectId]);

  useEffect(() => {
    if (!projectId || !currentMonthPlan) {
      setFactSalesToday(null);
      return;
    }
    fetchFactSalesToday();
  }, [projectId, currentMonthPlan, fetchFactSalesToday]);

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

  // дневной план на сегодня (из месячного плана)
  const now = new Date();
  const daysInMonth = new Date(now.getFullYear(), now.getMonth() + 1, 0).getDate();
  const dailySalesPlan = totalSalesPlan > 0 && daysInMonth > 0 ? totalSalesPlan / daysInMonth : 0;
  const dailyBudgetPlan =
    totalBudgetPlan > 0 && daysInMonth > 0 ? totalBudgetPlan / daysInMonth : 0;
  const dailyRevenuePlan =
    plannedRevenue > 0 && daysInMonth > 0 ? plannedRevenue / daysInMonth : 0;

  const planPerformanceState = useMemo((): "no_plan" | "on_track" | "behind" => {
    if (!hasCurrentMonthPlan || totalSalesPlan <= 0) return "no_plan";
    const plannedSales = totalSalesPlan;
    const now = new Date();
    const currentDay = now.getDate();
    const daysInMonth = new Date(now.getFullYear(), now.getMonth() + 1, 0).getDate();
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

  const activeProjectName =
    projectId && projects.length > 0
      ? (projects.find((p) => p.id === projectId)?.name ?? null) || "Проект"
      : null;

  const handleSelectProject = useCallback(
    (id: string) => {
      setActiveProjectId(id);
      setProjectId(id);
      setSwitcherOpen(false);
      router.push(`/app?project_id=${encodeURIComponent(id)}`);
    },
    [router]
  );

  const metrics: Metric[] = useMemo(
    () => [
      {
        key: "sales",
        title: "Продажи",
        fact: factSalesToday ?? 0,
        plan: dailySalesPlan,
        format: "num",
      },
    ],
    [factSalesToday, dailySalesPlan]
  );

  const visibleTop = metrics.filter((m) => m.key === "sales");
  const hidden = metrics.filter((m) => m.key !== "sales");

  return (
    <aside
      style={{
        padding: 16,
        borderRight: "1px solid rgba(255,255,255,0.08)",
        background:
          "radial-gradient(800px 260px at 30% 0%, rgba(120,120,255,0.16), transparent 60%), linear-gradient(180deg, rgba(255,255,255,0.05), rgba(255,255,255,0.01))",
        minWidth: 260,
        width: 260,
        maxWidth: 260,
      }}
    >
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
      <div style={{ ...cardStyle, padding: 14, marginBottom: 14 }}>
        <button
          type="button"
          onClick={() => setTodayOpen((v) => !v)}
          style={{
            width: "100%",
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            gap: 10,
            background: "transparent",
            border: "none",
            color: "white",
            padding: 0,
            cursor: "pointer",
            minWidth: 0, // ✅ фикс: кнопка тоже может сжиматься
          }}
        >
          <div style={{ fontSize: 34, fontWeight: 900, lineHeight: 1.05, minWidth: 0 }}>
            Сегодня
          </div>

          <div
            style={{
              width: 34,
              height: 34,
              borderRadius: 12,
              border: "1px solid rgba(255,255,255,0.10)",
              background: "rgba(255,255,255,0.03)",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              transform: todayOpen ? "rotate(180deg)" : "rotate(0deg)",
              transition: "transform 160ms ease",
              flexShrink: 0,
            }}
            aria-hidden="true"
          >
            <span style={{ lineHeight: 1, fontSize: 14 }}>▾</span>
          </div>
        </button>

        {/* Кнопка редактирования плана — только по правам и наличию проекта */}
        {projectId && canEditPlan && (() => {
          const dotColor =
            planPerformanceState === "no_plan"
              ? "rgba(239,68,68,0.95)"
              : planPerformanceState === "on_track"
                ? "rgba(34,197,94,0.95)"
                : "rgba(234,179,8,0.95)";
          const tooltip =
            planPerformanceState === "no_plan"
              ? "План на текущий месяц не задан.\nДобавьте план продаж для корректной аналитики."
              : planPerformanceState === "on_track"
                ? "План выполняется.\nФактические показатели соответствуют плану."
                : "Ежемесячный план не выполняется.\nРекомендуется откорректировать его на более реалистичный.";
          return (
            <div style={{ marginTop: 10 }}>
              <button
                type="button"
                onClick={() => setPlanModalOpen(true)}
                title={tooltip}
                style={{
                  width: "100%",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  gap: 8,
                  padding: "8px 12px",
                  borderRadius: 10,
                  border: "1px solid rgba(255,255,255,0.12)",
                  background: "rgba(255,255,255,0.04)",
                  color: "rgba(255,255,255,0.85)",
                  fontSize: 12,
                  fontWeight: 600,
                  cursor: "pointer",
                }}
              >
                <span
                  style={{
                    width: 8,
                    height: 8,
                    borderRadius: 999,
                    background: dotColor,
                    flexShrink: 0,
                  }}
                  title={tooltip}
                  aria-hidden="true"
                />
                Редактировать план
              </button>
            </div>
          );
        })()}

        {/* progress блока плана продаж — только от наличия плана, независимо от прав */}
        {totalSalesPlan > 0 && (
          <div
            style={{
              marginTop: 16,
              padding: "12px 14px",
              borderRadius: 14,
              border: "1px solid rgba(255,255,255,0.10)",
              background: "rgba(0,0,0,0.35)",
              display: "grid",
              gap: 10,
              fontSize: 11,
              color: "rgba(255,255,255,0.85)",
            }}
          >
            {(() => {
              const fact = factSalesToday ?? 0;
              const raw = dailySalesPlan > 0 ? fact / dailySalesPlan : 0;
              const clamped = Math.max(0, Math.min(raw, 1));
              const pct = dailySalesPlan > 0 ? raw * 100 : 0;
              return (
                <>
                  <div
                    style={{
                      height: 6,
                      borderRadius: 999,
                      background: "rgba(24,24,35,0.9)",
                      overflow: "hidden",
                    }}
                  >
                    <div
                      style={{
                        width: `${clamped * 100}%`,
                        height: "100%",
                        borderRadius: 999,
                        background:
                          planPerformanceState === "no_plan"
                            ? "rgba(234,179,8,0.65)"
                            : planPerformanceState === "on_track"
                              ? "rgba(34,197,94,0.85)"
                              : "rgba(239,68,68,0.85)",
                        transition: "width 180ms ease-out",
                      }}
                    />
                  </div>
                  <div
                    style={{
                      display: "flex",
                      justifyContent: "space-between",
                      alignItems: "center",
                    }}
                  >
                    <span>{pct.toFixed(0)}% плана</span>
                    <span>
                      {new Intl.NumberFormat("ru-RU").format(Math.round(fact))} /{" "}
                      {new Intl.NumberFormat("ru-RU").format(Math.round(dailySalesPlan))} продаж
                    </span>
                  </div>
                </>
              );
            })()}
          </div>
        )}

        <div style={{ display: "grid", gap: 10, marginTop: 12, minWidth: 0 }}>
          <TodaySpendCard
            todaySpend={todaySpend}
            planBudget={dailyBudgetPlan || null}
            currency={projectCurrency}
            usdToKztRate={usdToKztRate}
          />
          {visibleTop.map((m) => (
            <MetricRow key={m.key} m={m} />
          ))}

          {todayOpen ? (
            <div style={{ display: "grid", gap: 10, minWidth: 0 }}>
              {/* ROAS */}
              <div
                style={{
                  padding: 10,
                  borderRadius: 12,
                  border: "1px solid rgba(255,255,255,0.10)",
                  background: "rgba(255,255,255,0.02)",
                  minWidth: 0,
                  fontSize: 13,
                  color: "rgba(255,255,255,0.85)",
                  display: "grid",
                  gap: 4,
                }}
              >
                <div style={{ fontWeight: 700 }}>ROAS</div>
                <div style={{ display: "flex", justifyContent: "space-between", opacity: 0.8 }}>
                  <span>Факт</span>
                  <span style={{ fontWeight: 700 }}>—</span>
                </div>
                <div style={{ display: "flex", justifyContent: "space-between", opacity: 0.8 }}>
                  <span>План</span>
                  <span style={{ fontWeight: 700 }}>
                    {planRoas != null ? planRoas.toFixed(2).replace(".", ",") : "—"}
                  </span>
                </div>
              </div>

              {/* CAC */}
              <div
                style={{
                  padding: 10,
                  borderRadius: 12,
                  border: "1px solid rgba(255,255,255,0.10)",
                  background: "rgba(255,255,255,0.02)",
                  minWidth: 0,
                  fontSize: 13,
                  color: "rgba(255,255,255,0.85)",
                  display: "grid",
                  gap: 4,
                }}
              >
                <div style={{ fontWeight: 700 }}>CAC</div>
                <div style={{ display: "flex", justifyContent: "space-between", opacity: 0.8 }}>
                  <span>Факт</span>
                  <span style={{ fontWeight: 700 }}>—</span>
                </div>
                <div style={{ display: "flex", justifyContent: "space-between", opacity: 0.8 }}>
                  <span>План</span>
                  <span style={{ fontWeight: 700 }}>
                    {planCac != null
                      ? fmtProjectCurrency(planCac, projectCurrency, usdToKztRate)
                      : "—"}
                  </span>
                </div>
              </div>

              {/* CPR */}
              <div
                style={{
                  padding: 10,
                  borderRadius: 12,
                  border: "1px solid rgba(255,255,255,0.10)",
                  background: "rgba(255,255,255,0.02)",
                  minWidth: 0,
                  fontSize: 13,
                  color: "rgba(255,255,255,0.85)",
                  display: "grid",
                  gap: 4,
                }}
              >
                <div style={{ fontWeight: 700 }}>CPR</div>
                <div style={{ display: "flex", justifyContent: "space-between", opacity: 0.8 }}>
                  <span>Факт</span>
                  <span style={{ fontWeight: 700 }}>—</span>
                </div>
                <div style={{ display: "flex", justifyContent: "space-between", opacity: 0.8 }}>
                  <span>План</span>
                  <span style={{ fontWeight: 700 }}>
                    {planCpr != null
                      ? fmtProjectCurrency(planCpr, projectCurrency, usdToKztRate)
                      : "—"}
                  </span>
                </div>
              </div>
            </div>
          ) : (
            <div style={{ opacity: 0.55, fontSize: 12 }}>Показать ROAS / CAC / CPR</div>
          )}
        </div>
      </div>

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

        <Link href={withProjectId("/app/utm-builder")} style={itemStyle(pathname.startsWith("/app/utm-builder"))}>
          🔗 UTM Builder
        </Link>

        <Link href={withProjectId("/app/pixels")} style={itemStyle(pathname.startsWith("/app/pixels"))}>
          🛜 BQ Pixel
        </Link>

        <div
          style={{
            height: 1,
            background: "rgba(255,255,255,0.10)",
            opacity: 0.45,
            margin: "10px 2px",
          }}
        />

        <Link href={withProjectId("/app/accounts")} style={itemStyle(pathname.startsWith("/app/accounts"))}>
          🌎 Аккаунты
        </Link>

        <Link href={withProjectId("/app/project-members")} style={itemStyle(pathname.startsWith("/app/project-members"))}>
          👥 Участники
        </Link>

        <Link href="/app/org-members" style={itemStyle(pathname.startsWith("/app/org-members"))}>
          👥 Организация
        </Link>

        <Link href={withProjectId("/app/sales-data")} style={itemStyle(pathname.startsWith("/app/sales-data"))}>
          🧾 Sales Data
        </Link>

        <Link href={withProjectId("/app/api")} style={itemStyle(pathname.startsWith("/app/api"))}>
          🔑 API
        </Link>

        <Link href={withProjectId("/app/settings")} style={itemStyle(pathname.startsWith("/app/settings"))}>
          ⚙️ Настройки
        </Link>

        <Link href={withProjectId("/app/support")} style={itemStyle(pathname.startsWith("/app/support"))}>
          🛟 Поддержка
        </Link>
      </div>

      <div style={{ marginTop: 18, opacity: 0.6, fontSize: 12 }}>v0.1 — локальная версия</div>

      {projectId ? (
        <SalesPlanModal
          open={planModalOpen}
          onClose={() => setPlanModalOpen(false)}
          projectId={projectId}
          month={new Date().getMonth() + 1}
          year={new Date().getFullYear()}
          initialPlan={currentMonthPlan}
          onSaved={fetchCurrentMonthPlan}
          planPerformanceState={planPerformanceState}
          currency={projectCurrency}
          usdToKztRate={usdToKztRate}
        />
      ) : null}
    </aside>
  );
}