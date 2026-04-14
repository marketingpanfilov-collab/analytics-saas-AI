"use client";

import { useCallback, useEffect } from "react";
import { X } from "lucide-react";

import { cn } from "@/components/landing/BaseButton";
import { LandingMobileNavBody } from "@/components/layout/LandingMobileNavBody";

import { useAppMobileNav } from "../AppMobileNavContext";

/**
 * Мобильное меню по бургеру в /app: контент как в шапке лендинга.
 * z-index выше липкого топбара (90), иначе шапка «Меню» и крестик оказываются под Topbar.
 */
export default function AppMobileLandingNavDrawer() {
  const { mobileNavOpen, setMobileNavOpen } = useAppMobileNav();
  const close = useCallback(() => setMobileNavOpen(false), [setMobileNavOpen]);

  useEffect(() => {
    if (!mobileNavOpen) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") close();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [mobileNavOpen, close]);

  useEffect(() => {
    if (!mobileNavOpen) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = prev;
    };
  }, [mobileNavOpen]);

  return (
    <div
      className={cn(
        "fixed inset-0 z-[120] flex min-h-0 w-full flex-row lg:hidden",
        mobileNavOpen ? "pointer-events-auto" : "pointer-events-none"
      )}
      role="dialog"
      aria-modal={mobileNavOpen ? true : undefined}
      aria-label="Меню"
      inert={!mobileNavOpen ? true : undefined}
    >
      <aside
        className={cn(
          "flex h-full min-h-0 w-[min(19rem,92vw)] max-w-[260px] shrink-0 flex-col border-r border-white/10 bg-black shadow-[8px_0_48px_rgba(0,0,0,0.55)]",
          "transition-transform duration-300 ease-[cubic-bezier(0.16,1,0.3,1)] motion-reduce:transition-none",
          mobileNavOpen ? "translate-x-0" : "-translate-x-full"
        )}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex shrink-0 items-center justify-between gap-3 border-b border-white/10 px-3 py-3 pt-[max(12px,env(safe-area-inset-top))]">
          <span className="truncate pl-4 text-left text-base font-semibold tracking-tight text-white/90">
            Меню
          </span>
          <button
            type="button"
            className="inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border border-white/10 bg-white/[0.05] text-zinc-200 transition hover:bg-white/[0.08] hover:text-white active:bg-white/[0.07]"
            aria-label="Закрыть меню"
            tabIndex={mobileNavOpen ? 0 : -1}
            onClick={close}
          >
            <X className="h-[18px] w-[18px]" strokeWidth={2} aria-hidden />
          </button>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-3 pb-[max(24px,env(safe-area-inset-bottom))] pt-4">
          <LandingMobileNavBody onClose={close} showAuthRow={false} />
        </div>
      </aside>

      <button
        type="button"
        className={cn(
          "min-h-0 min-w-0 flex-1 cursor-pointer border-0 bg-black/55 p-0 backdrop-blur-[2px] transition-opacity motion-reduce:transition-none",
          mobileNavOpen ? "opacity-100" : "pointer-events-none opacity-0"
        )}
        aria-label="Закрыть меню"
        tabIndex={mobileNavOpen ? 0 : -1}
        onClick={close}
      />
    </div>
  );
}
