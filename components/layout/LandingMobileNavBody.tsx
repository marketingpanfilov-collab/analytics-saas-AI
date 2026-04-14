"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";

import { PartnershipNavButton } from "@/components/landing/PartnershipLeadProvider";
import { LandingLoginButton } from "@/components/layout/LandingLoginButton";

/** Согласовано с мобильным меню `LandingHeader` */
export const landingMobileNavItemClass =
  "w-full whitespace-nowrap rounded-xl px-4 py-3.5 text-left text-base font-semibold text-white/90 transition hover:bg-white/[0.06] active:bg-white/[0.08]";

const mobileAuthBtnClass =
  "inline-flex h-11 min-h-11 w-full min-w-0 flex-1 cursor-pointer items-center justify-center rounded-xl border border-white/12 bg-transparent px-3 text-sm font-extrabold text-white/90 transition hover:bg-white/[0.06]";

export function LandingMobileNavBody({
  onClose,
  /** `false` — только в меню /app (`AppMobileLandingNavDrawer`); на лендинге по умолчанию показываем Вход/Регистрация. */
  showAuthRow = true,
}: {
  onClose: () => void;
  showAuthRow?: boolean;
}) {
  const router = useRouter();
  const pathname = usePathname();

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
    onClose();
    scrollToSection(sectionId);
  };

  const goHomeFromMenu = () => {
    onClose();
    if (pathname === "/") {
      if (typeof window !== "undefined") window.scrollTo({ top: 0, behavior: "smooth" });
    } else {
      router.push("/");
    }
  };

  return (
    <>
      {showAuthRow ? (
        <div className="grid w-full min-w-0 grid-cols-2 gap-3">
          <LandingLoginButton
            variant="outline"
            label="Вход"
            onBeforeNavigate={onClose}
            className="!min-h-11 !min-w-0 h-11 w-full !min-w-0 px-3 py-0"
          />
          <Link href="/login?signup=1" className={mobileAuthBtnClass} onClick={onClose}>
            Регистрация
          </Link>
        </div>
      ) : null}

      <nav
        className={
          showAuthRow
            ? "mt-6 flex flex-col gap-1 border-t border-white/10 pt-6"
            : "flex flex-col gap-1 pt-0"
        }
        aria-label="Разделы лендинга"
      >
        <button type="button" className={landingMobileNavItemClass} onClick={goHomeFromMenu}>
          Главная
        </button>
        <button type="button" className={landingMobileNavItemClass} onClick={() => scrollToSectionFromMenu("advantages")}>
          Преимущества
        </button>
        <button type="button" className={landingMobileNavItemClass} onClick={() => scrollToSectionFromMenu("data")}>
          Данные
        </button>
        <button type="button" className={landingMobileNavItemClass} onClick={() => scrollToSectionFromMenu("pricing")}>
          Тарифы
        </button>
        <button type="button" className={landingMobileNavItemClass} onClick={() => scrollToSectionFromMenu("demo")}>
          Демо
        </button>
        <PartnershipNavButton layout="mobile" onBeforeAction={onClose} className="whitespace-nowrap" />
        <button type="button" className={landingMobileNavItemClass} onClick={() => scrollToSectionFromMenu("faq")}>
          FAQ
        </button>
      </nav>

      <div className="mt-6 border-t border-white/10 pt-4">
        <p className="text-left text-[11px] leading-snug text-white/40">
          © {new Date().getFullYear()} BoardIQ analytics — Все права защищены.
        </p>
      </div>
    </>
  );
}
