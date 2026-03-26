"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";

import { buildLoginPurchaseHref, type PricingPlanId } from "@/app/lib/auth/loginPurchaseUrl";
import { LandingHeader } from "@/components/layout/LandingHeader";

type BillingPeriod = "monthly" | "yearly";
type FeatureValue = string | boolean;
type FeatureRow = {
  group: string;
  title: string;
  starter: FeatureValue;
  growth: FeatureValue;
  agency: FeatureValue;
};

const BILLING_OPTIONS: { value: BillingPeriod; label: string }[] = [
  { value: "monthly", label: "1 месяц" },
  { value: "yearly", label: "1 год" },
];

const MONTHLY_PRICE: Record<PricingPlanId, number> = {
  starter: 39,
  growth: 99,
  agency: 249,
};

const YEARLY_DISCOUNT_PERCENT: Record<PricingPlanId, number> = {
  starter: 10,
  growth: 15,
  agency: 20,
};

const FEATURES: FeatureRow[] = [
  { group: "Лимиты", title: "Количество источников", starter: "до 3", growth: "до 10", agency: "без ограничений" },
  { group: "Лимиты", title: "Проекты / аккаунты", starter: "1", growth: "до 3", agency: "неограниченно" },
  { group: "Аналитика", title: "Тип отчетов", starter: "Базовые", growth: "Управленческие", agency: "Расширенные + кастом" },
  { group: "Аналитика", title: "DDA (атрибуция)", starter: "Базовый вклад", growth: "Полный DDA", agency: "Продвинутый DDA + кастом модели" },
  { group: "Аналитика", title: "AI-рекомендации", starter: false, growth: "Базовые", agency: "Продвинутые" },
  { group: "Операционка", title: "Алерты / уведомления", starter: false, growth: "Стандартные", agency: "Real-time + кастом правила" },
  { group: "Операционка", title: "Дашборды", starter: "1", growth: "до 5", agency: "неограниченно" },
  { group: "Операционка", title: "Обновление данных", starter: "каждые 24 часа", growth: "каждые 6 часов", agency: "почти real-time" },
  { group: "Интеграции", title: "Интеграции", starter: "Базовые", growth: "Расширенные", agency: "Все + приоритетные" },
  { group: "Интеграции", title: "UTM / трекинг система", starter: "Базовая", growth: "Расширенная", agency: "Продвинутая + свои параметры" },
  { group: "Команда", title: "Работа с командой", starter: false, growth: "Ограниченно", agency: "Роли, права, команды" },
  { group: "Команда", title: "Роли и доступы", starter: false, growth: "Частично", agency: "Полный контроль" },
  { group: "Enterprise", title: "API доступ", starter: false, growth: "Ограниченный", agency: "Полный API" },
  { group: "Enterprise", title: "White-label", starter: false, growth: false, agency: true },
  { group: "Поддержка", title: "Поддержка", starter: "Стандарт", growth: "Приоритетная", agency: "VIP / выделенная" },
  { group: "Поддержка", title: "Кому подходит", starter: "Фриланс / стартап", growth: "Бизнес", agency: "Агентство / холдинг" },
];

function yearlyTotal(monthlyUsd: number, discountPercent: number) {
  return Math.round(monthlyUsd * 12 * (1 - discountPercent / 100));
}

function yearlySavings(monthlyUsd: number, discountPercent: number) {
  return monthlyUsd * 12 - yearlyTotal(monthlyUsd, discountPercent);
}

function totalByBilling(planId: PricingPlanId, billing: BillingPeriod): number {
  if (billing === "monthly") return MONTHLY_PRICE[planId];
  return yearlyTotal(MONTHLY_PRICE[planId], YEARLY_DISCOUNT_PERCENT[planId]);
}

function formatUsd(n: number) {
  return `$${n}`;
}

export default function PricingComparisonPage() {
  const router = useRouter();
  const [starterBilling, setStarterBilling] = useState<BillingPeriod>("monthly");
  const [growthBilling, setGrowthBilling] = useState<BillingPeriod>("monthly");
  const [agencyBilling, setAgencyBilling] = useState<BillingPeriod>("monthly");

  const starterHref = useMemo(
    () => buildLoginPurchaseHref("starter", starterBilling),
    [starterBilling]
  );
  const growthHref = useMemo(
    () => buildLoginPurchaseHref("growth", growthBilling),
    [growthBilling]
  );
  const agencyHref = useMemo(
    () => buildLoginPurchaseHref("agency", agencyBilling),
    [agencyBilling]
  );

  const groups = useMemo(() => [...new Set(FEATURES.map((f) => f.group))], []);

  const handleBack = () => {
    if (typeof window !== "undefined" && window.history.length > 1) {
      router.back();
      return;
    }
    router.push("/#pricing");
  };

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
        <div className="mx-auto max-w-7xl px-5 pb-14 pt-12 md:pb-20 md:pt-16">
          <div className="mb-4">
            <button
              type="button"
              onClick={handleBack}
              className="inline-flex h-11 cursor-pointer items-center justify-self-start gap-2 rounded-xl border border-white/10 bg-white/[0.03] px-4 text-[14px] font-medium text-white/75 transition hover:bg-white/[0.06] hover:text-white"
            >
              <svg aria-hidden viewBox="0 0 20 20" fill="none" className="h-4 w-4 shrink-0">
                <path d="M11.5 5.5L7 10l4.5 4.5" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
              <span className="inline-block -translate-y-[1px] leading-none">Вернуться назад</span>
            </button>
          </div>

          <h1 className="text-center text-3xl font-semibold tracking-tight text-white/95 md:text-4xl">
            Сравнение тарифов BoardIQ
          </h1>

          <p className="mx-auto mt-4 max-w-2xl text-center text-base leading-relaxed text-white/60 md:text-lg">
            Выберите тариф, который лучше всего подходит под ваш бизнес и задачи
          </p>

          <div className="mt-8 overflow-x-auto rounded-2xl border border-white/10 bg-white/[0.03] ring-1 ring-white/[0.06]">
            <table className="min-w-[980px] w-full border-collapse text-sm">
              <thead>
                <tr className="border-b-2 border-white/18 bg-white/[0.04]">
                  <th className="px-4 py-4 text-left font-semibold text-white/90">Функция / Возможность</th>
                  <th className="px-4 py-4 text-center font-semibold text-white/90">Starter</th>
                  <th className="px-4 py-4 text-center font-semibold text-white/90">Growth</th>
                  <th className="px-4 py-4 text-center font-semibold text-white/90">Agency</th>
                </tr>
              </thead>
              <tbody>
                {groups.map((group) => (
                  <FragmentRows
                    key={group}
                    group={group}
                    rows={FEATURES.filter((f) => f.group === group)}
                  />
                ))}

                <tr className="border-t-2 border-white/18 border-b border-white/10 bg-white/[0.02]">
                  <td className="px-4 py-3 text-white/80">Период оплаты</td>
                  <td className="px-4 py-3 text-center">
                    <PeriodSelect value={starterBilling} onChange={setStarterBilling} />
                  </td>
                  <td className="px-4 py-3 text-center">
                    <PeriodSelect value={growthBilling} onChange={setGrowthBilling} />
                  </td>
                  <td className="px-4 py-3 text-center">
                    <PeriodSelect value={agencyBilling} onChange={setAgencyBilling} />
                  </td>
                </tr>

                <tr className="border-b border-white/10">
                  <td className="px-4 py-3 font-semibold text-white/90">Итого</td>
                  <td className="px-4 py-3 text-center text-base font-bold text-emerald-300">
                    {formatUsd(totalByBilling("starter", starterBilling))}
                    <span className="ml-1 text-xs font-medium text-white/50">
                      / {starterBilling === "yearly" ? "год" : "мес"}
                    </span>
                    <p className={`mt-1 text-xs font-medium ${starterBilling === "yearly" ? "text-red-400" : "text-white/60"}`}>
                      {starterBilling === "yearly"
                        ? `Скидка ${formatUsd(yearlySavings(MONTHLY_PRICE.starter, YEARLY_DISCOUNT_PERCENT.starter))}`
                        : "Без скидки"}
                    </p>
                  </td>
                  <td className="px-4 py-3 text-center text-base font-bold text-emerald-300">
                    {formatUsd(totalByBilling("growth", growthBilling))}
                    <span className="ml-1 text-xs font-medium text-white/50">
                      / {growthBilling === "yearly" ? "год" : "мес"}
                    </span>
                    <p className={`mt-1 text-xs font-medium ${growthBilling === "yearly" ? "text-red-400" : "text-white/60"}`}>
                      {growthBilling === "yearly"
                        ? `Скидка ${formatUsd(yearlySavings(MONTHLY_PRICE.growth, YEARLY_DISCOUNT_PERCENT.growth))}`
                        : "Без скидки"}
                    </p>
                  </td>
                  <td className="px-4 py-3 text-center text-base font-bold text-emerald-300">
                    {formatUsd(totalByBilling("agency", agencyBilling))}
                    <span className="ml-1 text-xs font-medium text-white/50">
                      / {agencyBilling === "yearly" ? "год" : "мес"}
                    </span>
                    <p className={`mt-1 text-xs font-medium ${agencyBilling === "yearly" ? "text-red-400" : "text-white/60"}`}>
                      {agencyBilling === "yearly"
                        ? `Скидка ${formatUsd(yearlySavings(MONTHLY_PRICE.agency, YEARLY_DISCOUNT_PERCENT.agency))}`
                        : "Без скидки"}
                    </p>
                  </td>
                </tr>

                <tr className="bg-white/[0.01]">
                  <td className="px-4 py-4 text-white/80">Действие</td>
                  <td className="px-4 py-4 text-center">
                    <BuyButton href={starterHref} planId="starter" />
                  </td>
                  <td className="px-4 py-4 text-center">
                    <BuyButton href={growthHref} planId="growth" />
                  </td>
                  <td className="px-4 py-4 text-center">
                    <BuyButton href={agencyHref} planId="agency" />
                  </td>
                </tr>
              </tbody>
            </table>
          </div>
        </div>
      </section>

      <section className="relative z-10">
        <div className="mx-auto max-w-6xl px-5 pb-10">
          <div className="flex flex-col items-start justify-between gap-4 border-t border-white/8 pt-6 text-xs text-white/42 md:flex-row md:items-center">
            <div>© {new Date().getFullYear()} BoardIQ</div>

            <div className="flex flex-wrap gap-4">
              <Link className="transition hover:text-white/70" href="/terms">
                Пользовательское соглашение
              </Link>
              <Link className="transition hover:text-white/70" href="/privacy">
                Политика конфиденциальности
              </Link>
              <Link className="transition hover:text-white/70" href="/refund-policy">
                Политика возврата
              </Link>
              <Link className="transition hover:text-white/70" href="/personal-data-agreement">
                Соглашение об обработке персональных данных
              </Link>
              <Link className="transition hover:text-white/70" href="/data-deletion">
                Удаление данных
              </Link>
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
  );
}

function FragmentRows({ group, rows }: { group: string; rows: FeatureRow[] }) {
  return (
    <>
      <tr className="border-t-2 border-white/18 bg-white/[0.05]">
        <td colSpan={4} className="px-4 py-2 text-xs font-semibold uppercase tracking-[0.14em] text-white/55">
          {group}
        </td>
      </tr>
      {rows.map((row) => (
        <tr key={row.title} className="border-b border-white/10">
          <td className="px-4 py-3 text-white/80">{row.title}</td>
          <td className="px-4 py-3 text-center">{renderFeatureValue(row.starter)}</td>
          <td className="px-4 py-3 text-center">{renderFeatureValue(row.growth)}</td>
          <td className="px-4 py-3 text-center">{renderFeatureValue(row.agency)}</td>
        </tr>
      ))}
    </>
  );
}

function renderFeatureValue(value: FeatureValue) {
  if (typeof value === "boolean") {
    return value ? (
      <span
        className="inline-flex h-6 w-6 items-center justify-center rounded-full bg-emerald-500/20 text-sm font-bold text-emerald-300 ring-1 ring-emerald-400/30"
        aria-label="Да"
      >
        ✓
      </span>
    ) : (
      <span
        className="inline-flex h-6 w-6 items-center justify-center rounded-full bg-red-500/16 text-sm font-bold text-red-300 ring-1 ring-red-400/25"
        aria-label="Нет"
      >
        ✕
      </span>
    );
  }

  if (value === "—") {
    return (
      <span className="inline-flex rounded-full border border-red-500/25 bg-red-500/10 px-2.5 py-1 text-xs font-medium text-red-300">
        Нет
      </span>
    );
  }

  return <span className="text-white/75">{value}</span>;
}

function PeriodSelect({
  value,
  onChange,
}: {
  value: BillingPeriod;
  onChange: (v: BillingPeriod) => void;
}) {
  return (
    <select
      value={value}
      onChange={(e) => onChange(e.target.value as BillingPeriod)}
      className="h-10 cursor-pointer rounded-xl border border-white/10 bg-white/[0.04] px-3 text-sm text-white focus:border-white/20 focus:outline-none"
    >
      {BILLING_OPTIONS.map((t) => (
        <option key={t.value} value={t.value} className="bg-[#111118] text-white">
          {t.label}
        </option>
      ))}
    </select>
  );
}

function BuyButton({ href, planId }: { href: string; planId: PricingPlanId }) {
  return (
    <Link
      href={href}
      className="inline-flex h-10 min-w-[130px] cursor-pointer items-center justify-center rounded-xl border border-emerald-400/35 bg-emerald-500/[0.18] px-4 text-sm font-semibold text-white transition hover:bg-emerald-500/[0.28]"
      aria-label={`Приобрести тариф ${planId}`}
    >
      Приобрести
    </Link>
  );
}
