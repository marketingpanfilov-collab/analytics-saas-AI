"use client";

import Link from "next/link";
import { useCallback, useEffect, useId, useState } from "react";
import { usePathname, useRouter } from "next/navigation";

import { cn } from "@/components/landing/BaseButton";
import { PartnershipNavButton } from "@/components/landing/PartnershipLeadProvider";
import { LandingLoginButton } from "@/components/layout/LandingLoginButton";

/* ! — глобальный `a { color: inherit }` в globals.css иначе даёт body white и глушит text-white/65 */
const landingNavLinkClass =
  "cursor-pointer rounded-md px-1 py-0.5 text-sm font-semibold !text-white/65 transition-colors duration-200 ease-out hover:!text-white hover:[text-shadow:0_0_20px_rgba(255,255,255,0.45),0_0_36px_rgba(200,230,255,0.2)]";

const mobileNavItemClass =
  "w-full rounded-xl px-4 py-3.5 text-left text-base font-semibold text-white/90 transition hover:bg-white/[0.06] active:bg-white/[0.08]";

const mobileAuthBtnClass =
  "inline-flex h-11 min-h-11 w-full min-w-0 flex-1 cursor-pointer items-center justify-center rounded-xl border border-white/12 bg-transparent px-3 text-sm font-extrabold text-white/90 transition hover:bg-white/[0.06]";

export function LandingHeader() {
  const router = useRouter();
  const pathname = usePathname();
  const [mobileOpen, setMobileOpen] = useState(false);
  const menuId = useId();

  const closeMobileMenu = useCallback(() => setMobileOpen(false), []);

  const scrollToSection = (sectionId: string) => {
    if (pathname !== "/") {
      if (typeof window !== "undefined") {
        window.sessionStorage.setItem("landing-scroll-target", sectionId);
      }
      router.push("/");
      return;
    }
    const section = document.getElementById(sectionId);
    if (!section) return;
    const headingTarget = section.querySelector("h2, h1");
    const targetEl = (headingTarget instanceof HTMLElement ? headingTarget : section) as HTMLElement;
    const headerEl = document.querySelector("header");
    const headerOffset = headerEl ? headerEl.getBoundingClientRect().height : 72;
    const top = targetEl.getBoundingClientRect().top + window.scrollY - headerOffset - 30;
    window.scrollTo({ top: Math.max(0, top), behavior: "smooth" });
  };

  const scrollToSectionFromMenu = (sectionId: string) => {
    closeMobileMenu();
    scrollToSection(sectionId);
  };

  useEffect(() => {
    if (!mobileOpen) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") closeMobileMenu();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [mobileOpen, closeMobileMenu]);

  useEffect(() => {
    if (!mobileOpen) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = prev;
    };
  }, [mobileOpen]);

  useEffect(() => {
    setMobileOpen(false);
  }, [pathname]);

  return (
    <>
      <header className="fixed left-0 right-0 top-0 z-50 w-full">
        <div className="border-b border-white/8 bg-black/40 backdrop-blur-xl supports-[backdrop-filter]:bg-black/30">
          <div className="mx-auto flex max-w-6xl items-center justify-between gap-4 px-5 py-3">
            <Link href="/" className="flex min-w-0 shrink-0 items-center gap-3">
              <div className="relative h-10 w-10 shrink-0 rounded-xl border border-white/10 bg-white/6">
                <span className="absolute inset-0 grid place-items-center text-[13px] font-black leading-none">
                  BIQ
                </span>
              </div>
              <div className="min-w-0 leading-tight">
                <div className="text-sm font-extrabold text-white/95">BoardIQ</div>
                <div className="text-xs text-white/50">analytics</div>
              </div>
            </Link>

            <nav
              className="hidden min-w-0 flex-1 items-center justify-center gap-6 md:flex lg:gap-8"
              aria-label="Разделы лендинга"
            >
              <button type="button" onClick={() => scrollToSection("advantages")} className={landingNavLinkClass}>
                Преимущества
              </button>
              <button type="button" onClick={() => scrollToSection("data")} className={landingNavLinkClass}>
                Данные
              </button>
              <button type="button" onClick={() => scrollToSection("pricing")} className={landingNavLinkClass}>
                Тарифы
              </button>
              <button type="button" onClick={() => scrollToSection("demo")} className={landingNavLinkClass}>
                Демо
              </button>
              <PartnershipNavButton className={landingNavLinkClass} />
              <button type="button" onClick={() => scrollToSection("faq")} className={landingNavLinkClass}>
                FAQ
              </button>
            </nav>

            <div className="flex shrink-0 items-center gap-2 sm:gap-3 md:gap-4">
              <Link
                href="/login?signup=1"
                className="inline-flex h-11 min-w-[132px] items-center justify-center rounded-xl border border-white/12 bg-white/8 px-4 text-sm font-extrabold text-white/92 transition hover:bg-white/12 sm:min-w-[148px] sm:px-6 md:hidden"
              >
                Регистрация
              </Link>
              <div className="hidden md:flex md:items-center">
                <LandingLoginButton
                  variant="secondary"
                  className="min-w-[132px] px-5 sm:min-w-[148px] sm:px-6"
                />
              </div>

              <button
                type="button"
                className="inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-xl border border-white/12 bg-white/[0.04] text-white transition hover:bg-white/[0.08] md:hidden"
                aria-expanded={mobileOpen}
                aria-controls={menuId}
                aria-label={mobileOpen ? "Закрыть меню" : "Открыть меню"}
                onClick={() => setMobileOpen((o) => !o)}
              >
                {mobileOpen ? (
                  <span className="relative block h-5 w-5" aria-hidden="true">
                    <span className="absolute left-1/2 top-1/2 block h-0.5 w-4 -translate-x-1/2 -translate-y-1/2 rotate-45 rounded-full bg-white" />
                    <span className="absolute left-1/2 top-1/2 block h-0.5 w-4 -translate-x-1/2 -translate-y-1/2 -rotate-45 rounded-full bg-white" />
                  </span>
                ) : (
                  <span className="flex h-5 w-5 flex-col justify-center gap-1.5" aria-hidden="true">
                    <span className="block h-0.5 w-full rounded-full bg-white/90" />
                    <span className="block h-0.5 w-full rounded-full bg-white/90" />
                    <span className="block h-0.5 w-full rounded-full bg-white/90" />
                  </span>
                )}
              </button>
            </div>
          </div>
        </div>
      </header>

      {/* Мобильное меню: вход / регистрация + nav; в DOM всегда (md:hidden) — для плавного opacity/transform */}
      <div
        id={menuId}
        className={cn(
          "fixed inset-0 top-16 z-40 flex flex-col md:hidden",
          mobileOpen ? "pointer-events-auto" : "pointer-events-none"
        )}
        role="dialog"
        aria-modal={mobileOpen}
        aria-hidden={!mobileOpen}
        aria-label="Меню"
      >
        <button
          type="button"
          className={cn(
            "absolute inset-0 bg-black/55 backdrop-blur-sm transition-opacity duration-300 ease-[cubic-bezier(0.16,1,0.3,1)] motion-reduce:transition-none",
            mobileOpen ? "opacity-100" : "opacity-0"
          )}
          aria-label="Закрыть меню"
          tabIndex={mobileOpen ? 0 : -1}
          onClick={closeMobileMenu}
        />
        <div
          className={cn(
            "relative mt-0 flex max-h-[calc(100dvh-4rem)] flex-col overflow-y-auto border-t border-white/10 bg-black/92 px-5 pb-8 pt-5 shadow-[0_24px_64px_rgba(0,0,0,0.55)] backdrop-blur-xl supports-[backdrop-filter]:bg-black/88",
            "transition-[opacity,transform] duration-300 ease-[cubic-bezier(0.16,1,0.3,1)] motion-reduce:transition-none",
            mobileOpen
              ? "translate-y-0 opacity-100 motion-reduce:translate-y-0"
              : "-translate-y-2 opacity-0 motion-reduce:translate-y-0 motion-reduce:opacity-0"
          )}
          onClick={(e) => e.stopPropagation()}
        >
          <div className="grid w-full grid-cols-2 gap-3">
            <LandingLoginButton
              variant="outline"
              label="Вход"
              onBeforeNavigate={closeMobileMenu}
              className="!min-h-11 !min-w-0 h-11 w-full !min-w-0 px-3 py-0"
            />
            <Link href="/login?signup=1" className={mobileAuthBtnClass} onClick={closeMobileMenu}>
              Регистрация
            </Link>
          </div>

          <nav
            className="mt-6 flex flex-col gap-1 border-t border-white/10 pt-6"
            aria-label="Разделы лендинга"
          >
            <button type="button" className={mobileNavItemClass} onClick={() => scrollToSectionFromMenu("advantages")}>
              Преимущества
            </button>
            <button type="button" className={mobileNavItemClass} onClick={() => scrollToSectionFromMenu("data")}>
              Данные
            </button>
            <button type="button" className={mobileNavItemClass} onClick={() => scrollToSectionFromMenu("pricing")}>
              Тарифы
            </button>
            <button type="button" className={mobileNavItemClass} onClick={() => scrollToSectionFromMenu("demo")}>
              Демо
            </button>
            <PartnershipNavButton layout="mobile" onBeforeAction={closeMobileMenu} />
            <button type="button" className={mobileNavItemClass} onClick={() => scrollToSectionFromMenu("faq")}>
              FAQ
            </button>
          </nav>

          <div className="mt-6 border-t border-white/10 pt-4">
            <p className="text-left text-[11px] leading-snug text-white/40">
              © {new Date().getFullYear()} BoardIQ analytics — Все права защищены.
            </p>
          </div>
        </div>
      </div>

      {/* Reserve space: fixed header doesn’t participate in flow */}
      <div className="h-16 w-full shrink-0 md:h-[4.25rem]" aria-hidden />
    </>
  );
}
