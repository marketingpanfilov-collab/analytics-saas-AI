"use client";

import Link from "next/link";
import { useState } from "react";

function cn(...classes: (string | boolean | undefined | null)[]) {
  return classes.filter(Boolean).join(" ");
}

/* ========== BUTTONS ========== */

function PrimaryButton({ children, href }: { children: React.ReactNode; href: string }) {
  return (
    <Link
      href={href}
      className="inline-flex items-center justify-center rounded-full px-7 py-3.5 text-sm font-semibold text-[#0a0a0f] bg-[#96ffc8] hover:bg-[#aaffda] transition-all duration-200 shadow-[0_0_24px_rgba(150,255,200,0.25)]"
    >
      {children}
    </Link>
  );
}

function SecondaryButton({ children, href }: { children: React.ReactNode; href: string }) {
  return (
    <Link
      href={href}
      className="inline-flex items-center justify-center rounded-full px-7 py-3.5 text-sm font-semibold text-white/90 border border-white/15 hover:bg-white/5 transition-all duration-200"
    >
      {children}
    </Link>
  );
}

/* ========== FAQ ========== */

function FaqItem({ q, a, defaultOpen }: { q: string; a: string[]; defaultOpen?: boolean }) {
  const [open, setOpen] = useState(!!defaultOpen);
  return (
    <div className="border-b border-white/10">
      <button
        type="button"
        onClick={() => setOpen((s) => !s)}
        className="w-full py-6 flex items-center justify-between gap-4 text-left"
      >
        <span className="text-lg font-medium text-white/90">{q}</span>
        <span className="text-white/40 text-2xl font-light">{open ? "−" : "+"}</span>
      </button>
      {open && (
        <div className="pb-6 text-white/60 space-y-2 leading-relaxed">
          {a.map((line, i) => (
            <p key={i}>{line}</p>
          ))}
        </div>
      )}
    </div>
  );
}

/* ========== DASHBOARD PREVIEW (THE ONE STRONG VISUAL) ========== */

function DashboardPreview() {
  return (
    <div className="relative">
      {/* Ambient glow */}
      <div className="absolute -inset-8 bg-gradient-to-br from-[#96ffc8]/20 via-[#78aaff]/10 to-transparent blur-3xl opacity-70 pointer-events-none" />
      
      <div className="relative bg-[#0a0a12]/90 rounded-3xl border border-white/8 overflow-hidden shadow-2xl">
        {/* Browser chrome */}
        <div className="px-5 py-3.5 border-b border-white/6 flex items-center gap-3">
          <div className="flex items-center gap-2">
            <div className="h-3 w-3 rounded-full bg-white/20" />
            <div className="h-3 w-3 rounded-full bg-white/20" />
            <div className="h-3 w-3 rounded-full bg-white/20" />
          </div>
          <div className="flex-1 flex justify-center">
            <div className="px-4 py-1.5 rounded-lg bg-white/4 text-xs text-white/40">
              app.boardiq.io/dashboard
            </div>
          </div>
        </div>

        {/* Dashboard Content */}
        <div className="p-8">
          {/* Top row: Main KPI + Data Health */}
          <div className="flex items-start justify-between gap-8">
            {/* Main KPI - THE BIG NUMBER */}
            <div>
              <div className="text-[11px] uppercase tracking-[0.15em] text-white/40">Выручка за период</div>
              <div className="mt-3 text-6xl font-bold text-white tracking-tight">$847,290</div>
              <div className="mt-3 flex items-center gap-3">
                <div className="flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-[#96ffc8]/15">
                  <svg className="h-3 w-3 text-[#96ffc8]" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M5 10l7-7m0 0l7 7m-7-7v18" />
                  </svg>
                  <span className="text-sm font-semibold text-[#96ffc8]">+18.4%</span>
                </div>
                <span className="text-sm text-white/40">vs прошлый месяц</span>
              </div>
            </div>

            {/* Data Health */}
            <div className="text-right">
              <div className="inline-flex items-center gap-2.5 px-4 py-2 rounded-xl bg-[#96ffc8]/8 border border-[#96ffc8]/15">
                <div className="relative">
                  <div className="h-2.5 w-2.5 rounded-full bg-[#96ffc8]" />
                  <div className="absolute inset-0 h-2.5 w-2.5 rounded-full bg-[#96ffc8] animate-ping opacity-40" />
                </div>
                <div className="text-right">
                  <div className="text-[10px] uppercase tracking-wider text-white/40">Data Health</div>
                  <div className="text-lg font-bold text-[#96ffc8]">97%</div>
                </div>
              </div>
            </div>
          </div>

          {/* Chart */}
          <div className="mt-8 h-36 relative">
            <svg viewBox="0 0 500 120" className="w-full h-full" preserveAspectRatio="none">
              <defs>
                <linearGradient id="areaGradient" x1="0" x2="0" y1="0" y2="1">
                  <stop offset="0%" stopColor="rgba(150,255,200,0.25)" />
                  <stop offset="100%" stopColor="rgba(150,255,200,0)" />
                </linearGradient>
              </defs>
              <path
                d="M0 95 C30 90, 60 85, 90 80 C120 75, 150 70, 180 55 C210 40, 240 50, 270 45 C300 40, 330 30, 360 25 C390 20, 420 22, 450 18 L500 15 L500 120 L0 120 Z"
                fill="url(#areaGradient)"
              />
              <path
                d="M0 95 C30 90, 60 85, 90 80 C120 75, 150 70, 180 55 C210 40, 240 50, 270 45 C300 40, 330 30, 360 25 C390 20, 420 22, 450 18 L500 15"
                fill="none"
                stroke="#96ffc8"
                strokeWidth="2.5"
              />
              {/* Dot at the end */}
              <circle cx="500" cy="15" r="4" fill="#96ffc8" />
            </svg>
            {/* Subtle grid lines */}
            <div className="absolute inset-0 flex flex-col justify-between pointer-events-none">
              {[0, 1, 2].map((i) => (
                <div key={i} className="border-b border-white/5" />
              ))}
            </div>
          </div>

          {/* Channel breakdown - clean, minimal */}
          <div className="mt-8 grid grid-cols-3 gap-5">
            {[
              { name: "Google Ads", value: "$312k", romi: "4.2x", color: "#78aaff" },
              { name: "Meta Ads", value: "$289k", romi: "3.8x", color: "#96ffc8" },
              { name: "TikTok", value: "$156k", romi: "2.9x", color: "#ffd282" },
            ].map((ch) => (
              <div key={ch.name} className="bg-white/[0.03] rounded-2xl p-5 border border-white/5">
                <div className="flex items-center gap-2">
                  <div className="h-2 w-2 rounded-full" style={{ backgroundColor: ch.color }} />
                  <span className="text-xs text-white/50 font-medium">{ch.name}</span>
                </div>
                <div className="mt-3 text-2xl font-bold text-white">{ch.value}</div>
                <div className="mt-1.5 text-xs text-white/40">
                  ROMI <span className="text-white/70 font-medium">{ch.romi}</span>
                </div>
              </div>
            ))}
          </div>

          {/* Recommendation row */}
          <div className="mt-6 flex gap-5">
            <div className="flex-1 bg-[#ffd282]/8 border border-[#ffd282]/15 rounded-2xl p-5">
              <div className="flex items-center gap-2">
                <svg className="h-4 w-4 text-[#ffd282]" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M13 10V3L4 14h7v7l9-11h-7z" />
                </svg>
                <span className="text-xs font-semibold text-[#ffd282] uppercase tracking-wider">Рекомендация</span>
              </div>
              <p className="mt-3 text-sm text-white/70 leading-relaxed">
                Перераспределить 15% бюджета с TikTok Campaign B на Google Search — потенциал +$23k/мес
              </p>
            </div>
            <div className="flex-1 bg-[#78aaff]/8 border border-[#78aaff]/15 rounded-2xl p-5">
              <div className="flex items-center gap-2">
                <svg className="h-4 w-4 text-[#78aaff]" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
                </svg>
                <span className="text-xs font-semibold text-[#78aaff] uppercase tracking-wider">Сверка данных</span>
              </div>
              <p className="mt-3 text-sm text-white/70 leading-relaxed">
                CRM и Ads расходятся на 3.2% — в пределах нормы. Последняя сверка: сегодня
              </p>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

/* ========== MAIN PAGE ========== */

export default function Page() {
  return (
    <main className="min-h-screen overflow-x-hidden">
      {/* ========== HEADER ========== */}
      <header className="fixed top-0 left-0 right-0 z-50 backdrop-blur-md bg-[#0a0a0f]/70">
        <div className="mx-auto max-w-7xl px-6">
          <div className="flex items-center justify-between h-16">
            <Link href="/" className="flex items-center gap-2">
              <span className="text-xl font-bold text-white">BoardIQ</span>
            </Link>

            <nav className="hidden md:flex items-center gap-10 text-sm text-white/60">
              <a href="#product" className="hover:text-white transition-colors">Продукт</a>
              <a href="#attribution" className="hover:text-white transition-colors">Атрибуция</a>
              <a href="#pricing" className="hover:text-white transition-colors">Тарифы</a>
              <a href="#faq" className="hover:text-white transition-colors">FAQ</a>
            </nav>

            <div className="flex items-center gap-4">
              <Link href="/login" className="text-sm text-white/70 hover:text-white transition-colors">
                Войти
              </Link>
              <PrimaryButton href="#pricing">Начать</PrimaryButton>
            </div>
          </div>
        </div>
      </header>

      {/* ========== HERO ========== */}
      <section className="relative pt-32 pb-24">
        {/* Subtle radial glow */}
        <div className="absolute top-0 left-1/2 -translate-x-1/2 w-[1200px] h-[600px] bg-gradient-to-b from-[#96ffc8]/8 via-transparent to-transparent blur-3xl pointer-events-none" />
        
        <div className="relative mx-auto max-w-7xl px-6">
          <div className="grid lg:grid-cols-[1fr,1.2fr] gap-16 items-center">
            {/* Left Side - Copy */}
            <div className="max-w-xl">
              <h1 className="text-5xl md:text-[3.5rem] font-bold text-white leading-[1.08] tracking-tight text-balance">
                Маркетинговая аналитика без искажений
              </h1>
              
              <p className="mt-7 text-lg text-white/55 leading-relaxed">
                Реальная выручка по каналам, честный CAC и ROMI, сверка данных и рекомендации по перераспределению бюджета.
              </p>

              <div className="mt-10 flex flex-wrap items-center gap-4">
                <PrimaryButton href="#pricing">Попробовать бесплатно</PrimaryButton>
                <SecondaryButton href="#demo">Смотреть демо</SecondaryButton>
              </div>

              {/* Trust bullets - text only, no icons */}
              <div className="mt-14 space-y-3.5 text-[15px] text-white/50">
                <div className="flex items-center gap-3">
                  <span className="h-px w-5 bg-[#96ffc8]/50" />
                  <span>Прозрачные расчёты, единая методология</span>
                </div>
                <div className="flex items-center gap-3">
                  <span className="h-px w-5 bg-[#78aaff]/50" />
                  <span>Data-Driven Attribution вместо Last Click</span>
                </div>
                <div className="flex items-center gap-3">
                  <span className="h-px w-5 bg-[#ffd282]/50" />
                  <span>Конкретные рекомендации, не просто графики</span>
                </div>
              </div>
            </div>

            {/* Right Side - Dashboard (THE ONE STRONG VISUAL) */}
            <div id="demo" className="lg:translate-x-4">
              <DashboardPreview />
            </div>
          </div>
        </div>
      </section>

      {/* ========== SIGNALS / RECOMMENDATIONS ========== */}
      <section className="py-24 border-t border-white/6">
        <div className="mx-auto max-w-7xl px-6">
          <div className="max-w-xl">
            <h2 className="text-3xl font-bold text-white">Сигналы, а не просто данные</h2>
            <p className="mt-4 text-white/50 leading-relaxed">
              Система анализирует метрики и выдаёт конкретные действия: что перераспределить, что починить, где проблема.
            </p>
          </div>

          <div className="mt-14 grid md:grid-cols-2 lg:grid-cols-4 gap-8">
            {[
              {
                color: "#96ffc8",
                title: "Перераспределение бюджета",
                desc: "Снизить расходы на кампании с ROMI ниже 100% и усилить топ-3.",
              },
              {
                color: "#78aaff",
                title: "Расхождение данных",
                desc: "CRM показывает на 12% больше продаж. Проверьте настройку событий.",
              },
              {
                color: "#ffd282",
                title: "Рост стоимости привлечения",
                desc: "CAC вырос на 18% за неделю. Причина: рост частоты показов.",
              },
              {
                color: "#ff8ca0",
                title: "Потеря UTM-меток",
                desc: "23% сессий теряют параметры на этапе оплаты. Проверьте редиректы.",
              },
            ].map((item) => (
              <div key={item.title} className="group">
                <div
                  className="h-0.5 w-10 rounded-full mb-7 transition-all duration-300 group-hover:w-16"
                  style={{ backgroundColor: item.color }}
                />
                <h3 className="text-lg font-semibold text-white">{item.title}</h3>
                <p className="mt-3 text-sm text-white/45 leading-relaxed">{item.desc}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ========== PRODUCT EXPLANATION ========== */}
      <section id="product" className="py-24 border-t border-white/6">
        <div className="mx-auto max-w-7xl px-6">
          <div className="grid lg:grid-cols-2 gap-20 items-start">
            <div className="lg:sticky lg:top-32">
              <h2 className="text-4xl font-bold text-white leading-tight text-balance">
                Прозрачность данных вместо красивых отчётов
              </h2>
              <p className="mt-7 text-lg text-white/50 leading-relaxed">
                Мы сверяем источники и показываем расхождения. Вы видите реальную картину, а не то, что хочет показать рекламный кабинет.
              </p>
              <div className="mt-10">
                <PrimaryButton href="#pricing">Начать работу</PrimaryButton>
              </div>
            </div>

            <div className="space-y-10">
              {[
                {
                  num: "01",
                  title: "Единая методология метрик",
                  desc: "CAC, ROMI, LTV считаются по одной логике для всех каналов. Никаких расхождений между отчётами.",
                },
                {
                  num: "02",
                  title: "Автоматическая сверка источников",
                  desc: "Сравнение данных из CRM, рекламных кабинетов и аналитики сайта. Расхождения подсвечиваются.",
                },
                {
                  num: "03",
                  title: "Контроль качества данных",
                  desc: "Data Health Score показывает полноту и согласованность. Вы знаете, насколько можно доверять цифрам.",
                },
                {
                  num: "04",
                  title: "Рекомендации к действию",
                  desc: "Система анализирует и выдаёт конкретные советы: что сократить, что масштабировать, что исправить.",
                },
              ].map((item) => (
                <div key={item.num} className="flex gap-7">
                  <div className="text-3xl font-bold text-white/15">{item.num}</div>
                  <div>
                    <h3 className="text-xl font-semibold text-white">{item.title}</h3>
                    <p className="mt-3 text-white/50 leading-relaxed">{item.desc}</p>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      </section>

      {/* ========== ATTRIBUTION ========== */}
      <section id="attribution" className="py-24 border-t border-white/6">
        <div className="mx-auto max-w-7xl px-6">
          <div className="max-w-2xl mx-auto text-center">
            <h2 className="text-4xl font-bold text-white">Data-Driven Attribution</h2>
            <p className="mt-5 text-lg text-white/50">
              Распределение ценности на основе данных о пути клиента, а не правил вроде Last Click.
            </p>
          </div>

          <div className="mt-16 grid md:grid-cols-2 gap-8 max-w-4xl mx-auto">
            {/* Last Click */}
            <div className="bg-white/[0.025] rounded-2xl p-8 border border-white/6">
              <div className="text-xs text-white/35 uppercase tracking-[0.15em]">Last Click</div>
              <div className="mt-8 space-y-5">
                <div className="flex items-center justify-between">
                  <span className="text-white/50">Instagram</span>
                  <span className="text-white/30 font-medium">0%</span>
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-white/50">Google</span>
                  <span className="text-white/30 font-medium">0%</span>
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-white">Email</span>
                  <span className="text-white font-bold">100%</span>
                </div>
              </div>
              <p className="mt-8 text-sm text-white/35 leading-relaxed">
                Последний канал забирает всю ценность. Вы недооцениваете каналы, которые знакомят с брендом.
              </p>
            </div>

            {/* DDA */}
            <div className="bg-gradient-to-b from-[#96ffc8]/8 to-transparent rounded-2xl p-8 border border-[#96ffc8]/15">
              <div className="text-xs text-[#96ffc8] uppercase tracking-[0.15em]">DDA в BoardIQ</div>
              <div className="mt-8 space-y-5">
                {[
                  { name: "Instagram", value: 35, color: "#ffd282" },
                  { name: "Google", value: 42, color: "#78aaff" },
                  { name: "Email", value: 23, color: "#96ffc8" },
                ].map((ch) => (
                  <div key={ch.name}>
                    <div className="flex items-center justify-between mb-2.5">
                      <span className="text-white">{ch.name}</span>
                      <span className="text-white font-bold">{ch.value}%</span>
                    </div>
                    <div className="h-1.5 bg-white/8 rounded-full overflow-hidden">
                      <div
                        className="h-full rounded-full"
                        style={{ width: `${ch.value}%`, backgroundColor: ch.color }}
                      />
                    </div>
                  </div>
                ))}
              </div>
              <p className="mt-8 text-sm text-white/55 leading-relaxed">
                Вклад распределяется по данным о пути клиента. Точнее бюджетирование.
              </p>
            </div>
          </div>
        </div>
      </section>

      {/* ========== INTEGRATIONS ========== */}
      <section className="py-24 border-t border-white/6">
        <div className="mx-auto max-w-7xl px-6">
          <div className="flex flex-col md:flex-row md:items-end md:justify-between gap-6">
            <div>
              <h2 className="text-3xl font-bold text-white">Интеграции</h2>
              <p className="mt-3 text-white/45">Подключение за 10 минут. Синхронизация автоматическая.</p>
            </div>
          </div>

          <div className="mt-12 flex flex-wrap gap-3">
            {["Google Ads", "Meta Ads", "TikTok Ads", "GA4", "amoCRM", "Битрикс24", "Stripe", "YooKassa", "Tilda"].map((name) => (
              <div
                key={name}
                className="px-5 py-3.5 bg-white/[0.03] rounded-xl border border-white/6 text-white/70 text-sm font-medium hover:bg-white/[0.05] hover:border-white/10 transition-all duration-200"
              >
                {name}
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ========== PRICING ========== */}
      <section id="pricing" className="py-24 border-t border-white/6">
        <div className="mx-auto max-w-7xl px-6">
          <div className="text-center max-w-xl mx-auto">
            <h2 className="text-4xl font-bold text-white">Тарифы</h2>
            <p className="mt-4 text-white/45">14 дней бесплатно на любом тарифе. Без карты.</p>
          </div>

          <div className="mt-16 grid md:grid-cols-3 gap-6 max-w-5xl mx-auto">
            {[
              {
                name: "Starter",
                price: "$39",
                period: "/мес",
                desc: "Для небольших команд",
                features: ["До 3 источников данных", "Базовые отчёты", "DDA-атрибуция", "Email-поддержка"],
                highlighted: false,
              },
              {
                name: "Growth",
                price: "$99",
                period: "/мес",
                desc: "Самый популярный",
                features: ["До 10 источников", "Управленческие отчёты", "Рекомендации", "Приоритетная поддержка"],
                highlighted: true,
              },
              {
                name: "Agency",
                price: "$249",
                period: "/мес",
                desc: "Для агентств и команд",
                features: ["Безлимит проектов", "Роли и доступы", "White label", "Персональный менеджер"],
                highlighted: false,
              },
            ].map((plan) => (
              <div
                key={plan.name}
                className={cn(
                  "rounded-2xl p-8 transition-all duration-200",
                  plan.highlighted
                    ? "bg-gradient-to-b from-[#96ffc8]/10 to-transparent border-2 border-[#96ffc8]/25 scale-[1.03]"
                    : "bg-white/[0.025] border border-white/8"
                )}
              >
                <div className="text-sm text-white/45">{plan.desc}</div>
                <div className="mt-2 text-2xl font-bold text-white">{plan.name}</div>
                <div className="mt-5">
                  <span className="text-4xl font-bold text-white">{plan.price}</span>
                  <span className="text-white/45">{plan.period}</span>
                </div>
                <ul className="mt-8 space-y-4">
                  {plan.features.map((f) => (
                    <li key={f} className="flex items-center gap-3 text-sm text-white/65">
                      <span className="h-1.5 w-1.5 rounded-full bg-[#96ffc8]" />
                      {f}
                    </li>
                  ))}
                </ul>
                <div className="mt-8">
                  {plan.highlighted ? (
                    <PrimaryButton href="/login">Начать бесплатно</PrimaryButton>
                  ) : (
                    <SecondaryButton href="/login">Выбрать</SecondaryButton>
                  )}
                </div>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ========== FAQ ========== */}
      <section id="faq" className="py-24 border-t border-white/6">
        <div className="mx-auto max-w-3xl px-6">
          <h2 className="text-3xl font-bold text-white text-center">Вопросы и ответы</h2>

          <div className="mt-14">
            <FaqItem
              q="Чем вы отличаетесь от Google Analytics?"
              a={[
                "GA4 показывает сессии и события. Мы показываем деньги: выручку, CAC, ROMI по каждому каналу.",
                "Мы сверяем данные из CRM с рекламными кабинетами и подсвечиваем расхождения.",
                "Плюс вы получаете рекомендации: что сократить, что масштабировать, что исправить.",
              ]}
              defaultOpen
            />
            <FaqItem
              q="Как работает DDA-атрибуция?"
              a={[
                "DDA анализирует все касания клиента до покупки и распределяет ценность на основе данных.",
                "В отличие от Last Click, где 100% получает последний канал, DDA учитывает вклад каждого касания.",
                "Это помогает точнее распределять бюджеты и не переоценивать ретаргетинг.",
              ]}
            />
            <FaqItem
              q="Какие данные нужны для начала работы?"
              a={[
                "Минимум: рекламный кабинет (Google/Meta/TikTok) и CRM или данные о продажах.",
                "Идеально: ещё GA4 или данные с сайта для полной картины пути клиента.",
                "Подключение занимает около 10 минут. Данные начинают поступать сразу.",
              ]}
            />
            <FaqItem
              q="Можно ли попробовать бесплатно?"
              a={[
                "Да, 14 дней бесплатно на любом тарифе.",
                "Карта не нужна. Подключите источники и начните работать.",
              ]}
            />
          </div>
        </div>
      </section>

      {/* ========== FINAL CTA ========== */}
      <section className="py-24 border-t border-white/6">
        <div className="mx-auto max-w-7xl px-6">
          <div className="max-w-2xl mx-auto text-center">
            <h2 className="text-4xl md:text-5xl font-bold text-white leading-tight text-balance">
              Перестаньте гадать. Начните управлять.
            </h2>
            <p className="mt-7 text-lg text-white/45">
              Подключите источники данных и получите прозрачные отчёты за 10 минут.
            </p>
            <div className="mt-10 flex flex-wrap justify-center gap-4">
              <PrimaryButton href="/login">Попробовать бесплатно</PrimaryButton>
              <SecondaryButton href="#demo">Смотреть демо</SecondaryButton>
            </div>
          </div>
        </div>
      </section>

      {/* ========== FOOTER ========== */}
      <footer className="py-14 border-t border-white/6">
        <div className="mx-auto max-w-7xl px-6">
          <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-6">
            <div className="text-xl font-bold text-white">BoardIQ</div>
            <nav className="flex gap-8 text-sm text-white/45">
              <a href="#product" className="hover:text-white transition-colors">Продукт</a>
              <a href="#pricing" className="hover:text-white transition-colors">Тарифы</a>
              <a href="#faq" className="hover:text-white transition-colors">FAQ</a>
            </nav>
            <div className="text-sm text-white/25">© {new Date().getFullYear()} BoardIQ</div>
          </div>
        </div>
      </footer>
    </main>
  );
}
