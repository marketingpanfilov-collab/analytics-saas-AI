"use client";

import Link from "next/link";
import { useState } from "react";

function cn(...v: Array<string | false | null | undefined>) {
  return v.filter(Boolean).join(" ");
}

function FaqItem({
  q,
  a,
  defaultOpen,
}: {
  q: string;
  a: string;
  defaultOpen?: boolean;
}) {
  const [open, setOpen] = useState(!!defaultOpen);
  return (
    <div className="border-b border-white/10">
      <button
        type="button"
        onClick={() => setOpen((s) => !s)}
        className="w-full py-5 flex items-center justify-between gap-4 text-left"
      >
        <span className="font-semibold text-white/90">{q}</span>
        <span className="text-white/50 text-xl font-light">{open ? "−" : "+"}</span>
      </button>
      {open && (
        <div className="pb-5 text-sm text-white/65 leading-relaxed">{a}</div>
      )}
    </div>
  );
}

export default function Page() {
  return (
    <main className="min-h-screen bg-[#0B0F14]">
      {/* HEADER */}
      <header className="fixed top-0 left-0 right-0 z-50">
        <div className="bg-[#0B0F14]/80 backdrop-blur-xl border-b border-white/5">
          <div className="mx-auto max-w-6xl px-6 h-16 flex items-center justify-between">
            <Link href="/" className="text-lg font-bold text-white">
              BoardIQ
            </Link>

            <nav className="hidden md:flex items-center gap-8 text-sm text-white/60">
              <a href="#product" className="hover:text-white transition">Продукт</a>
              <a href="#attribution" className="hover:text-white transition">Атрибуция</a>
              <a href="#integrations" className="hover:text-white transition">Интеграции</a>
              <a href="#pricing" className="hover:text-white transition">Тарифы</a>
              <a href="#faq" className="hover:text-white transition">FAQ</a>
            </nav>

            <div className="flex items-center gap-3">
              <Link
                href="/login"
                className="text-sm text-white/70 hover:text-white transition"
              >
                Вход
              </Link>
              <Link
                href="#pricing"
                className="text-sm font-semibold text-white bg-white/10 hover:bg-white/15 px-4 py-2 rounded-lg transition"
              >
                Начать
              </Link>
            </div>
          </div>
        </div>
      </header>

      {/* HERO */}
      <section className="pt-32 pb-24 px-6">
        <div className="mx-auto max-w-6xl">
          <div className="grid lg:grid-cols-2 gap-16 items-center">
            {/* LEFT */}
            <div className="space-y-8">
              {/* Badges */}
              <div className="flex flex-wrap gap-2">
                <span className="text-xs text-white/50 bg-white/5 px-3 py-1.5 rounded-full">
                  Прозрачные данные
                </span>
                <span className="text-xs text-white/50 bg-white/5 px-3 py-1.5 rounded-full">
                  DDA-атрибуция
                </span>
                <span className="text-xs text-white/50 bg-white/5 px-3 py-1.5 rounded-full">
                  Рекомендации
                </span>
              </div>

              <h1 className="text-4xl md:text-5xl font-bold leading-tight text-white text-balance">
                Управляйте маркетингом через прибыль, а не рекламные кабинеты
              </h1>

              <p className="text-lg text-white/55 leading-relaxed max-w-lg">
                BoardIQ объединяет рекламу, CRM и аналитику в одну систему.
                Видите реальную выручку, CAC, ROMI и вклад каналов — без искажённых данных.
              </p>

              {/* CTA */}
              <div className="flex flex-wrap gap-3">
                <Link
                  href="#pricing"
                  className="inline-flex items-center justify-center px-6 py-3 text-sm font-semibold text-[#0B0F14] bg-white hover:bg-white/90 rounded-lg transition"
                >
                  Начать
                </Link>
                <Link
                  href="#demo"
                  className="inline-flex items-center justify-center px-6 py-3 text-sm font-semibold text-white/80 bg-white/5 hover:bg-white/10 border border-white/10 rounded-lg transition"
                >
                  Смотреть демо
                </Link>
              </div>

              {/* Bullets */}
              <div className="space-y-2 text-sm text-white/50">
                <div>Честная сквозная аналитика</div>
                <div>Реальный вклад каналов (DDA)</div>
                <div>Мониторинг качества данных</div>
              </div>
            </div>

            {/* RIGHT — DASHBOARD PREVIEW */}
            <div className="relative">
              <div className="bg-[#12141A] border border-white/10 rounded-2xl p-6 shadow-2xl">
                {/* Top metric */}
                <div className="mb-6">
                  <div className="text-xs text-white/40 uppercase tracking-wider mb-1">Выручка</div>
                  <div className="flex items-baseline gap-3">
                    <span className="text-4xl font-bold text-white">$127,450</span>
                    <span className="text-sm font-medium text-emerald-400">+23%</span>
                  </div>
                </div>

                {/* Chart */}
                <div className="h-40 mb-6 relative">
                  <svg className="w-full h-full" viewBox="0 0 400 120" preserveAspectRatio="none">
                    <defs>
                      <linearGradient id="chartGradient" x1="0" x2="0" y1="0" y2="1">
                        <stop offset="0%" stopColor="rgba(52,211,153,0.3)" />
                        <stop offset="100%" stopColor="rgba(52,211,153,0)" />
                      </linearGradient>
                    </defs>
                    <path
                      d="M0 100 L50 85 L100 90 L150 70 L200 75 L250 55 L300 45 L350 30 L400 20 L400 120 L0 120 Z"
                      fill="url(#chartGradient)"
                    />
                    <path
                      d="M0 100 L50 85 L100 90 L150 70 L200 75 L250 55 L300 45 L350 30 L400 20"
                      fill="none"
                      stroke="rgba(52,211,153,0.8)"
                      strokeWidth="2"
                    />
                  </svg>
                </div>

                {/* Channel breakdown */}
                <div className="space-y-3 mb-6">
                  <div className="flex items-center justify-between text-sm">
                    <span className="text-white/60">Google Ads</span>
                    <span className="text-white font-medium">$42k</span>
                  </div>
                  <div className="h-1.5 bg-white/5 rounded-full overflow-hidden">
                    <div className="h-full bg-blue-400/70 rounded-full" style={{ width: "45%" }} />
                  </div>

                  <div className="flex items-center justify-between text-sm">
                    <span className="text-white/60">Meta</span>
                    <span className="text-white font-medium">$38k</span>
                  </div>
                  <div className="h-1.5 bg-white/5 rounded-full overflow-hidden">
                    <div className="h-full bg-indigo-400/70 rounded-full" style={{ width: "38%" }} />
                  </div>

                  <div className="flex items-center justify-between text-sm">
                    <span className="text-white/60">TikTok</span>
                    <span className="text-white font-medium">$28k</span>
                  </div>
                  <div className="h-1.5 bg-white/5 rounded-full overflow-hidden">
                    <div className="h-full bg-pink-400/70 rounded-full" style={{ width: "28%" }} />
                  </div>
                </div>

                {/* Data Health */}
                <div className="flex items-center justify-between text-sm mb-4 py-3 border-t border-white/5">
                  <span className="text-white/50">Data Health</span>
                  <span className="text-emerald-400 font-medium">94%</span>
                </div>

                {/* Insight */}
                <div className="bg-emerald-500/10 border border-emerald-500/20 rounded-lg p-3">
                  <div className="text-xs text-emerald-400/80">Рекомендация</div>
                  <div className="text-sm text-white/80 mt-1">
                    Увеличьте бюджет на Campaign B (+12% прогноз)
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* SIGNALS */}
      <section className="py-24 px-6">
        <div className="mx-auto max-w-6xl">
          <div className="text-center mb-16">
            <h2 className="text-3xl font-bold text-white mb-4">
              Что требует внимания прямо сейчас
            </h2>
            <p className="text-white/50 max-w-xl mx-auto">
              Система обнаруживает проблемы и даёт чёткие действия.
            </p>
          </div>

          <div className="grid md:grid-cols-2 lg:grid-cols-4 gap-4">
            {/* Signal 1 */}
            <div className="bg-[#12141A] border-l-2 border-emerald-400 rounded-lg p-5">
              <div className="text-sm font-semibold text-white mb-2">Перераспределение бюджета</div>
              <div className="text-sm text-white/50 leading-relaxed">
                Сократите 12–18% с кампаний с низким ROMI, масштабируйте лучшие
              </div>
            </div>

            {/* Signal 2 */}
            <div className="bg-[#12141A] border-l-2 border-amber-400 rounded-lg p-5">
              <div className="text-sm font-semibold text-white mb-2">Расхождение данных</div>
              <div className="text-sm text-white/50 leading-relaxed">
                7% расхождение между CRM и Ads — проверьте трекинг
              </div>
            </div>

            {/* Signal 3 */}
            <div className="bg-[#12141A] border-l-2 border-red-400 rounded-lg p-5">
              <div className="text-sm font-semibold text-white mb-2">Рост CAC</div>
              <div className="text-sm text-white/50 leading-relaxed">
                CAC вырос на 11% — проверьте таргетинг и частоту показов
              </div>
            </div>

            {/* Signal 4 */}
            <div className="bg-[#12141A] border-l-2 border-blue-400 rounded-lg p-5">
              <div className="text-sm font-semibold text-white mb-2">Потеря трекинга</div>
              <div className="text-sm text-white/50 leading-relaxed">
                Обнаружены сессии без UTM / click_id — проверьте редиректы
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* PRODUCT VALUE */}
      <section id="product" className="py-24 px-6 bg-[#0A0D11]">
        <div className="mx-auto max-w-6xl">
          <div className="text-center mb-16">
            <h2 className="text-3xl font-bold text-white mb-4">
              Единая система для маркетинговых решений
            </h2>
          </div>

          <div className="grid md:grid-cols-2 gap-6">
            {/* Block 1 - larger */}
            <div className="bg-[#12141A] border border-white/5 rounded-xl p-8 md:row-span-2">
              <div className="text-xl font-semibold text-white mb-3">
                Единая логика метрик
              </div>
              <p className="text-white/50 leading-relaxed mb-6">
                Выручка, CAC, ROMI рассчитываются по единым правилам. Никаких расхождений между отчётами.
              </p>
              <div className="h-32 bg-gradient-to-br from-emerald-500/10 to-transparent rounded-lg" />
            </div>

            {/* Block 2 */}
            <div className="bg-[#12141A] border border-white/5 rounded-xl p-6">
              <div className="text-lg font-semibold text-white mb-2">
                Сверка источников
              </div>
              <p className="text-white/50 text-sm leading-relaxed">
                Ads, CRM, аналитика — всё сведено в одну модель
              </p>
            </div>

            {/* Block 3 */}
            <div className="bg-[#12141A] border border-white/5 rounded-xl p-6">
              <div className="text-lg font-semibold text-white mb-2">
                Контроль качества данных
              </div>
              <p className="text-white/50 text-sm leading-relaxed">
                Понимайте, когда данные неполные или сломаны
              </p>
            </div>

            {/* Block 4 */}
            <div className="md:col-span-2 bg-[#12141A] border border-white/5 rounded-xl p-6 flex items-center gap-6">
              <div className="flex-1">
                <div className="text-lg font-semibold text-white mb-2">
                  Действенные рекомендации
                </div>
                <p className="text-white/50 text-sm leading-relaxed">
                  Знайте, что сократить, что масштабировать и что починить
                </p>
              </div>
              <div className="hidden md:block w-24 h-24 bg-gradient-to-br from-blue-500/10 to-transparent rounded-lg" />
            </div>
          </div>
        </div>
      </section>

      {/* ATTRIBUTION */}
      <section id="attribution" className="py-24 px-6">
        <div className="mx-auto max-w-6xl">
          <div className="text-center mb-16">
            <h2 className="text-3xl font-bold text-white mb-4">
              Data-Driven Attribution
            </h2>
            <p className="text-white/50 max-w-xl mx-auto">
              Поймите реальный вклад каналов, а не искажение last click.
            </p>
          </div>

          <div className="grid md:grid-cols-2 gap-8">
            {/* Last Click */}
            <div className="bg-[#12141A] border border-white/5 rounded-xl p-8">
              <div className="text-sm text-white/40 uppercase tracking-wider mb-4">Last Click</div>
              <div className="space-y-4">
                <div className="flex items-center justify-between">
                  <span className="text-white/70">Email</span>
                  <span className="text-2xl font-bold text-white">100%</span>
                </div>
                <div className="h-2 bg-white/10 rounded-full">
                  <div className="h-full bg-white/30 rounded-full w-full" />
                </div>
              </div>
            </div>

            {/* DDA */}
            <div className="bg-[#12141A] border border-emerald-500/20 rounded-xl p-8">
              <div className="text-sm text-emerald-400/70 uppercase tracking-wider mb-4">DDA Distribution</div>
              <div className="space-y-4">
                <div className="flex items-center justify-between">
                  <span className="text-white/70">Instagram</span>
                  <span className="text-white font-medium">35%</span>
                </div>
                <div className="h-2 bg-white/5 rounded-full overflow-hidden">
                  <div className="h-full bg-pink-400/60 rounded-full" style={{ width: "35%" }} />
                </div>

                <div className="flex items-center justify-between">
                  <span className="text-white/70">Google</span>
                  <span className="text-white font-medium">42%</span>
                </div>
                <div className="h-2 bg-white/5 rounded-full overflow-hidden">
                  <div className="h-full bg-blue-400/60 rounded-full" style={{ width: "42%" }} />
                </div>

                <div className="flex items-center justify-between">
                  <span className="text-white/70">Email</span>
                  <span className="text-white font-medium">23%</span>
                </div>
                <div className="h-2 bg-white/5 rounded-full overflow-hidden">
                  <div className="h-full bg-amber-400/60 rounded-full" style={{ width: "23%" }} />
                </div>
              </div>
            </div>
          </div>

          <p className="text-center text-white/40 text-sm mt-8 max-w-lg mx-auto">
            DDA распределяет ценность по всему пути клиента, показывая реальный вклад каждого касания.
          </p>
        </div>
      </section>

      {/* INTEGRATIONS */}
      <section id="integrations" className="py-24 px-6 bg-[#0A0D11]">
        <div className="mx-auto max-w-6xl">
          <div className="text-center mb-16">
            <h2 className="text-3xl font-bold text-white mb-4">
              Интеграции
            </h2>
            <p className="text-white/50">
              Подключайте за минуты. Данные обновляются автоматически.
            </p>
          </div>

          <div className="flex flex-wrap justify-center gap-3">
            {["Meta Ads", "Google Ads", "TikTok Ads", "GA4", "CRM", "Платежи", "API", "Webhooks"].map((item) => (
              <div
                key={item}
                className="bg-[#12141A] border border-white/5 px-5 py-3 rounded-lg text-sm text-white/70"
              >
                {item}
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* PRICING */}
      <section id="pricing" className="py-24 px-6">
        <div className="mx-auto max-w-6xl">
          <div className="text-center mb-16">
            <h2 className="text-3xl font-bold text-white mb-4">
              Тарифы для роста
            </h2>
          </div>

          <div className="grid md:grid-cols-3 gap-6">
            {/* Starter */}
            <div className="bg-[#12141A] border border-white/5 rounded-xl p-8">
              <div className="text-lg font-semibold text-white mb-1">Starter</div>
              <div className="text-3xl font-bold text-white mb-6">
                $39<span className="text-sm text-white/40 font-normal">/мес</span>
              </div>
              <ul className="space-y-3 text-sm text-white/60 mb-8">
                <li>До 3 источников</li>
                <li>Базовая аналитика</li>
                <li>DDA-атрибуция</li>
              </ul>
              <Link
                href="/signup"
                className="block w-full text-center py-3 text-sm font-medium text-white/80 bg-white/5 hover:bg-white/10 border border-white/10 rounded-lg transition"
              >
                Начать
              </Link>
            </div>

            {/* Growth */}
            <div className="bg-[#12141A] border border-emerald-500/30 rounded-xl p-8 relative">
              <div className="absolute -top-3 left-1/2 -translate-x-1/2 bg-emerald-500 text-[#0B0F14] text-xs font-semibold px-3 py-1 rounded-full">
                Популярный
              </div>
              <div className="text-lg font-semibold text-white mb-1">Growth</div>
              <div className="text-3xl font-bold text-white mb-6">
                $99<span className="text-sm text-white/40 font-normal">/мес</span>
              </div>
              <ul className="space-y-3 text-sm text-white/60 mb-8">
                <li>До 10 источников</li>
                <li>Управленческие отчёты</li>
                <li>Рекомендации</li>
              </ul>
              <Link
                href="/signup"
                className="block w-full text-center py-3 text-sm font-semibold text-[#0B0F14] bg-emerald-500 hover:bg-emerald-400 rounded-lg transition"
              >
                Начать
              </Link>
            </div>

            {/* Agency */}
            <div className="bg-[#12141A] border border-white/5 rounded-xl p-8">
              <div className="text-lg font-semibold text-white mb-1">Agency</div>
              <div className="text-3xl font-bold text-white mb-6">
                $249<span className="text-sm text-white/40 font-normal">/мес</span>
              </div>
              <ul className="space-y-3 text-sm text-white/60 mb-8">
                <li>Несколько проектов</li>
                <li>Роли в команде</li>
                <li>Расширенная аналитика</li>
              </ul>
              <Link
                href="/signup"
                className="block w-full text-center py-3 text-sm font-medium text-white/80 bg-white/5 hover:bg-white/10 border border-white/10 rounded-lg transition"
              >
                Начать
              </Link>
            </div>
          </div>
        </div>
      </section>

      {/* FAQ */}
      <section id="faq" className="py-24 px-6 bg-[#0A0D11]">
        <div className="mx-auto max-w-2xl">
          <h2 className="text-3xl font-bold text-white text-center mb-12">
            Вопросы и ответы
          </h2>

          <div>
            <FaqItem
              q="Почему ваши данные точнее?"
              a="Мы сверяем данные из нескольких источников: рекламные кабинеты, CRM, платёжные системы. Это позволяет выявлять расхождения и показывать реальную картину, а не данные одного источника."
              defaultOpen
            />
            <FaqItem
              q="Как работает DDA?"
              a="Data-Driven Attribution анализирует все касания клиента перед покупкой и распределяет ценность пропорционально влиянию каждого канала на конверсию."
            />
            <FaqItem
              q="Какие данные нужны для работы?"
              a="Минимально — доступ к рекламным кабинетам и CRM. Для полной картины рекомендуем подключить также GA4 и платёжную систему."
            />
          </div>
        </div>
      </section>

      {/* FINAL CTA */}
      <section className="py-24 px-6">
        <div className="mx-auto max-w-6xl">
          <div className="grid lg:grid-cols-2 gap-16 items-center">
            {/* Left */}
            <div className="space-y-6">
              <h2 className="text-3xl md:text-4xl font-bold text-white text-balance">
                Перейдите от кликов к управлению прибылью
              </h2>
              <p className="text-white/55 leading-relaxed">
                Получите полную видимость выручки, CAC и эффективности каналов.
              </p>
              <ul className="space-y-2 text-sm text-white/50">
                <li>Единая аналитика</li>
                <li>DDA-атрибуция</li>
                <li>Ежедневные рекомендации</li>
              </ul>
              <div className="flex flex-wrap gap-3 pt-2">
                <Link
                  href="#pricing"
                  className="inline-flex items-center justify-center px-6 py-3 text-sm font-semibold text-[#0B0F14] bg-white hover:bg-white/90 rounded-lg transition"
                >
                  Начать
                </Link>
                <Link
                  href="#demo"
                  className="inline-flex items-center justify-center px-6 py-3 text-sm font-semibold text-white/80 bg-white/5 hover:bg-white/10 border border-white/10 rounded-lg transition"
                >
                  Смотреть демо
                </Link>
              </div>
            </div>

            {/* Right - Signal cards stack */}
            <div className="space-y-3">
              <div className="bg-[#12141A] border-l-2 border-emerald-400 rounded-lg p-4">
                <div className="text-sm font-medium text-white">Перераспределение бюджета</div>
                <div className="text-xs text-white/50 mt-1">Масштабируйте Campaign B на 15%</div>
              </div>
              <div className="bg-[#12141A] border-l-2 border-amber-400 rounded-lg p-4">
                <div className="text-sm font-medium text-white">Аномалия в данных</div>
                <div className="text-xs text-white/50 mt-1">Расхождение CRM ↔ Ads: 7%</div>
              </div>
              <div className="bg-[#12141A] border-l-2 border-blue-400 rounded-lg p-4">
                <div className="text-sm font-medium text-white">Новый инсайт</div>
                <div className="text-xs text-white/50 mt-1">Instagram показывает +18% эффективность</div>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* FOOTER */}
      <footer className="py-12 px-6 border-t border-white/5">
        <div className="mx-auto max-w-6xl flex flex-col md:flex-row items-center justify-between gap-4 text-sm text-white/40">
          <div>© 2024 BoardIQ. Все права защищены.</div>
          <div className="flex gap-6">
            <a href="#" className="hover:text-white/70 transition">Политика конфиденциальности</a>
            <a href="#" className="hover:text-white/70 transition">Условия использования</a>
          </div>
        </div>
      </footer>
    </main>
  );
}
