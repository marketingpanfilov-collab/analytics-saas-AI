"use client";

import Link from "next/link";
import { useState } from "react";

import { buildLoginPurchaseHref, LOGIN_PURCHASE_NO_PLAN_HREF, type PricingPlanId } from "@/app/lib/auth/loginPurchaseUrl";
import { BaseButton, cn } from "@/components/landing/BaseButton";
import { LandingDemoSection } from "@/components/landing/LandingDemoBoard";
import { LandingPartnershipCta } from "@/components/landing/LandingPartnershipCta";
import { PartnershipLeadProvider } from "@/components/landing/PartnershipLeadProvider";
import { AdvantagesSection, DataInsightsSection, DDASection } from "@/components/landing/LandingMidSections";
import { LandingHeader } from "@/components/layout/LandingHeader";

type BillingPeriod = "monthly" | "yearly";

function formatUsd(n: number) {
  return `$${n}`;
}

/** Полная стоимость за год без скидки (12 × месяц). */
function yearlyPriceFullUsd(monthlyUsd: number) {
  return monthlyUsd * 12;
}

/** Стоимость за год со скидкой (округление до целого $). */
function yearlyPriceDiscountedUsd(monthlyUsd: number, discountPercent: number) {
  return Math.round(monthlyUsd * 12 * (1 - discountPercent / 100));
}

/** Разница между полной годовой суммой и суммой со скидкой ($). */
function yearlySavingsUsd(monthlyUsd: number, discountPercent: number) {
  return yearlyPriceFullUsd(monthlyUsd) - yearlyPriceDiscountedUsd(monthlyUsd, discountPercent);
}

function PricingCard({
  name,
  planId,
  items,
  highlight,
  billing,
  monthlyUsd,
  yearlyDiscountPercent,
}: {
  name: string;
  planId: PricingPlanId;
  items: string[];
  /** popular — зелёная карточка «Популярный / Компания»; agency — жёлтый бейдж; startup — серый бейдж «Стартап / Фриланс» (Starter) */
  highlight?: "popular" | "agency" | "startup";
  billing: BillingPeriod;
  monthlyUsd: number;
  yearlyDiscountPercent: number;
}) {
  const isPopular = highlight === "popular";
  const isAgency = highlight === "agency";
  const isStartup = highlight === "startup";
  const showYearlyDiscountBadge = billing === "yearly" && yearlyDiscountPercent > 0;
  const yearlyNet = yearlyPriceDiscountedUsd(monthlyUsd, yearlyDiscountPercent);
  return (
    <div
      className={cn(
        "landing-pricing-card group/pricing relative flex h-full flex-col overflow-hidden rounded-2xl border p-6",
        "transition-all duration-300 ease-out will-change-transform",
        isPopular &&
          "hover:-translate-y-1 hover:scale-[1.01] border-emerald-400/28 bg-gradient-to-b from-white/[0.09] to-emerald-500/[0.05] shadow-[0_0_68px_rgba(34,197,94,0.14)] ring-1 ring-emerald-400/20 hover:border-emerald-400/40 hover:shadow-[0_0_88px_rgba(34,197,94,0.2)] hover:ring-emerald-400/28",
        !isPopular &&
          "hover:-translate-y-0.5 hover:scale-[1.008] border-white/10 bg-white/[0.03] hover:border-white/18 hover:bg-white/[0.045] hover:shadow-[0_20px_50px_rgba(0,0,0,0.35)]"
      )}
    >
      {isPopular ? (
        <>
          <div
            className="pointer-events-none absolute -right-14 -top-14 h-44 w-44 rounded-full bg-emerald-400/14 blur-3xl landing-mid-glow-pulse"
            aria-hidden
          />
          <div
            className="pointer-events-none absolute -bottom-10 left-1/2 h-32 w-[92%] -translate-x-1/2 rounded-full bg-emerald-500/[0.09] blur-3xl"
            aria-hidden
          />
          <div
            className="pointer-events-none absolute left-1/2 top-[52%] h-24 w-[70%] -translate-x-1/2 rounded-full bg-emerald-400/[0.06] blur-2xl"
            aria-hidden
          />
        </>
      ) : null}

      <div className="relative z-[1] flex min-h-0 flex-1 flex-col">
        <div className="flex min-h-[28px] items-center justify-between gap-2">
          <div className="min-w-0 flex-1">
            {isPopular ? (
              <div className="inline-flex max-w-full rounded-full border border-emerald-400/30 bg-emerald-500/[0.1] px-3 py-1 text-[11px] font-bold leading-tight text-white/90 ring-1 ring-emerald-400/20 sm:text-xs">
                Популярный / Компания
              </div>
            ) : null}
            {isStartup ? (
              <div className="inline-flex max-w-full rounded-full border border-zinc-500/35 bg-zinc-500/[0.08] px-3 py-1 text-[11px] font-bold leading-tight text-zinc-400 ring-1 ring-zinc-500/25 sm:text-xs">
                Стартап / Фриланс
              </div>
            ) : null}
            {isAgency ? (
              <div className="inline-flex max-w-full rounded-full border border-amber-400/45 bg-amber-500/[0.14] px-3 py-1 text-[11px] font-bold leading-tight text-amber-50 ring-1 ring-amber-400/30 sm:text-xs">
                Холдинг / Агентство
              </div>
            ) : null}
          </div>
          <div className="flex min-h-[28px] shrink-0 flex-col items-end justify-center">
            <span
              className={cn(
                "inline-flex rounded-full border px-3 py-1 text-xs font-bold tracking-wide transition-opacity duration-300 ease-out",
                isPopular
                  ? "border-emerald-400/40 bg-emerald-500/[0.15] text-emerald-100"
                  : "border-white/15 bg-white/[0.06] text-white/90",
                showYearlyDiscountBadge ? "opacity-100" : "pointer-events-none opacity-0"
              )}
              aria-hidden={!showYearlyDiscountBadge}
            >
              Скидка −{yearlyDiscountPercent}%
            </span>
          </div>
        </div>

        <div className="mt-4 flex flex-col gap-1.5">
          <div className="flex min-h-[48px] items-center justify-between gap-3 md:min-h-[52px]">
            <div className="text-[40px] leading-none font-extrabold text-white/95 md:text-[44px]">
              {name}
            </div>
            <div className="flex min-h-[48px] shrink-0 items-center justify-end md:min-h-[52px]">
              <div
                key={billing}
                className={cn(
                  "pricing-billing-enter whitespace-nowrap text-right leading-none font-extrabold text-white tabular-nums",
                  billing === "yearly"
                    ? "text-[38px] md:text-[42px]"
                    : "text-[40px] md:text-[44px]"
                )}
              >
                {billing === "monthly" ? formatUsd(monthlyUsd) : formatUsd(yearlyNet)}
              </div>
            </div>
          </div>
          <div className="flex justify-end">
            <div
              key={billing}
              className={cn(
                "pricing-billing-enter text-right text-[13px] font-medium leading-snug tabular-nums sm:text-[14px] md:text-[15px]",
                billing === "yearly" ? "text-red-400" : "invisible"
              )}
              aria-hidden={billing === "monthly"}
            >
              {`Экономия\u00A0${formatUsd(yearlySavingsUsd(monthlyUsd, yearlyDiscountPercent))}`}
            </div>
          </div>
        </div>

        <ul className="mt-6 min-h-[132px] space-y-3 text-sm text-white/70">
          {items.map((it) => (
            <li key={it} className="flex items-start gap-2">
              <span
                className={cn(
                  "mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full transition-colors duration-300",
                  isPopular
                    ? "bg-emerald-400/90 group-hover/pricing:bg-emerald-300/[0.95]"
                    : "bg-white/55 group-hover/pricing:bg-white/80"
                )}
              />
              <span>{it}</span>
            </li>
          ))}
        </ul>

        <div className="mt-auto w-full pt-8">
          <div className="mb-6 h-px w-full bg-gradient-to-r from-transparent via-white/18 to-transparent opacity-70 group-hover/pricing:via-white/26" />
          <BaseButton href={buildLoginPurchaseHref(planId, billing)} variant={isPopular ? "primaryEmerald" : "primary"} full>
            Приобрести
          </BaseButton>
        </div>
      </div>
    </div>
  );
}

const PRICING_PLANS: {
  id: PricingPlanId;
  name: string;
  monthlyUsd: number;
  yearlyDiscountPercent: number;
  items: string[];
  highlight?: "popular" | "agency" | "startup";
}[] = [
  {
    id: "starter",
    name: "Starter",
    monthlyUsd: 39,
    yearlyDiscountPercent: 10,
    highlight: "startup",
    items: ["До 3 источников", "Базовые отчёты", "DDA-вклад"],
  },
  {
    id: "growth",
    name: "Growth",
    monthlyUsd: 99,
    yearlyDiscountPercent: 15,
    highlight: "popular",
    items: ["До 10 источников", "Управленческие отчёты", "Рекомендации"],
  },
  {
    id: "agency",
    name: "Agency",
    monthlyUsd: 249,
    yearlyDiscountPercent: 20,
    highlight: "agency",
    items: ["Много проектов", "Роли и доступы", "Расширенная аналитика"],
  },
];

export default function Page() {
  const [billing, setBilling] = useState<BillingPeriod>("monthly");

  return (
    <PartnershipLeadProvider>
    <main className="relative min-h-screen overflow-hidden bg-[#030303] text-white">
      <div className="pointer-events-none absolute inset-0">
        <div className="hero-orb hero-orb-1" />
        <div className="hero-orb hero-orb-2" />
        <div className="hero-orb hero-orb-3" />
        <div className="hero-noise" />
        <div className="absolute inset-0 bg-[linear-gradient(to_bottom,rgba(255,255,255,0.03)_1px,transparent_1px),linear-gradient(to_right,rgba(255,255,255,0.03)_1px,transparent_1px)] bg-[size:88px_88px] opacity-[0.08]" />
        <div className="absolute inset-0 bg-[radial-gradient(circle_at_center,transparent_0%,rgba(3,3,3,0.08)_55%,rgba(3,3,3,0.42)_100%)]" />
      </div>

      <LandingHeader />

      {/* Остаток экрана под спейсером хедера (h-16 / md:h-[4.25rem]); grid + place-content-center — стабильнее вертикального центра, чем flex + dvh */}
      <section className="hero-scope relative z-10 grid min-h-[calc(100svh-4rem)] w-full place-content-center md:min-h-[calc(100svh-4.25rem)]">
        <div className="mx-auto w-full max-w-5xl px-5 py-10 md:py-12">
          <div className="text-center">
            <div className="relative mx-auto inline-block max-w-4xl">
              <div
                className="mb-3 flex flex-wrap items-center justify-center gap-2 sm:mb-4 lg:hidden"
                aria-hidden
              >
                <span className="hero-badge hero-badge--realtime">
                  <span className="hero-badge-dot" />
                  <span className="hero-badge-label">Real time</span>
                </span>
                <span className="hero-badge hero-badge--control">
                  <span className="hero-badge-dot" />
                  <span className="hero-badge-label">Control</span>
                </span>
                <span className="hero-badge hero-badge--alert">
                  <span className="hero-badge-dot" />
                  <span className="hero-badge-label">Alert</span>
                </span>
              </div>
              <div
                className="pointer-events-none absolute bottom-full right-0 z-10 mb-2 hidden max-w-[min(100%,calc(100vw-2.5rem))] flex-row flex-nowrap items-center justify-end gap-2 sm:gap-2.5 lg:mb-2.5 lg:flex"
                aria-hidden
              >
                <span className="hero-badge hero-badge--realtime">
                  <span className="hero-badge-dot" />
                  <span className="hero-badge-label">Real time</span>
                </span>
                <span className="hero-badge hero-badge--control">
                  <span className="hero-badge-dot" />
                  <span className="hero-badge-label">Control</span>
                </span>
                <span className="hero-badge hero-badge--alert">
                  <span className="hero-badge-dot" />
                  <span className="hero-badge-label">Alert</span>
                </span>
              </div>
              <h1 className="hero-title-gradient mx-auto max-w-4xl overflow-visible pb-[0.12em] text-[2.55rem] font-extrabold leading-[1.1] md:text-6xl md:leading-[1.1] xl:text-[72px] xl:leading-[1.08]">
                Управляйте маркетингом
                <br />
                через прибыль
              </h1>
            </div>

            <p className="mx-auto mt-5 max-w-xl text-[1.08rem] leading-relaxed text-white/58 md:text-lg">
              Единая прозрачная аналитика, которая помогает принимать решения и управлять прибылью
            </p>

            <div className="mt-8 flex flex-wrap items-center justify-center gap-3">
              <BaseButton href={LOGIN_PURCHASE_NO_PLAN_HREF} variant="primary">
                Приобрести
              </BaseButton>
              <BaseButton href="#demo" variant="secondary">
                Демо
              </BaseButton>
              <BaseButton href="/login" variant="outline">
                Войти
              </BaseButton>
            </div>
          </div>
        </div>
      </section>

      <AdvantagesSection density="spacious" />
      <DataInsightsSection density="spacious" />
      <DDASection density="spacious" />

      <section
        id="pricing"
        className="landing-mid-scope relative z-10 scroll-mt-24 border-t border-white/10"
      >
        <div className="mx-auto max-w-6xl px-5 pb-14 pt-14 md:pb-20 md:pt-20">
          <div className="mb-10 text-center md:mb-12">
            <h2 className="text-3xl font-semibold tracking-tight text-white/95 md:text-4xl">Тарифы</h2>
            <div className="mt-6 flex justify-center">
              <div className="flex w-[320px] flex-col items-center sm:w-[360px]">
                <div
                  className="grid w-full grid-cols-2 gap-1 rounded-xl bg-white/[0.04] p-1 ring-1 ring-white/10 transition-[box-shadow,background-color] duration-300 ease-out"
                  role="group"
                  aria-label="Период оплаты"
                >
                  <button
                    type="button"
                    onClick={() => setBilling("monthly")}
                    className={cn(
                      "flex-1 cursor-pointer rounded-lg px-4 py-2 text-sm font-medium transition-[color,background-color,transform] duration-300 ease-out",
                      billing === "monthly"
                        ? "bg-white/10 text-white"
                        : "text-zinc-400 hover:text-zinc-200"
                    )}
                  >
                    Ежемесячно
                  </button>
                  <span className="relative inline-flex">
                    <button
                      type="button"
                      onClick={() => setBilling("yearly")}
                      className={cn(
                        "w-full cursor-pointer rounded-lg px-4 py-2 text-sm font-medium transition-[color,background-color,transform] duration-300 ease-out",
                        billing === "yearly"
                          ? "bg-white/10 text-white"
                          : "text-zinc-400 hover:text-zinc-200"
                      )}
                    >
                      Ежегодно
                    </button>
                    {/* Вершина внешней рамки кнопки: центр круга в углу, половина снаружи блока */}
                    <span
                      className="pointer-events-none absolute right-0 top-0 z-10 flex h-6 w-6 -translate-y-1/2 translate-x-1/2 items-center justify-center rounded-full bg-emerald-500/35 text-[11px] font-bold leading-none text-emerald-100 ring-1 ring-emerald-400/50"
                      aria-hidden
                    >
                      %
                    </span>
                  </span>
                </div>
              </div>
            </div>
          </div>

          <div className="grid items-stretch gap-6 md:grid-cols-3">
            {PRICING_PLANS.map((plan) => (
              <PricingCard
                key={plan.id}
                planId={plan.id}
                name={plan.name}
                items={plan.items}
                highlight={plan.highlight}
                billing={billing}
                monthlyUsd={plan.monthlyUsd}
                yearlyDiscountPercent={plan.yearlyDiscountPercent}
              />
            ))}
          </div>

          <div className="mt-8 flex justify-center">
            <Link
              href="/pricing-comparison"
              className="inline-flex h-11 cursor-pointer items-center gap-2 rounded-xl border border-white/15 bg-zinc-500/10 px-6 text-sm font-medium text-zinc-300 transition hover:bg-zinc-500/20 hover:text-zinc-200"
            >
              Сравнить тарифы
              <span aria-hidden>→</span>
            </Link>
          </div>
        </div>
      </section>

      <LandingDemoSection />

      <LandingPartnershipCta />

      <section className="relative z-10">
        <div className="mx-auto max-w-6xl px-5 pb-10">
          <div className="flex flex-col items-start justify-between gap-4 border-t border-white/8 pt-6 text-xs text-white/42 md:flex-row md:items-center">
            <div>© {new Date().getFullYear()} BoardIQ</div>

            <div className="flex flex-wrap gap-4">
              <a
                className="transition hover:text-white/70"
                href="https://boardiq.kz/terms"
                target="_blank"
                rel="noreferrer"
              >
                Пользовательское соглашение
              </a>
              <a
                className="transition hover:text-white/70"
                href="https://boardiq.kz/privacy"
                target="_blank"
                rel="noreferrer"
              >
                Политика конфиденциальности
              </a>
              <Link
                className="transition hover:text-white/70"
                href="/refund-policy"
              >
                Политика возврата
              </Link>
              <Link
                className="transition hover:text-white/70"
                href="/personal-data-agreement"
              >
                Соглашение об обработке персональных данных
              </Link>
              <a
                className="transition hover:text-white/70"
                href="https://boardiq.kz/data-deletion"
                target="_blank"
                rel="noreferrer"
              >
                Удаление данных
              </a>
            </div>
          </div>

          <p className="mt-6 w-full border-t border-white/10 pt-6 text-center text-[11px] leading-relaxed text-white/32 md:text-xs">
            Все материалы, тексты, изображения и иные данные на сайте являются интеллектуальной собственностью правообладателя.
            Копирование, воспроизведение, переработка или публичное упоминание допускаются только после предварительного
            письменного согласия и подтверждения со стороны правообладателя; иное использование без разрешения запрещено.
          </p>
        </div>
      </section>
    </main>
    </PartnershipLeadProvider>
  );
}