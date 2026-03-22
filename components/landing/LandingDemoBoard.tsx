"use client";

import { useState } from "react";

/**
 * Статичное превью дашборда для лендинга (тестовые данные).
 * Без переходов в приложение — только визуальная копия структуры борда.
 */
const DEMO_BG = "#0b0b10";

const card = {
  borderRadius: 14,
  border: "1px solid rgba(255,255,255,0.10)",
  background: "rgba(255,255,255,0.03)",
} as const;

const cardStyleSidebar = {
  borderRadius: 18,
  border: "1px solid rgba(255,255,255,0.10)",
  background:
    "radial-gradient(700px 240px at 30% 0%, rgba(120,120,255,0.18), transparent 60%), rgba(255,255,255,0.03)",
  boxShadow: "0 18px 60px rgba(0,0,0,0.45)",
  padding: 14,
  overflow: "hidden" as const,
};

const DEMO_KPIS = {
  spend: 12480,
  registrations: 428,
  sales: 94,
  revenue: 38250,
  roas: 2.84,
  cpl: 29.2,
  cac: 118.4,
};

/** Данные «за сегодня» в сайдбаре — в духе Sidebar / TodaySpendCard */
const DEMO_TODAY = {
  spendFact: 142.3,
  spendPlan: 120,
  salesFact: 5,
  salesPlanDaily: 7,
  planPct: 71,
  roasFact: "2,84",
  roasPlan: "2,50",
  cacFact: "$118",
  cacPlan: "$125",
  cprFact: "$42",
  cprPlan: "$48",
};

const DEMO_CHART: { d: string; spend: number; reg: number; sales: number }[] = [
  { d: "Пн", spend: 1180, reg: 52, sales: 9 },
  { d: "Вт", spend: 1320, reg: 58, sales: 11 },
  { d: "Ср", spend: 980, reg: 44, sales: 7 },
  { d: "Чт", spend: 1560, reg: 61, sales: 14 },
  { d: "Пт", spend: 1720, reg: 68, sales: 15 },
  { d: "Сб", spend: 890, reg: 38, sales: 6 },
  { d: "Вс", spend: 1050, reg: 47, sales: 8 },
];

const NAV_STATIC = [
  ["📊", "Дашборд", true],
  ["📑", "Отчёты", false],
  ["📈", "LTV", false],
  ["🔗", "UTM Builder", false],
  ["🛜", "BQ Pixel", false],
  ["—divider—", "", false],
  ["🌎", "Аккаунты", false],
  ["⚙️", "Настройки", false],
] as const;

const bigCard = {
  borderRadius: 16,
  border: "1px solid rgba(255,255,255,0.10)",
  background: "rgba(255,255,255,0.03)",
  padding: 18,
  boxShadow: "0 20px 60px rgba(0,0,0,0.55)",
  minHeight: 220,
} as const;

function MiniDemoChart() {
  const w = 520;
  const h = 200;
  const pad = 36;
  const bottom = 28;
  const plotW = w - pad - 16;
  const plotH = h - bottom - 12;
  const maxSpend = Math.max(...DEMO_CHART.map((p) => p.spend), 1);
  const maxR = Math.max(...DEMO_CHART.map((p) => p.reg), 1);
  const maxS = Math.max(...DEMO_CHART.map((p) => p.sales), 1);
  const n = DEMO_CHART.length;
  const x = (i: number) => pad + (i / (n - 1)) * plotW;
  const ySpend = (v: number) => 12 + plotH * (1 - v / maxSpend);
  const yR = (v: number) => 12 + plotH * (1 - v / maxR);
  const yS = (v: number) => 12 + plotH * (1 - v / maxS);

  const path = (fn: (v: number) => number, get: (p: (typeof DEMO_CHART)[0]) => number) =>
    DEMO_CHART.map((p, i) => `${i === 0 ? "M" : "L"} ${x(i).toFixed(1)} ${fn(get(p)).toFixed(1)}`).join(" ");

  return (
    <svg
      width="100%"
      viewBox={`0 0 ${w} ${h}`}
      className="max-h-[220px] text-white"
      preserveAspectRatio="xMidYMid meet"
      aria-hidden
    >
      {[0, 1, 2, 3].map((k) => {
        const yy = 12 + (k / 3) * plotH;
        return (
          <line
            key={k}
            x1={pad}
            x2={w - 16}
            y1={yy}
            y2={yy}
            stroke="rgba(255,255,255,0.06)"
            strokeWidth="1"
          />
        );
      })}
      <path d={path(ySpend, (p) => p.spend)} fill="none" stroke="rgba(130,255,200,0.85)" strokeWidth="2.2" strokeLinecap="round" />
      <path d={path(yR, (p) => p.reg)} fill="none" stroke="rgba(147,197,253,0.9)" strokeWidth="2" strokeLinecap="round" />
      <path d={path(yS, (p) => p.sales)} fill="none" stroke="rgba(253,230,138,0.9)" strokeWidth="2" strokeLinecap="round" />
      {DEMO_CHART.map((p, i) => (
        <text
          key={p.d}
          x={x(i)}
          y={h - 6}
          textAnchor="middle"
          fill="rgba(255,255,255,0.38)"
          fontSize="10"
        >
          {p.d}
        </text>
      ))}
    </svg>
  );
}

function fmtMoney(n: number) {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 0,
  }).format(n);
}

function fmtUsd2(n: number) {
  return (
    "$" +
    n.toLocaleString("en-US", {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    })
  );
}

export function LandingDemoSection() {
  /** Как в Sidebar: по умолчанию блок «Сегодня» свёрнут (ROAS/CAC/CPR скрыты). */
  const [todayOpen, setTodayOpen] = useState(false);

  const spendDelta = DEMO_TODAY.spendPlan > 0 ? (DEMO_TODAY.spendFact - DEMO_TODAY.spendPlan) / DEMO_TODAY.spendPlan : 0;
  const spendPct = Math.round(spendDelta * 100);
  const salesRatio =
    DEMO_TODAY.salesPlanDaily > 0 ? DEMO_TODAY.salesFact / DEMO_TODAY.salesPlanDaily : 0;
  const barW = Math.max(0, Math.min(salesRatio, 1));

  return (
    <section
      id="demo"
      className="landing-mid-scope relative z-10 scroll-mt-24 border-t border-white/10 py-14 md:py-20"
    >
      <div className="mx-auto max-w-6xl px-5">
        <div className="mb-10 text-center md:text-left">
          <h2 className="text-3xl font-semibold tracking-tight text-white/95 md:text-4xl">Демо</h2>
          <p className="mx-auto mt-3 max-w-2xl text-base leading-relaxed text-white/60 md:mx-0">
            Так выглядит дашборд BoardIQ: расходы, конверсии и статус данных — без подключения кабинетов.
          </p>
        </div>

        <div
          className="flex h-[min(80vh,820px)] flex-col overflow-hidden rounded-2xl border border-white/10 shadow-[0_24px_80px_rgba(0,0,0,0.55)] ring-1 ring-white/[0.04]"
          style={{ background: DEMO_BG }}
        >
          <div className="grid min-h-0 flex-1 grid-cols-1 md:grid-cols-[minmax(0,260px)_1fr]">
            {/* Сайдбар: «Сегодня» + навигация (как в приложении, без ссылок) */}
            <aside
              className="hidden min-h-0 select-none overflow-y-auto overscroll-y-contain border-b border-white/[0.06] md:block md:border-b-0 md:border-r"
              style={{
                background:
                  "radial-gradient(800px 260px at 30% 0%, rgba(120,120,255,0.16), transparent 60%), linear-gradient(180deg, rgba(255,255,255,0.05), rgba(255,255,255,0.01))",
              }}
            >
              <div className="flex flex-col gap-3 p-4 pb-2">
                <div className="rounded-lg border border-white/[0.12] bg-white/[0.04] px-3 py-2.5 text-[13px] font-semibold text-white/90">
                  Демо-проект
                </div>

                {/* Блок «Сегодня» — по образцу Sidebar */}
                <div style={cardStyleSidebar}>
                  <button
                    type="button"
                    onClick={() => setTodayOpen((v) => !v)}
                    className="flex w-full min-w-0 cursor-pointer items-center justify-between gap-2 border-0 bg-transparent p-0 text-left text-white"
                    aria-expanded={todayOpen}
                  >
                    <div className="min-w-0 text-[34px] font-black leading-[1.05]">Сегодня</div>
                    <div
                      className="flex h-[34px] w-[34px] shrink-0 items-center justify-center rounded-xl border border-white/10 bg-white/[0.03] text-sm text-white/80 transition-transform duration-[160ms] ease-out"
                      style={{ transform: todayOpen ? "rotate(180deg)" : "rotate(0deg)" }}
                      aria-hidden
                    >
                      ▾
                    </div>
                  </button>

                  <div
                    className="mt-4 grid gap-2.5 rounded-[14px] border border-white/10 p-3 text-[11px] text-white/85"
                    style={{ background: "rgba(0,0,0,0.35)" }}
                  >
                    <div className="h-1.5 overflow-hidden rounded-full bg-[rgba(24,24,35,0.9)]">
                      <div
                        className="h-full rounded-full bg-emerald-500/80 transition-[width]"
                        style={{ width: `${barW * 100}%` }}
                      />
                    </div>
                    <div className="flex items-center justify-between gap-2">
                      <span>{DEMO_TODAY.planPct}% плана</span>
                      <span className="text-right tabular-nums">
                        {DEMO_TODAY.salesFact} / {DEMO_TODAY.salesPlanDaily} продаж
                      </span>
                    </div>
                  </div>

                  {/* Расход (TodaySpendCard) */}
                  <div
                    className="mt-3 rounded-[14px] border border-white/10 p-3"
                    style={{ background: "rgba(255,255,255,0.02)" }}
                  >
                    <div className="flex items-center justify-between gap-2">
                      <span className="min-w-0 truncate font-black text-white">Расход</span>
                      <span
                        className="shrink-0 rounded-full border border-red-400/40 bg-red-500/15 px-2 py-0.5 text-[11px] font-black text-red-200/95"
                        title="Отклонение факт vs план"
                      >
                        +{spendPct}%
                      </span>
                    </div>
                    <div className="mt-2.5 grid gap-1.5 text-[13px]">
                      <div className="flex justify-between gap-2 opacity-75">
                        <span>Факт</span>
                        <span className="font-black tabular-nums opacity-100">{fmtUsd2(DEMO_TODAY.spendFact)}</span>
                      </div>
                      <div className="flex justify-between gap-2 opacity-75">
                        <span>План</span>
                        <span className="font-black tabular-nums opacity-100">{fmtUsd2(DEMO_TODAY.spendPlan)}</span>
                      </div>
                    </div>
                  </div>

                  {/* Продажи (MetricRow) */}
                  <div
                    className="mt-2.5 rounded-[14px] border border-white/10 p-3"
                    style={{ background: "rgba(255,255,255,0.02)" }}
                  >
                    <div className="flex items-center justify-between gap-2">
                      <span className="min-w-0 truncate font-black text-white">Продажи</span>
                      <span className="shrink-0 rounded-full border border-amber-400/35 bg-amber-500/15 px-2 py-0.5 text-[11px] font-black text-amber-100/95">
                        −29%
                      </span>
                    </div>
                    <div className="mt-2.5 grid gap-1.5 text-[13px]">
                      <div className="flex justify-between gap-2 opacity-75">
                        <span>Факт</span>
                        <span className="font-black tabular-nums opacity-100">{DEMO_TODAY.salesFact}</span>
                      </div>
                      <div className="flex justify-between gap-2 opacity-75">
                        <span>План</span>
                        <span className="font-black tabular-nums opacity-100">
                          {DEMO_TODAY.salesPlanDaily.toFixed(1).replace(".", ",")}
                        </span>
                      </div>
                    </div>
                  </div>

                  {todayOpen ? (
                    <div className="mt-3 grid gap-2.5 text-[13px] text-white/85">
                      {[
                        ["ROAS", DEMO_TODAY.roasFact, DEMO_TODAY.roasPlan],
                        ["CAC", DEMO_TODAY.cacFact, DEMO_TODAY.cacPlan],
                        ["CPR", DEMO_TODAY.cprFact, DEMO_TODAY.cprPlan],
                      ].map(([title, fact, plan]) => (
                        <div
                          key={title}
                          className="grid gap-1 rounded-xl border border-white/10 bg-white/[0.02] p-2.5"
                        >
                          <div className="font-bold">{title}</div>
                          <div className="flex justify-between opacity-80">
                            <span>Факт</span>
                            <span className="font-bold">{fact}</span>
                          </div>
                          <div className="flex justify-between opacity-80">
                            <span>План</span>
                            <span className="font-bold">{plan}</span>
                          </div>
                        </div>
                      ))}
                    </div>
                  ) : (
                    <div className="mt-3 text-[12px] opacity-55">Показать ROAS / CAC / CPR</div>
                  )}
                </div>

                {/* Навигация */}
                <nav className="flex flex-col gap-2 pb-4 text-[13px]">
                  {NAV_STATIC.map(([emoji, label, active]) =>
                    emoji === "—divider—" ? (
                      <div key="sidebar-nav-divider" className="my-1 h-px bg-white/10 opacity-45" />
                    ) : (
                      <div
                        key={label}
                        className="rounded-[10px] px-3 py-2.5 font-medium text-white"
                        style={{
                          background: active ? "rgba(255,255,255,0.10)" : "transparent",
                          border: active ? "1px solid rgba(255,255,255,0.10)" : "1px solid transparent",
                        }}
                      >
                        {emoji} {label}
                      </div>
                    )
                  )}
                </nav>

                <div className="mt-auto pt-2 text-[12px] text-white/45">v1.0 beta</div>
              </div>
            </aside>

            <div className="flex min-h-0 min-w-0 flex-col">
              <header
                className="flex h-14 shrink-0 items-center justify-between gap-3 border-b border-white/[0.08] px-4 md:px-8"
                style={{ background: "rgba(11,11,16,0.92)" }}
              >
                <span className="truncate text-sm font-semibold text-white/90 md:hidden">BoardIQ</span>
                <span className="hidden text-[13px] text-white/45 md:inline">Сегодня</span>
                <div className="flex items-center gap-2">
                  <span
                    className="hidden text-[10px] font-semibold uppercase tracking-[0.12em] text-white/35 sm:inline"
                    aria-hidden
                  >
                    preview
                  </span>
                  <div className="h-8 w-8 rounded-full bg-gradient-to-br from-white/20 to-white/5 ring-1 ring-white/10" />
                </div>
              </header>

              <div className="min-h-0 flex-1 overflow-y-auto overflow-x-hidden overscroll-y-contain [-webkit-overflow-scrolling:touch]">
                <div className="p-4 md:p-5 lg:p-6">
                  <div className="mb-1 text-[clamp(22px,4vw,30px)] font-black leading-tight text-white">Дашборд</div>
                  <div className="mb-4 max-w-xl text-[13px] leading-relaxed text-white/55">
                    Обзор метрик по выбранному периоду и статус данных.
                  </div>

                  <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
                    <div className="flex flex-wrap items-center gap-2 text-[12px]">
                      <span
                        className="rounded-lg border border-white/10 bg-white/[0.03] px-3 py-1.5 font-semibold text-white/75"
                        style={{ borderRadius: 10 }}
                      >
                        Sources: All ▼
                      </span>
                      <span
                        className="rounded-lg border border-white/10 bg-white/[0.03] px-3 py-1.5 font-semibold text-white/75"
                        style={{ borderRadius: 10 }}
                      >
                        Accounts: All ▼
                      </span>
                      <span
                        className="rounded-lg border border-white/10 bg-white/[0.04] px-2 py-1.5 text-white/70"
                        style={{ borderRadius: 10 }}
                      >
                        01.03.2025 — 07.03.2025
                      </span>
                      <span
                        className="rounded-full border border-emerald-500/40 bg-emerald-500/20 px-3 py-1 text-[11px] font-bold text-emerald-100/95"
                        style={{ borderRadius: 999 }}
                      >
                        OK
                      </span>
                    </div>
                    <div className="flex flex-col items-end gap-1.5 text-[11px] text-white/55">
                      <span className="rounded-md border border-white/10 bg-white/[0.04] px-2.5 py-1 font-semibold text-white/70">
                        Обновлено: 14:32
                      </span>
                      <span className="rounded-md border border-white/10 bg-white/[0.04] px-2.5 py-1 font-semibold text-white/70">
                        OK: 14:31
                      </span>
                    </div>
                  </div>

                  <div
                    className="mb-4 grid grid-cols-2 gap-3 lg:grid-cols-4"
                    style={{ gap: 12 }}
                  >
                    {[
                      { label: "Расход", value: fmtMoney(DEMO_KPIS.spend), sub: `CPL: $${DEMO_KPIS.cpl} · CAC: $${DEMO_KPIS.cac}` },
                      { label: "Регистрации", value: String(DEMO_KPIS.registrations), sub: "Конверсия лид → продажа: 22.0%" },
                      { label: "Продажи", value: String(DEMO_KPIS.sales), sub: `Выручка: ${fmtMoney(DEMO_KPIS.revenue)}` },
                      { label: "ROAS", value: DEMO_KPIS.roas.toFixed(2), sub: "Выручка / расход" },
                    ].map((k) => (
                      <div key={k.label} style={{ ...card, padding: "14px 16px" }}>
                        <div className="flex justify-between gap-2">
                          <div className="text-[11px] text-white/55">{k.label}</div>
                          <div className="rounded-md border border-white/10 bg-white/[0.04] px-1.5 py-0.5 text-[10px] font-semibold text-white/60">
                            All
                          </div>
                        </div>
                        <div className="mt-2 text-[clamp(22px,3.5vw,32px)] font-black tabular-nums text-white/95">{k.value}</div>
                        <div className="mt-2 text-[11px] leading-snug text-white/45">{k.sub}</div>
                      </div>
                    ))}
                  </div>

                  <div
                    style={{
                      display: "grid",
                      gridTemplateColumns: "2fr 1fr",
                      gap: 16,
                      marginBottom: 20,
                      alignItems: "stretch",
                    }}
                    className="max-lg:grid-cols-1"
                  >
                    <div style={{ ...card, padding: 20 }}>
                      <div className="mb-2.5 text-lg font-black text-white">Динамика расхода</div>
                      <div className="mb-3.5 text-[13px] text-white/70">
                        Spend, Registrations, Sales (по выбранному диапазону)
                      </div>
                      <MiniDemoChart />
                      <div className="mt-3 flex flex-wrap gap-4 text-[11px] text-white/45">
                        <span className="inline-flex items-center gap-1.5">
                          <span className="h-2 w-2 rounded-full bg-[rgba(130,255,200,0.85)]" /> Spend
                        </span>
                        <span className="inline-flex items-center gap-1.5">
                          <span className="h-2 w-2 rounded-full bg-[rgba(147,197,253,0.9)]" /> Reg
                        </span>
                        <span className="inline-flex items-center gap-1.5">
                          <span className="h-2 w-2 rounded-full bg-[rgba(253,230,138,0.9)]" /> Sales
                        </span>
                        <span className="inline-flex items-center gap-1.5">
                          <span className="h-2 w-2 rounded-full bg-[rgba(196,181,253,0.9)]" /> CAC
                        </span>
                      </div>
                    </div>

                    <div style={{ ...card, padding: 20 }}>
                      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
                        <span className="text-lg font-black text-white">Data Status</span>
                        <span className="inline-flex items-center gap-1.5 rounded-md bg-emerald-500/15 px-2 py-1 text-[12px] font-semibold text-emerald-100/95 ring-1 ring-emerald-400/25">
                          <span className="h-1.5 w-1.5 rounded-full bg-emerald-400" />
                          3 / 3 healthy · OK
                        </span>
                      </div>

                      <div className="space-y-2.5 text-[13px] text-white/90">
                        <div
                          className="rounded-[10px] border border-white/[0.06] bg-white/[0.02] px-3.5 py-3"
                        >
                          <div className="mb-1.5 text-[11px] font-semibold uppercase tracking-[0.04em] text-white/70">
                            Integrations
                          </div>
                          {["Meta Ads", "Google Ads", "TikTok Ads"].map((name) => (
                            <div key={name} className="mt-1 flex justify-between gap-2">
                              <span className="opacity-90">{name}</span>
                              <span className="inline-flex items-center gap-1.5 text-emerald-300/95">
                                <span className="h-1.5 w-1.5 rounded-full bg-emerald-400" />
                                Connected
                              </span>
                            </div>
                          ))}
                        </div>

                        <div className="rounded-[10px] border border-white/[0.06] bg-white/[0.02] px-3.5 py-3">
                          <div className="mb-1.5 text-[11px] font-semibold uppercase tracking-[0.04em] text-white/70">Data</div>
                          <div className="flex justify-between gap-2">
                            <span className="opacity-70">Date range</span>
                            <span className="text-right">01.03.2025 – 07.03.2025</span>
                          </div>
                          <div className="mt-1 flex justify-between gap-2">
                            <span className="opacity-70">Last updated</span>
                            <span className="text-right">14:32</span>
                          </div>
                          <div className="mt-1 flex justify-between gap-2">
                            <span className="opacity-70">Last successful</span>
                            <span className="text-right">14:31</span>
                          </div>
                        </div>

                        <div className="rounded-[10px] border border-white/[0.06] bg-white/[0.02] px-3.5 py-3">
                          <div className="mb-1.5 text-[11px] font-semibold uppercase tracking-[0.04em] text-white/70">
                            Accounts
                          </div>
                          <div className="flex justify-between gap-2">
                            <span className="opacity-70">Ad platforms</span>
                            <span className="text-right">3</span>
                          </div>
                        </div>
                      </div>
                    </div>
                  </div>

                  {/* Ряд как в борде: Роль каналов | Топ путей */}
                  <div
                    style={{
                      display: "grid",
                      gridTemplateColumns: "1fr 1fr",
                      gap: 20,
                      marginBottom: 20,
                      alignItems: "stretch",
                    }}
                    className="max-lg:grid-cols-1"
                  >
                    <div style={bigCard}>
                      <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
                        <h3 className="text-[17px] font-bold text-white/95">Роль каналов в пути к покупке</h3>
                        <span className="rounded-md border border-rose-400/40 bg-rose-500/15 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-rose-100/95">
                          demo
                        </span>
                      </div>
                      <p className="mb-3 text-[12px] leading-relaxed text-white/55">
                        Показывает, на каком этапе каналы чаще участвуют в конверсии: в начале пути, в процессе выбора или
                        перед покупкой.
                      </p>
                      {[
                        { name: "Meta Ads", f: 18, a: 7, l: 5 },
                        { name: "Google Ads", f: 6, a: 4, l: 9 },
                        { name: "Прямой переход", f: 0, a: 0, l: 12 },
                      ].map((row) => {
                        const t = row.f + row.a + row.l || 1;
                        return (
                          <div key={row.name} className="mb-3 border-b border-white/[0.06] pb-3 last:mb-0 last:border-0 last:pb-0">
                            <div className="text-[14px] font-semibold text-white/95">{row.name}</div>
                            <div className="mt-1 text-[11px] text-white/55">
                              Открывает путь {row.f} • Помогает {row.a} • Закрывает {row.l}
                            </div>
                            <div className="mt-2 flex h-4 w-full overflow-hidden rounded-md bg-white/[0.06]">
                              <div className="h-full bg-[rgba(139,124,201,0.75)]" style={{ width: `${(row.f / t) * 100}%` }} />
                              <div className="h-full bg-[rgba(92,142,214,0.75)]" style={{ width: `${(row.a / t) * 100}%` }} />
                              <div className="h-full bg-[rgba(88,184,132,0.85)]" style={{ width: `${(row.l / t) * 100}%` }} />
                            </div>
                          </div>
                        );
                      })}
                    </div>

                    <div style={{ ...bigCard, display: "flex", flexDirection: "column" }}>
                      <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
                        <h3 className="text-[17px] font-bold text-white/95">Топ путей пользователей</h3>
                        <span className="rounded-md border border-rose-400/40 bg-rose-500/15 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-rose-100/95">
                          demo
                        </span>
                      </div>
                      <p className="mb-3 text-[12px] leading-relaxed text-white/55">
                        Показывает самые частые маршруты пользователей до покупки.
                      </p>
                      <div className="flex flex-1 flex-col gap-2">
                        {[
                          { path: "Meta Ads → Прямой → Покупка", pct: 34, n: 42 },
                          { path: "Google Ads → Покупка", pct: 28, n: 35 },
                          { path: "TikTok → Meta → Покупка", pct: 19, n: 24 },
                        ].map((r) => (
                          <div
                            key={r.path}
                            className="rounded-[10px] border border-white/[0.06] bg-white/[0.02] px-3 py-2.5"
                          >
                            <div className="text-[13px] font-medium text-white/90">{r.path}</div>
                            <div className="mt-1 flex justify-between text-[12px] text-white/50">
                              <span>{r.pct}% путей</span>
                              <span className="tabular-nums">{r.n} конв.</span>
                            </div>
                          </div>
                        ))}
                      </div>
                    </div>
                  </div>

                  {/* Карта выручки */}
                  <div style={{ ...bigCard, minHeight: 240, marginBottom: 20 }}>
                    <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
                      <h3 className="text-[17px] font-bold text-white/95">Карта выручки по атрибуции</h3>
                      <span className="rounded-md border border-rose-400/40 bg-rose-500/15 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-rose-100/95">
                        demo
                      </span>
                    </div>
                    <p className="mb-4 text-[12px] leading-relaxed text-white/55">
                      Показывает, какие каналы закрывают выручку и какие участвуют в пути пользователя до покупки.
                    </p>
                    <div className="mb-4 rounded-[10px] border border-white/[0.06] bg-white/[0.02] px-3 py-2.5 text-[13px]">
                      <div className="flex flex-wrap justify-between gap-2">
                        <span className="text-white/70">Закрытая выручка</span>
                        <span className="font-bold tabular-nums text-emerald-200/95">$18 420</span>
                      </div>
                      <div className="mt-1 flex flex-wrap justify-between gap-2">
                        <span className="text-white/70">Выручка с участием</span>
                        <span className="font-bold tabular-nums text-amber-200/95">$9 870</span>
                      </div>
                    </div>
                    {[
                      { ch: "Meta Ads", closed: 62, assisted: 38 },
                      { ch: "Google Ads", closed: 48, assisted: 52 },
                    ].map((r) => (
                      <div key={r.ch} className="mb-3 last:mb-0">
                        <div className="mb-1 flex justify-between text-[13px] font-semibold text-white/90">
                          <span>{r.ch}</span>
                        </div>
                        <div className="flex h-3.5 w-full overflow-hidden rounded-md bg-white/[0.06]">
                          <div
                            className="h-full bg-[rgba(91,184,168,0.9)]"
                            style={{ width: `${r.closed}%` }}
                          />
                          <div
                            className="h-full bg-[rgba(200,169,107,0.9)]"
                            style={{ width: `${r.assisted}%` }}
                          />
                        </div>
                        <div className="mt-1 flex justify-between text-[11px] text-white/45">
                          <span>закрытая</span>
                          <span>с участием</span>
                        </div>
                      </div>
                    ))}
                  </div>

                  {/* Поведение конверсии */}
                  <div style={{ ...bigCard, minHeight: 260, marginBottom: 8 }}>
                    <div className="mb-1 border-b border-white/[0.06] pb-3">
                      <h3 className="text-[17px] font-bold text-white/95">Поведение конверсии</h3>
                      <p className="mt-2 text-[12px] leading-relaxed text-white/55">
                        Показывает, сколько времени обычно проходит до покупки и сколько касаний требуется пользователю до
                        конверсии.
                      </p>
                    </div>
                    <div className="mt-4 grid gap-6 md:grid-cols-2">
                      <div>
                        <div className="mb-2 text-[12px] font-semibold text-white/70">Время до покупки</div>
                        {[
                          { l: "0–1 час", p: 18 },
                          { l: "1–6 часов", p: 27 },
                          { l: "6–24 часа", p: 31 },
                          { l: "1–3 дня", p: 17 },
                        ].map((b) => (
                          <div key={b.l} className="mb-1.5 flex items-center gap-2 text-[11px]">
                            <span className="w-24 shrink-0 text-white/50">{b.l}</span>
                            <div className="h-3 flex-1 overflow-hidden rounded-md bg-white/[0.06]">
                              <div
                                className="h-full rounded-md bg-gradient-to-r from-[#5E6AB8] to-[#6E7ACF]"
                                style={{ width: `${b.p}%` }}
                              />
                            </div>
                            <span className="w-8 tabular-nums text-white/45">{b.p}%</span>
                          </div>
                        ))}
                      </div>
                      <div>
                        <div className="mb-2 text-[12px] font-semibold text-white/70">Касания</div>
                        {[
                          { l: "1 касание", p: 12 },
                          { l: "2 касания", p: 23 },
                          { l: "3 касания", p: 34 },
                          { l: "4+ касания", p: 31 },
                        ].map((b) => (
                          <div key={b.l} className="mb-1.5 flex items-center gap-2 text-[11px]">
                            <span className="w-24 shrink-0 text-white/50">{b.l}</span>
                            <div className="h-3 flex-1 overflow-hidden rounded-md bg-white/[0.06]">
                              <div
                                className="h-full rounded-md bg-gradient-to-r from-[#C87662] to-[#D8846F]"
                                style={{ width: `${b.p}%` }}
                              />
                            </div>
                            <span className="w-8 tabular-nums text-white/45">{b.p}%</span>
                          </div>
                        ))}
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
