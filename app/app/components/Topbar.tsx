"use client";

import Link from "next/link";
import { useRouter, usePathname, useSearchParams } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties } from "react";
import { createPortal } from "react-dom";
import { acquireBodyScrollLock } from "@/app/lib/bodyScrollLock";
import { setActiveProjectId } from "@/app/lib/activeProjectClient";
import { supabase } from "../../lib/supabaseClient";
import { billingActionAllowed, clearBillingRouteStorage } from "@/app/lib/billingBootstrapClient";
import { billingPayloadFromResolved, emitBillingCjmEvent } from "@/app/lib/billingCjmAnalytics";
import { ActionId } from "@/app/lib/billingUiContract";
import {
  BOOTSTRAP_PLAN_DISPLAY_FALLBACK,
  resolveBootstrapPlanAnalyticsSlug,
  resolveBootstrapPlanTier,
  subscriptionStatusLooksPaid,
} from "@/app/lib/billingBootstrapPlanLabel";
import { suggestUpgradePlanId } from "@/app/lib/billingPlanDisplay";
import { useOptionalAppMobileNav } from "./AppMobileNavContext";
import { useBillingBootstrap } from "./BillingBootstrapProvider";
import { useBillingPricingModalRequest } from "./BillingPricingModalProvider";
import { BillingInlinePricingSuspended } from "./BillingInlinePricing";
import DataHealthMini, {
  type DataHealthIssue,
  type DataHealthRecommendation,
} from "./DataHealthMini";
import {
  MobileBottomSheet,
  MobileSheetHeaderCloseButton,
  mobileSheetActionRowClassName,
  mobileSheetDividerClassName,
} from "./mobile/MobileBottomSheet";

type ProjectItem = { id: string; name: string | null; organization_id: string | null };

function sectionLabel(pathname: string): string {
  if (pathname === "/app" || pathname === "/app/") return "Дашборд";
  if (pathname.startsWith("/app/reports")) return "Отчёты";
  if (pathname.startsWith("/app/ltv")) return "LTV";
  if (pathname.startsWith("/app/utm-builder")) return "UTM Builder";
  if (pathname.startsWith("/app/pixels")) return "Pixel & CRM";
  if (pathname.startsWith("/app/accounts")) return "Аккаунты";
  if (pathname.startsWith("/app/project-members")) return "Участники";
  if (pathname.startsWith("/app/org-members")) return "Организация";
  if (pathname.startsWith("/app/conversion-data") || pathname.startsWith("/app/sales-data")) return "Conversion Data";
  if (pathname.startsWith("/app/weekly-report")) return "Shared Board Report";
  if (pathname.startsWith("/app/api")) return "API";
  if (pathname.startsWith("/app/settings")) return "Настройки";
  if (pathname.startsWith("/app/support")) return "Поддержка";
  if (pathname === "/app/projects" || pathname === "/app/projects/") return "Проекты";
  if (pathname.startsWith("/app/projects/new")) return "Создание проекта";
  if (pathname.startsWith("/app/invite")) return "Приглашение";
  return "Рабочая область";
}

/** Человекочитаемая подпись под названием тарифа (дата периода или статус; без сырого unknown). */
function planSubscriptionCaptionLine(args: {
  currentPlanUntil: string | null;
  currentPlanStatus: string;
  currentPlan: string;
}): string | null {
  const { currentPlanUntil, currentPlanStatus, currentPlan } = args;
  if (currentPlanUntil) {
    try {
      return `Тариф действует до ${new Date(currentPlanUntil).toLocaleDateString("ru-RU")}`;
    } catch {
      return null;
    }
  }
  if (currentPlan === "free") {
    return "Платная подписка не оформлена";
  }
  const st = currentPlanStatus.toLowerCase();
  const map: Record<string, string> = {
    active: "Подписка активна",
    trialing: "Пробный период",
    past_due: "Ожидается оплата",
    canceled: "Подписка отменена",
    cancelled: "Подписка отменена",
    incomplete: "Оформление не завершено",
    incomplete_expired: "Срок оформления истёк",
    unpaid: "Платёж не прошёл",
    paused: "Подписка приостановлена",
    unknown: "Статус уточняется",
  };
  const line = map[st];
  if (line) return line;
  if (!st || st === "unknown") return "Статус уточняется";
  return `Статус: ${currentPlanStatus}`;
}

type NoticeType = "info" | "warn" | "success" | "upgrade";

type Notice = {
  id: string;
  type: NoticeType;
  title: string;
  text: string;
  time?: string;
  unread?: boolean;
};

function typeColor(t: NoticeType) {
  if (t === "success") return "rgba(140,255,210,0.95)";
  if (t === "warn") return "rgba(255,200,120,0.95)";
  if (t === "upgrade") return "rgba(255,150,150,0.98)";
  return "rgba(220,220,255,0.95)";
}

function typeDotColor(t: NoticeType) {
  if (t === "success") return "rgba(110,255,200,0.95)";
  if (t === "warn") return "rgba(255,190,120,0.95)";
  if (t === "upgrade") return "rgba(248,113,113,0.98)";
  return "rgba(140,160,255,0.95)";
}

function MenuIcon({ size = 20 }: { size?: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      aria-hidden="true"
      style={{ display: "block" }}
    >
      <path
        d="M4 7h16M4 12h16M4 17h16"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
      />
    </svg>
  );
}

function ChevronDownIcon({ size = 18 }: { size?: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      aria-hidden="true"
      className="shrink-0 text-zinc-500"
      style={{ display: "block" }}
    >
      <path
        d="M6 9l6 6 6-6"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function shortProjectId(id: string): string {
  if (id.length <= 8) return id;
  return id.slice(0, 8);
}

function UserMenuIcon({ size = 20 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" aria-hidden="true" style={{ display: "block" }}>
      <path
        d="M12 12a4 4 0 1 0-4-4 4 4 0 0 0 4 4Zm0 2c-4.42 0-8 2.24-8 5v1h16v-1c0-2.76-3.58-5-8-5Z"
        fill="currentColor"
        opacity={0.9}
      />
    </svg>
  );
}

function BellIcon({ size = 18 }: { size?: number }) {
  // ✅ фикс пропорций: корректный viewBox + preserveAspectRatio
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      preserveAspectRatio="xMidYMid meet"
      fill="none"
      aria-hidden="true"
      style={{ display: "block" }}
    >
      <path
        d="M12 22a2.2 2.2 0 0 0 2.15-1.7H9.85A2.2 2.2 0 0 0 12 22Z"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <path
        d="M18 16.5H6c1.2-1.4 1.6-2.5 1.6-4.7V10a4.4 4.4 0 0 1 8.8 0v1.8c0 2.2.4 3.3 1.6 4.7Z"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function Dot({ color, soft }: { color: string; soft?: boolean }) {
  const s = soft ? 8 : 10;
  return (
    <span
      style={{
        width: s,
        height: s,
        borderRadius: 999,
        background: color,
        flex: `0 0 ${s}px`,
        marginTop: soft ? 3 : 4,
        boxShadow: soft ? undefined : "0 0 0 4px rgba(255,255,255,0.03)",
      }}
    />
  );
}

/** Ползунки «настройки»: только прямые линии и круги — без длинных кривых, стабильно на 18–20px. */
function SettingsGearIcon({ size = 18 }: { size?: number }) {
  const s = `${size}px`;
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      aria-hidden
      className="block shrink-0 text-zinc-400"
      style={{ width: s, height: s, minWidth: s, minHeight: s, flexShrink: 0 }}
    >
      <path stroke="currentColor" strokeWidth={2} strokeLinecap="round" d="M4 7h16M4 12h10M4 17h16" />
      <circle cx={18} cy={7} r={1.5} fill="currentColor" />
      <circle cx={14} cy={12} r={1.5} fill="currentColor" />
      <circle cx={18} cy={17} r={1.5} fill="currentColor" />
    </svg>
  );
}

function LogoutDoorIcon({ size = 18 }: { size?: number }) {
  const s = `${size}px`;
  return (
    <svg
      viewBox="0 0 24 24"
      preserveAspectRatio="xMidYMid meet"
      fill="none"
      aria-hidden
      className="block shrink-0 text-zinc-500"
      style={{ width: s, height: s, minWidth: s, minHeight: s, flexShrink: 0 }}
    >
      <path
        d="M10 7H6a2 2 0 0 0-2 2v6a2 2 0 0 0 2 2h4M15 16l4-4-4-4M19 12H9"
        stroke="currentColor"
        strokeWidth="1.75"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

export default function Topbar({ email }: { email?: string }) {
  type CurrentPlan = "starter" | "growth" | "scale" | "unknown" | "free";

  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const projectId = searchParams.get("project_id")?.trim() ?? null;

  const { bootstrap, resolvedUi, loading: billingUiLoading } = useBillingBootstrap();
  const { requestBillingPricingModal } = useBillingPricingModalRequest();
  const canNavigateApp = useMemo(
    () => billingActionAllowed(resolvedUi, ActionId.navigate_app),
    [resolvedUi]
  );
  const matrix = bootstrap?.plan_feature_matrix;
  const isMaxPlan = resolveBootstrapPlanTier(bootstrap ?? null) === "scale";
  const canPrefetchDataQuality = useMemo(
    () => bootstrap?.effective_plan === "growth" || bootstrap?.effective_plan === "scale",
    [bootstrap?.effective_plan]
  );

  const { currentPlan, currentPlanStatus, currentPlanUntil, neutralPaidPlan } = useMemo(() => {
    const sub = bootstrap?.subscription;
    if (bootstrap?.experience_tier === "free") {
      return {
        currentPlan: "free" as const,
        currentPlanStatus: "unknown",
        currentPlanUntil: null as string | null,
        neutralPaidPlan: false,
      };
    }
    const tier = resolveBootstrapPlanTier(bootstrap ?? null);
    if (tier) {
      return {
        currentPlan: tier as CurrentPlan,
        currentPlanStatus: sub ? String(sub.status ?? "unknown").toLowerCase() : "unknown",
        currentPlanUntil: sub?.current_period_end ?? null,
        neutralPaidPlan: false,
      };
    }
    if (!sub) {
      return {
        currentPlan: "unknown" as CurrentPlan,
        currentPlanStatus: "unknown",
        currentPlanUntil: null as string | null,
        neutralPaidPlan: false,
      };
    }
    return {
      currentPlan: "unknown" as CurrentPlan,
      currentPlanStatus: String(sub.status ?? "unknown").toLowerCase(),
      currentPlanUntil: sub.current_period_end ?? null,
      neutralPaidPlan: subscriptionStatusLooksPaid(sub.status),
    };
  }, [bootstrap]);

  const planCaptionLine = useMemo(
    () =>
      planSubscriptionCaptionLine({
        currentPlanUntil,
        currentPlanStatus,
        currentPlan,
      }),
    [currentPlanUntil, currentPlanStatus, currentPlan]
  );

  /** Буллеты в панели «Текущий тариф»: для Free — отдельный копирайт. */
  const planTariffFeatureLines = useMemo(
    () =>
      currentPlan === "free"
        ? [
            "Первичные данные по рекламе и продажам",
            "Ограниченный анализ",
            "1 проект и 1 источник",
          ]
        : ["Рекомендуемая аналитика", "Расширенные интеграции", "Поддержка приоритетных задач"],
    [currentPlan]
  );

  const planTheme = useMemo(() => {
    /* Первый запрос: пока нет bootstrap — не показываем «No plan» */
    if (billingUiLoading && bootstrap == null) {
      return {
        label: "Загрузка...",
        dot: "rgba(148,163,184,0.55)",
        border: "rgba(148,163,184,0.22)",
        bg: "rgba(148,163,184,0.08)",
        dotGlow: "rgba(148,163,184,0.12)",
      };
    }
    if (currentPlan === "free") {
      return {
        label: "Free",
        dot: "rgba(251,191,36,0.95)",
        border: "rgba(251,191,36,0.4)",
        bg: "rgba(251,191,36,0.12)",
        dotGlow: "rgba(251,191,36,0.22)",
      };
    }
    if (currentPlan === "starter") {
      return {
        label: "Базовый",
        dot: "rgba(200,200,210,0.95)",
        border: "rgba(255,255,255,0.16)",
        bg: "rgba(255,255,255,0.06)",
        dotGlow: "rgba(255,255,255,0.18)",
      };
    }
    if (currentPlan === "growth") {
      return {
        label: "Growth",
        dot: "rgba(52,211,153,0.95)",
        border: "rgba(52,211,153,0.35)",
        bg: "rgba(16,185,129,0.14)",
        dotGlow: "rgba(16,185,129,0.25)",
      };
    }
    if (currentPlan === "scale") {
      return {
        label: "Scale",
        dot: "rgba(167,139,250,0.98)",
        border: "rgba(167,139,250,0.42)",
        bg: "rgba(139,92,246,0.14)",
        dotGlow: "rgba(167,139,250,0.22)",
      };
    }
    if (neutralPaidPlan) {
      return {
        label: BOOTSTRAP_PLAN_DISPLAY_FALLBACK,
        dot: "rgba(148,163,184,0.95)",
        border: "rgba(148,163,184,0.28)",
        bg: "rgba(148,163,184,0.14)",
        dotGlow: "rgba(148,163,184,0.2)",
      };
    }
    return {
      label: "No plan",
      dot: "rgba(148,163,184,0.95)",
      border: "rgba(148,163,184,0.28)",
      bg: "rgba(148,163,184,0.14)",
      dotGlow: "rgba(148,163,184,0.2)",
    };
  }, [billingUiLoading, bootstrap, currentPlan, neutralPaidPlan]);

  type DataQualityPayload = {
    has_data: boolean;
    score: number | null;
    label: string;
    breakdown: {
      click_capture_quality: number;
      visit_attribution_quality: number;
      conversion_attribution_quality: number;
      purchase_completeness: number;
      registration_completeness: number;
    } | null;
    issues: DataHealthIssue[];
    recommendations: DataHealthRecommendation[];
  };
  const [dataQuality, setDataQuality] = useState<DataQualityPayload | null>(null);
  const [dataQualityLoading, setDataQualityLoading] = useState(false);
  const [projects, setProjects] = useState<ProjectItem[]>([]);

  const section = useMemo(() => {
    if (pathname?.startsWith("/app/settings") && searchParams.get("section") === "access") {
      return "Управление доступом";
    }
    return sectionLabel(pathname ?? "");
  }, [pathname, searchParams]);
  const projectName = useMemo(
    () => (projectId && projects.length ? (projects.find((p) => p.id === projectId)?.name ?? null) || "Проект" : null),
    [projectId, projects]
  );

  useEffect(() => {
    let mounted = true;
    (async () => {
      try {
        const res = await fetch("/api/projects", { cache: "no-store" });
        const json = (await res.json()) as { success?: boolean; projects?: ProjectItem[] };
        if (mounted && json?.success && Array.isArray(json.projects)) setProjects(json.projects);
      } catch {
        if (mounted) setProjects([]);
      }
    })();
    return () => {
      mounted = false;
    };
  }, []);

  const [notifOpen, setNotifOpen] = useState(false);
  const popoverRef = useRef<HTMLDivElement | null>(null);
  const [isNarrowViewport, setIsNarrowViewport] = useState(false);

  useEffect(() => {
    if (typeof window === "undefined") return;
    const mq = window.matchMedia("(max-width: 1023px)");
    const sync = () => setIsNarrowViewport(mq.matches);
    sync();
    mq.addEventListener("change", sync);
    return () => mq.removeEventListener("change", sync);
  }, []);

  const [planTariffPanelOpen, setPlanTariffPanelOpen] = useState(false);
  const [tariffModalOpen, setTariffModalOpen] = useState(false);
  const [maxPlanHover, setMaxPlanHover] = useState(false);
  const [maxPlanCursor, setMaxPlanCursor] = useState<{ x: number; y: number }>({ x: 0, y: 0 });

  /** Пока открыта модалка тарифов — держим блокировку скролла (счётчик в `bodyScrollLock`, совместимо с bottom sheet). */
  useEffect(() => {
    if (!tariffModalOpen || typeof document === "undefined") return;
    return acquireBodyScrollLock();
  }, [tariffModalOpen]);

  /** Смена ширины viewport: сбрасываем тарифную панель (десктопный hover / mobile sheet), без зависимости от planTariffPanelOpen — иначе hover на десктопе мгновенно закрывается. */
  useEffect(() => {
    setPlanTariffPanelOpen(false);
  }, [isNarrowViewport]);

  const notices: Notice[] = useMemo(
    () =>
      currentPlan === "free"
        ? [
            {
              id: "free-upgrade",
              type: "upgrade",
              title: "Обновите тариф",
              text: "Обновите тариф чтобы разблокировать весь функционал и получить максимум возможностей.",
              unread: true,
            },
          ]
        : [
            {
              id: "1",
              type: "info",
              title: "Meta готова к синку",
              text: "Выберите кабинет и запустите синхронизацию.",
              time: "только что",
              unread: true,
            },
            {
              id: "2",
              type: "warn",
              title: "Атрибуция: есть пробелы",
              text: "Проверьте события и UTM-метки.",
              time: "10 мин назад",
              unread: true,
            },
            {
              id: "3",
              type: "success",
              title: "Данные обновлены",
              text: "Сводка пересчитана за сегодня.",
              time: "сегодня",
              unread: false,
            },
          ],
    [currentPlan]
  );

  const unreadCount = useMemo(() => notices.filter((n) => n.unread).length, [notices]);

  useEffect(() => {
    if (!canPrefetchDataQuality) {
      setDataQuality(null);
      setDataQualityLoading(false);
      return;
    }
    async function loadDataQuality() {
      if (!projectId) {
        setDataQuality(null);
        setDataQualityLoading(false);
        return;
      }
      setDataQualityLoading(true);
      try {
        const r = await fetch(`/api/data-quality?project_id=${encodeURIComponent(projectId)}&days=30`, {
          cache: "no-store",
        });
        const j = (await r.json()) as {
          success?: boolean;
          has_data?: boolean;
          score?: number | null;
          label?: string;
          breakdown?: DataQualityPayload["breakdown"];
          issues?: DataQualityPayload["issues"];
          recommendations?: DataQualityPayload["recommendations"];
        };
        if (j?.success && j?.has_data !== undefined) {
          setDataQuality({
            has_data: j.has_data,
            score: j.score ?? null,
            label: j.label ?? "No data",
            breakdown: j.breakdown ?? null,
            issues: Array.isArray(j.issues) ? j.issues : [],
            recommendations: Array.isArray(j.recommendations) ? j.recommendations : [],
          });
        } else {
          setDataQuality({
            has_data: false,
            score: null,
            label: "No data",
            breakdown: null,
            issues: [],
            recommendations: [],
          });
        }
      } catch {
        setDataQuality({
          has_data: false,
          score: null,
          label: "No data",
          breakdown: null,
          issues: [],
          recommendations: [],
        });
      } finally {
        setDataQualityLoading(false);
      }
    }
    loadDataQuality();
  }, [projectId, canPrefetchDataQuality]);

  // ✅ Закрытие попапа по клику вне (только desktop; на mobile — bottom sheet со своим фоном)
  useEffect(() => {
    function onDocClick(e: MouseEvent) {
      if (!notifOpen || isNarrowViewport) return;
      const el = popoverRef.current;
      if (!el) return;
      if (e.target instanceof Node && !el.contains(e.target)) setNotifOpen(false);
    }
    document.addEventListener("mousedown", onDocClick);
    return () => document.removeEventListener("mousedown", onDocClick);
  }, [notifOpen, isNarrowViewport]);

  // ✅ Esc закрывает открытые панели (mobile sheets / dropdowns)
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key !== "Escape") return;
      setNotifOpen(false);
      setMobileProfileOpen(false);
      setMobileProjectOpen(false);
      setPlanTariffPanelOpen(false);
    }
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, []);

  const logout = async () => {
    clearBillingRouteStorage();
    await supabase.auth.signOut();
    router.replace("/login");
  };

  const pendingPlanChange = !billingUiLoading && resolvedUi?.pending_plan_change === true;
  const canManageBillingForCheckout =
    !billingUiLoading &&
    resolvedUi &&
    billingActionAllowed(resolvedUi, ActionId.billing_manage) &&
    !pendingPlanChange;

  /**
   * Единый вход в выбор тарифа: сначала глобальная модалка с `force` (Free / navigate_* без billing_manage),
   * иначе локальная модалка Topbar при полном billing_manage, иначе — настройки.
   */
  const openTopbarTariffFlow = useCallback(
    (sourceAction: "topbar_upgrade" | "topbar_notifications"): "pricing" | "settings" | "noop" => {
      if (pendingPlanChange) return "noop";
      if (billingUiLoading && !resolvedUi) return "noop";

      const payloadPlan =
        resolveBootstrapPlanAnalyticsSlug(bootstrap ?? null) ??
        (matrix?.plan as string | undefined) ??
        "unknown";

      if (requestBillingPricingModal(sourceAction, { force: true })) {
        emitBillingCjmEvent(
          "upgrade_clicked",
          billingPayloadFromResolved(resolvedUi ?? null, {
            plan: payloadPlan,
            userId: null,
            source_action: sourceAction,
          })
        );
        return "pricing";
      }
      if (canManageBillingForCheckout) {
        emitBillingCjmEvent(
          "upgrade_clicked",
          billingPayloadFromResolved(resolvedUi ?? null, {
            plan: payloadPlan,
            userId: null,
            source_action: sourceAction,
          })
        );
        setTariffModalOpen(true);
        return "pricing";
      }
      router.push(
        projectId ? `/app/settings?project_id=${encodeURIComponent(projectId)}` : "/app/settings"
      );
      return "settings";
    },
    [
      pendingPlanChange,
      billingUiLoading,
      resolvedUi,
      requestBillingPricingModal,
      bootstrap,
      matrix?.plan,
      canManageBillingForCheckout,
      router,
      projectId,
      setTariffModalOpen,
    ]
  );

  const handleOpenTariffFromNotif = useCallback(() => {
    const r = openTopbarTariffFlow("topbar_notifications");
    if (r !== "noop") setNotifOpen(false);
  }, [openTopbarTariffFlow]);

  const mobileNav = useOptionalAppMobileNav();
  const [mobileProfileOpen, setMobileProfileOpen] = useState(false);
  const [mobileProjectOpen, setMobileProjectOpen] = useState(false);

  const handleMobileSelectProject = useCallback(
    (id: string) => {
      setMobileProjectOpen(false);
      setActiveProjectId(id);
      if (canNavigateApp) {
        void fetch(`/api/projects/${encodeURIComponent(id)}/touch`, { method: "POST" }).catch(() => null);
      }
      router.push(`/app?project_id=${encodeURIComponent(id)}`);
    },
    [canNavigateApp, router]
  );

  useEffect(() => {
    if (!mobileProjectOpen) return;
    if (!isNarrowViewport) setMobileProjectOpen(false);
  }, [isNarrowViewport, mobileProjectOpen]);

  /** Смена страницы: не оставлять «невидимый» слой sheet (см. MobileBottomSheet — анимация закрытия). */
  useEffect(() => {
    setMobileProjectOpen(false);
    setMobileProfileOpen(false);
    setNotifOpen(false);
    setPlanTariffPanelOpen(false);
    setTariffModalOpen(false);
  }, [pathname]);

  return (
    <>
    <header
      className="topbar-app-header"
      style={{
        width: "100%",
        boxSizing: "border-box",
        position: "relative",
        zIndex: 30,
        borderBottom: "1px solid rgba(255,255,255,0.08)",
        background: "rgba(11,11,16,0.75)",
        backdropFilter: "blur(10px)",
      }}
    >
      {/* ─── Desktop (lg+): прежняя одна строка — без изменений визуала ─── */}
      <div
        className="hidden h-16 w-full flex-row items-center justify-between lg:flex"
        style={{ padding: "0 24px" }}
      >
      {/* Project context: project name + section */}
      <div
        style={{
          display: "flex",
          flexDirection: "column",
          gap: 2,
          minWidth: 0,
        }}
      >
        <div
          style={{
            fontWeight: 800,
            fontSize: 15,
            color: "white",
            opacity: 0.95,
            lineHeight: 1.2,
            overflow: "hidden",
            textOverflow: "ellipsis",
            whiteSpace: "nowrap",
          }}
        >
          {projectName ?? "BoardIQ"}
        </div>
        <div
          style={{
            fontSize: 12,
            color: "rgba(255,255,255,0.55)",
            lineHeight: 1.2,
            overflow: "hidden",
            textOverflow: "ellipsis",
            whiteSpace: "nowrap",
          }}
        >
          {section}
        </div>
      </div>

      <div style={{ display: "flex", alignItems: "center", gap: 18 }}>
        <DataHealthMini projectId={projectId} initialData={dataQuality} dataQualityPrefetchPending={dataQualityLoading} />

        {/* Notifications */}
        <div ref={popoverRef} style={{ position: "relative" }}>
          <button
            type="button"
            onClick={() => setNotifOpen((v) => !v)}
            style={{
              height: 40,
              width: 40,
              borderRadius: 14,
              border: "1px solid rgba(255,255,255,0.12)",
              background: "rgba(255,255,255,0.06)",
              color: "white",
              cursor: "pointer",
              display: "grid",
              placeItems: "center",
              position: "relative",
              padding: 0,
              lineHeight: 0, // ✅ убирает “расползание” svg
            }}
            aria-label="Уведомления"
          >
            <BellIcon size={18} />

            {unreadCount > 0 && (
              <span
                style={{
                  position: "absolute",
                  top: -7,
                  right: -7,
                  height: 20,
                  minWidth: 20,
                  padding: "0 6px",
                  borderRadius: 999,
                  background: "rgba(255,120,120,0.95)",
                  color: "white",
                  fontSize: 12,
                  fontWeight: 900,
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  border: "2px solid rgba(11,11,16,0.95)",
                  boxSizing: "border-box",
                }}
              >
                {unreadCount}
              </span>
            )}
          </button>

          {notifOpen && !isNarrowViewport ? (
            <div
              style={{
                position: "absolute",
                top: 52,
                right: 0,
                width: 360,
                maxWidth: "calc(100vw - 48px)",
                borderRadius: 18,
                border: "1px solid rgba(255,255,255,0.10)",
                background: "rgba(18,18,26,0.96)", // ✅ меньше “прозрачность”
                backdropFilter: "blur(10px)",
                boxShadow: "0 20px 60px rgba(0,0,0,0.75)",
                padding: 14,
                zIndex: 999, // ✅ поверх всего
                boxSizing: "border-box",
              }}
            >
              {/* header */}
              <div
                style={{
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "space-between",
                  gap: 12,
                  padding: "4px 2px 10px 2px",
                }}
              >
                <div style={{ fontWeight: 900, fontSize: 16 }}>Уведомления</div>

                <button
                  type="button"
                  onClick={() => setNotifOpen(false)}
                  style={{
                    height: 34,
                    width: 34,
                    borderRadius: 12,
                    border: "1px solid rgba(255,255,255,0.14)",
                    background: "rgba(255,255,255,0.06)",
                    color: "white",
                    cursor: "pointer",
                    display: "grid",
                    placeItems: "center",
                    padding: 0,
                    lineHeight: 0,
                    flex: "0 0 auto",
                  }}
                  aria-label="Закрыть"
                >
                  ✕
                </button>
              </div>

              {/* list */}
              <div style={{ display: "grid", gap: 10 }}>
                {notices.map((n) => {
                  const cardShellStyle: CSSProperties = {
                    borderRadius: 16,
                    border: "1px solid rgba(255,255,255,0.08)",
                    background: "rgba(255,255,255,0.05)",
                    padding: 12,
                    boxSizing: "border-box",
                    width: "100%",
                  };
                  const body = (
                    <div style={{ display: "flex", gap: 10, alignItems: "flex-start" }}>
                      <Dot color={typeDotColor(n.type)} />
                      <div style={{ minWidth: 0, flex: "1 1 auto" }}>
                        <div
                          style={{
                            fontWeight: 900,
                            color: typeColor(n.type),
                            fontSize: 15,
                            lineHeight: 1.2,
                            margin: 0,
                          }}
                        >
                          {n.title}
                        </div>

                        <div
                          style={{
                            fontSize: 13,
                            opacity: 0.82,
                            marginTop: 6,
                            lineHeight: 1.35,
                            whiteSpace: "normal",
                            overflowWrap: "anywhere",
                            wordBreak: "break-word",
                          }}
                        >
                          {n.text}
                        </div>

                        {n.time ? (
                          <div
                            style={{
                              fontSize: 12,
                              opacity: 0.55,
                              marginTop: 8,
                              lineHeight: 1.2,
                            }}
                          >
                            {n.time}
                          </div>
                        ) : null}
                      </div>
                    </div>
                  );
                  if (n.type === "upgrade") {
                    return (
                      <button
                        key={n.id}
                        type="button"
                        disabled={pendingPlanChange}
                        onClick={handleOpenTariffFromNotif}
                        style={{
                          ...cardShellStyle,
                          display: "block",
                          cursor: pendingPlanChange ? "not-allowed" : "pointer",
                          textAlign: "left",
                          font: "inherit",
                          color: "inherit",
                          opacity: pendingPlanChange ? 0.55 : 1,
                        }}
                      >
                        {body}
                      </button>
                    );
                  }
                  return (
                    <div key={n.id} style={cardShellStyle}>
                      {body}
                    </div>
                  );
                })}
              </div>

              {/* footer hint */}
              <div style={{ marginTop: 10, fontSize: 12, opacity: 0.55 }}>
                Esc — закрыть • клик вне окна — закрыть
              </div>
            </div>
          ) : null}
        </div>

          {/* Тариф: без group-hover — иначе «ложное» наведение на кнопку при движении по дашборду ниже */}
        <div
          className="relative"
          style={{ flex: "0 0 auto" }}
          onMouseLeave={() => setPlanTariffPanelOpen(false)}
        >
          <div
            className="flex cursor-default items-center gap-2 rounded-xl px-4 py-2"
            onMouseEnter={() => setPlanTariffPanelOpen(true)}
            style={{
              border: `1px solid ${planTheme.border}`,
              background: planTheme.bg,
              boxShadow: `inset 0 0 0 1px rgba(255,255,255,0.02)`,
            }}
          >
            <span
              aria-hidden
              style={{
                width: 10,
                height: 10,
                borderRadius: 999,
                background: planTheme.dot,
                boxShadow: `0 0 0 4px ${planTheme.dotGlow}`,
              }}
            />
            <div style={{ display: "flex", flexDirection: "column", lineHeight: 1.05 }}>
              <div style={{ fontWeight: 900, fontSize: 13, color: "white" }}>{planTheme.label}</div>
            </div>
          </div>

          {/* Панель: видимость только по state, не по group-hover */}
          <div
            className={`absolute left-0 top-full z-[1000] w-[330px] flex-col rounded-2xl border border-white/10 bg-[#0f0f14] p-4 shadow-[0_24px_80px_rgba(0,0,0,0.65)] transition-opacity duration-150 ${
              planTariffPanelOpen ? "visible pointer-events-auto opacity-100" : "invisible pointer-events-none opacity-0"
            }`}
            onMouseEnter={() => setPlanTariffPanelOpen(true)}
          >
              <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                <span
                  aria-hidden
                  style={{
                    width: 10,
                    height: 10,
                    borderRadius: 999,
                    flexShrink: 0,
                    background: planTheme.dot,
                    boxShadow: `0 0 0 4px ${planTheme.dotGlow}`,
                  }}
                />
                <div style={{ fontWeight: 900, color: "white", fontSize: 14 }}>{planTheme.label}</div>
              </div>
            {planCaptionLine ? (
              <div
                style={{
                  marginTop: 6,
                  fontSize: 12,
                  opacity: 0.72,
                  color: "rgba(228,228,235,0.95)",
                  lineHeight: 1.35,
                }}
              >
                {planCaptionLine}
              </div>
            ) : null}

            <div style={{ marginTop: 14, fontSize: 13, lineHeight: 1.45, color: "rgba(228,228,235,0.92)" }}>
              {planTariffFeatureLines.map((line, i) => (
                <div
                  key={line}
                  style={{
                    display: "flex",
                    gap: 10,
                    alignItems: "flex-start",
                    marginTop: i === 0 ? 0 : 8,
                  }}
                >
                  <span
                    style={{
                      width: 18,
                      flexShrink: 0,
                      textAlign: "center",
                      paddingTop: 2,
                      color: "rgba(52,211,153,0.9)",
                    }}
                    aria-hidden
                  >
                    ✓
                  </span>
                  <span>{line}</span>
                </div>
              ))}
            </div>

            <div className="relative">
              <button
                type="button"
                className={
                  isMaxPlan || pendingPlanChange
                    ? "mt-4 h-11 cursor-not-allowed rounded-xl border border-white/10 bg-white/[0.06] px-6 text-sm font-extrabold text-white/55 md:mt-5"
                    : "mt-4 h-11 cursor-pointer rounded-xl border border-[#4aad7c] bg-[#39946B] px-6 text-sm font-extrabold text-white shadow-[0_6px_22px_rgba(57,148,107,0.38)] transition hover:bg-[#328a63] hover:brightness-[1.03] active:bg-[#2d7355] md:mt-5"
                }
                aria-disabled={isMaxPlan || pendingPlanChange}
                title={
                  pendingPlanChange
                    ? "Смена тарифа уже обрабатывается — не оплачивайте повторно"
                    : undefined
                }
                onClick={(e) => {
                  e.preventDefault();
                  e.stopPropagation();
                  if (isMaxPlan || pendingPlanChange) {
                    return;
                  }
                  const r = openTopbarTariffFlow("topbar_upgrade");
                  if (r === "pricing") queueMicrotask(() => setPlanTariffPanelOpen(false));
                  if (r === "settings") setPlanTariffPanelOpen(false);
                }}
                onMouseEnter={(e) => {
                  if (!isMaxPlan) return;
                  setMaxPlanHover(true);
                  setMaxPlanCursor({ x: e.clientX, y: e.clientY });
                }}
                onMouseMove={(e) => {
                  if (!isMaxPlan || !maxPlanHover) return;
                  setMaxPlanCursor({ x: e.clientX, y: e.clientY });
                }}
                onMouseLeave={() => {
                  if (!isMaxPlan) return;
                  setMaxPlanHover(false);
                }}
              >
                Сменить тариф
              </button>

              {isMaxPlan &&
                typeof document !== "undefined" &&
                maxPlanHover &&
                createPortal(
                  <div
                    role="tooltip"
                    aria-live="polite"
                    className="pointer-events-none fixed z-[99999] max-w-[260px] rounded-xl border border-white/10 bg-[#0f0f14] px-3 py-2 text-xs font-semibold text-white/90 shadow-[0_24px_80px_rgba(0,0,0,0.65)]"
                    style={{
                      left: maxPlanCursor.x + 12,
                      top: maxPlanCursor.y + 1,
                    }}
                  >
                    У вас максимальный тариф
                  </div>,
                  document.body
                )}
            </div>
          </div>
        </div>

        <div style={{ opacity: 0.7, fontSize: 13 }}>{email || "—"}</div>

        <button
          onClick={logout}
          style={{
            padding: "8px 12px",
            borderRadius: 10,
            border: "1px solid rgba(255,255,255,0.14)",
            background: "rgba(255,255,255,0.06)",
            color: "white",
            cursor: "pointer",
            lineHeight: 1,
          }}
        >
          Выйти
        </button>
      </div>
      </div>

      {/* Mobile (<lg): v2 — brand row + primary row + context; без «инпутного» проекта и без email в primary */}
      <div className="flex w-full min-w-0 flex-col lg:hidden">
        <div
          className="flex items-center gap-2 border-b border-white/[0.05] pb-1.5 pl-[max(14px,env(safe-area-inset-left))] pr-[max(14px,env(safe-area-inset-right))] pt-[max(8px,env(safe-area-inset-top))]"
        >
          {mobileNav ? (
            <button
              type="button"
              onClick={() => {
                if (!mobileNav.mobileNavOpen) {
                  mobileNav.setTodayDrawerOpen(false);
                }
                mobileNav.toggleMobileNav();
              }}
              className="grid h-8 w-8 shrink-0 place-items-center rounded-lg text-zinc-400 transition hover:bg-white/[0.06] hover:text-white"
              aria-label="Открыть меню"
            >
              <MenuIcon size={18} />
            </button>
          ) : null}
          <span className="text-[10px] font-semibold uppercase tracking-[0.14em] text-zinc-500">
            BOARDIQ
          </span>
        </div>

        <div className="flex min-h-[48px] w-full min-w-0 items-center gap-3 border-b border-white/[0.06] py-2 pl-[max(14px,env(safe-area-inset-left))] pr-[max(14px,env(safe-area-inset-right))]">
          <div className="min-w-0 flex-1">
            <button
              type="button"
              onClick={() => {
                setMobileProfileOpen(false);
                setPlanTariffPanelOpen(false);
                setNotifOpen(false);
                setMobileProjectOpen((o) => !o);
              }}
              className="flex w-full min-w-0 max-w-full items-center gap-2 border-0 bg-transparent p-0 text-left outline-none focus-visible:rounded-md focus-visible:ring-2 focus-visible:ring-white/25 focus-visible:ring-offset-2 focus-visible:ring-offset-[#0b0b10]"
              aria-expanded={mobileProjectOpen}
              aria-haspopup="dialog"
            >
              <span className="min-w-0 flex-1 truncate text-[16px] font-semibold leading-tight tracking-tight text-white">
                {projectName ?? "Выберите проект"}
              </span>
              <ChevronDownIcon size={18} />
            </button>
          </div>

          <div className="flex shrink-0 items-center gap-1.5">
            <button
              type="button"
              onClick={() => {
                setMobileProjectOpen(false);
                setNotifOpen((v) => !v);
              }}
              className="relative grid h-9 w-9 place-items-center rounded-lg border border-white/[0.08] bg-white/[0.03] text-white"
              aria-label="Уведомления"
            >
              <BellIcon size={17} />
              {unreadCount > 0 ? (
                <span className="absolute -right-0.5 -top-0.5 flex h-[15px] min-w-[15px] items-center justify-center rounded-full bg-[rgba(248,113,113,0.95)] px-0.5 text-[9px] font-bold leading-none text-white ring-1 ring-[#0b0b10]">
                  {unreadCount > 9 ? "9+" : unreadCount}
                </span>
              ) : null}
            </button>

            <button
              type="button"
              className="flex h-9 max-w-[5.5rem] shrink-0 items-center gap-1.5 rounded-lg border border-white/[0.1] bg-white/[0.03] px-2"
              style={{ borderColor: `${planTheme.border}99` }}
              onClick={() => {
                setMobileProjectOpen(false);
                setPlanTariffPanelOpen((o) => !o);
              }}
              aria-expanded={planTariffPanelOpen}
            >
              <span
                aria-hidden
                className="h-1.5 w-1.5 shrink-0 rounded-full"
                style={{ background: planTheme.dot }}
              />
              <span className="truncate text-[11px] font-semibold text-white">{planTheme.label}</span>
            </button>

            <button
              type="button"
              onClick={() => {
                setMobileProjectOpen(false);
                setMobileProfileOpen((o) => !o);
              }}
              className="grid h-9 w-9 place-items-center rounded-lg border border-white/[0.08] bg-white/[0.03] text-zinc-300"
              aria-label="Профиль и аккаунт"
              aria-expanded={mobileProfileOpen}
            >
              <UserMenuIcon size={17} />
            </button>
          </div>
        </div>

        <DataHealthMini
          variant="mobileContextStrip"
          projectId={projectId}
          initialData={dataQuality}
          dataQualityPrefetchPending={dataQualityLoading}
        />
      </div>

      <MobileBottomSheet
        open={Boolean(mobileProjectOpen && isNarrowViewport)}
        onOpenChange={setMobileProjectOpen}
        title="Выберите проект"
        titleId="mobile-project-sheet-title"
        titleBottomPaddingExtraPx={6}
        panelMaxClassName="max-h-[min(72dvh,560px)]"
        contentClassName="pb-2"
        cancelFooterHideTopBorder
        bottomContent={
          <div className="-mx-4 border-t border-white/[0.06] px-4 pt-3">
            <Link
              href={
                projectId ? `/app/projects?project_id=${encodeURIComponent(projectId)}` : "/app/projects"
              }
              className="block w-full py-2 text-center text-[15px] font-medium text-white no-underline hover:underline"
              onClick={() => setMobileProjectOpen(false)}
            >
              Все проекты
            </Link>
          </div>
        }
      >
        {projects.length === 0 ? (
          <p className="px-3 py-8 text-center text-[13px] leading-snug text-zinc-500">Пока нет проектов</p>
        ) : (
          <ul className="flex flex-col gap-0.5" role="listbox" aria-labelledby="mobile-project-sheet-title">
            {projects.map((p) => {
              const active = projectId === p.id;
              return (
                <li key={p.id}>
                  <button
                    type="button"
                    role="option"
                    aria-selected={active}
                    className={`flex w-full items-start gap-2 rounded-xl px-3 py-3.5 text-left transition-colors ${
                      active
                        ? "bg-white/[0.08] ring-1 ring-white/[0.07]"
                        : "hover:bg-white/[0.04] active:bg-white/[0.07]"
                    }`}
                    onClick={() => handleMobileSelectProject(p.id)}
                  >
                    <div className="min-w-0 flex-1">
                      <div
                        className={`truncate text-[15px] leading-snug ${
                          active ? "font-semibold text-white" : "font-medium text-zinc-200"
                        }`}
                      >
                        {p.name || "Без названия"}
                      </div>
                      <div className="mt-1 font-mono text-[11px] tracking-wide text-zinc-500">
                        {shortProjectId(p.id)}
                      </div>
                    </div>
                    <span
                      className={`mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center text-[15px] font-semibold leading-none ${
                        active ? "text-emerald-400" : "text-transparent"
                      }`}
                      aria-hidden
                    >
                      ✓
                    </span>
                  </button>
                </li>
              );
            })}
          </ul>
        )}
      </MobileBottomSheet>

      <MobileBottomSheet
        open={Boolean(mobileProfileOpen && isNarrowViewport)}
        onOpenChange={setMobileProfileOpen}
        title="Профиль"
        titleId="mobile-profile-sheet-title"
        contentClassName="!px-4 pb-3 pt-0.5"
        showHeaderDivider={false}
      >
        <div className="inline-flex min-w-0 max-w-full flex-wrap items-baseline gap-x-1.5 gap-y-0.5">
          <span className="min-w-0 max-w-full break-words text-[14px] font-medium leading-snug text-white">
            {email || "Аккаунт"}
          </span>
          <span className="inline-flex shrink-0 items-center gap-1">
            <span
              aria-hidden
              className="shrink-0 rounded-full"
              style={{
                width: 8,
                height: 8,
                background: planTheme.dot,
                boxShadow: `0 0 0 2px ${planTheme.dotGlow}`,
              }}
            />
            <span className="text-[13px] font-semibold leading-snug text-zinc-100">{planTheme.label}</span>
          </span>
        </div>
        <div className={`my-3.5 w-full ${mobileSheetDividerClassName}`} />
        <div className="flex flex-col gap-0.5">
          <Link
            href={
              projectId ? `/app/settings?project_id=${encodeURIComponent(projectId)}` : "/app/settings"
            }
            className={`${mobileSheetActionRowClassName} text-white no-underline`}
            onClick={() => setMobileProfileOpen(false)}
          >
            <span
              className="inline-flex h-[22px] min-h-[22px] w-[22px] min-w-[22px] shrink-0 items-center justify-center leading-none"
              aria-hidden
            >
              <SettingsGearIcon size={20} />
            </span>
            <span className="min-w-0">Настройки</span>
          </Link>
          <button
            type="button"
            onClick={() => {
              setMobileProfileOpen(false);
              void logout();
            }}
            className={`${mobileSheetActionRowClassName} text-zinc-300 hover:bg-red-500/[0.08] hover:text-red-200/95 active:bg-red-500/[0.1]`}
          >
            <span
              className="inline-flex h-6 min-h-[24px] w-6 min-w-[24px] shrink-0 items-center justify-center leading-none"
              aria-hidden
            >
              <LogoutDoorIcon size={22} />
            </span>
            <span className="min-w-0">Выйти</span>
          </button>
        </div>
      </MobileBottomSheet>

      <MobileBottomSheet
        open={Boolean(planTariffPanelOpen && isNarrowViewport)}
        onOpenChange={setPlanTariffPanelOpen}
        title="Текущий тариф"
        titleId="mobile-tariff-sheet-title"
        subtitle={
          <span className="flex min-w-0 items-center gap-2.5">
            <span
              aria-hidden
              className="shrink-0 rounded-full"
              style={{
                width: 10,
                height: 10,
                background: planTheme.dot,
                boxShadow: `0 0 0 4px ${planTheme.dotGlow}`,
              }}
            />
            <span className="min-w-0 text-[15px] font-semibold leading-snug text-zinc-100">{planTheme.label}</span>
          </span>
        }
        panelMaxClassName="max-h-[min(64dvh,520px)]"
        contentClassName="!px-4 pb-4 pt-1"
      >
        {planCaptionLine ? (
          <p className="text-[13px] leading-relaxed text-zinc-400">{planCaptionLine}</p>
        ) : null}
        <ul className="mt-4 space-y-3 text-[14px] leading-snug text-zinc-200">
          {planTariffFeatureLines.map((line) => (
            <li key={line} className="flex gap-3">
              <span className="w-5 shrink-0 pt-0.5 text-center text-[15px] text-emerald-400/90" aria-hidden>
                ✓
              </span>
              <span className="min-w-0">{line}</span>
            </li>
          ))}
        </ul>
        <button
          type="button"
          className={
            isMaxPlan || pendingPlanChange
              ? "mt-6 w-full cursor-not-allowed rounded-xl border border-white/10 bg-transparent py-3 text-center text-[15px] font-medium text-white/40"
              : "mt-6 w-full rounded-xl border border-[#4aad7c] bg-[#39946B] py-3 text-center text-[15px] font-extrabold text-white shadow-[0_8px_28px_rgba(57,148,107,0.4)] transition-colors hover:bg-[#328a63] hover:brightness-[1.03] active:bg-[#2d7355]"
          }
          aria-disabled={isMaxPlan || pendingPlanChange}
          title={
            pendingPlanChange ? "Смена тарифа уже обрабатывается — не оплачивайте повторно" : undefined
          }
          onClick={(e) => {
            e.preventDefault();
            e.stopPropagation();
            if (isMaxPlan || pendingPlanChange) {
              return;
            }
            const r = openTopbarTariffFlow("topbar_upgrade");
            if (r === "pricing") queueMicrotask(() => setPlanTariffPanelOpen(false));
            if (r === "settings") setPlanTariffPanelOpen(false);
          }}
        >
          Сменить тариф
        </button>
      </MobileBottomSheet>

      <MobileBottomSheet
        open={Boolean(notifOpen && isNarrowViewport)}
        onOpenChange={setNotifOpen}
        title="Уведомления"
        titleId="mobile-notif-sheet-title"
        subtitle="Свежие события по проекту"
        variant="notifications"
        headerRight={<MobileSheetHeaderCloseButton onClick={() => setNotifOpen(false)} />}
        panelMaxClassName="min-h-[min(78dvh,560px)] max-h-[78dvh]"
        contentClassName="pb-4"
      >
        <div
          className="grid gap-3 px-2"
          onKeyDown={(e) => e.key === "Escape" && setNotifOpen(false)}
          role="list"
        >
          {notices.map((n) => {
            const cardClassName =
              "rounded-[14px] border border-white/[0.07] bg-white/[0.055] p-3.5 text-left shadow-[inset_0_1px_0_rgba(255,255,255,0.04)]";
            const inner = (
              <div className="flex gap-3">
                <Dot color={typeDotColor(n.type)} soft />
                <div className="min-w-0 flex-1">
                  <div className="text-[15px] font-semibold leading-snug text-white">{n.title}</div>
                  <div className="mt-1 text-[13px] leading-snug text-zinc-400 [overflow-wrap:anywhere] [word-break:break-word]">
                    {n.text}
                  </div>
                  {n.time ? (
                    <div className="mt-2 text-[11px] font-medium text-zinc-600">{n.time}</div>
                  ) : null}
                </div>
              </div>
            );
            if (n.type === "upgrade") {
              return (
                <button
                  key={n.id}
                  type="button"
                  className={`${cardClassName} w-full cursor-pointer font-[inherit] text-inherit transition-colors hover:bg-white/[0.07] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/25 disabled:cursor-not-allowed`}
                  style={{ opacity: pendingPlanChange ? 0.55 : 1 }}
                  disabled={pendingPlanChange}
                  onClick={handleOpenTariffFromNotif}
                >
                  {inner}
                </button>
              );
            }
            return (
              <div key={n.id} className={cardClassName}>
                {inner}
              </div>
            );
          })}
        </div>
      </MobileBottomSheet>
    </header>
    {tariffModalOpen &&
      typeof document !== "undefined" &&
      createPortal(
        <div
          role="dialog"
          aria-modal="true"
          aria-label="Смена тарифа"
          className="fixed inset-0 z-[2200] flex items-center justify-center overflow-y-auto overscroll-contain bg-[rgba(8,8,12,0.88)] p-3 pt-[max(10px,env(safe-area-inset-top))] pb-[max(10px,env(safe-area-inset-bottom))] backdrop-blur-[8px] sm:p-5"
          onClick={() => setTariffModalOpen(false)}
        >
          {/*
            Как в BillingPricingModalProvider: ограничить высоту и дать flex-1 + overflow-y-auto,
            иначе BillingInlinePricing выше экрана — скролла нет (баг на мобилке после «Сменить тариф»).
          */}
          <div
            className="relative box-border flex min-h-0 w-full max-h-[min(92dvh,calc(100dvh-24px))] max-w-[min(880px,calc(100vw-24px))] flex-col overflow-hidden rounded-2xl border border-white/[0.12] bg-[rgba(18,18,26,0.98)] shadow-[0_24px_80px_rgba(0,0,0,0.65)] sm:max-h-[min(92vh,calc(100vh-40px))] sm:max-w-[min(880px,calc(100vw-40px))]"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="sticky top-0 z-20 flex shrink-0 justify-end bg-gradient-to-b from-[rgba(18,18,26,0.98)] from-70% to-transparent px-3 pb-3 pt-2 sm:px-3.5 sm:pb-3.5 sm:pt-3.5">
              <button
                type="button"
                onClick={() => setTariffModalOpen(false)}
                className="flex size-10 shrink-0 items-center justify-center rounded-[10px] border border-white/20 bg-white/[0.06] leading-none text-white"
                aria-label="Закрыть"
              >
                <span className="block text-[18px] leading-none">✕</span>
              </button>
            </div>
            <div className="scrollbar-hidden box-border min-h-0 flex-1 overflow-y-auto overscroll-contain px-3 pb-6 pt-px [-webkit-overflow-scrolling:touch] sm:px-8 sm:pb-8">
              <BillingInlinePricingSuspended
                projectId={projectId}
                suggestPlan={suggestUpgradePlanId(bootstrap?.plan_feature_matrix?.plan)}
                showComparisonLink
                widePlanGrid
                pricingModalEntrySource="topbar_upgrade"
                onAfterCheckoutCompleted={() => setTariffModalOpen(false)}
              />
            </div>
          </div>
        </div>,
        document.body
      )}
    </>
  );
}