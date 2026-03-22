"use client";

import Link from "next/link";
import { useMemo, useState, useEffect } from "react";

type MetricTab = "Spend" | "CAC" | "ROMI" | "Покупатели";
type ChannelTab = "Google" | "Meta" | "TikTok";
type PeriodTab = "7 дней" | "30 дней" | "90 дней";

function cn(...v: Array<string | false | null | undefined>) {
  return v.filter(Boolean).join(" ");
}

// Smooth scroll function
function scrollToSection(id: string) {
  const element = document.getElementById(id);
  if (element) {
    element.scrollIntoView({ behavior: "smooth" });
  }
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
        "rounded-full px-3 py-1.5 text-xs font-semibold transition border",
        active
          ? "bg-white/15 border-white/20 text-white"
          : "bg-white/5 border-white/10 text-white/60 hover:bg-white/10 hover:text-white/80"
      )}
    >
      {children}
    </button>
  );
}

function AnimatedNumber({ value, prefix = "", suffix = "" }: { value: number; prefix?: string; suffix?: string }) {
  const [displayValue, setDisplayValue] = useState(0);

  useEffect(() => {
    const duration = 1500;
    const startTime = Date.now();
    const startValue = displayValue;

    const animate = () => {
      const now = Date.now();
      const progress = Math.min((now - startTime) / duration, 1);
      const easeOut = 1 - Math.pow(1 - progress, 3);
      setDisplayValue(Math.round(startValue + (value - startValue) * easeOut));

      if (progress < 1) {
        requestAnimationFrame(animate);
      }
    };

    requestAnimationFrame(animate);
  }, [value]);

  return <span>{prefix}{displayValue.toLocaleString()}{suffix}</span>;
}

function Sparkline({ data, color = "emerald" }: { data: number[]; color?: "emerald" | "blue" | "amber" | "pink" }) {
  const max = Math.max(...data);
  const min = Math.min(...data);
  const range = max - min || 1;

  const points = data.map((v, i) => {
    const x = (i / (data.length - 1)) * 380 + 10;
    const y = 100 - ((v - min) / range) * 70 - 10;
    return `${x},${y}`;
  }).join(" L");

  const fillPoints = `M10,100 L${points} L390,100 Z`;

  const gradientColors = {
    emerald: { start: "rgba(52,211,153,0.3)", end: "rgba(52,211,153,0)" },
    blue: { start: "rgba(96,165,250,0.3)", end: "rgba(96,165,250,0)" },
    amber: { start: "rgba(251,191,36,0.3)", end: "rgba(251,191,36,0)" },
    pink: { start: "rgba(244,114,182,0.3)", end: "rgba(244,114,182,0)" },
  };

  const strokeColors = {
    emerald: "rgba(52,211,153,0.9)",
    blue: "rgba(96,165,250,0.9)",
    amber: "rgba(251,191,36,0.9)",
    pink: "rgba(244,114,182,0.9)",
  };

  return (
    <div className="h-28 w-full">
      <svg viewBox="0 0 400 110" className="w-full h-full" preserveAspectRatio="none">
        <defs>
          <linearGradient id={`sparkGradient-${color}`} x1="0" x2="0" y1="0" y2="1">
            <stop offset="0%" stopColor={gradientColors[color].start} />
            <stop offset="100%" stopColor={gradientColors[color].end} />
          </linearGradient>
        </defs>
        <path d={fillPoints} fill={`url(#sparkGradient-${color})`} />
        <path d={`M${points}`} fill="none" stroke={strokeColors[color]} strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
    </div>
  );
}

function MetricCard({
  title,
  value,
  change,
  changePositive,
  data,
  color,
  topCampaign,
  topCampaignValue,
}: {
  title: string;
  value: string;
  change: string;
  changePositive: boolean;
  data: number[];
  color: "emerald" | "blue" | "amber" | "pink";
  topCampaign: string;
  topCampaignValue: string;
}) {
  return (
    <div className="bg-[#12141A] border border-white/10 rounded-xl p-5">
      <div className="flex items-start justify-between mb-4">
        <div>
          <div className="text-xs text-white/50 uppercase tracking-wider mb-1">{title}</div>
          <div className="text-3xl font-bold text-white">{value}</div>
        </div>
        <div className={cn(
          "text-sm font-medium px-2 py-1 rounded",
          changePositive ? "text-emerald-400 bg-emerald-500/10" : "text-red-400 bg-red-500/10"
        )}>
          {change}
        </div>
      </div>
      <Sparkline data={data} color={color} />
      <div className="mt-4 pt-4 border-t border-white/5 flex items-center justify-between text-sm">
        <span className="text-white/50">Топ-кампания</span>
        <span className="text-white font-medium">{topCampaign} - {topCampaignValue}</span>
      </div>
    </div>
  );
}

function HealthCard({ score, channel }: { score: number; channel: string }) {
  const metrics = {
    Google: { crm: 82, events: 85, duplicates: 12 },
    Meta: { crm: 78, events: 88, duplicates: 18 },
    TikTok: { crm: 75, events: 80, duplicates: 22 },
  };

  const m = metrics[channel as keyof typeof metrics] || metrics.Google;

  return (
    <div className="bg-[#12141A] border border-white/10 rounded-xl p-5">
      <div className="flex items-start justify-between mb-6">
        <div>
          <div className="text-xs text-white/50 uppercase tracking-wider mb-1">Data Health</div>
          <div className="text-3xl font-bold text-white">{score}%</div>
        </div>
        <div className="text-xs text-white/50">
          качество данных
        </div>
      </div>

      <div className="space-y-4">
        <div>
          <div className="flex items-center justify-between text-sm mb-2">
            <span className="text-white/60">Сходимость CRM → Ads</span>
            <span className="text-white font-medium">{m.crm}%</span>
          </div>
          <div className="h-2 bg-white/5 rounded-full overflow-hidden">
            <div className="h-full bg-emerald-400/70 rounded-full transition-all duration-700" style={{ width: `${m.crm}%` }} />
          </div>
        </div>

        <div>
          <div className="flex items-center justify-between text-sm mb-2">
            <span className="text-white/60">Полнота событий</span>
            <span className="text-white font-medium">{m.events}%</span>
          </div>
          <div className="h-2 bg-white/5 rounded-full overflow-hidden">
            <div className="h-full bg-blue-400/70 rounded-full transition-all duration-700" style={{ width: `${m.events}%` }} />
          </div>
        </div>

        <div>
          <div className="flex items-center justify-between text-sm mb-2">
            <span className="text-white/60">Дубликаты / шум</span>
            <span className="text-white font-medium">{m.duplicates}%</span>
          </div>
          <div className="h-2 bg-white/5 rounded-full overflow-hidden">
            <div className="h-full bg-red-400/70 rounded-full transition-all duration-700" style={{ width: `${m.duplicates}%` }} />
          </div>
        </div>
      </div>

      <div className="mt-5 bg-emerald-500/10 border border-emerald-500/20 rounded-lg p-3">
        <div className="text-xs text-emerald-400/80 mb-1">Что означает score</div>
        <div className="text-xs text-white/60">
          Чем выше score — тем точнее отчёты, надёжнее DDA и качественнее рекомендации
        </div>
      </div>
    </div>
  );
}

function DDAChart({ animate }: { animate: boolean }) {
  const [values, setValues] = useState({ instagram: 0, google: 0, email: 0 });

  useEffect(() => {
    if (animate) {
      const timer = setTimeout(() => {
        setValues({ instagram: 35, google: 42, email: 23 });
      }, 300);
      return () => clearTimeout(timer);
    }
  }, [animate]);

  return (
    <div className="space-y-4">
      {[
        { name: "Instagram", value: values.instagram, color: "bg-pink-400/70" },
        { name: "Google", value: values.google, color: "bg-blue-400/70" },
        { name: "Email", value: values.email, color: "bg-amber-400/70" },
      ].map((item) => (
        <div key={item.name}>
          <div className="flex items-center justify-between text-sm mb-2">
            <span className="text-white/70">{item.name}</span>
            <span className="text-white font-medium">{item.value}%</span>
          </div>
          <div className="h-2 bg-white/5 rounded-full overflow-hidden">
            <div
              className={cn("h-full rounded-full transition-all duration-1000 ease-out", item.color)}
              style={{ width: `${item.value}%` }}
            />
          </div>
        </div>
      ))}
    </div>
  );
}

function FaqItem({ q, a, defaultOpen }: { q: string; a: string[]; defaultOpen?: boolean }) {
  const [open, setOpen] = useState(!!defaultOpen);
  return (
    <div className="border border-white/10 rounded-xl overflow-hidden">
      <button
        type="button"
        onClick={() => setOpen((s) => !s)}
        className="w-full px-6 py-5 flex items-center justify-between gap-4 text-left bg-[#12141A] hover:bg-[#14161C] transition"
      >
        <span className="font-semibold text-white/90">{q}</span>
        <span className={cn(
          "text-white/50 text-xl font-light transition-transform duration-300",
          open && "rotate-45"
        )}>+</span>
      </button>
      <div className={cn(
        "overflow-hidden transition-all duration-300",
        open ? "max-h-96" : "max-h-0"
      )}>
        <div className="px-6 pb-5 pt-2 text-sm text-white/65 leading-relaxed space-y-2 bg-[#12141A]">
          {a.map((line, i) => (
            <p key={i}>{line}</p>
          ))}
        </div>
      </div>
    </div>
  );
}

function SignalCard({ type, title, text }: { type: "success" | "warning" | "danger" | "info"; title: string; text: string }) {
  const colors = {
    success: "border-emerald-400 bg-emerald-500/5",
    warning: "border-amber-400 bg-amber-500/5",
    danger: "border-red-400 bg-red-500/5",
    info: "border-blue-400 bg-blue-500/5",
  };

  const dotColors = {
    success: "bg-emerald-400",
    warning: "bg-amber-400",
    danger: "bg-red-400",
    info: "bg-blue-400",
  };

  return (
    <div className={cn("border-l-2 rounded-lg p-4", colors[type])}>
      <div className="flex items-start gap-3">
        <span className={cn("mt-1.5 h-2 w-2 rounded-full flex-shrink-0", dotColors[type])} />
        <div>
          <div className="text-sm font-semibold text-white/90">{title}</div>
          <div className="mt-1 text-sm text-white/55">{text}</div>
        </div>
      </div>
    </div>
  );
}

export default function Page() {
  const [metric, setMetric] = useState<MetricTab>("ROMI");
  const [channel, setChannel] = useState<ChannelTab>("Google");
  const [period, setPeriod] = useState<PeriodTab>("30 дней");
  const [ddaAnimate, setDdaAnimate] = useState(false);

  // Trigger DDA animation when section comes into view
  useEffect(() => {
    const observer = new IntersectionObserver(
      (entries) => {
        entries.forEach((entry) => {
          if (entry.isIntersecting) {
            setDdaAnimate(true);
          }
        });
      },
      { threshold: 0.3 }
    );

    const ddaSection = document.getElementById("attribution");
    if (ddaSection) {
      observer.observe(ddaSection);
    }

    return () => observer.disconnect();
  }, []);

  const metricData = useMemo(() => {
    const baseData = {
      Spend: {
        Google: { value: "$12,450", change: "+8.4%", positive: true, data: [8200, 9100, 8800, 10200, 11000, 11800, 12450], top: "Search Brand", topVal: "41%" },
        Meta: { value: "$9,820", change: "+5.2%", positive: true, data: [7500, 8200, 8000, 8800, 9200, 9500, 9820], top: "Lookalike 1%", topVal: "38%" },
        TikTok: { value: "$6,340", change: "+12.1%", positive: true, data: [4200, 4800, 5100, 5400, 5800, 6100, 6340], top: "Spark Ads", topVal: "52%" },
      },
      CAC: {
        Google: { value: "$21.8", change: "-4.1%", positive: true, data: [28, 26, 25, 24, 23, 22, 21.8], top: "Search Brand", topVal: "$18" },
        Meta: { value: "$24.5", change: "-2.8%", positive: true, data: [30, 28, 27, 26, 25, 24.8, 24.5], top: "Retargeting", topVal: "$19" },
        TikTok: { value: "$31.2", change: "+6.3%", positive: false, data: [26, 27, 28, 29, 30, 30.5, 31.2], top: "In-Feed", topVal: "$28" },
      },
      ROMI: {
        Google: { value: "168%", change: "+12.0%", positive: true, data: [120, 132, 145, 152, 158, 164, 168], top: "Search Brand", topVal: "245%" },
        Meta: { value: "142%", change: "+8.5%", positive: true, data: [110, 118, 125, 130, 135, 139, 142], top: "Lookalike 1%", topVal: "198%" },
        TikTok: { value: "118%", change: "-3.2%", positive: false, data: [135, 130, 128, 125, 122, 120, 118], top: "TopView", topVal: "156%" },
      },
      Покупатели: {
        Google: { value: "1,240", change: "+6.7%", positive: true, data: [980, 1020, 1080, 1120, 1160, 1200, 1240], top: "Search Brand", topVal: "512" },
        Meta: { value: "890", change: "+4.2%", positive: true, data: [720, 760, 800, 830, 855, 875, 890], top: "Lookalike 1%", topVal: "342" },
        TikTok: { value: "520", change: "+15.3%", positive: true, data: [320, 360, 400, 440, 470, 495, 520], top: "Spark Ads", topVal: "189" },
      },
    };
    return baseData[metric][channel];
  }, [metric, channel]);

  const healthScore = useMemo(() => {
    const scores = { Google: 84, Meta: 81, TikTok: 76 };
    return scores[channel];
  }, [channel]);

  const colorMap: Record<MetricTab, "emerald" | "blue" | "amber" | "pink"> = {
    ROMI: "emerald",
    CAC: "blue",
    Spend: "amber",
    Покупатели: "pink",
  };

  return (
    <main className="min-h-screen bg-[#0B0F14]">
      {/* HEADER */}
      <header className="fixed top-0 left-0 right-0 z-50">
        <div className="bg-[#0B0F14]/80 backdrop-blur-xl border-b border-white/5">
          <div className="mx-auto max-w-6xl px-6 h-16 flex items-center justify-between">
            <Link href="/" className="flex items-center gap-2">
              <div className="h-8 w-8 rounded-lg bg-emerald-500/20 border border-emerald-500/30 flex items-center justify-center">
                <span className="text-emerald-400 font-bold text-sm">B</span>
              </div>
              <span className="text-lg font-bold text-white">BoardIQ</span>
            </Link>

            <nav className="hidden md:flex items-center gap-8 text-sm text-white/60">
              <button onClick={() => scrollToSection("product")} className="hover:text-white transition">Продукт</button>
              <button onClick={() => scrollToSection("attribution")} className="hover:text-white transition">Атрибуция</button>
              <button onClick={() => scrollToSection("integrations")} className="hover:text-white transition">Интеграции</button>
              <button onClick={() => scrollToSection("pricing")} className="hover:text-white transition">Тарифы</button>
              <button onClick={() => scrollToSection("faq")} className="hover:text-white transition">FAQ</button>
            </nav>

            <div className="flex items-center gap-3">
              <Link href="/login" className="text-sm text-white/70 hover:text-white transition">
                Вход
              </Link>
              <button
                onClick={() => scrollToSection("pricing")}
                className="text-sm font-semibold text-[#0B0F14] bg-emerald-400 hover:bg-emerald-300 px-4 py-2 rounded-lg transition"
              >
                Начать
              </button>
            </div>
          </div>
        </div>
      </header>

      {/* HERO */}
      <section className="pt-28 pb-16 px-6">
        <div className="mx-auto max-w-6xl">
          <div className="grid lg:grid-cols-2 gap-12 items-start">
            {/* LEFT */}
            <div className="space-y-6">
              <div className="flex flex-wrap gap-2">
                <span className="text-xs text-emerald-400 bg-emerald-500/10 border border-emerald-500/20 px-3 py-1.5 rounded-full">
                  Прозрачные данные
                </span>
                <span className="text-xs text-blue-400 bg-blue-500/10 border border-blue-500/20 px-3 py-1.5 rounded-full">
                  DDA-атрибуция
                </span>
                <span className="text-xs text-amber-400 bg-amber-500/10 border border-amber-500/20 px-3 py-1.5 rounded-full">
                  Рекомендации
                </span>
              </div>

              <h1 className="text-4xl md:text-5xl font-bold leading-tight text-white text-balance">
                Управленческая аналитика маркетинга{" "}
                <span className="text-emerald-400">без искажённых данных</span>
              </h1>

              <p className="text-lg text-white/55 leading-relaxed max-w-xl">
                BoardIQ объединяет рекламные кабинеты, CRM и аналитику в единую систему.
                Видите реальную выручку, CAC, ROMI и вклад каналов — без искажённых данных из рекламных кабинетов.
              </p>

              {/* FEATURES LIST */}
              <div className="space-y-3 py-2">
                <div className="flex items-center gap-3 text-sm text-white/70">
                  <span className="h-1.5 w-1.5 rounded-full bg-emerald-400" />
                  Честная сквозная аналитика с сверкой источников
                </div>
                <div className="flex items-center gap-3 text-sm text-white/70">
                  <span className="h-1.5 w-1.5 rounded-full bg-blue-400" />
                  Реальный вклад каналов через Data-Driven Attribution
                </div>
                <div className="flex items-center gap-3 text-sm text-white/70">
                  <span className="h-1.5 w-1.5 rounded-full bg-amber-400" />
                  Рекомендации: где резать, где масштабировать, что чинить
                </div>
                <div className="flex items-center gap-3 text-sm text-white/70">
                  <span className="h-1.5 w-1.5 rounded-full bg-pink-400" />
                  Контроль качества данных и мониторинг аномалий
                </div>
              </div>

              {/* CTA */}
              <div className="flex flex-wrap gap-3 pt-2">
                <button
                  onClick={() => scrollToSection("pricing")}
                  className="inline-flex items-center justify-center px-6 py-3 text-sm font-semibold text-[#0B0F14] bg-emerald-400 hover:bg-emerald-300 rounded-lg transition"
                >
                  Начать бесплатно
                </button>
                <button
                  onClick={() => scrollToSection("demo")}
                  className="inline-flex items-center justify-center px-6 py-3 text-sm font-semibold text-white/80 bg-white/5 hover:bg-white/10 border border-white/10 rounded-lg transition"
                >
                  Посмотреть демо
                </button>
              </div>

              {/* SOCIAL PROOF */}
              <div className="pt-4 flex items-center gap-6 text-sm text-white/40">
                <div className="flex items-center gap-2">
                  <span className="text-white/70 font-semibold">50+</span>
                  <span>компаний</span>
                </div>
                <div className="flex items-center gap-2">
                  <span className="text-white/70 font-semibold">$2M+</span>
                  <span>под управлением</span>
                </div>
              </div>
            </div>

            {/* RIGHT — INTERACTIVE DASHBOARD */}
            <div id="demo" className="bg-[#12141A] border border-white/10 rounded-2xl p-6 shadow-2xl">
              <div className="flex items-center justify-between mb-5">
                <div>
                  <div className="text-xs text-white/40 uppercase tracking-wider">Интерактивная демо-панель</div>
                  <div className="text-lg font-semibold text-white mt-1">Управленческий дашборд</div>
                </div>
                <div className="flex items-center gap-2 text-xs text-white/40">
                  <span className="h-2 w-2 rounded-full bg-emerald-400 animate-pulse" />
                  live demo
                </div>
              </div>

              {/* FILTERS */}
              <div className="space-y-3 mb-5">
                <div className="flex flex-wrap gap-2">
                  {(["ROMI", "CAC", "Spend", "Покупатели"] as MetricTab[]).map((t) => (
                    <Pill key={t} active={metric === t} onClick={() => setMetric(t)}>
                      {t}
                    </Pill>
                  ))}
                </div>
                <div className="flex flex-wrap gap-2">
                  {(["Google", "Meta", "TikTok"] as ChannelTab[]).map((t) => (
                    <Pill key={t} active={channel === t} onClick={() => setChannel(t)}>
                      {t} Ads
                    </Pill>
                  ))}
                </div>
                <div className="flex flex-wrap gap-2">
                  {(["7 дней", "30 дней", "90 дней"] as PeriodTab[]).map((t) => (
                    <Pill key={t} active={period === t} onClick={() => setPeriod(t)}>
                      {t}
                    </Pill>
                  ))}
                </div>
              </div>

              {/* METRICS GRID */}
              <div className="grid md:grid-cols-2 gap-4">
                <MetricCard
                  title={`${metric} • ${channel}`}
                  value={metricData.value}
                  change={metricData.change}
                  changePositive={metricData.positive}
                  data={metricData.data}
                  color={colorMap[metric]}
                  topCampaign={metricData.top}
                  topCampaignValue={metricData.topVal}
                />
                <HealthCard score={healthScore} channel={channel} />
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* SIGNALS & RECOMMENDATIONS */}
      <section className="py-16 px-6">
        <div className="mx-auto max-w-6xl">
          <div className="text-center mb-12">
            <h2 className="text-3xl font-bold text-white mb-4">
              Что требует внимания прямо сейчас
            </h2>
            <p className="text-white/50 max-w-xl mx-auto">
              Система обнаруживает проблемы и формирует конкретные действия на основе ваших данных.
            </p>
          </div>

          <div className="grid md:grid-cols-2 lg:grid-cols-4 gap-4">
            <SignalCard
              type="success"
              title="Перераспределение бюджета"
              text="Сократите 12–18% с кампаний с низким ROMI и усильте 2 топ-кампании (прогноз +9–14%)"
            />
            <SignalCard
              type="warning"
              title="Расхождение CRM ↔ Ads"
              text="Обнаружено 7% расхождение — проверьте Purchase, external_id и дедупликацию событий"
            />
            <SignalCard
              type="danger"
              title="Рост CAC на 11%"
              text="CAC вырос при той же выручке — проверьте частоту показов и сегментацию аудитории"
            />
            <SignalCard
              type="info"
              title="Потеря трекинга"
              text="Найдены сессии без UTM/click id на шаге оплаты — проверьте редиректы и query-параметры"
            />
          </div>
        </div>
      </section>

      {/* PRODUCT VALUE */}
      <section id="product" className="py-16 px-6 bg-[#0A0D11]">
        <div className="mx-auto max-w-6xl">
          <div className="text-center mb-12">
            <h2 className="text-3xl font-bold text-white mb-4">
              Единая система для маркетинговых решений
            </h2>
            <p className="text-white/50 max-w-2xl mx-auto">
              Прозрачные расчёты, DDA-атрибуция и управленческие подсказки — без "красивых цифр" из рекламных кабинетов.
            </p>
          </div>

          <div className="grid md:grid-cols-2 lg:grid-cols-4 gap-6">
            {[
              {
                title: "Прозрачные расчёты",
                text: "Единая логика метрик, сверка CRM с рекламными кабинетами и воспроизводимость результата. Знаете, откуда каждая цифра.",
                color: "emerald",
              },
              {
                title: "DDA-атрибуция",
                text: "Оценка вклада касаний по всему пути клиента, а не по правилам last click из кабинетов. Видите реальную окупаемость каналов.",
                color: "blue",
              },
              {
                title: "Рекомендации",
                text: "Автоматические подсказки на основе данных: где сократить бюджет, где масштабировать и что необходимо починить.",
                color: "amber",
              },
              {
                title: "Контроль качества",
                text: "Мониторинг полноты данных, расхождений между источниками и аномалий. Понимаете, когда данные неполные или сломаны.",
                color: "pink",
              },
            ].map((item) => (
              <div key={item.title} className="bg-[#12141A] border border-white/10 rounded-xl p-6 hover:border-white/20 transition">
                <div className="flex items-center gap-2 mb-3">
                  <span className={cn(
                    "h-2 w-2 rounded-full",
                    item.color === "emerald" ? "bg-emerald-400" :
                    item.color === "blue" ? "bg-blue-400" :
                    item.color === "amber" ? "bg-amber-400" : "bg-pink-400"
                  )} />
                  <span className="text-lg font-semibold text-white">{item.title}</span>
                </div>
                <p className="text-sm text-white/55 leading-relaxed">{item.text}</p>
              </div>
            ))}
          </div>

          {/* EXPANDED INFO */}
          <div className="mt-12 grid lg:grid-cols-2 gap-6">
            <div className="bg-[#12141A] border border-white/10 rounded-xl p-8">
              <h3 className="text-xl font-semibold text-white mb-4">Как это работает</h3>
              <div className="space-y-4 text-sm text-white/60">
                <div className="flex items-start gap-3">
                  <span className="h-6 w-6 rounded-full bg-emerald-500/20 flex items-center justify-center text-emerald-400 font-semibold text-xs flex-shrink-0">1</span>
                  <div>
                    <span className="text-white/80 font-medium">Подключение источников</span>
                    <p className="mt-1">Рекламные кабинеты, CRM, платёжная система и GA4. Настройка за 10-15 минут.</p>
                  </div>
                </div>
                <div className="flex items-start gap-3">
                  <span className="h-6 w-6 rounded-full bg-emerald-500/20 flex items-center justify-center text-emerald-400 font-semibold text-xs flex-shrink-0">2</span>
                  <div>
                    <span className="text-white/80 font-medium">Сверка и расчёты</span>
                    <p className="mt-1">Система сопоставляет данные из всех источников и строит единую модель метрик.</p>
                  </div>
                </div>
                <div className="flex items-start gap-3">
                  <span className="h-6 w-6 rounded-full bg-emerald-500/20 flex items-center justify-center text-emerald-400 font-semibold text-xs flex-shrink-0">3</span>
                  <div>
                    <span className="text-white/80 font-medium">Отчёты и рекомендации</span>
                    <p className="mt-1">Получаете управленческий дашборд с реальными цифрами и конкретными действиями.</p>
                  </div>
                </div>
              </div>
            </div>

            <div className="bg-[#12141A] border border-white/10 rounded-xl p-8">
              <h3 className="text-xl font-semibold text-white mb-4">Что вы получаете</h3>
              <ul className="space-y-3 text-sm text-white/60">
                <li className="flex items-center gap-3">
                  <span className="h-1.5 w-1.5 rounded-full bg-emerald-400" />
                  <span>Единая выручка, расходы, CAC и ROMI по всем каналам</span>
                </li>
                <li className="flex items-center gap-3">
                  <span className="h-1.5 w-1.5 rounded-full bg-emerald-400" />
                  <span>DDA-вклад каналов вместо искажённого last click</span>
                </li>
                <li className="flex items-center gap-3">
                  <span className="h-1.5 w-1.5 rounded-full bg-emerald-400" />
                  <span>Data Health — понимание качества и полноты данных</span>
                </li>
                <li className="flex items-center gap-3">
                  <span className="h-1.5 w-1.5 rounded-full bg-emerald-400" />
                  <span>Аномалии и расхождения между источниками</span>
                </li>
                <li className="flex items-center gap-3">
                  <span className="h-1.5 w-1.5 rounded-full bg-emerald-400" />
                  <span>Рекомендации по бюджетам и оптимизации кампаний</span>
                </li>
                <li className="flex items-center gap-3">
                  <span className="h-1.5 w-1.5 rounded-full bg-emerald-400" />
                  <span>Технические алерты: потери UTM, проблемы с трекингом</span>
                </li>
              </ul>
            </div>
          </div>
        </div>
      </section>

      {/* ATTRIBUTION */}
      <section id="attribution" className="py-16 px-6">
        <div className="mx-auto max-w-6xl">
          <div className="text-center mb-12">
            <h2 className="text-3xl font-bold text-white mb-4">
              Data-Driven Attribution (DDA)
            </h2>
            <p className="text-white/50 max-w-xl mx-auto">
              Поймите реальный вклад каналов в продажи, а не искажение от last click атрибуции.
            </p>
          </div>

          <div className="grid lg:grid-cols-3 gap-6">
            {/* What DDA considers */}
            <div className="bg-[#12141A] border border-white/10 rounded-xl p-6">
              <h3 className="text-lg font-semibold text-white mb-4">Что учитывает DDA</h3>
              <ul className="space-y-3 text-sm text-white/60">
                <li className="flex items-center gap-2">
                  <span className="h-1.5 w-1.5 rounded-full bg-blue-400" />
                  Все касания в пути клиента
                </li>
                <li className="flex items-center gap-2">
                  <span className="h-1.5 w-1.5 rounded-full bg-blue-400" />
                  Порядок и частоту контактов
                </li>
                <li className="flex items-center gap-2">
                  <span className="h-1.5 w-1.5 rounded-full bg-blue-400" />
                  Вероятность конверсии
                </li>
                <li className="flex items-center gap-2">
                  <span className="h-1.5 w-1.5 rounded-full bg-blue-400" />
                  Влияние касаний на продажу
                </li>
                <li className="flex items-center gap-2">
                  <span className="h-1.5 w-1.5 rounded-full bg-blue-400" />
                  Сезонность и эффект каналов
                </li>
              </ul>
            </div>

            {/* Last Click */}
            <div className="bg-[#12141A] border border-white/10 rounded-xl p-6">
              <div className="text-xs text-white/40 uppercase tracking-wider mb-2">Last Click</div>
              <div className="text-sm text-white/60 mb-4">
                Пример: Instagram → Google → Email → Покупка
              </div>
              <div className="text-4xl font-bold text-white mb-2">Email: 100%</div>
              <p className="text-sm text-white/50">
                Email получает 100% ценности, хотя клиент пришёл через Instagram и Google. Это искажает решения по бюджетам.
              </p>
            </div>

            {/* DDA */}
            <div className="bg-[#12141A] border border-emerald-500/20 rounded-xl p-6">
              <div className="text-xs text-emerald-400/70 uppercase tracking-wider mb-2">DDA Distribution</div>
              <div className="text-sm text-white/60 mb-4">
                Тот же путь, реальное распределение
              </div>
              <DDAChart animate={ddaAnimate} />
              <p className="text-sm text-white/50 mt-4">
                DDA показывает реальный вклад каждого канала на основе данных.
              </p>
            </div>
          </div>
        </div>
      </section>

      {/* INTEGRATIONS */}
      <section id="integrations" className="py-16 px-6 bg-[#0A0D11]">
        <div className="mx-auto max-w-6xl">
          <div className="text-center mb-12">
            <h2 className="text-3xl font-bold text-white mb-4">
              Интеграции
            </h2>
            <p className="text-white/50">
              Подключение занимает 10-15 минут. Данные обновляются автоматически.
            </p>
          </div>

          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            {[
              { name: "Meta Ads", status: "Популярный" },
              { name: "Google Ads", status: "Популярный" },
              { name: "TikTok Ads", status: "Новый" },
              { name: "VK Ads", status: "" },
              { name: "Яндекс.Директ", status: "" },
              { name: "GA4", status: "" },
              { name: "CRM (amoCRM, Bitrix)", status: "" },
              { name: "Платежи (Stripe, YooKassa)", status: "" },
            ].map((item) => (
              <div
                key={item.name}
                className="bg-[#12141A] border border-white/10 rounded-xl p-5 hover:border-white/20 transition"
              >
                <div className="font-semibold text-white text-sm">{item.name}</div>
                {item.status && (
                  <div className="text-xs text-emerald-400 mt-1">{item.status}</div>
                )}
              </div>
            ))}
          </div>

          <div className="mt-8 text-center">
            <p className="text-sm text-white/40">
              Также поддерживаем: API, Webhooks, PostgreSQL, BigQuery и другие источники
            </p>
          </div>
        </div>
      </section>

      {/* PRICING */}
      <section id="pricing" className="py-16 px-6">
        <div className="mx-auto max-w-6xl">
          <div className="text-center mb-12">
            <h2 className="text-3xl font-bold text-white mb-4">
              Тарифы
            </h2>
            <p className="text-white/50">
              Начните с малого и масштабируйтесь по мере роста.
            </p>
          </div>

          <div className="grid md:grid-cols-3 gap-6">
            {/* Starter */}
            <div className="bg-[#12141A] border border-white/10 rounded-xl p-8 hover:border-white/20 transition">
              <div className="text-lg font-semibold text-white mb-1">Starter</div>
              <div className="text-3xl font-bold text-white mb-1">
                $39<span className="text-sm text-white/40 font-normal">/мес</span>
              </div>
              <div className="text-sm text-white/40 mb-6">Для небольших проектов</div>
              <ul className="space-y-3 text-sm text-white/60 mb-8">
                <li className="flex items-center gap-2">
                  <span className="h-1.5 w-1.5 rounded-full bg-emerald-400" />
                  До 3 рекламных источников
                </li>
                <li className="flex items-center gap-2">
                  <span className="h-1.5 w-1.5 rounded-full bg-emerald-400" />
                  Базовые отчёты и метрики
                </li>
                <li className="flex items-center gap-2">
                  <span className="h-1.5 w-1.5 rounded-full bg-emerald-400" />
                  DDA-атрибуция
                </li>
                <li className="flex items-center gap-2">
                  <span className="h-1.5 w-1.5 rounded-full bg-emerald-400" />
                  Email поддержка
                </li>
              </ul>
              <Link
                href="/signup?plan=starter"
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
              <div className="text-3xl font-bold text-white mb-1">
                $99<span className="text-sm text-white/40 font-normal">/мес</span>
              </div>
              <div className="text-sm text-white/40 mb-6">Для растущих команд</div>
              <ul className="space-y-3 text-sm text-white/60 mb-8">
                <li className="flex items-center gap-2">
                  <span className="h-1.5 w-1.5 rounded-full bg-emerald-400" />
                  До 10 рекламных источников
                </li>
                <li className="flex items-center gap-2">
                  <span className="h-1.5 w-1.5 rounded-full bg-emerald-400" />
                  Управленческие отчёты
                </li>
                <li className="flex items-center gap-2">
                  <span className="h-1.5 w-1.5 rounded-full bg-emerald-400" />
                  Рекомендации по бюджетам
                </li>
                <li className="flex items-center gap-2">
                  <span className="h-1.5 w-1.5 rounded-full bg-emerald-400" />
                  Data Health мониторинг
                </li>
                <li className="flex items-center gap-2">
                  <span className="h-1.5 w-1.5 rounded-full bg-emerald-400" />
                  Приоритетная поддержка
                </li>
              </ul>
              <Link
                href="/signup?plan=growth"
                className="block w-full text-center py-3 text-sm font-semibold text-[#0B0F14] bg-emerald-500 hover:bg-emerald-400 rounded-lg transition"
              >
                Начать
              </Link>
            </div>

            {/* Agency */}
            <div className="bg-[#12141A] border border-white/10 rounded-xl p-8 hover:border-white/20 transition">
              <div className="text-lg font-semibold text-white mb-1">Agency</div>
              <div className="text-3xl font-bold text-white mb-1">
                $249<span className="text-sm text-white/40 font-normal">/мес</span>
              </div>
              <div className="text-sm text-white/40 mb-6">Для агентств и enterprise</div>
              <ul className="space-y-3 text-sm text-white/60 mb-8">
                <li className="flex items-center gap-2">
                  <span className="h-1.5 w-1.5 rounded-full bg-emerald-400" />
                  Неограниченные источники
                </li>
                <li className="flex items-center gap-2">
                  <span className="h-1.5 w-1.5 rounded-full bg-emerald-400" />
                  Несколько проектов
                </li>
                <li className="flex items-center gap-2">
                  <span className="h-1.5 w-1.5 rounded-full bg-emerald-400" />
                  Роли и доступы в команде
                </li>
                <li className="flex items-center gap-2">
                  <span className="h-1.5 w-1.5 rounded-full bg-emerald-400" />
                  Расширенная аналитика
                </li>
                <li className="flex items-center gap-2">
                  <span className="h-1.5 w-1.5 rounded-full bg-emerald-400" />
                  Выделенный менеджер
                </li>
              </ul>
              <Link
                href="/signup?plan=agency"
                className="block w-full text-center py-3 text-sm font-medium text-white/80 bg-white/5 hover:bg-white/10 border border-white/10 rounded-lg transition"
              >
                Связаться
              </Link>
            </div>
          </div>

          <div className="mt-8 text-center">
            <p className="text-sm text-white/40">
              Все тарифы включают 14-дневный бесплатный период. Отмена в любой момент.
            </p>
          </div>
        </div>
      </section>

      {/* FAQ */}
      <section id="faq" className="py-16 px-6 bg-[#0A0D11]">
        <div className="mx-auto max-w-3xl">
          <div className="text-center mb-12">
            <h2 className="text-3xl font-bold text-white mb-4">
              Вопросы и ответы
            </h2>
          </div>

          <div className="space-y-3">
            <FaqItem
              q="Почему вы говорите «без искажённых данных»?"
              a={[
                "Мы сверяем данные между источниками (рекламные кабинеты, CRM, платёжная система, GA4) и подсвечиваем расхождения.",
                "Отчёт строится на согласованной логике метрик, чтобы вы управляли прибылью, а не «красивыми» цифрами из кабинетов.",
                "Если данные неполные (нет UTM/click id, потери на редиректах) — это видно как снижение Data Health score."
              ]}
              defaultOpen
            />
            <FaqItem
              q="Как работает DDA-атрибуция?"
              a={[
                "DDA (Data-Driven Attribution) — это модель, которая оценивает вклад касаний на основе реальных данных пути клиента.",
                "В отличие от last click, DDA распределяет ценность продажи между всеми касаниями пропорционально их влиянию на конверсию.",
                "Это помогает точнее распределять бюджеты и видеть реальную окупаемость каналов."
              ]}
            />
            <FaqItem
              q="Какие рекомендации вы даёте?"
              a={[
                "Бюджетные: где сократить расходы, где масштабировать кампании на основе ROMI/CAC и динамики.",
                "Технические: где теряются UTM/click id, где есть расхождение CRM ↔ Ads, где нужна дедупликация событий.",
                "Управленческие: какие каналы реально приносят прибыль по DDA-модели, а какие переоценены в last click."
              ]}
            />
            <FaqItem
              q="Какие данные нужны для работы?"
              a={[
                "Минимально: доступ к рекламным кабинетам (Meta, Google, TikTok и др.) и CRM с данными о продажах.",
                "Для полной картины: также подключите GA4 и платёжную систему.",
                "Настройка занимает 10-15 минут. Данные обновляются автоматически."
              ]}
            />
            <FaqItem
              q="Есть ли бесплатный период?"
              a={[
                "Да, все тарифы включают 14-дневный бесплатный период с полным функционалом.",
                "Не требуется карта для регистрации. Отмена в любой момент без обязательств."
              ]}
            />
          </div>
        </div>
      </section>

      {/* FINAL CTA */}
      <section className="py-16 px-6">
        <div className="mx-auto max-w-6xl">
          <div className="bg-[#12141A] border border-white/10 rounded-2xl p-8 md:p-12">
            <div className="grid lg:grid-cols-2 gap-8 items-center">
              <div>
                <h2 className="text-3xl md:text-4xl font-bold text-white mb-4 text-balance">
                  Перейдите от «кликов» к управлению прибылью
                </h2>
                <p className="text-white/55 leading-relaxed mb-6">
                  Получите полную видимость выручки, CAC и эффективности каналов. Принимайте решения на основе данных, а не отчётов из рекламных кабинетов.
                </p>
                <div className="flex flex-wrap gap-3">
                  <button
                    onClick={() => scrollToSection("pricing")}
                    className="inline-flex items-center justify-center px-6 py-3 text-sm font-semibold text-[#0B0F14] bg-emerald-400 hover:bg-emerald-300 rounded-lg transition"
                  >
                    Начать бесплатно
                  </button>
                  <button
                    onClick={() => scrollToSection("demo")}
                    className="inline-flex items-center justify-center px-6 py-3 text-sm font-semibold text-white/80 bg-white/5 hover:bg-white/10 border border-white/10 rounded-lg transition"
                  >
                    Посмотреть демо
                  </button>
                </div>
              </div>

              <div className="space-y-3">
                <SignalCard
                  type="success"
                  title="Рекомендация: перераспределение бюджета"
                  text="Снять 15% с Campaign C и усилить Campaign A (прогноз +12% ROMI)"
                />
                <SignalCard
                  type="warning"
                  title="Сигнал: расхождение CRM ↔ Ads"
                  text="7% событий не совпадают — проверьте дедупликацию"
                />
                <SignalCard
                  type="info"
                  title="Инсайт: Instagram +18% эффективность"
                  text="DDA показывает недооценённый вклад канала"
                />
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* FOOTER */}
      <footer className="py-12 px-6 border-t border-white/5">
        <div className="mx-auto max-w-6xl flex flex-col md:flex-row items-center justify-between gap-4 text-sm text-white/40">
          <div className="flex items-center gap-2">
            <div className="h-6 w-6 rounded bg-emerald-500/20 flex items-center justify-center">
              <span className="text-emerald-400 font-bold text-xs">B</span>
            </div>
            <span>© {new Date().getFullYear()} BoardIQ</span>
          </div>
          <div className="flex gap-6">
            <button onClick={() => scrollToSection("product")} className="hover:text-white/70 transition">Продукт</button>
            <button onClick={() => scrollToSection("pricing")} className="hover:text-white/70 transition">Тарифы</button>
            <button onClick={() => scrollToSection("faq")} className="hover:text-white/70 transition">FAQ</button>
            <Link href="/privacy" className="hover:text-white/70 transition">Политика конфиденциальности</Link>
          </div>
        </div>
      </footer>
    </main>
  );
}
