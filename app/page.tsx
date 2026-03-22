"use client";

import { BaseButton, cn } from "@/components/landing/BaseButton";
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
        "flex h-full flex-col rounded-[28px] border p-6 backdrop-blur-md",
        featured
          ? "border-white/18 bg-white/[0.06] shadow-[0_0_80px_rgba(255,255,255,0.05)]"
          : "border-white/10 bg-white/[0.04]"
      )}
    >
      <div className="min-h-[28px]">
        {featured ? (
          <div className="inline-flex rounded-full border border-white/14 bg-white/8 px-3 py-1 text-xs font-bold text-white/88">
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
            <span className="mt-1.5 h-1.5 w-1.5 rounded-full bg-white/80" />
            <span>{it}</span>
          </li>
        ))}
      </ul>

      <div className="mt-auto pt-8">
        <BaseButton href="/login" variant="primary" full>
          Приобрести
        </BaseButton>
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

      <section className="relative z-10">
        <div className="mx-auto max-w-5xl px-5 pb-16 pt-24 md:pb-20 md:pt-28">
          <div className="text-center">
            <h1 className="mx-auto max-w-4xl text-4xl font-extrabold leading-[0.98] text-white md:text-6xl xl:text-[72px]">
              Управляйте маркетингом
              <br />
              через прибыль
            </h1>

            <p className="mx-auto mt-5 max-w-xl text-base leading-relaxed text-white/58 md:text-lg">
              Без красивых отчётов кабинетов, которые не помогают принимать решения.
            </p>

            <div className="mt-8 flex flex-wrap items-center justify-center gap-3">
              <BaseButton href="#pricing" variant="primary">
                Приобрести
              </BaseButton>
              <BaseButton href="/app/projects" variant="secondary">
                Демо
              </BaseButton>
              <BaseButton href="/login" variant="outline">
                Войти
              </BaseButton>
            </div>
          </div>
        </div>
      </section>

      <section id="pricing" className="relative z-10">
        <div className="mx-auto max-w-6xl px-5 pb-16">
          <div className="mb-10 text-center">
            <h2 className="text-3xl font-extrabold text-white/95 md:text-4xl">
              Тарифы
            </h2>
          </div>

          <div className="grid items-stretch gap-4 md:grid-cols-3">
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