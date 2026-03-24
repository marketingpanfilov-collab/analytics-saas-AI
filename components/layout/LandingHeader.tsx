import Link from "next/link";

import { BaseButton } from "@/components/landing/BaseButton";
import { PartnershipNavButton } from "@/components/landing/PartnershipLeadProvider";

/* ! — глобальный `a { color: inherit }` в globals.css иначе даёт body white и глушит text-white/65 */
const landingNavLinkClass =
  "rounded-md px-1 py-0.5 text-sm font-semibold !text-white/65 transition-colors duration-200 ease-out hover:!text-white hover:[text-shadow:0_0_20px_rgba(255,255,255,0.45),0_0_36px_rgba(200,230,255,0.2)]";

export function LandingHeader() {
  return (
    <>
      <header className="fixed left-0 right-0 top-0 z-50 w-full">
        <div className="border-b border-white/8 bg-black/40 backdrop-blur-xl supports-[backdrop-filter]:bg-black/30">
          <div className="mx-auto flex max-w-6xl items-center justify-between gap-4 px-5 py-3">
            <Link href="/" className="flex shrink-0 items-center gap-3">
              <div className="relative h-10 w-10 rounded-xl border border-white/10 bg-white/6">
                <span className="absolute inset-0 grid place-items-center text-[13px] font-black leading-none">
                  BIQ
                </span>
              </div>
              <div className="leading-tight">
                <div className="text-sm font-extrabold text-white/95">BoardIQ</div>
                <div className="text-xs text-white/50">analytics</div>
              </div>
            </Link>

            <nav
              className="hidden min-w-0 flex-1 items-center justify-center gap-6 md:flex lg:gap-8"
              aria-label="Разделы лендинга"
            >
              <Link href="/#advantages" className={landingNavLinkClass}>
                Преимущества
              </Link>
              <Link href="/#data" className={landingNavLinkClass}>
                Данные
              </Link>
              <Link href="/#dda" className={landingNavLinkClass}>
                DDA
              </Link>
              <Link href="/#pricing" className={landingNavLinkClass}>
                Тарифы
              </Link>
              <Link href="/#demo" className={landingNavLinkClass}>
                Демо
              </Link>
              <PartnershipNavButton className={landingNavLinkClass} />
            </nav>

            <div className="flex shrink-0 items-center gap-3 md:gap-4">
              {/* На мобильных nav скрыт — «Партнёрам» только здесь; с md пункт внутри nav выше */}
              <PartnershipNavButton className={`${landingNavLinkClass} md:hidden`} />
              <BaseButton
                href="/login"
                variant="secondary"
                className="min-w-[132px] px-5 sm:min-w-[148px] sm:px-6"
              >
                Войти
              </BaseButton>
            </div>
          </div>
        </div>
      </header>
      {/* Reserve space: fixed header doesn’t participate in flow */}
      <div className="h-16 w-full shrink-0 md:h-[4.25rem]" aria-hidden />
    </>
  );
}
