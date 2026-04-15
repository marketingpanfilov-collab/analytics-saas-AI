"use client";

import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { acquireBodyScrollLock } from "@/app/lib/bodyScrollLock";
import { createPortal } from "react-dom";
import { useAppMobileNav } from "../AppMobileNavContext";

const PANEL_MS = 280;
const BACKDROP_MS = 220;
const MOBILE_TODAY_DRAWER_Z = 185;

/**
 * Левый full-height drawer для блока «Сегодня» (только mobile).
 * Контент монтируется через portal из Sidebar — та же бизнес-логика и данные.
 */
export default function MobileTodayDrawer() {
  const {
    todayDrawerOpen,
    setTodayDrawerOpen,
    setTodayDrawerPortalContainer,
    todayDrawerProjectLabel,
  } = useAppMobileNav();
  const [mounted, setMounted] = useState(false);
  const [visible, setVisible] = useState(false);
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const touchStartX = useRef<number | null>(null);

  useEffect(() => {
    if (todayDrawerOpen) {
      setMounted(true);
      const id = requestAnimationFrame(() => {
        requestAnimationFrame(() => setVisible(true));
      });
      return () => cancelAnimationFrame(id);
    }
    setVisible(false);
    const t = window.setTimeout(() => setMounted(false), PANEL_MS);
    return () => window.clearTimeout(t);
  }, [todayDrawerOpen]);

  useLayoutEffect(() => {
    if (!mounted) {
      setTodayDrawerPortalContainer(null);
      return;
    }
    setTodayDrawerPortalContainer(scrollRef.current);
    return () => setTodayDrawerPortalContainer(null);
  }, [mounted, setTodayDrawerPortalContainer]);

  useEffect(() => {
    if (!mounted) return;
    return acquireBodyScrollLock();
  }, [mounted]);

  const close = useCallback(() => setTodayDrawerOpen(false), [setTodayDrawerOpen]);

  const onTouchStart = (e: React.TouchEvent) => {
    touchStartX.current = e.touches[0]?.clientX ?? null;
  };

  const onTouchEnd = (e: React.TouchEvent) => {
    const start = touchStartX.current;
    touchStartX.current = null;
    if (start == null) return;
    const end = e.changedTouches[0]?.clientX ?? start;
    if (end - start < -56) close();
  };

  if (!mounted || typeof document === "undefined") return null;

  const panelEase = visible ? "cubic-bezier(0.22, 1, 0.36, 1)" : "cubic-bezier(0.4, 0, 1, 1)";

  return createPortal(
    <div
      className="pointer-events-none fixed inset-0 overflow-x-hidden lg:hidden"
      style={{ zIndex: MOBILE_TODAY_DRAWER_Z }}
    >
      <button
        type="button"
        aria-label="Закрыть панель"
        className={`pointer-events-auto absolute inset-0 bg-black/55 backdrop-blur-[2px] transition-opacity ${
          visible ? "opacity-100" : "opacity-0"
        }`}
        style={{
          transitionDuration: `${BACKDROP_MS}ms`,
          transitionTimingFunction: visible ? "ease-out" : "ease-in",
        }}
        onClick={close}
      />
      <aside
        role="dialog"
        aria-modal="true"
        aria-labelledby="mobile-today-drawer-project mobile-today-drawer-title"
        className="pointer-events-auto fixed inset-x-0 top-0 bottom-app-mobile-tabbar z-10 flex flex-col bg-[#0f1017] shadow-[12px_0_48px_rgba(0,0,0,0.55)] box-border min-h-0 min-w-0"
        style={{
          transform: visible ? "translate3d(0,0,0)" : "translate3d(-100%,0,0)",
          opacity: visible ? 1 : 0,
          transition: `transform ${PANEL_MS}ms ${panelEase}, opacity ${PANEL_MS}ms ${visible ? "ease-out" : "ease-in"}`,
        }}
        onClick={(e) => e.stopPropagation()}
        onTouchStart={onTouchStart}
        onTouchEnd={onTouchEnd}
      >
        {/* px-3 как у скролла + pl-[18px] как padding карточки в SidebarTodayPanel — вровень с «Отчет за сегодня». */}
        <div className="flex shrink-0 items-center gap-3 border-b border-white/[0.06] px-3 py-3 pt-[max(12px,env(safe-area-inset-top))]">
          <p
            id="mobile-today-drawer-project"
            className="min-w-0 flex-1 truncate pl-[18px] text-left text-[15px] font-semibold leading-[1.2] text-white"
            title={todayDrawerProjectLabel ?? undefined}
          >
            {todayDrawerProjectLabel ?? "\u00a0"}
          </p>
          <span id="mobile-today-drawer-title" className="sr-only">
            Отчет за сегодня
          </span>
          <button
            type="button"
            onClick={close}
            className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border border-white/[0.12] bg-white/[0.05] text-zinc-200 transition-colors hover:bg-white/[0.08] active:bg-white/[0.07]"
            aria-label="Закрыть"
          >
            <svg
              width={14}
              height={14}
              viewBox="0 0 14 14"
              className="block shrink-0"
              aria-hidden
              fill="none"
            >
              <path
                d="M3.5 3.5l7 7M10.5 3.5l-7 7"
                stroke="currentColor"
                strokeWidth={1.5}
                strokeLinecap="round"
              />
            </svg>
          </button>
        </div>

        <div
          ref={scrollRef}
          className="min-h-0 flex-1 overflow-x-hidden overflow-y-auto overscroll-contain px-3 pb-[max(20px,env(safe-area-inset-bottom))]"
        />
      </aside>
    </div>,
    document.body
  );
}
