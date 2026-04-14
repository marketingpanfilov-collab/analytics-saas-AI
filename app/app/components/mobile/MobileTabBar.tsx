"use client";

import Link from "next/link";
import { BarChart3, Clock, LayoutGrid, Menu, Send, TrendingUp } from "lucide-react";
import { usePathname, useSearchParams } from "next/navigation";
import { useMemo, useState, type ReactNode } from "react";
import { useOptionalAppMobileNav } from "../AppMobileNavContext";
import { MobileBottomSheet, mobileSheetActionRowClassName } from "./MobileBottomSheet";

type TabItem = {
  id: string;
  label: string;
  href?: string;
  isActive: (pathname: string) => boolean;
  icon: (active: boolean) => ReactNode;
  onClick?: () => void;
};

function withProjectId(path: string, projectId: string | null) {
  if (!projectId) return path;
  const hasQuery = path.includes("?");
  return `${path}${hasQuery ? "&" : "?"}project_id=${encodeURIComponent(projectId)}`;
}

const iconProps = {
  size: 20,
  strokeWidth: 1.8,
};

export default function MobileTabBar() {
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const mobileNav = useOptionalAppMobileNav();
  const [menuOpen, setMenuOpen] = useState(false);
  const projectId = searchParams.get("project_id");

  const sidebarItems = useMemo(
    () => [
      { label: "Дашборд", href: withProjectId("/app", projectId), active: pathname === "/app" },
      { label: "Отчеты", href: withProjectId("/app/reports", projectId), active: pathname.startsWith("/app/reports") },
      { label: "LTV", href: withProjectId("/app/ltv", projectId), active: pathname.startsWith("/app/ltv") },
      {
        label: "Shared Board Report",
        href: withProjectId("/app/weekly-report", projectId),
        active: pathname.startsWith("/app/weekly-report"),
      },
      {
        label: "Conversion Data",
        href: withProjectId("/app/conversion-data", projectId),
        active: pathname.startsWith("/app/conversion-data"),
      },
      {
        label: "UTM Builder",
        href: withProjectId("/app/utm-builder", projectId),
        active: pathname.startsWith("/app/utm-builder"),
      },
      { label: "Аккаунты", href: withProjectId("/app/accounts", projectId), active: pathname.startsWith("/app/accounts") },
      { label: "Pixel & CRM", href: withProjectId("/app/pixels", projectId), active: pathname.startsWith("/app/pixels") },
      { label: "Настройки", href: withProjectId("/app/settings", projectId), active: pathname.startsWith("/app/settings") },
      { label: "Поддержка", href: withProjectId("/app/support", projectId), active: pathname.startsWith("/app/support") },
    ],
    [pathname, projectId]
  );

  const hiddenByPath =
    pathname.startsWith("/app/invite/") ||
    pathname.startsWith("/app/transfer/") ||
    pathname.startsWith("/app/internal-admin") ||
    Boolean(mobileNav?.mobileNavOpen);

  if (hiddenByPath) return null;

  const todayDrawerOpen = Boolean(mobileNav?.todayDrawerOpen);

  const tabs: TabItem[] = [
    {
      id: "today",
      label: "Сегодня",
      isActive: () => todayDrawerOpen,
      icon: () => <Clock {...iconProps} aria-hidden />,
      onClick: () => {
        mobileNav?.setMobileNavOpen(false);
        mobileNav?.setTodayDrawerOpen(true);
      },
    },
    {
      id: "dashboard",
      label: "Дашборд",
      href: withProjectId("/app", projectId),
      isActive: (p) => p === "/app" && !todayDrawerOpen,
      icon: () => <LayoutGrid {...iconProps} aria-hidden />,
    },
    {
      id: "reports",
      label: "Отчеты",
      href: withProjectId("/app/reports", projectId),
      isActive: (p) => p.startsWith("/app/reports"),
      icon: () => <BarChart3 {...iconProps} aria-hidden />,
    },
    {
      id: "ltv",
      label: "LTV",
      href: withProjectId("/app/ltv", projectId),
      isActive: (p) => p.startsWith("/app/ltv"),
      icon: () => <TrendingUp {...iconProps} aria-hidden />,
    },
    {
      id: "send",
      label: "Отправить",
      href: withProjectId("/app/weekly-report", projectId),
      isActive: (p) => p.startsWith("/app/weekly-report"),
      icon: () => <Send {...iconProps} aria-hidden />,
    },
    {
      id: "menu",
      label: "Меню",
      isActive: () => menuOpen,
      icon: () => <Menu {...iconProps} aria-hidden />,
      onClick: () => {
        mobileNav?.setMobileNavOpen(false);
        mobileNav?.setTodayDrawerOpen(false);
        setMenuOpen(true);
      },
    },
  ];

  return (
    <>
      <div
        className="fixed inset-x-0 bottom-0 z-[190] border-t border-white/[0.08] bg-[#0f1017] md:hidden"
        style={{ paddingBottom: "max(8px, env(safe-area-inset-bottom))" }}
      >
        <nav className="mx-auto grid h-[58px] w-full max-w-[500px] grid-cols-6 items-center px-1" aria-label="Нижняя навигация">
          {tabs.map((tab) => {
            const active = tab.isActive(pathname);
            const iconClass = active ? "text-mint" : "text-white/50";
            const labelClass = active ? "text-white" : "text-white/50";
            const commonClass =
              "relative z-0 flex w-full min-w-0 flex-col items-center justify-center gap-[3px] rounded-lg px-0.5 py-1 transition-colors before:pointer-events-none before:absolute before:inset-x-0.5 before:top-0 before:-bottom-[5px] before:-z-10 before:rounded-lg before:bg-transparent before:transition-colors before:content-[''] active:before:bg-white/[0.06]";
            if (tab.href) {
              return (
                <Link
                  key={tab.id}
                  href={tab.href}
                  className={commonClass}
                  onClick={() => {
                    mobileNav?.setMobileNavOpen(false);
                    mobileNav?.setTodayDrawerOpen(false);
                  }}
                >
                  <span className={`translate-y-[1px] ${iconClass}`}>{tab.icon(active)}</span>
                  <span className={`translate-y-[1px] truncate text-[11px] leading-none ${labelClass}`}>{tab.label}</span>
                </Link>
              );
            }
            return (
              <button key={tab.id} type="button" className={commonClass} onClick={tab.onClick}>
                <span className={`translate-y-[1px] ${iconClass}`}>{tab.icon(active)}</span>
                <span className={`translate-y-[1px] truncate text-[11px] leading-none ${labelClass}`}>{tab.label}</span>
              </button>
            );
          })}
        </nav>
      </div>

      <MobileBottomSheet
        open={menuOpen}
        onOpenChange={setMenuOpen}
        title="Меню"
        titleId="mobile-tabbar-menu-title"
        contentClassName="px-2 pb-2 pt-1.5"
        panelMaxClassName="max-h-[min(72dvh,560px)]"
        titleBottomPaddingExtraPx={6}
      >
        <nav className="flex flex-col gap-0.5" aria-label="Разделы">
          {sidebarItems.map((item) => (
            <Link
              key={item.href}
              href={item.href}
              className={`${mobileSheetActionRowClassName} no-underline ${item.active ? "bg-white/[0.07] text-emerald-300" : ""}`}
              onClick={() => setMenuOpen(false)}
            >
              {item.label}
            </Link>
          ))}
        </nav>
      </MobileBottomSheet>
    </>
  );
}
