"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";

import { cn } from "@/components/landing/BaseButton";
import { buildLoginPurchaseHref, type PricingPlanId } from "@/app/lib/auth/loginPurchaseUrl";
import { LandingHeader } from "@/components/layout/LandingHeader";
import PricingBuyButton from "./PricingBuyButton";

type BillingPeriod = "monthly" | "yearly";
type FeatureValue = string | boolean;
type FeatureRow = {
  group: string;
  title: string;
  free: FeatureValue;
  growth: FeatureValue;
  scale: FeatureValue;
};

type ComparisonPaidPlan = Extract<PricingPlanId, "growth" | "scale">;

const BILLING_OPTIONS: { value: BillingPeriod; label: string }[] = [
  { value: "monthly", label: "1 месяц" },
  { value: "yearly", label: "1 год" },
];

const MONTHLY_PRICE: Record<ComparisonPaidPlan, number> = {
  growth: 99,
  scale: 249,
};

const YEARLY_DISCOUNT_PERCENT: Record<ComparisonPaidPlan, number> = {
  growth: 15,
  scale: 20,
};

const FEATURES: FeatureRow[] = [
  { group: "Лимиты", title: "Количество источников", free: "до 3", growth: "до 10", scale: "без ограничений" },
  { group: "Лимиты", title: "Проекты / аккаунты", free: "1", growth: "до 3", scale: "неограниченно" },
  { group: "Лимиты", title: "Участники организации", free: "1", growth: "до 10", scale: "неограниченно" },
  { group: "Аналитика", title: "Тип отчетов", free: "Базовые, ограниченно", growth: "Управленческие", scale: "Расширенные + кастом" },
  { group: "Аналитика", title: "DDA (атрибуция)", free: "Базовый вклад", growth: "Полный DDA", scale: "Продвинутый DDA + кастом модели" },
  { group: "Аналитика", title: "AI-рекомендации", free: false, growth: "Базовые", scale: "Продвинутые" },
  { group: "Операционка", title: "Алерты / уведомления", free: false, growth: "Стандартные", scale: "Real-time + кастом правила" },
  { group: "Операционка", title: "Дашборды", free: "1", growth: "до 5", scale: "неограниченно" },
  { group: "Операционка", title: "Обновление данных", free: "реже (ориентир до 24 ч)", growth: "каждые 6 часов", scale: "почти real-time" },
  { group: "Интеграции", title: "Интеграции", free: "Базовые", growth: "Расширенные", scale: "Все + приоритетные" },
  { group: "Интеграции", title: "UTM / трекинг система", free: "Базовая", growth: "Расширенная", scale: "Продвинутая + свои параметры" },
  { group: "Команда", title: "Работа с командой", free: false, growth: "Ограниченно", scale: "Роли, права, команды" },
  { group: "Команда", title: "Роли и доступы", free: false, growth: "Частично", scale: "Полный контроль" },
  { group: "Enterprise", title: "API доступ", free: false, growth: "Ограниченный", scale: "Полный API" },
  { group: "Enterprise", title: "White-label", free: false, growth: false, scale: true },
  { group: "Поддержка", title: "Поддержка", free: "Стандарт", growth: "Приоритетная", scale: "VIP / выделенная" },
  { group: "Поддержка", title: "Кому подходит", free: "Старт и проверка гипотез", growth: "Бизнес", scale: "Scale / холдинг" },
];

function yearlyTotal(monthlyUsd: number, discountPercent: number) {
  return Math.round(monthlyUsd * 12 * (1 - discountPercent / 100));
}

function yearlySavings(monthlyUsd: number, discountPercent: number) {
  return monthlyUsd * 12 - yearlyTotal(monthlyUsd, discountPercent);
}

function totalByBilling(planId: ComparisonPaidPlan, billing: BillingPeriod): number {
  if (billing === "monthly") return MONTHLY_PRICE[planId];
  return yearlyTotal(MONTHLY_PRICE[planId], YEARLY_DISCOUNT_PERCENT[planId]);
}

function formatUsd(n: number) {
  return `$${n}`;
}

/** Колонка Growth: заливка и боковые границы на всю высоту таблицы */
const growthColTd =
  "border-l border-r border-emerald-400/35 bg-emerald-500/[0.08] [box-shadow:inset_0_0_24px_rgba(34,197,94,0.06)]";

const growthColHead = cn(
  growthColTd,
  "relative bg-emerald-500/[0.12] px-4 pb-4 pt-8 text-center align-top font-semibold text-white/95"
);

export default function PricingComparisonPage() {
  const router = useRouter();
  const [growthBilling, setGrowthBilling] = useState<BillingPeriod>("yearly");
  const [scaleBilling, setScaleBilling] = useState<BillingPeriod>("yearly");

  const growthHref = useMemo(
    () => buildLoginPurchaseHref("growth", growthBilling),
    [growthBilling]
  );
  const scaleHref = useMemo(
    () => buildLoginPurchaseHref("scale", scaleBilling),
    [scaleBilling]
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

          <div className="mt-10 overflow-x-auto rounded-2xl border border-white/10 bg-white/[0.03] pt-4 ring-1 ring-white/[0.06]">
            <table className="min-w-[980px] w-full border-collapse text-sm">
              <thead>
                <tr className="border-b-2 border-white/18 bg-white/[0.04]">
                  <th className="px-4 py-4 text-left font-semibold text-white/90">Функция / Возможность</th>
                  <th className="px-4 py-4 text-center font-semibold text-white/90">Free</th>
                  <th className={growthColHead}>
                    <span
                      className="pointer-events-none absolute left-1/2 top-0 z-10 -translate-x-1/2 -translate-y-1/2 whitespace-nowrap rounded-full bg-emerald-500 px-4 py-1.5 text-[11px] font-bold uppercase tracking-wide text-white shadow-[0_3px_16px_rgba(34,197,94,0.45)] ring-1 ring-emerald-300/80"
                      aria-hidden
                    >
                      Популярный
                    </span>
                    <span className="relative z-[1] block">Growth</span>
                  </th>
                  <th className="px-4 py-4 text-center font-semibold text-white/90">Scale</th>
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
                  <td className="px-4 py-3 text-center text-sm text-white/55">—</td>
                  <td className={cn("px-4 py-3 text-center", growthColTd)}>
                    <PeriodSelect
                      value={growthBilling}
                      onChange={setGrowthBilling}
                      className="border-emerald-400/35 bg-emerald-500/[0.12] text-emerald-50 focus:border-emerald-400/55"
                    />
                  </td>
                  <td className="px-4 py-3 text-center">
                    <PeriodSelect value={scaleBilling} onChange={setScaleBilling} />
                  </td>
                </tr>

                <tr className="border-b border-white/10">
                  <td className="px-4 py-3 font-semibold text-white/90">Итого</td>
                  <td className="px-4 py-3 text-center text-base font-bold text-white/90">
                    Бесплатно
                    <p className="mt-1 text-xs font-medium text-white/50">без карты, без срока</p>
                  </td>
                  <td className={cn("px-4 py-3 text-center text-base font-bold text-emerald-200", growthColTd)}>
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
                    {formatUsd(totalByBilling("scale", scaleBilling))}
                    <span className="ml-1 text-xs font-medium text-white/50">
                      / {scaleBilling === "yearly" ? "год" : "мес"}
                    </span>
                    <p className={`mt-1 text-xs font-medium ${scaleBilling === "yearly" ? "text-red-400" : "text-white/60"}`}>
                      {scaleBilling === "yearly"
                        ? `Скидка ${formatUsd(yearlySavings(MONTHLY_PRICE.scale, YEARLY_DISCOUNT_PERCENT.scale))}`
                        : "Без скидки"}
                    </p>
                  </td>
                </tr>

                <tr className="bg-white/[0.01]">
                  <td className="px-4 py-4 text-white/80">Действие</td>
                  <td className="px-4 py-4 text-center">
                    <Link
                      href="/login?signup=1"
                      className="inline-flex h-10 min-w-[130px] cursor-pointer items-center justify-center rounded-xl border border-white/18 bg-white/[0.06] px-4 text-sm font-semibold text-white transition hover:bg-white/[0.1]"
                    >
                      Начать бесплатно
                    </Link>
                  </td>
                  <td className={cn("px-4 py-4 text-center", growthColTd)}>
                    <PricingBuyButton
                      guestHref={growthHref}
                      planId="growth"
                      billing={growthBilling}
                      guestLabel="Приобрести Growth"
                      checkoutLabel="Приобрести Growth"
                    />
                  </td>
                  <td className="px-4 py-4 text-center">
                    <PricingBuyButton
                      guestHref={scaleHref}
                      planId="scale"
                      billing={scaleBilling}
                      guestLabel="Приобрести Scale"
                      checkoutLabel="Приобрести Scale"
                    />
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
          <td className="px-4 py-3 text-center">{renderFeatureValue(row.free)}</td>
          <td className={cn("px-4 py-3 text-center", growthColTd)}>{renderFeatureValue(row.growth)}</td>
          <td className="px-4 py-3 text-center">{renderFeatureValue(row.scale)}</td>
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
  className,
}: {
  value: BillingPeriod;
  onChange: (v: BillingPeriod) => void;
  className?: string;
}) {
  return (
    <select
      value={value}
      onChange={(e) => onChange(e.target.value as BillingPeriod)}
      className={cn(
        "h-10 cursor-pointer rounded-xl border border-white/10 bg-white/[0.04] px-3 text-sm text-white focus:border-white/20 focus:outline-none",
        className
      )}
    >
      {BILLING_OPTIONS.map((t) => (
        <option key={t.value} value={t.value} className="bg-[#111118] text-white">
          {t.label}
        </option>
      ))}
    </select>
  );
}

