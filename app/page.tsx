"use client";

import Link from "next/link";

import { BaseButton, cn } from "@/components/landing/BaseButton";
import { LandingDemoSection } from "@/components/landing/LandingDemoBoard";
import { AdvantagesSection, DataInsightsSection, DDASection } from "@/components/landing/LandingMidSections";
import { LandingHeader } from "@/components/layout/LandingHeader";

function PricingCard({
  name,
  price,
  items,
  featured,
}: {
  name: string;
  price: string;
  items: string[];
  featured?: boolean;
}) {
  return (
    <div
      className={cn(
        "landing-pricing-card group/pricing relative flex h-full flex-col overflow-hidden rounded-2xl border p-6",
        "transition-all duration-300 ease-out will-change-transform",
        featured
          ? "hover:-translate-y-1 hover:scale-[1.01] border-emerald-400/28 bg-gradient-to-b from-white/[0.09] to-emerald-500/[0.05] shadow-[0_0_68px_rgba(34,197,94,0.14)] ring-1 ring-emerald-400/20 hover:border-emerald-400/40 hover:shadow-[0_0_88px_rgba(34,197,94,0.2)] hover:ring-emerald-400/28"
          : "hover:-translate-y-0.5 hover:scale-[1.008] border-white/10 bg-white/[0.03] hover:border-white/18 hover:bg-white/[0.045] hover:shadow-[0_20px_50px_rgba(0,0,0,0.35)]"
      )}
    >
      {featured ? (
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
        <div className="min-h-[28px]">
          {featured ? (
            <div className="inline-flex rounded-full border border-emerald-400/30 bg-emerald-500/[0.1] px-3 py-1 text-xs font-bold text-white/90 ring-1 ring-emerald-400/20">
              Популярный
            </div>
          ) : null}
        </div>

        <div className="mt-4 flex min-h-[52px] items-start justify-between gap-3">
          <div className="text-[40px] leading-none font-extrabold text-white/95">
            {name}
          </div>
          <div className="pt-1 text-[40px] leading-none font-extrabold text-white">
            {price}
          </div>
        </div>

        <ul className="mt-6 min-h-[132px] space-y-3 text-sm text-white/70">
          {items.map((it) => (
            <li key={it} className="flex items-start gap-2">
              <span
                className={cn(
                  "mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full transition-colors duration-300",
                  featured
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
          <BaseButton href="/login" variant={featured ? "primaryEmerald" : "primary"} full>
            Приобрести
          </BaseButton>
        </div>
      </div>
    </div>
  );
}

export default function Page() {
  return (
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
              <h1 className="hero-title-gradient mx-auto max-w-4xl overflow-visible pb-[0.12em] text-4xl font-extrabold leading-[1.12] md:text-6xl md:leading-[1.1] xl:text-[72px] xl:leading-[1.08]">
                Управляйте маркетингом
                <br />
                через прибыль
              </h1>
            </div>

            <p className="mx-auto mt-5 max-w-xl text-base leading-relaxed text-white/58 md:text-lg">
              Единая прозрачная аналитика, которая помогает принимать решения и управлять прибылью
            </p>

            <div className="mt-8 flex flex-wrap items-center justify-center gap-3">
              <BaseButton href="#pricing" variant="primary">
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
        <div className="mx-auto max-w-6xl px-5 pb-24 pt-14 md:pb-32 md:pt-20">
          <div className="mb-12 text-center md:mb-14">
            <h2 className="text-3xl font-semibold tracking-tight text-white/95 md:text-4xl">Тарифы</h2>
          </div>

          <div className="grid items-stretch gap-6 md:grid-cols-3">
            <PricingCard
              name="Starter"
              price="$39"
              items={["до 3 источников", "базовые отчёты", "DDA-вклад"]}
            />
            <PricingCard
              name="Growth"
              price="$99"
              featured
              items={["до 10 источников", "управленческие отчёты", "рекомендации"]}
            />
            <PricingCard
              name="Agency"
              price="$249"
              items={["много проектов", "роли и доступы", "расширенная аналитика"]}
            />
          </div>
        </div>
      </section>

      <LandingDemoSection />

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
        </div>
      </section>
    </main>
  );
}