"use client";

import Link from "next/link";
import { useMemo, useState } from "react";

type MetricTab = "Spend" | "CAC" | "ROMI" | "Покупатели";
type ChannelTab = "Google" | "Meta" | "TikTok";

function cn(...v: Array<string | false | null | undefined>) {
  return v.filter(Boolean).join(" ");
}

function Pill({
  active,
  children,
  onClick,
}: {
  active?: boolean;
  children: React.ReactNode;
  onClick?: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "ring-soft rounded-full px-3 py-1 text-xs font-semibold transition",
        "bg-white/5 hover:bg-white/8",
        active && "bg-white/10"
      )}
    >
      {children}
    </button>
  );
}

function PrimaryButton({
  children,
  href,
}: {
  children: React.ReactNode;
  href: string;
}) {
  return (
    <Link
      href={href}
      className={cn(
        "inline-flex items-center justify-center rounded-xl px-4 py-2.5",
        "font-extrabold text-sm text-white",
        "bg-[rgba(150,255,200,0.28)] hover:bg-[rgba(150,255,200,0.34)]",
        "border border-white/12 shadow-glow transition"
      )}
    >
      {children}
    </Link>
  );
}

function SecondaryButton({
  children,
  href,
}: {
  children: React.ReactNode;
  href: string;
}) {
  return (
    <Link
      href={href}
      className={cn(
        "inline-flex items-center justify-center rounded-xl px-4 py-2.5",
        "font-bold text-sm text-white/90",
        "bg-white/6 hover:bg-white/10 border border-white/12 transition"
      )}
    >
      {children}
    </Link>
  );
}

function OutlineButton({
  children,
  href,
}: {
  children: React.ReactNode;
  href: string;
}) {
  return (
    <Link
      href={href}
      className={cn(
        "inline-flex items-center justify-center rounded-xl px-4 py-2.5",
        "font-bold text-sm text-white/80",
        "bg-transparent hover:bg-white/6 border border-white/12 transition"
      )}
    >
      {children}
    </Link>
  );
}

function MiniProgress({
  value,
  variant,
  labelLeft,
  labelRight,
  helper,
}: {
  value: number; // 0..100
  variant: "mint" | "blue" | "yellow" | "red";
  labelLeft: string;
  labelRight: string;
  helper?: string;
}) {
  const barClass =
    variant === "mint"
      ? "bg-grad-mint"
      : variant === "blue"
      ? "bg-grad-blue"
      : variant === "yellow"
      ? "bg-grad-yellow"
      : "bg-grad-red";

  return (
    <div className="space-y-1.5">
      <div className="flex items-baseline justify-between gap-3">
        <div className="text-xs font-semibold text-white/80">{labelLeft}</div>
        <div className="text-xs font-extrabold text-white/90">
          {labelRight}
        </div>
      </div>

      {helper ? <div className="text-[11px] text-white/55">{helper}</div> : null}

      <div className="h-2 rounded-full bg-white/8 overflow-hidden ring-soft">
        <div
          className={cn("h-full rounded-full", barClass)}
          style={{ width: `${Math.max(0, Math.min(100, value))}%` }}
        />
      </div>
    </div>
  );
}

function Sparkline() {
  // чисто декоративно
  return (
    <div className="h-24 rounded-xl bg-white/4 border border-white/10 ring-soft overflow-hidden p-3">
      <div className="h-full w-full">
        <svg viewBox="0 0 240 90" className="h-full w-full">
          <defs>
            <linearGradient id="g" x1="0" x2="1">
              <stop offset="0" stopColor="rgba(150,255,200,0.85)" />
              <stop offset="1" stopColor="rgba(120,170,255,0.75)" />
            </linearGradient>
            <linearGradient id="fill" x1="0" x2="0" y1="0" y2="1">
              <stop offset="0" stopColor="rgba(150,255,200,0.20)" />
              <stop offset="1" stopColor="rgba(150,255,200,0.00)" />
            </linearGradient>
          </defs>
          <path
            d="M10 70 L40 62 L65 66 L92 52 L120 58 L145 45 L170 48 L200 30 L230 36"
            fill="none"
            stroke="url(#g)"
            strokeWidth="3"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
          <path
            d="M10 70 L40 62 L65 66 L92 52 L120 58 L145 45 L170 48 L200 30 L230 36 L230 90 L10 90 Z"
            fill="url(#fill)"
          />
        </svg>
      </div>
    </div>
  );
}

function MetricCard({
  title,
  value,
  sub,
  rightNote,
}: {
  title: string;
  value: string;
  sub: string;
  rightNote: string;
}) {
  return (
    <div className="glass rounded-2xl p-5 ring-soft border border-white/10">
      <div className="flex items-start justify-between gap-3">
        <div>
          <div className="text-xs font-semibold text-white/60">{title}</div>
          <div className="mt-1 text-2xl font-extrabold text-mint">{value}</div>
          <div className="mt-1 text-xs text-white/55">{sub}</div>
        </div>
        <div className="text-right">
          <div className="text-[11px] text-white/55">динамика</div>
          <div className="mt-1 text-xs font-bold text-white/80">
            {rightNote}
          </div>
        </div>
      </div>

      <div className="mt-4">
        <Sparkline />
      </div>

      <div className="mt-4 grid grid-cols-2 gap-3 text-xs">
        <div className="rounded-xl bg-white/4 border border-white/10 ring-soft p-3">
          <div className="text-white/55">Топ-кампания</div>
          <div className="mt-1 font-extrabold text-white/90">Campaign A • 41%</div>
        </div>
        <div className="rounded-xl bg-white/4 border border-white/10 ring-soft p-3">
          <div className="text-white/55">Просадка конверсии</div>
          <div className="mt-1 font-extrabold text-white/90">Checkout • −9%</div>
        </div>
      </div>

      <div className="mt-3 rounded-xl bg-white/4 border border-white/10 ring-soft p-3 text-xs">
        <div className="flex items-center justify-between">
          <div className="text-white/55">Потери источника</div>
          <div className="font-extrabold text-white/90">3%</div>
        </div>
      </div>
    </div>
  );
}

function HealthCard({
  score,
}: {
  score: number;
}) {
  return (
    <div className="glass rounded-2xl p-5 ring-soft border border-white/10">
      <div className="flex items-start justify-between gap-3">
        <div>
          <div className="text-xs font-semibold text-white/60">
            Качество данных
          </div>
          <div className="mt-1 text-xl font-extrabold text-white/95">
            Health score
          </div>
          <div className="mt-1 text-xs text-white/55">
            согласованность • полнота • шум
          </div>
        </div>
        <div className="text-right">
          <div className="text-[11px] text-white/55">score</div>
          <div className="mt-1 text-xl font-extrabold text-mint">{score}%</div>
        </div>
      </div>

      <div className="mt-4 space-y-4">
        <MiniProgress
          value={80}
          variant="mint"
          labelLeft="Сходимость CRM → Ads"
          labelRight="80%"
          helper="сходимость продаж и событий"
        />
        <MiniProgress
          value={83}
          variant="blue"
          labelLeft="Полнота событий"
          labelRight="83%"
          helper="наличие utm/click id и параметров"
        />
        <MiniProgress
          value={15}
          variant="red"
          labelLeft="Дубликаты / шум"
          labelRight="15%"
          helper="чем меньше — тем лучше"
        />
      </div>

      <div className="mt-4 rounded-xl bg-white/4 border border-white/10 ring-soft p-4">
        <div className="flex items-center gap-2">
          <span className="inline-block h-2 w-2 rounded-full bg-mint" />
          <div className="text-xs font-extrabold text-white/90">
            Что означает score
          </div>
        </div>
        <ul className="mt-2 space-y-1 text-xs text-white/70">
          <li>• чем выше score — тем меньше расхождений в отчётах;</li>
          <li>• DDA точнее распределяет вклад каналов;</li>
          <li>• рекомендации становятся надёжнее.</li>
        </ul>
      </div>

      <div className="mt-3 text-[11px] text-white/50">
        * демо-пример. В продукте всё считается по вашим данным.
      </div>
    </div>
  );
}

function Notice({
  dot,
  title,
  text,
}: {
  dot: "mint" | "blue" | "yellow" | "red";
  title: string;
  text: string;
}) {
  const dotClass =
    dot === "mint"
      ? "bg-mint"
      : dot === "blue"
      ? "bg-blue"
      : dot === "yellow"
      ? "bg-yellow"
      : "bg-red";

  const tint =
    dot === "mint"
      ? "bg-[rgba(150,255,200,0.10)] border-[rgba(150,255,200,0.22)]"
      : dot === "blue"
      ? "bg-[rgba(120,170,255,0.10)] border-[rgba(120,170,255,0.22)]"
      : dot === "yellow"
      ? "bg-[rgba(255,210,130,0.10)] border-[rgba(255,210,130,0.22)]"
      : "bg-[rgba(255,140,160,0.10)] border-[rgba(255,140,160,0.22)]";

  return (
    <div className={cn("rounded-2xl border p-4 ring-soft", tint)}>
      <div className="flex items-start gap-3">
        <span className={cn("mt-1.5 h-2 w-2 rounded-full", dotClass)} />
        <div className="min-w-0">
          <div className="text-sm font-extrabold text-white/92">{title}</div>
          <div className="mt-1 text-sm text-white/70">{text}</div>
        </div>
      </div>
    </div>
  );
}

function FaqItem({
  q,
  a,
  defaultOpen,
}: {
  q: string;
  a: string[];
  defaultOpen?: boolean;
}) {
  const [open, setOpen] = useState(!!defaultOpen);
  return (
    <div className="rounded-2xl border border-white/10 bg-white/4 ring-soft overflow-hidden">
      <button
        type="button"
        onClick={() => setOpen((s) => !s)}
        className="w-full px-5 py-4 flex items-center justify-between gap-4 text-left"
      >
        <div className="font-extrabold text-white/90">{q}</div>
        <div className="text-white/60 font-black">{open ? "—" : "+"}</div>
      </button>
      {open ? (
        <div className="px-5 pb-5 pt-0 text-sm text-white/75 space-y-2">
          {a.map((line, i) => (
            <div key={i}>{line}</div>
          ))}
        </div>
      ) : null}
    </div>
  );
}

export default function Page() {
  const [metric, setMetric] = useState<MetricTab>("Spend");
  const [channel, setChannel] = useState<ChannelTab>("Google");

  const metricView = useMemo(() => {
    if (metric === "Spend") {
      return { title: "Spend", value: "$12,450", sub: "расход за период", note: "+8.4% vs прошлый период" };
    }
    if (metric === "CAC") {
      return { title: "CAC", value: "$21.8", sub: "стоимость привлечения", note: "−4.1% vs прошлый период" };
    }
    if (metric === "ROMI") {
      return { title: "ROMI", value: "168%", sub: "окупаемость маркетинга", note: "+12.0% vs прошлый период" };
    }
    return { title: "Покупатели", value: "1,240", sub: "за период", note: "+6.7% vs прошлый период" };
  }, [metric]);

  const score = useMemo(() => {
    // в демо просто слегка “гуляет”
    const base = channel === "Google" ? 81 : channel === "Meta" ? 84 : 78;
    return base;
  }, [channel]);

  return (
    <main className="min-h-screen">
      {/* HEADER */}
      <header className="sticky top-0 z-50">
        <div className="bg-black/25 backdrop-blur border-b border-white/8">
          <div className="mx-auto max-w-6xl px-5 py-3 flex items-center justify-between gap-4">
            <Link href="/" className="flex items-center gap-3">
              <div className="h-9 w-9 rounded-xl glass ring-soft flex items-center justify-center font-black">
                BIQ
              </div>
              <div className="leading-tight">
                <div className="text-sm font-extrabold">BoardIQ</div>
                <div className="text-xs text-white/55">analytics</div>
              </div>
            </Link>

            <nav className="hidden md:flex items-center gap-6 text-sm text-white/70">
              <a href="#product" className="hover:text-white">Продукт</a>
              <a href="#dda" className="hover:text-white">Атрибуция</a>
              <a href="#integrations" className="hover:text-white">Интеграции</a>
              <a href="#pricing" className="hover:text-white">Тарифы</a>
              <a href="#faq" className="hover:text-white">Вопросы</a>
            </nav>

            <div className="flex items-center gap-2">
              <OutlineButton href="/app">Перейти в продукт</OutlineButton>
              <SecondaryButton href="/login">Вход</SecondaryButton>
            </div>
          </div>
        </div>
      </header>

      {/* HERO */}
      <section className="grid-bg">
        <div className="mx-auto max-w-6xl px-5 pt-10 pb-10">
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-10 items-start">
            {/* LEFT */}
            <div className="space-y-6">
              <div className="flex flex-wrap gap-2">
                <span className="ring-soft rounded-full px-3 py-1 text-xs font-semibold bg-white/5">
                  <span className="inline-block h-2 w-2 rounded-full bg-mint mr-2" />
                  Прозрачные данные
                </span>
                <span className="ring-soft rounded-full px-3 py-1 text-xs font-semibold bg-white/5">
                  <span className="inline-block h-2 w-2 rounded-full bg-blue mr-2" />
                  Data-Driven Attribution (DDA)
                </span>
                <span className="ring-soft rounded-full px-3 py-1 text-xs font-semibold bg-white/5">
                  <span className="inline-block h-2 w-2 rounded-full bg-yellow mr-2" />
                  Система рекомендаций
                </span>
                <span className="ring-soft rounded-full px-3 py-1 text-xs font-semibold bg-white/5">
                  <span className="inline-block h-2 w-2 rounded-full bg-red mr-2" />
                  Контроль качества
                </span>
              </div>

              <h1 className="text-4xl md:text-5xl font-extrabold leading-[1.02]">
                Управленческая аналитика маркетинга без{" "}
                <span className="text-mint">искажённых данных</span>
              </h1>

              <p className="text-white/70 text-base leading-relaxed max-w-xl">
                Подключите рекламные кабинеты, CRM и сайт — получите реальную картину:
                выручка, расходы, CAC, ROMI и вклад каналов в продажи.
                Плюс рекомендации: где резать, где масштабировать и что чинить.
              </p>

              <div className="flex flex-wrap items-center gap-2 pt-1">
                <PrimaryButton href="#pricing">Приобрести</PrimaryButton>
                <SecondaryButton href="/login">Вход</SecondaryButton>
                <OutlineButton href="#demo">Посмотреть демо</OutlineButton>
              </div>

              {/* KPI ROW — фиксированная сетка, не “едет” */}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 pt-3">
                <div className="glass rounded-2xl p-5 ring-soft border border-white/10">
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <div className="text-xs text-white/55 font-semibold">Data Health</div>
                      <div className="mt-1 text-2xl font-extrabold text-white/95">Высокий</div>
                      <div className="mt-1 text-xs text-white/55">качество и полнота данных</div>
                    </div>
                    <div className="text-right">
                      <div className="text-[11px] text-white/55">score</div>
                      <div className="mt-1 text-lg font-extrabold text-mint">81%</div>
                    </div>
                  </div>
                  <div className="mt-4 h-2 rounded-full bg-white/8 overflow-hidden ring-soft">
                    <div className="h-full bg-grad-mint rounded-full" style={{ width: "81%" }} />
                  </div>
                </div>

                <div className="glass rounded-2xl p-5 ring-soft border border-white/10">
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <div className="text-xs text-white/55 font-semibold">Аномалии</div>
                      <div className="mt-1 text-2xl font-extrabold text-white/95">2</div>
                      <div className="mt-1 text-xs text-white/55">за последние 24 часа</div>
                    </div>
                    <div className="text-right">
                      <div className="text-[11px] text-white/55">уровень</div>
                      <div className="mt-1 text-lg font-extrabold text-yellow">22%</div>
                    </div>
                  </div>
                  <div className="mt-4 h-2 rounded-full bg-white/8 overflow-hidden ring-soft">
                    <div className="h-full bg-grad-yellow rounded-full" style={{ width: "22%" }} />
                  </div>
                </div>

                <div className="glass rounded-2xl p-5 ring-soft border border-white/10">
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <div className="text-xs text-white/55 font-semibold">Интеграции</div>
                      <div className="mt-1 text-2xl font-extrabold text-white/95">8+</div>
                      <div className="mt-1 text-xs text-white/55">Ads, CRM, Site, GA4</div>
                    </div>
                    <div className="text-right">
                      <div className="text-[11px] text-white/55">покрытие</div>
                      <div className="mt-1 text-lg font-extrabold text-blue">68%</div>
                    </div>
                  </div>
                  <div className="mt-4 h-2 rounded-full bg-white/8 overflow-hidden ring-soft">
                    <div className="h-full bg-grad-blue rounded-full" style={{ width: "68%" }} />
                  </div>
                </div>

                <div className="glass rounded-2xl p-5 ring-soft border border-white/10">
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <div className="text-xs text-white/55 font-semibold">Рекомендации</div>
                      <div className="mt-1 text-2xl font-extrabold text-white/95">5</div>
                      <div className="mt-1 text-xs text-white/55">к действию сегодня</div>
                    </div>
                    <div className="text-right">
                      <div className="text-[11px] text-white/55">готовность</div>
                      <div className="mt-1 text-lg font-extrabold text-mint">56%</div>
                    </div>
                  </div>
                  <div className="mt-4 h-2 rounded-full bg-white/8 overflow-hidden ring-soft">
                    <div className="h-full bg-grad-mint rounded-full" style={{ width: "56%" }} />
                  </div>
                </div>
              </div>

              <div className="pt-2 grid grid-cols-1 sm:grid-cols-2 gap-2 text-sm text-white/75">
                <div className="flex items-center gap-2">
                  <span className="h-2 w-2 rounded-full bg-mint" />
                  Честная сквозная аналитика
                </div>
                <div className="flex items-center gap-2">
                  <span className="h-2 w-2 rounded-full bg-blue" />
                  Вклад каналов (DDA)
                </div>
                <div className="flex items-center gap-2">
                  <span className="h-2 w-2 rounded-full bg-yellow" />
                  Аномалии / просадки
                </div>
                <div className="flex items-center gap-2">
                  <span className="h-2 w-2 rounded-full bg-mint" />
                  Рекомендации по росту
                </div>
              </div>
            </div>

            {/* RIGHT — DEMO PANEL (строго по сетке, без “жести”) */}
            <div id="demo" className="glass rounded-3xl p-6 border border-white/10 ring-soft shadow-glow">
              <div className="flex items-start justify-between gap-4">
                <div>
                  <div className="text-[11px] uppercase tracking-widest text-white/45 font-bold">
                    интерактив • пример
                  </div>
                  <div className="mt-1 text-lg font-extrabold text-white/95">
                    Демонстрационная панель
                  </div>
                </div>
                <div className="ring-soft rounded-full px-3 py-1 text-xs font-semibold bg-white/5 text-white/70">
                  <span className="inline-block h-2 w-2 rounded-full bg-mint mr-2" />
                  канал • метрика • индексы
                </div>
              </div>

              {/* Tabs */}
              <div className="mt-4 flex flex-wrap gap-2">
                {(["Spend", "CAC", "ROMI", "Покупатели"] as MetricTab[]).map((t) => (
                  <Pill key={t} active={metric === t} onClick={() => setMetric(t)}>
                    {t}
                  </Pill>
                ))}
              </div>

              <div className="mt-2 flex flex-wrap gap-2">
                {(["Google", "Meta", "TikTok"] as ChannelTab[]).map((t) => (
                  <Pill key={t} active={channel === t} onClick={() => setChannel(t)}>
                    {t}
                  </Pill>
                ))}
              </div>

              {/* GRID внутри панели: всегда 2 колонки на lg, 1 на мобиле */}
              <div className="mt-5 grid grid-cols-1 md:grid-cols-2 gap-4 items-start">
                <MetricCard
                  title={`${metricView.title} • ${channel}`}
                  value={metricView.value}
                  sub={metricView.sub}
                  rightNote={metricView.note}
                />
                <HealthCard score={score} />
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* RECOMMENDATIONS — УНОСИМ ОТДЕЛЬНО (органично и ровно) */}
      <section className="mx-auto max-w-6xl px-5 pb-10">
        <div className="glass rounded-3xl p-6 border border-white/10 ring-soft">
          <div className="flex items-start justify-between gap-4">
            <div>
              <div className="text-[11px] uppercase tracking-widest text-white/45 font-bold">
                сигналы • рекомендации
              </div>
              <h2 className="mt-1 text-2xl font-extrabold text-white/95">
                Что система подсветит сегодня
              </h2>
              <p className="mt-2 text-sm text-white/70 max-w-2xl">
                Уведомления формируются из расхождений, потерь параметров и динамики метрик.
                Это не “советы в вакууме”, а конкретные действия: что проверить и где улучшить.
              </p>
            </div>
            <div className="hidden md:block text-sm text-white/60">
              приоритет • причина • действие
            </div>
          </div>

          <div className="mt-5 grid grid-cols-1 md:grid-cols-2 gap-4">
            <Notice
              dot="mint"
              title="Рекомендация: перераспределить бюджет"
              text="Сократить 12–18% бюджета в кампаниях с низким ROMI и усилить 2 топ-кампании (прогноз +9–14%)."
            />
            <Notice
              dot="blue"
              title="Сигнал: расхождение CRM ↔ Ads"
              text="Расхождение 7%. Проверьте Purchase и передачу external_id, fbp/fbc, а также дедупликацию событий."
            />
            <Notice
              dot="yellow"
              title="Сигнал: рост CAC"
              text="CAC вырос на 11% при той же выручке. Рекомендация: проверить частоту показов и сегментацию."
            />
            <Notice
              dot="red"
              title="Риск: потери UTM / click id"
              text="Найдены сессии без utm/click id на шаге оплаты. Проверьте редиректы и сохранение query-параметров."
            />
          </div>
        </div>
      </section>

      {/* PRODUCT CARDS */}
      <section id="product" className="mx-auto max-w-6xl px-5 pb-10">
        <h2 className="text-2xl md:text-3xl font-extrabold text-white/95">
          Прозрачные данные + DDA + рекомендации
        </h2>
        <p className="mt-2 text-sm text-white/70 max-w-2xl">
          Единая логика метрик, сверка источников и управленческие подсказки — без “красивых цифр”.
        </p>

        <div className="mt-6 grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
          {[
            {
              title: "Прозрачные расчёты",
              text: "Единая логика, сверка источников и воспроизводимость результата.",
              idx: "82%",
              dot: "mint" as const,
              bar: "bg-grad-mint",
            },
            {
              title: "DDA-атрибуция",
              text: "Оценка вклада касаний по данным пути клиента, а не по правилам кабинетов.",
              idx: "74%",
              dot: "blue" as const,
              bar: "bg-grad-blue",
            },
            {
              title: "Рекомендации",
              text: "Авто-подсказки: где резать, где масштабировать и что чинить.",
              idx: "82%",
              dot: "yellow" as const,
              bar: "bg-grad-yellow",
            },
            {
              title: "Управленческий отчёт",
              text: "Выручка, расходы, CAC, ROMI и вклад каналов — в одном дашборде.",
              idx: "68%",
              dot: "red" as const,
              bar: "bg-grad-red",
            },
          ].map((c) => (
            <div key={c.title} className="glass rounded-2xl p-5 border border-white/10 ring-soft">
              <div className="flex items-start justify-between gap-3">
                <div className="text-base font-extrabold text-white/92">
                  <span className={cn(
                    "inline-block h-2 w-2 rounded-full mr-2",
                    c.dot === "mint" ? "bg-mint" : c.dot === "blue" ? "bg-blue" : c.dot === "yellow" ? "bg-yellow" : "bg-red"
                  )} />
                  {c.title}
                </div>
                <div className="text-right">
                  <div className="text-[11px] text-white/55">индекс</div>
                  <div className="text-sm font-extrabold text-white/90">{c.idx}</div>
                </div>
              </div>
              <div className="mt-3 text-sm text-white/70 min-h-[44px]">
                {c.text}
              </div>
              <div className="mt-4 h-2 rounded-full bg-white/8 overflow-hidden ring-soft">
                <div className={cn("h-full rounded-full", c.bar)} style={{ width: c.idx }} />
              </div>
              <div className="mt-2 text-xs text-white/55">
                Стабильно — можно масштабировать.
              </div>
            </div>
          ))}
        </div>

        <div className="mt-6 flex gap-2">
          <PrimaryButton href="#pricing">Приобрести</PrimaryButton>
          <SecondaryButton href="/login">Вход</SecondaryButton>
          <OutlineButton href="/app">Перейти в продукт</OutlineButton>
        </div>
      </section>

      {/* DDA */}
      <section id="dda" className="mx-auto max-w-6xl px-5 pb-10">
        <h2 className="text-3xl font-extrabold text-white/95">Data-Driven Attribution (DDA)</h2>
        <p className="mt-2 text-sm text-white/70 max-w-3xl">
          В отличие от правил (Last Click / First Click), DDA анализирует весь путь клиента и распределяет ценность продажи на основе данных.
        </p>

        <div className="mt-6 grid grid-cols-1 lg:grid-cols-3 gap-4">
          <div className="glass rounded-2xl p-5 border border-white/10 ring-soft">
            <div className="text-lg font-extrabold text-white/92">Что учитывает DDA</div>
            <ul className="mt-3 text-sm text-white/75 space-y-2">
              <li>• все касания в пути клиента;</li>
              <li>• порядок и частоту контактов;</li>
              <li>• вероятность конверсии;</li>
              <li>• влияние касаний на продажу;</li>
              <li>• сезонность и эффект каналов.</li>
            </ul>
          </div>

          <div className="glass rounded-2xl p-5 border border-white/10 ring-soft lg:col-span-2">
            <div className="flex items-start justify-between gap-4">
              <div>
                <div className="text-lg font-extrabold text-white/92">Last Click vs DDA (пример)</div>
                <div className="mt-1 text-sm text-white/70">Instagram → Google → Email → Покупка</div>
              </div>
              <span className="ring-soft rounded-full px-3 py-1 text-xs font-semibold bg-white/5 text-white/70">
                путь клиента
              </span>
            </div>

            <div className="mt-4 grid grid-cols-1 md:grid-cols-2 gap-4">
              <div className="rounded-2xl bg-white/4 border border-white/10 ring-soft p-5">
                <div className="text-xs text-white/55 font-semibold">Last Click</div>
                <div className="mt-2 text-sm text-white/70">
                  100% ценности получает последний канал — часто это искажает решения.
                </div>
                <div className="mt-4 text-3xl font-extrabold text-white/95">Email: 100%</div>
                <div className="mt-2 text-xs text-white/55">
                  Email здесь — последний шаг перед покупкой, поэтому модель “перетягивает” вклад.
                </div>
              </div>

              <div className="rounded-2xl bg-white/4 border border-white/10 ring-soft p-5">
                <div className="text-xs text-white/55 font-semibold">DDA</div>

                <div className="mt-4 space-y-3">
                  <MiniProgress value={35} variant="yellow" labelLeft="Instagram" labelRight="35%" />
                  <MiniProgress value={40} variant="blue" labelLeft="Google" labelRight="40%" />
                  <MiniProgress value={25} variant="mint" labelLeft="Email" labelRight="25%" />
                </div>

                <div className="mt-3 text-xs text-white/55">
                  DDA помогает точнее распределять бюджеты и видеть реальную окупаемость каналов.
                </div>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* INTEGRATIONS (оставил как у тебя было ниже, но уже аккуратно) */}
      <section id="integrations" className="mx-auto max-w-6xl px-5 pb-10">
        <h2 className="text-3xl font-extrabold text-white/95">Интеграции</h2>
        <p className="mt-2 text-sm text-white/70 max-w-3xl">
          Подключение занимает ~10 минут. Данные обновляются автоматически.
        </p>

        <div className="mt-6 grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
          {[
            { name: "Meta Ads", bar: "bg-grad-mint" },
            { name: "Google Ads", bar: "bg-grad-blue" },
            { name: "TikTok Ads", bar: "bg-grad-yellow" },
            { name: "GA4", bar: "bg-grad-blue" },
            { name: "CRM", bar: "bg-grad-mint" },
            { name: "Платежи", bar: "bg-grad-yellow" },
            { name: "API", bar: "bg-grad-blue" },
            { name: "Webhooks", bar: "bg-grad-mint" },
          ].map((x) => (
            <div key={x.name} className="glass rounded-2xl p-5 border border-white/10 ring-soft">
              <div className="flex items-center justify-between gap-3">
                <div className="font-extrabold text-white/92">{x.name}</div>
                <div className="text-xs text-white/55">готово</div>
              </div>
              <div className="mt-4 h-2 rounded-full bg-white/8 overflow-hidden ring-soft">
                <div className={cn("h-full rounded-full", x.bar)} style={{ width: "90%" }} />
              </div>
            </div>
          ))}
        </div>
      </section>

      {/* PRICING */}
      <section id="pricing" className="mx-auto max-w-6xl px-5 pb-12">
        <h2 className="text-3xl font-extrabold text-white/95">Тарифы</h2>
        <p className="mt-2 text-sm text-white/70">
          Цена зависит от количества подключений/аккаунтов. Можно начать с малого и масштабироваться.
        </p>

        <div className="mt-6 grid grid-cols-1 md:grid-cols-3 gap-4">
          {[
            { name: "Starter", price: "$39", items: ["до 3 источников", "базовые отчёты", "DDA-вклад"] },
            { name: "Growth", price: "$99", items: ["до 10 источников", "управленческие отчёты", "рекомендации"] },
            { name: "Agency", price: "$249", items: ["много проектов", "роли и доступы", "расширенная аналитика"] },
          ].map((p) => (
            <div key={p.name} className="glass rounded-2xl p-6 border border-white/10 ring-soft">
              <div className="flex items-start justify-between gap-3">
                <div className="text-lg font-extrabold text-white/92">{p.name}</div>
                <div className="text-xl font-extrabold text-mint">{p.price}</div>
              </div>
              <ul className="mt-4 space-y-2 text-sm text-white/75">
                {p.items.map((it) => (
                  <li key={it}>• {it}</li>
                ))}
              </ul>
              {/* кнопки тарифов → на /login (дальше ты уже поведёшь на оплату) */}
              <div className="mt-6">
                <PrimaryButton href="/login">Купить</PrimaryButton>
              </div>
            </div>
          ))}
        </div>
      </section>

      {/* FAQ */}
      <section id="faq" className="mx-auto max-w-6xl px-5 pb-12">
        <h2 className="text-3xl font-extrabold text-white/95">Вопросы и ответы</h2>
        <p className="mt-2 text-sm text-white/70">
          Коротко по самым частым: честность данных, DDA и как мы помогаем уменьшать расходы.
        </p>

        <div className="mt-6 space-y-3">
          <FaqItem
            q="Почему вы говорите “мы не искажаем реальность”?"
            a={[
              "Мы сверяем данные между источниками (Ads ↔ CRM ↔ сайт ↔ GA4) и подсвечиваем расхождения.",
              "Отчёт строится на согласованной логике метрик, чтобы управлять прибылью, а не “рисовать” цифры.",
              "Если данные неполные (нет utm/click id, потери на редиректах) — это видно как снижение Data Health."
            ]}
            defaultOpen
          />
          <FaqItem
            q="DDA — это магия?"
            a={[
              "Нет. DDA — это модель, которая оценивает вклад касаний на основе данных пути клиента.",
              "Она снижает перекос Last Click и помогает точнее перераспределять бюджеты.",
              "Качество результата зависит от полноты данных и корректной передачи событий."
            ]}
          />
          <FaqItem
            q="Какие рекомендации вы даёте?"
            a={[
              "Бюджетные: где резать/усиливать кампании на основе ROMI/CAC и динамики.",
              "Технические: где теряются utm/click id, где есть расхождение CRM ↔ Ads, где нужна дедупликация.",
              "Управленческие: какие каналы реально приносят прибыль в DDA-модели."
            ]}
          />
        </div>
      </section>

      {/* FOOTER CTA */}
      <section className="mx-auto max-w-6xl px-5 pb-14">
        <div className="glass rounded-3xl p-8 border border-white/10 ring-soft">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6 items-center">
            <div>
              <h3 className="text-3xl font-extrabold text-white/95">
                Перейдите от «кликов» к управлению прибылью
              </h3>
              <p className="mt-2 text-sm text-white/70">
                Подключите источники, получите прозрачные отчёты и рекомендации по оптимизации расходов и росту продаж.
              </p>

              <ul className="mt-4 space-y-2 text-sm text-white/75">
                <li className="flex items-center gap-2">
                  <span className="h-2 w-2 rounded-full bg-mint" />
                  Единая управленческая сводка: выручка, расходы, CAC, ROMI
                </li>
                <li className="flex items-center gap-2">
                  <span className="h-2 w-2 rounded-full bg-blue" />
                  DDA показывает вклад каналов по данным пути клиента
                </li>
                <li className="flex items-center gap-2">
                  <span className="h-2 w-2 rounded-full bg-yellow" />
                  Рекомендации на каждый день: резать / масштабировать / чинить
                </li>
              </ul>

              <div className="mt-6 flex flex-wrap gap-2">
                <PrimaryButton href="#pricing">Приобрести</PrimaryButton>
                <SecondaryButton href="/login">Вход</SecondaryButton>
                <OutlineButton href="/app">Демо</OutlineButton>
              </div>
            </div>

            <div className="space-y-3">
              <Notice
                dot="mint"
                title="Сигнал: рост CAC"
                text="CAC вырос на 11% при той же выручке. Рекомендация: проверить сегменты и частоту показов."
              />
              <Notice
                dot="blue"
                title="Сигнал: расхождение CRM ↔ Ads"
                text="Расхождение 7%. Проверьте Purchase, external_id и дедупликацию событий."
              />
              <Notice
                dot="yellow"
                title="Рекомендация: перераспределение бюджета"
                text="Снять 12% с кампаний с низким ROMI и усилить 2 топ-кампании (прогноз +9–14%)."
              />
              <Notice
                dot="red"
                title="Риск: потери utm/click id"
                text="Найдены сессии без параметров на шаге оплаты. Проверьте редиректы и сохранение query."
              />
            </div>
          </div>
        </div>

        <div className="mt-8 flex items-center justify-between text-xs text-white/45">
          <div>© {new Date().getFullYear()} BoardIQ</div>
          <div className="flex gap-4">
            <a className="hover:text-white/70" href="#product">Продукт</a>
            <a className="hover:text-white/70" href="#pricing">Тарифы</a>
            <a className="hover:text-white/70" href="#faq">FAQ</a>
          </div>
        </div>
      </section>
    </main>
  );
}