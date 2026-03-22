import Link from "next/link";

import { BaseButton } from "@/components/landing/BaseButton";

/** Чуть крупнее только пункты навигации (не лого / не кнопки) */
const navLinkClass =
  "whitespace-nowrap text-[14px] font-semibold text-white/65 transition hover:text-white/95";

export function LandingHeader() {
  return (
    <>
      <header className="fixed left-0 right-0 top-0 z-50 w-full">
        <div className="border-b border-white/8 bg-black/40 backdrop-blur-xl supports-[backdrop-filter]:bg-black/30">
          <div className="mx-auto flex max-w-6xl flex-col gap-3 px-5 py-3 md:flex-row md:items-center md:justify-between md:gap-4">
            <div className="flex items-center justify-between gap-4">
              <Link href="/#home" className="flex items-center gap-3">
                <div className="flex h-10 w-10 items-center justify-center rounded-xl border border-white/10 bg-white/6 font-black">
                  BIQ
                </div>
                <div className="leading-tight">
                  <div className="text-sm font-extrabold text-white/95">BoardIQ</div>
                  <div className="text-xs text-white/50">analytics</div>
                </div>
              </Link>

              <div className="flex shrink-0 items-center gap-2 md:hidden">
                <BaseButton href="/#pricing" variant="primary">
                  Приобрести
                </BaseButton>
                <BaseButton href="/app/projects" variant="outline">
                  Войти
                </BaseButton>
              </div>
            </div>

            <nav
              className="flex flex-wrap items-center justify-center gap-x-5 gap-y-2 sm:gap-x-6 md:flex-1 md:justify-center md:gap-x-7 md:px-2 lg:gap-x-8"
              aria-label="Разделы лендинга"
            >
              <a className={navLinkClass} href="/#home">
                Главная
              </a>
              <a className={navLinkClass} href="/#advantages">
                Преимущества
              </a>
              <a className={navLinkClass} href="/#data">
                Данные
              </a>
              <a className={navLinkClass} href="/#dda">
                DDA
              </a>
              <a className={navLinkClass} href="/#pricing">
                Тарифы
              </a>
              <a className={navLinkClass} href="/#demo">
                Демо
              </a>
            </nav>

            <div className="hidden shrink-0 items-center gap-2 md:flex">
              <BaseButton href="/#pricing" variant="primary">
                Приобрести
              </BaseButton>
              <BaseButton href="/app/projects" variant="outline">
                Войти
              </BaseButton>
            </div>
          </div>
        </div>
      </header>
      {/* Reserve space: fixed header doesn’t participate in flow */}
      {/* На мобилке хедер в 2 ряда (лого+кнопки, затем навигация) — больше отступ */}
      <div className="h-28 w-full shrink-0 md:h-[4.25rem]" aria-hidden />
    </>
  );
}
