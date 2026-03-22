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
      className="inline-flex items-center justify-center rounded-full px-6 py-3 text-sm font-semibold text-[#0a0a0f] bg-[#96ffc8] hover:bg-[#b0ffd8] transition-all duration-200"
    >
      {children}
    </Link>
  );
}

function SecondaryButton({ children, href }: { children: React.ReactNode; href: string }) {
  return (
    <Link
      href={href}
      className="inline-flex items-center justify-center rounded-full px-6 py-3 text-sm font-semibold text-white/90 border border-white/15 hover:bg-white/5 transition-all duration-200"
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

/* ========== DASHBOARD PREVIEW ========== */

function DashboardPreview() {
  return (
    <div className="relative">
      {/* Glow effect */}
      <div className="absolute -inset-4 bg-gradient-to-r from-[#96ffc8]/20 via-[#78aaff]/15 to-transparent blur-3xl opacity-60" />
      
      <div className="relative bg-[#0c0c14] rounded-2xl border border-white/10 overflow-hidden">
        {/* Dashboard Header */}
        <div className="px-6 py-4 border-b border-white/8 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="h-3 w-3 rounded-full bg-[#ff5f57]" />
            <div className="h-3 w-3 rounded-full bg-[#febc2e]" />
            <div className="h-3 w-3 rounded-full bg-[#28c840]" />
          </div>
          <div className="text-xs text-white/40">boardiq.app/dashboard</div>
        </div>

        {/* Dashboard Content */}
        <div className="p-6 space-y-6">
          {/* Main KPI */}
          <div className="flex items-start justify-between">
            <div>
              <div className="text-xs text-white/50 uppercase tracking-wider">Выручка за период</div>
              <div className="mt-2 text-5xl font-bold text-white tracking-tight">$127,450</div>
              <div className="mt-2 flex items-center gap-2">
                <span className="text-[#96ffc8] text-sm font-medium">+23.4%</span>
                <span className="text-white/40 text-sm">vs прошлый месяц</span>
              </div>
            </div>
            <div className="text-right">
              <div className="inline-flex items-center gap-2 px-3 py-1.5 rounded-full bg-[#96ffc8]/10 border border-[#96ffc8]/20">
                <span className="h-2 w-2 rounded-full bg-[#96ffc8]" />
                <span className="text-xs text-[#96ffc8] font-medium">Данные актуальны</span>
              </div>
            </div>
          </div>

          {/* Chart */}
          <div className="h-32 relative">
            <svg viewBox="0 0 400 100" className="w-full h-full" preserveAspectRatio="none">
              <defs>
                <linearGradient id="chartGradient" x1="0" x2="0" y1="0" y2="1">
                  <stop offset="0%" stopColor="rgba(150,255,200,0.3)" />
                  <stop offset="100%" stopColor="rgba(150,255,200,0)" />
                </linearGradient>
              </defs>
              <path
                d="M0 80 L40 75 L80 70 L120 60 L160 65 L200 45 L240 50 L280 35 L320 40 L360 25 L400 20 L400 100 L0 100 Z"
                fill="url(#chartGradient)"
              />
              <path
                d="M0 80 L40 75 L80 70 L120 60 L160 65 L200 45 L240 50 L280 35 L320 40 L360 25 L400 20"
                fill="none"
                stroke="#96ffc8"
                strokeWidth="2"
              />
            </svg>
          </div>

          {/* Channel Breakdown */}
          <div className="grid grid-cols-3 gap-4">
            {[
              { name: "Google Ads", value: "$42.1k", share: "33%", color: "#78aaff" },
              { name: "Meta Ads", value: "$38.7k", share: "30%", color: "#96ffc8" },
              { name: "TikTok", value: "$28.4k", share: "22%", color: "#ffd282" },
            ].map((ch) => (
              <div key={ch.name} className="bg-white/3 rounded-xl p-4">
                <div className="flex items-center gap-2">
                  <div className="h-2 w-2 rounded-full" style={{ backgroundColor: ch.color }} />
                  <span className="text-xs text-white/50">{ch.name}</span>
                </div>
                <div className="mt-2 text-xl font-semibold text-white">{ch.value}</div>
                <div className="mt-1 text-xs text-white/40">{ch.share} от общего</div>
              </div>
            ))}
          </div>

          {/* Data Quality + Insight */}
          <div className="flex gap-4">
            <div className="flex-1 bg-white/3 rounded-xl p-4">
              <div className="flex items-center justify-between">
                <span className="text-xs text-white/50">Data Health Score</span>
                <span className="text-lg font-semibold text-[#96ffc8]">94%</span>
              </div>
              <div className="mt-3 h-1.5 bg-white/10 rounded-full overflow-hidden">
                <div className="h-full bg-gradient-to-r from-[#96ffc8] to-[#78aaff] rounded-full" style={{ width: "94%" }} />
              </div>
            </div>
            <div className="flex-1 bg-[#ffd282]/10 border border-[#ffd282]/20 rounded-xl p-4">
              <div className="flex items-center gap-2">
                <div className="h-2 w-2 rounded-full bg-[#ffd282]" />
                <span className="text-xs text-[#ffd282]">Рекомендация</span>
              </div>
              <p className="mt-2 text-sm text-white/70">Снизить бюджет Campaign B на 15%</p>
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
    <main className="min-h-screen">
      {/* ========== HEADER ========== */}
      <header className="fixed top-0 left-0 right-0 z-50">
        <div className="mx-auto max-w-7xl px-6">
          <div className="flex items-center justify-between h-16 border-b border-white/8">
            <Link href="/" className="flex items-center gap-2">
              <span className="text-lg font-bold text-white">BoardIQ</span>
            </Link>

            <nav className="hidden md:flex items-center gap-8 text-sm text-white/60">
              <a href="#product" className="hover:text-white transition-colors">Продукт</a>
              <a href="#attribution" className="hover:text-white transition-colors">Атрибуция</a>
              <a href="#integrations" className="hover:text-white transition-colors">Интеграции</a>
              <a href="#pricing" className="hover:text-white transition-colors">Тарифы</a>
            </nav>

            <div className="flex items-center gap-3">
              <Link href="/login" className="text-sm text-white/70 hover:text-white transition-colors">
                Войти
              </Link>
              <PrimaryButton href="#pricing">Начать</PrimaryButton>
            </div>
          </div>
        </div>
      </header>

      {/* ========== HERO ========== */}
      <section className="pt-32 pb-20 overflow-hidden">
        <div className="mx-auto max-w-7xl px-6">
          <div className="grid lg:grid-cols-2 gap-16 items-center">
            {/* Left Side */}
            <div className="max-w-xl">
              <h1 className="text-5xl md:text-6xl font-bold text-white leading-[1.1] tracking-tight text-balance">
                Аналитика маркетинга без искажений
              </h1>
              
              <p className="mt-6 text-lg text-white/60 leading-relaxed">
                Реальная выручка, точный CAC, честный ROMI. Подключите источники данных и получите управленческие отчёты с рекомендациями.
              </p>

              <div className="mt-8 flex flex-wrap items-center gap-4">
                <PrimaryButton href="#pricing">Попробовать бесплатно</PrimaryButton>
                <SecondaryButton href="#demo">Посмотреть демо</SecondaryButton>
              </div>

              <div className="mt-12 flex items-center gap-8 text-sm text-white/50">
                <div className="flex items-center gap-2">
                  <span className="h-1.5 w-1.5 rounded-full bg-[#96ffc8]" />
                  Прозрачные расчёты
                </div>
                <div className="flex items-center gap-2">
                  <span className="h-1.5 w-1.5 rounded-full bg-[#78aaff]" />
                  DDA-атрибуция
                </div>
                <div className="flex items-center gap-2">
                  <span className="h-1.5 w-1.5 rounded-full bg-[#ffd282]" />
                  Рекомендации
                </div>
              </div>
            </div>

            {/* Right Side - Dashboard */}
            <div id="demo" className="lg:translate-x-8">
              <DashboardPreview />
            </div>
          </div>
        </div>
      </section>

      {/* ========== SIGNALS / RECOMMENDATIONS ========== */}
      <section className="py-20 border-t border-white/8">
        <div className="mx-auto max-w-7xl px-6">
          <div className="max-w-2xl">
            <h2 className="text-3xl font-bold text-white">Сигналы и рекомендации</h2>
            <p className="mt-4 text-white/50">
              Система анализирует данные и выдаёт конкретные действия: где проблема, почему и что делать.
            </p>
          </div>

          <div className="mt-12 grid md:grid-cols-2 lg:grid-cols-4 gap-6">
            {[
              {
                color: "#96ffc8",
                title: "Перераспределение бюджета",
                desc: "Снизить расходы на кампании с ROMI < 80% и усилить топ-3 кампании.",
              },
              {
                color: "#78aaff",
                title: "Расхождение данных",
                desc: "CRM показывает на 12% больше продаж, чем Ads. Проверьте события.",
              },
              {
                color: "#ffd282",
                title: "Рост CAC",
                desc: "Стоимость привлечения выросла на 18% за неделю. Причина: частота показов.",
              },
              {
                color: "#ff8ca0",
                title: "Потеря параметров",
                desc: "23% сессий теряют UTM на этапе оплаты. Проверьте редиректы.",
              },
            ].map((item) => (
              <div key={item.title} className="group">
                <div
                  className="h-1 w-12 rounded-full mb-6 transition-all duration-300 group-hover:w-20"
                  style={{ backgroundColor: item.color }}
                />
                <h3 className="text-lg font-semibold text-white">{item.title}</h3>
                <p className="mt-2 text-sm text-white/50 leading-relaxed">{item.desc}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ========== PRODUCT EXPLANATION ========== */}
      <section id="product" className="py-20 border-t border-white/8">
        <div className="mx-auto max-w-7xl px-6">
          <div className="grid lg:grid-cols-2 gap-16 items-start">
            <div className="lg:sticky lg:top-32">
              <h2 className="text-4xl font-bold text-white leading-tight">
                Прозрачность вместо красивых цифр
              </h2>
              <p className="mt-6 text-lg text-white/50 leading-relaxed">
                Мы сверяем данные из разных источников и показываем расхождения. 
                Вы видите реальную картину, а не то, что хочет показать рекламный кабинет.
              </p>
              <div className="mt-8">
                <PrimaryButton href="#pricing">Начать работу</PrimaryButton>
              </div>
            </div>

            <div className="space-y-8">
              {[
                {
                  num: "01",
                  title: "Единая логика метрик",
                  desc: "CAC, ROMI, LTV считаются по одной методологии для всех каналов. Никаких расхождений между отчётами.",
                },
                {
                  num: "02",
                  title: "Сверка источников",
                  desc: "Автоматическое сравнение данных из CRM, рекламных кабинетов и аналитики сайта. Расхождения подсвечиваются.",
                },
                {
                  num: "03",
                  title: "Контроль качества данных",
                  desc: "Data Health Score показывает полноту и согласованность данных. Вы знаете, насколько можно доверять цифрам.",
                },
                {
                  num: "04",
                  title: "Рекомендации к действию",
                  desc: "Система анализирует метрики и выдаёт конкретные советы: что резать, что масштабировать, что чинить.",
                },
              ].map((item) => (
                <div key={item.num} className="flex gap-6">
                  <div className="text-2xl font-bold text-white/20">{item.num}</div>
                  <div>
                    <h3 className="text-xl font-semibold text-white">{item.title}</h3>
                    <p className="mt-2 text-white/50 leading-relaxed">{item.desc}</p>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      </section>

      {/* ========== ATTRIBUTION ========== */}
      <section id="attribution" className="py-20 border-t border-white/8">
        <div className="mx-auto max-w-7xl px-6">
          <div className="max-w-2xl mx-auto text-center">
            <h2 className="text-4xl font-bold text-white">Data-Driven Attribution</h2>
            <p className="mt-4 text-lg text-white/50">
              Оценка вклада каналов на основе данных о пути клиента, а не правил вроде Last Click.
            </p>
          </div>

          <div className="mt-16 grid md:grid-cols-2 gap-8 max-w-4xl mx-auto">
            {/* Last Click */}
            <div className="bg-white/3 rounded-2xl p-8">
              <div className="text-xs text-white/40 uppercase tracking-wider">Модель Last Click</div>
              <div className="mt-6 space-y-4">
                <div className="flex items-center justify-between">
                  <span className="text-white/60">Instagram</span>
                  <span className="text-white/40">0%</span>
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-white/60">Google</span>
                  <span className="text-white/40">0%</span>
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-white">Email</span>
                  <span className="text-white font-semibold">100%</span>
                </div>
              </div>
              <p className="mt-6 text-sm text-white/40">
                Последний канал забирает всю ценность. Вы недооцениваете каналы, которые знакомят с брендом.
              </p>
            </div>

            {/* DDA */}
            <div className="bg-gradient-to-b from-[#96ffc8]/10 to-transparent rounded-2xl p-8 border border-[#96ffc8]/20">
              <div className="text-xs text-[#96ffc8] uppercase tracking-wider">DDA в BoardIQ</div>
              <div className="mt-6 space-y-4">
                {[
                  { name: "Instagram", value: 35, color: "#ffd282" },
                  { name: "Google", value: 42, color: "#78aaff" },
                  { name: "Email", value: 23, color: "#96ffc8" },
                ].map((ch) => (
                  <div key={ch.name}>
                    <div className="flex items-center justify-between mb-2">
                      <span className="text-white">{ch.name}</span>
                      <span className="text-white font-semibold">{ch.value}%</span>
                    </div>
                    <div className="h-1.5 bg-white/10 rounded-full overflow-hidden">
                      <div
                        className="h-full rounded-full transition-all duration-500"
                        style={{ width: `${ch.value}%`, backgroundColor: ch.color }}
                      />
                    </div>
                  </div>
                ))}
              </div>
              <p className="mt-6 text-sm text-white/60">
                Вклад распределяется по данным о пути клиента. Точнее бюджетирование.
              </p>
            </div>
          </div>
        </div>
      </section>

      {/* ========== INTEGRATIONS ========== */}
      <section id="integrations" className="py-20 border-t border-white/8">
        <div className="mx-auto max-w-7xl px-6">
          <div className="flex flex-col md:flex-row md:items-end md:justify-between gap-6">
            <div>
              <h2 className="text-3xl font-bold text-white">Интеграции</h2>
              <p className="mt-2 text-white/50">Подключение за 10 минут. Данные синхронизируются автоматически.</p>
            </div>
          </div>

          <div className="mt-12 flex flex-wrap gap-4">
            {["Google Ads", "Meta Ads", "TikTok Ads", "GA4", "amoCRM", "Битрикс24", "Stripe", "YooKassa"].map((name) => (
              <div
                key={name}
                className="px-6 py-4 bg-white/3 rounded-xl border border-white/8 text-white/80 text-sm font-medium hover:bg-white/5 hover:border-white/12 transition-all duration-200"
              >
                {name}
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ========== PRICING ========== */}
      <section id="pricing" className="py-20 border-t border-white/8">
        <div className="mx-auto max-w-7xl px-6">
          <div className="text-center max-w-2xl mx-auto">
            <h2 className="text-4xl font-bold text-white">Простые тарифы</h2>
            <p className="mt-4 text-white/50">Без скрытых платежей. Масштабируйтесь по мере роста.</p>
          </div>

          <div className="mt-16 grid md:grid-cols-3 gap-8 max-w-5xl mx-auto">
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
                desc: "Для агентств",
                features: ["Безлимит проектов", "Роли и доступы", "White label", "Персональный менеджер"],
                highlighted: false,
              },
            ].map((plan) => (
              <div
                key={plan.name}
                className={cn(
                  "rounded-2xl p-8 transition-all duration-200",
                  plan.highlighted
                    ? "bg-gradient-to-b from-[#96ffc8]/10 to-transparent border-2 border-[#96ffc8]/30 scale-105"
                    : "bg-white/3 border border-white/10"
                )}
              >
                <div className="text-sm text-white/50">{plan.desc}</div>
                <div className="mt-2 text-2xl font-bold text-white">{plan.name}</div>
                <div className="mt-4">
                  <span className="text-4xl font-bold text-white">{plan.price}</span>
                  <span className="text-white/50">{plan.period}</span>
                </div>
                <ul className="mt-8 space-y-4">
                  {plan.features.map((f) => (
                    <li key={f} className="flex items-center gap-3 text-sm text-white/70">
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
      <section id="faq" className="py-20 border-t border-white/8">
        <div className="mx-auto max-w-3xl px-6">
          <h2 className="text-3xl font-bold text-white text-center">Вопросы и ответы</h2>

          <div className="mt-12">
            <FaqItem
              q="Чем вы отличаетесь от Google Analytics?"
              a={[
                "GA4 показывает сессии и события. Мы показываем деньги: выручку, CAC, ROMI по каждому каналу.",
                "Мы сверяем данные из CRM с рекламными кабинетами и подсвечиваем расхождения.",
                "Плюс вы получаете рекомендации: что резать, что масштабировать, что чинить.",
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
                "Да, есть 14-дневный пробный период на любом тарифе.",
                "Карта не нужна. Просто подключите источники и начните работать.",
              ]}
            />
          </div>
        </div>
      </section>

      {/* ========== FINAL CTA ========== */}
      <section className="py-20 border-t border-white/8">
        <div className="mx-auto max-w-7xl px-6">
          <div className="max-w-3xl mx-auto text-center">
            <h2 className="text-4xl md:text-5xl font-bold text-white leading-tight">
              Перестаньте гадать. Начните управлять.
            </h2>
            <p className="mt-6 text-lg text-white/50">
              Подключите источники данных и получите прозрачные отчёты за 10 минут.
            </p>
            <div className="mt-8 flex flex-wrap justify-center gap-4">
              <PrimaryButton href="/login">Попробовать бесплатно</PrimaryButton>
              <SecondaryButton href="#demo">Посмотреть демо</SecondaryButton>
            </div>
          </div>
        </div>
      </section>

      {/* ========== FOOTER ========== */}
      <footer className="py-12 border-t border-white/8">
        <div className="mx-auto max-w-7xl px-6">
          <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-6">
            <div className="text-white font-bold">BoardIQ</div>
            <nav className="flex gap-6 text-sm text-white/50">
              <a href="#product" className="hover:text-white transition-colors">Продукт</a>
              <a href="#pricing" className="hover:text-white transition-colors">Тарифы</a>
              <a href="#faq" className="hover:text-white transition-colors">FAQ</a>
            </nav>
            <div className="text-sm text-white/30">© {new Date().getFullYear()} BoardIQ</div>
          </div>
        </div>
      </footer>
    </main>
  );
}
