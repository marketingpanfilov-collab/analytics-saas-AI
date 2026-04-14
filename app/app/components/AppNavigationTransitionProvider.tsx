"use client";

import { usePathname } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";

/** Единый z-index: выше таббара (190) и mobile sheet (200). */
const NAV_TRANSITION_OVERLAY_Z = 230;

function normalizePath(p: string): string {
  if (!p || p === "") return "/";
  const trimmed = p.length > 1 && p.endsWith("/") ? p.slice(0, -1) : p;
  return trimmed || "/";
}

/** Глобальный оверлей не показываем при переходе в раздел проектов — там свой фрейм загрузки. */
function isProjectsDestination(p: string): boolean {
  const n = normalizePath(p);
  return n === "/app/projects" || n.startsWith("/app/projects/");
}

export default function AppNavigationTransitionProvider({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const [pending, setPending] = useState(false);
  const [mounted, setMounted] = useState(false);
  const pathnameRef = useRef(pathname);
  pathnameRef.current = pathname;

  const tryBegin = useCallback((nextPathname: string) => {
    const cur = normalizePath(pathnameRef.current);
    const next = normalizePath(nextPathname);
    if (cur === next) return;
    if (isProjectsDestination(next)) return;
    setPending(true);
  }, []);

  const clear = useCallback(() => {
    setPending(false);
  }, []);

  /** Навигация завершилась: Next обновил маршрут. */
  useEffect(() => {
    clear();
  }, [pathname, clear]);

  useEffect(() => {
    if (!pending) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = prev;
    };
  }, [pending]);

  useEffect(() => {
    setMounted(true);
  }, []);

  /** Клики по внутренним ссылкам — мгновенная реакция до history. */
  useEffect(() => {
    const onClickCapture = (e: MouseEvent) => {
      if (e.defaultPrevented) return;
      if (e.button !== 0) return;
      if (e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
      const t = e.target;
      if (!(t instanceof Element)) return;
      const a = t.closest("a[href]");
      if (!(a instanceof HTMLAnchorElement)) return;
      if (a.target && a.target !== "_self") return;
      if (a.hasAttribute("download")) return;
      const href = a.getAttribute("href");
      if (!href || href.startsWith("#")) return;
      let url: URL;
      try {
        url = new URL(href, window.location.origin);
      } catch {
        return;
      }
      if (url.origin !== window.location.origin) return;
      tryBegin(url.pathname);
    };
    document.addEventListener("click", onClickCapture, true);
    return () => document.removeEventListener("click", onClickCapture, true);
  }, [tryBegin]);

  /** Programmatic / router.push|replace — только если сменился pathname (не query). */
  useEffect(() => {
    if (typeof window === "undefined") return;

    const origPush = history.pushState.bind(history);
    const origReplace = history.replaceState.bind(history);

    const afterHistory = (pathnameBefore: string) => {
      const after = window.location.pathname;
      if (normalizePath(pathnameBefore) === normalizePath(after)) return;
      tryBegin(after);
    };

    history.pushState = function (...args: Parameters<History["pushState"]>) {
      const before = window.location.pathname;
      const ret = origPush(...args);
      afterHistory(before);
      return ret;
    };

    history.replaceState = function (...args: Parameters<History["replaceState"]>) {
      const before = window.location.pathname;
      const ret = origReplace(...args);
      afterHistory(before);
      return ret;
    };

    return () => {
      history.pushState = origPush;
      history.replaceState = origReplace;
    };
  }, [tryBegin]);

  /** Назад / вперёд в истории браузера. */
  useEffect(() => {
    const onPopState = () => {
      tryBegin(window.location.pathname);
    };
    window.addEventListener("popstate", onPopState);
    return () => window.removeEventListener("popstate", onPopState);
  }, [tryBegin]);

  const overlay =
    pending && mounted && typeof document !== "undefined"
      ? createPortal(
          <div
            className="pointer-events-auto fixed inset-0 flex items-center justify-center bg-black/55 backdrop-blur-[6px] motion-reduce:backdrop-blur-sm"
            style={{ zIndex: NAV_TRANSITION_OVERLAY_Z }}
            role="status"
            aria-live="polite"
            aria-busy="true"
          >
            <span className="rounded-2xl border border-white/12 bg-[#14141c]/95 px-8 py-5 text-[15px] font-semibold text-white shadow-2xl">
              Подождите...
            </span>
          </div>,
          document.body
        )
      : null;

  return (
    <>
      {children}
      {overlay}
    </>
  );
}
