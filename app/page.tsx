"use client";

import Link from "next/link";
import { useState, useEffect, useRef } from "react";
import {
  AreaChart,
  Area,
  BarChart,
  Bar,
  PieChart,
  Pie,
  Cell,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
  LineChart,
  Line,
} from "recharts";

/* ===== UTILS ===== */
function cn(...v: Array<string | false | null | undefined>) {
  return v.filter(Boolean).join(" ");
}

function scrollToSection(id: string) {
  const element = document.getElementById(id);
  if (element) {
    element.scrollIntoView({ behavior: "smooth" });
  }
}

/* ===== ANIMATION HOOK ===== */
function useInView(threshold = 0.2) {
  const ref = useRef<HTMLDivElement>(null);
  const [inView, setInView] = useState(false);

  useEffect(() => {
    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting) {
          setInView(true);
        }
      },
      { threshold }
    );
    if (ref.current) observer.observe(ref.current);
    return () => observer.disconnect();
  }, [threshold]);

  return { ref, inView };
}

/* ===== ANIMATED COUNTER ===== */
function AnimatedNumber({
  value,
  prefix = "",
  suffix = "",
  duration = 1500,
}: {
  value: number;
  prefix?: string;
  suffix?: string;
  duration?: number;
}) {
  const [display, setDisplay] = useState(0);
  const { ref, inView } = useInView();

  useEffect(() => {
    if (!inView) return;
    const start = Date.now();
    const animate = () => {
      const progress = Math.min((Date.now() - start) / duration, 1);
      const ease = 1 - Math.pow(1 - progress, 3);
      setDisplay(Math.round(value * ease));
      if (progress < 1) requestAnimationFrame(animate);
    };
    requestAnimationFrame(animate);
  }, [inView, value, duration]);

  return (
    <span ref={ref}>
      {prefix}
      {display.toLocaleString()}
      {suffix}
    </span>
  );
}

/* ===== FADE IN COMPONENT ===== */
function FadeIn({
  children,
  delay = 0,
  className = "",
}: {
  children: React.ReactNode;
  delay?: number;
  className?: string;
}) {
  const { ref, inView } = useInView(0.1);

  return (
    <div
      ref={ref}
      className={cn(
        "transition-all duration-700 ease-out",
        inView ? "opacity-100 translate-y-0" : "opacity-0 translate-y-8",
        className
      )}
      style={{ transitionDelay: `${delay}ms` }}
    >
      {children}
    </div>
  );
}

/* ===== DASHBOARD DATA ===== */
type MetricKey = "revenue" | "cac" | "romi" | "customers";
type ChannelKey = "all" | "google" | "meta" | "tiktok";
type PeriodKey = "7d" | "30d" | "90d";

const dashboardData = {
  revenue: {
    all: {
      "7d": { value: 127450, change: 12.4, trend: [95, 102, 98, 115, 108, 120, 127] },
      "30d": { value: 489200, change: 18.2, trend: [320, 345, 380, 410, 425, 460, 489] },
      "90d": { value: 1420000, change: 24.5, trend: [980, 1050, 1120, 1200, 1290, 1350, 1420] },
    },
    google: {
      "7d": { value: 52300, change: 8.1, trend: [42, 44, 46, 48, 50, 51, 52] },
      "30d": { value: 198500, change: 15.3, trend: [140, 150, 162, 175, 182, 190, 198] },
      "90d": { value: 580000, change: 21.2, trend: [420, 450, 485, 510, 540, 560, 580] },
    },
    meta: {
      "7d": { value: 48200, change: 15.8, trend: [32, 36, 40, 42, 44, 46, 48] },
      "30d": { value: 178400, change: 22.1, trend: [110, 125, 142, 155, 165, 172, 178] },
      "90d": { value: 520000, change: 28.4, trend: [340, 380, 420, 455, 480, 500, 520] },
    },
    tiktok: {
      "7d": { value: 26950, change: 18.2, trend: [18, 20, 21, 23, 24, 25, 27] },
      "30d": { value: 112300, change: 32.5, trend: [62, 72, 82, 90, 98, 105, 112] },
      "90d": { value: 320000, change: 45.1, trend: [160, 195, 230, 260, 285, 305, 320] },
    },
  },
  cac: {
    all: {
      "7d": { value: 23.4, change: -5.2, trend: [28, 27, 26, 25, 24, 24, 23] },
      "30d": { value: 24.8, change: -3.8, trend: [29, 28, 27, 26, 26, 25, 25] },
      "90d": { value: 26.2, change: -8.1, trend: [32, 30, 29, 28, 27, 27, 26] },
    },
    google: {
      "7d": { value: 21.2, change: -4.1, trend: [25, 24, 23, 22, 22, 21, 21] },
      "30d": { value: 22.5, change: -2.9, trend: [26, 25, 24, 24, 23, 23, 22] },
      "90d": { value: 24.1, change: -6.5, trend: [29, 28, 27, 26, 25, 25, 24] },
    },
    meta: {
      "7d": { value: 24.8, change: -6.3, trend: [30, 29, 28, 27, 26, 25, 25] },
      "30d": { value: 26.2, change: -4.5, trend: [31, 30, 29, 28, 27, 27, 26] },
      "90d": { value: 27.8, change: -9.2, trend: [35, 33, 31, 30, 29, 28, 28] },
    },
    tiktok: {
      "7d": { value: 28.5, change: -3.8, trend: [33, 32, 31, 30, 30, 29, 28] },
      "30d": { value: 30.1, change: -2.1, trend: [34, 33, 32, 32, 31, 31, 30] },
      "90d": { value: 32.4, change: -5.8, trend: [38, 37, 36, 35, 34, 33, 32] },
    },
  },
  romi: {
    all: {
      "7d": { value: 168, change: 14.2, trend: [132, 140, 148, 155, 160, 164, 168] },
      "30d": { value: 172, change: 11.8, trend: [140, 148, 155, 162, 166, 170, 172] },
      "90d": { value: 185, change: 18.5, trend: [142, 152, 162, 170, 176, 181, 185] },
    },
    google: {
      "7d": { value: 195, change: 12.1, trend: [160, 168, 175, 182, 188, 192, 195] },
      "30d": { value: 198, change: 9.8, trend: [165, 172, 180, 186, 191, 195, 198] },
      "90d": { value: 210, change: 15.2, trend: [168, 178, 188, 195, 202, 206, 210] },
    },
    meta: {
      "7d": { value: 152, change: 16.5, trend: [115, 125, 135, 142, 147, 150, 152] },
      "30d": { value: 158, change: 14.2, trend: [122, 132, 140, 148, 153, 156, 158] },
      "90d": { value: 168, change: 20.1, trend: [125, 138, 148, 156, 162, 165, 168] },
    },
    tiktok: {
      "7d": { value: 128, change: 18.8, trend: [95, 102, 110, 118, 122, 125, 128] },
      "30d": { value: 135, change: 22.5, trend: [98, 108, 118, 125, 130, 133, 135] },
      "90d": { value: 145, change: 28.2, trend: [100, 112, 125, 135, 140, 143, 145] },
    },
  },
  customers: {
    all: {
      "7d": { value: 892, change: 8.5, trend: [720, 755, 790, 825, 850, 872, 892] },
      "30d": { value: 3420, change: 12.2, trend: [2650, 2820, 2980, 3120, 3250, 3340, 3420] },
      "90d": { value: 9850, change: 15.8, trend: [7200, 7800, 8350, 8850, 9280, 9580, 9850] },
    },
    google: {
      "7d": { value: 385, change: 6.2, trend: [320, 335, 350, 362, 372, 378, 385] },
      "30d": { value: 1480, change: 9.5, trend: [1180, 1250, 1320, 1380, 1420, 1455, 1480] },
      "90d": { value: 4250, change: 12.4, trend: [3200, 3480, 3720, 3940, 4080, 4170, 4250] },
    },
    meta: {
      "7d": { value: 328, change: 10.2, trend: [258, 275, 292, 305, 315, 322, 328] },
      "30d": { value: 1260, change: 14.8, trend: [950, 1020, 1090, 1150, 1200, 1235, 1260] },
      "90d": { value: 3620, change: 18.2, trend: [2580, 2850, 3100, 3320, 3480, 3560, 3620] },
    },
    tiktok: {
      "7d": { value: 179, change: 12.5, trend: [135, 145, 155, 162, 170, 175, 179] },
      "30d": { value: 680, change: 18.5, trend: [480, 530, 580, 620, 650, 668, 680] },
      "90d": { value: 1980, change: 24.2, trend: [1320, 1480, 1640, 1780, 1880, 1940, 1980] },
    },
  },
};

const channelDistribution = {
  all: [
    { name: "Google", value: 42, color: "#60a5fa" },
    { name: "Meta", value: 35, color: "#f472b6" },
    { name: "TikTok", value: 18, color: "#34d399" },
    { name: "Другие", value: 5, color: "#fbbf24" },
  ],
  google: [
    { name: "Search", value: 55, color: "#60a5fa" },
    { name: "Display", value: 25, color: "#818cf8" },
    { name: "YouTube", value: 20, color: "#f87171" },
  ],
  meta: [
    { name: "Feed", value: 45, color: "#f472b6" },
    { name: "Stories", value: 30, color: "#c084fc" },
    { name: "Reels", value: 25, color: "#fb923c" },
  ],
  tiktok: [
    { name: "In-Feed", value: 50, color: "#34d399" },
    { name: "Spark", value: 35, color: "#22d3d1" },
    { name: "TopView", value: 15, color: "#a3e635" },
  ],
};

const metricLabels: Record<MetricKey, { label: string; format: (v: number) => string }> = {
  revenue: { label: "Выручка", format: (v) => `$${v.toLocaleString()}` },
  cac: { label: "CAC", format: (v) => `$${v.toFixed(1)}` },
  romi: { label: "ROMI", format: (v) => `${v}%` },
  customers: { label: "Покупатели", format: (v) => v.toLocaleString() },
};

const channelLabels: Record<ChannelKey, string> = {
  all: "Все каналы",
  google: "Google Ads",
  meta: "Meta Ads",
  tiktok: "TikTok Ads",
};

const periodLabels: Record<PeriodKey, string> = {
  "7d": "7 дней",
  "30d": "30 дней",
  "90d": "90 дней",
};

/* ===== FILTER PILL ===== */
function FilterPill({
  active,
  children,
  onClick,
  color = "default",
}: {
  active?: boolean;
  children: React.ReactNode;
  onClick?: () => void;
  color?: "default" | "emerald" | "blue" | "pink" | "amber";
}) {
  const colors = {
    default: active
      ? "bg-white/15 border-white/25 text-white"
      : "bg-white/5 border-white/10 text-white/60 hover:bg-white/10 hover:text-white",
    emerald: active
      ? "bg-emerald-500/20 border-emerald-500/40 text-emerald-400"
      : "bg-white/5 border-white/10 text-white/60 hover:bg-emerald-500/10 hover:text-emerald-400",
    blue: active
      ? "bg-blue-500/20 border-blue-500/40 text-blue-400"
      : "bg-white/5 border-white/10 text-white/60 hover:bg-blue-500/10 hover:text-blue-400",
    pink: active
      ? "bg-pink-500/20 border-pink-500/40 text-pink-400"
      : "bg-white/5 border-white/10 text-white/60 hover:bg-pink-500/10 hover:text-pink-400",
    amber: active
      ? "bg-amber-500/20 border-amber-500/40 text-amber-400"
      : "bg-white/5 border-white/10 text-white/60 hover:bg-amber-500/10 hover:text-amber-400",
  };

  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "rounded-full px-4 py-2 text-sm font-medium transition-all duration-300 border",
        colors[color]
      )}
    >
      {children}
    </button>
  );
}

/* ===== INTERACTIVE DASHBOARD ===== */
function InteractiveDashboard() {
  const [metric, setMetric] = useState<MetricKey>("revenue");
  const [channel, setChannel] = useState<ChannelKey>("all");
  const [period, setPeriod] = useState<PeriodKey>("30d");

  const data = dashboardData[metric][channel][period];
  const distribution = channelDistribution[channel];
  const metricInfo = metricLabels[metric];

  const chartData = data.trend.map((value, index) => ({
    day: index + 1,
    value,
  }));

  const chartColor =
    metric === "revenue"
      ? "#34d399"
      : metric === "cac"
        ? "#60a5fa"
        : metric === "romi"
          ? "#fbbf24"
          : "#f472b6";

  return (
    <div className="bg-[#0d1117]/80 backdrop-blur-xl border border-white/10 rounded-2xl p-6 shadow-2xl">
      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <div>
          <div className="text-xs text-white/40 uppercase tracking-wider mb-1">Live Dashboard</div>
          <div className="text-xl font-bold text-white">Управленческая панель</div>
        </div>
        <div className="flex items-center gap-2">
          <span className="h-2 w-2 rounded-full bg-emerald-400 animate-pulse" />
          <span className="text-xs text-white/50">обновлено сейчас</span>
        </div>
      </div>

      {/* Metric Filters */}
      <div className="flex flex-wrap gap-2 mb-4">
        {(Object.keys(metricLabels) as MetricKey[]).map((key) => (
          <FilterPill
            key={key}
            active={metric === key}
            onClick={() => setMetric(key)}
            color={
              key === "revenue"
                ? "emerald"
                : key === "cac"
                  ? "blue"
                  : key === "romi"
                    ? "amber"
                    : "pink"
            }
          >
            {metricLabels[key].label}
          </FilterPill>
        ))}
      </div>

      {/* Channel Filters */}
      <div className="flex flex-wrap gap-2 mb-4">
        {(Object.keys(channelLabels) as ChannelKey[]).map((key) => (
          <FilterPill key={key} active={channel === key} onClick={() => setChannel(key)}>
            {channelLabels[key]}
          </FilterPill>
        ))}
      </div>

      {/* Period Filters */}
      <div className="flex flex-wrap gap-2 mb-6">
        {(Object.keys(periodLabels) as PeriodKey[]).map((key) => (
          <FilterPill key={key} active={period === key} onClick={() => setPeriod(key)}>
            {periodLabels[key]}
          </FilterPill>
        ))}
      </div>

      {/* Main Metric */}
      <div className="grid md:grid-cols-2 gap-6">
        <div className="bg-[#161b22] rounded-xl p-5 border border-white/5">
          <div className="text-sm text-white/50 mb-2">{metricInfo.label}</div>
          <div className="text-4xl font-bold text-white mb-2">
            {metricInfo.format(data.value)}
          </div>
          <div
            className={cn(
              "inline-flex items-center gap-1 text-sm font-medium px-2 py-1 rounded",
              data.change > 0
                ? "text-emerald-400 bg-emerald-500/10"
                : "text-red-400 bg-red-500/10"
            )}
          >
            {data.change > 0 ? "+" : ""}
            {data.change}%
            <svg
              className={cn("w-3 h-3", data.change < 0 && "rotate-180")}
              fill="none"
              viewBox="0 0 24 24"
              stroke="currentColor"
            >
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 15l7-7 7 7" />
            </svg>
          </div>

          {/* Area Chart */}
          <div className="h-32 mt-4">
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart data={chartData}>
                <defs>
                  <linearGradient id={`gradient-${metric}`} x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor={chartColor} stopOpacity={0.3} />
                    <stop offset="100%" stopColor={chartColor} stopOpacity={0} />
                  </linearGradient>
                </defs>
                <Area
                  type="monotone"
                  dataKey="value"
                  stroke={chartColor}
                  strokeWidth={2}
                  fill={`url(#gradient-${metric})`}
                />
                <Tooltip
                  contentStyle={{
                    background: "#1c2128",
                    border: "1px solid rgba(255,255,255,0.1)",
                    borderRadius: "8px",
                    color: "#fff",
                  }}
                  formatter={(value: number) => [metricInfo.format(value), metricInfo.label]}
                />
              </AreaChart>
            </ResponsiveContainer>
          </div>
        </div>

        {/* Channel Distribution Pie */}
        <div className="bg-[#161b22] rounded-xl p-5 border border-white/5">
          <div className="text-sm text-white/50 mb-4">Распределение</div>
          <div className="h-40">
            <ResponsiveContainer width="100%" height="100%">
              <PieChart>
                <Pie
                  data={distribution}
                  cx="50%"
                  cy="50%"
                  innerRadius={45}
                  outerRadius={65}
                  paddingAngle={2}
                  dataKey="value"
                >
                  {distribution.map((entry, index) => (
                    <Cell key={`cell-${index}`} fill={entry.color} />
                  ))}
                </Pie>
                <Tooltip
                  contentStyle={{
                    background: "#1c2128",
                    border: "1px solid rgba(255,255,255,0.1)",
                    borderRadius: "8px",
                    color: "#fff",
                  }}
                  formatter={(value: number) => [`${value}%`, ""]}
                />
              </PieChart>
            </ResponsiveContainer>
          </div>
          <div className="flex flex-wrap gap-3 mt-4">
            {distribution.map((item) => (
              <div key={item.name} className="flex items-center gap-2 text-xs">
                <span
                  className="h-2 w-2 rounded-full"
                  style={{ backgroundColor: item.color }}
                />
                <span className="text-white/60">{item.name}</span>
                <span className="text-white font-medium">{item.value}%</span>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* Data Health */}
      <div className="mt-6 bg-[#161b22] rounded-xl p-5 border border-white/5">
        <div className="flex items-center justify-between mb-4">
          <div className="text-sm text-white/50">Data Health Score</div>
          <div className="text-2xl font-bold text-emerald-400">94%</div>
        </div>
        <div className="grid grid-cols-3 gap-4">
          {[
            { label: "CRM → Ads", value: 96, color: "bg-emerald-400" },
            { label: "События", value: 92, color: "bg-blue-400" },
            { label: "UTM полнота", value: 94, color: "bg-amber-400" },
          ].map((item) => (
            <div key={item.label}>
              <div className="flex items-center justify-between text-xs mb-1">
                <span className="text-white/50">{item.label}</span>
                <span className="text-white font-medium">{item.value}%</span>
              </div>
              <div className="h-1.5 bg-white/5 rounded-full overflow-hidden">
                <div
                  className={cn("h-full rounded-full transition-all duration-1000", item.color)}
                  style={{ width: `${item.value}%` }}
                />
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

/* ===== SIGNAL CARD ===== */
function SignalCard({
  type,
  title,
  text,
  metric,
  delay = 0,
}: {
  type: "success" | "warning" | "danger" | "info";
  title: string;
  text: string;
  metric?: string;
  delay?: number;
}) {
  const colors = {
    success: "border-l-emerald-400 bg-emerald-500/5",
    warning: "border-l-amber-400 bg-amber-500/5",
    danger: "border-l-red-400 bg-red-500/5",
    info: "border-l-blue-400 bg-blue-500/5",
  };

  const dotColors = {
    success: "bg-emerald-400",
    warning: "bg-amber-400",
    danger: "bg-red-400",
    info: "bg-blue-400",
  };

  return (
    <FadeIn delay={delay}>
      <div
        className={cn(
          "border-l-2 border border-white/5 rounded-xl p-5 hover:border-white/10 transition-all duration-300 group",
          colors[type]
        )}
      >
        <div className="flex items-start gap-3">
          <span
            className={cn(
              "mt-1 h-2.5 w-2.5 rounded-full flex-shrink-0 animate-pulse",
              dotColors[type]
            )}
          />
          <div className="flex-1">
            <div className="flex items-start justify-between gap-2">
              <div className="text-sm font-semibold text-white/90">{title}</div>
              {metric && (
                <div className="text-xs text-white/40 bg-white/5 px-2 py-0.5 rounded">
                  {metric}
                </div>
              )}
            </div>
            <div className="mt-1.5 text-sm text-white/55 leading-relaxed">{text}</div>
          </div>
        </div>
      </div>
    </FadeIn>
  );
}

/* ===== DDA COMPARISON ===== */
function DDAComparison() {
  const { ref, inView } = useInView(0.3);
  const [animated, setAnimated] = useState(false);

  useEffect(() => {
    if (inView && !animated) {
      setAnimated(true);
    }
  }, [inView, animated]);

  const lastClickData = [
    { name: "Instagram", lastClick: 0, dda: 35 },
    { name: "Google", lastClick: 0, dda: 42 },
    { name: "Email", lastClick: 100, dda: 23 },
  ];

  const animatedData = lastClickData.map((item) => ({
    ...item,
    lastClick: animated ? item.lastClick : 0,
    dda: animated ? item.dda : 0,
  }));

  return (
    <div ref={ref} className="grid lg:grid-cols-2 gap-6">
      <div className="bg-[#12141A] border border-white/10 rounded-xl p-6">
        <div className="flex items-center gap-2 mb-4">
          <div className="h-3 w-3 rounded-full bg-red-400/50" />
          <div className="text-lg font-semibold text-white">Last Click</div>
        </div>
        <p className="text-sm text-white/50 mb-6">
          Путь: Instagram → Google → Email → Покупка
        </p>
        <div className="h-48">
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={animatedData} layout="vertical">
              <XAxis type="number" domain={[0, 100]} hide />
              <YAxis type="category" dataKey="name" width={70} tick={{ fill: "rgba(255,255,255,0.6)", fontSize: 12 }} />
              <Bar
                dataKey="lastClick"
                fill="#f87171"
                radius={[0, 4, 4, 0]}
                animationDuration={1000}
              />
              <Tooltip
                contentStyle={{
                  background: "#1c2128",
                  border: "1px solid rgba(255,255,255,0.1)",
                  borderRadius: "8px",
                  color: "#fff",
                }}
                formatter={(value: number) => [`${value}%`, "Last Click"]}
              />
            </BarChart>
          </ResponsiveContainer>
        </div>
        <div className="mt-4 p-3 bg-red-500/10 border border-red-500/20 rounded-lg">
          <p className="text-xs text-red-300">
            Email получает 100% ценности, хотя клиент пришёл через другие каналы
          </p>
        </div>
      </div>

      <div className="bg-[#12141A] border border-emerald-500/20 rounded-xl p-6">
        <div className="flex items-center gap-2 mb-4">
          <div className="h-3 w-3 rounded-full bg-emerald-400" />
          <div className="text-lg font-semibold text-white">DDA (Data-Driven)</div>
        </div>
        <p className="text-sm text-white/50 mb-6">
          Тот же путь, реальное распределение
        </p>
        <div className="h-48">
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={animatedData} layout="vertical">
              <XAxis type="number" domain={[0, 100]} hide />
              <YAxis type="category" dataKey="name" width={70} tick={{ fill: "rgba(255,255,255,0.6)", fontSize: 12 }} />
              <Bar
                dataKey="dda"
                fill="#34d399"
                radius={[0, 4, 4, 0]}
                animationDuration={1000}
                animationBegin={200}
              />
              <Tooltip
                contentStyle={{
                  background: "#1c2128",
                  border: "1px solid rgba(255,255,255,0.1)",
                  borderRadius: "8px",
                  color: "#fff",
                }}
                formatter={(value: number) => [`${value}%`, "DDA"]}
              />
            </BarChart>
          </ResponsiveContainer>
        </div>
        <div className="mt-4 p-3 bg-emerald-500/10 border border-emerald-500/20 rounded-lg">
          <p className="text-xs text-emerald-300">
            DDA показывает реальный вклад каждого канала в конверсию
          </p>
        </div>
      </div>
    </div>
  );
}

/* ===== CHANNEL PERFORMANCE CHART ===== */
function ChannelPerformanceChart() {
  const data = [
    { month: "Янв", google: 45, meta: 38, tiktok: 22 },
    { month: "Фев", google: 52, meta: 42, tiktok: 28 },
    { month: "Мар", google: 48, meta: 48, tiktok: 35 },
    { month: "Апр", google: 58, meta: 52, tiktok: 42 },
    { month: "Май", google: 62, meta: 58, tiktok: 48 },
    { month: "Июн", google: 68, meta: 62, tiktok: 55 },
  ];

  return (
    <div className="bg-[#12141A] border border-white/10 rounded-xl p-6">
      <div className="text-lg font-semibold text-white mb-4">Динамика каналов (ROMI %)</div>
      <div className="h-64">
        <ResponsiveContainer width="100%" height="100%">
          <LineChart data={data}>
            <XAxis dataKey="month" tick={{ fill: "rgba(255,255,255,0.5)", fontSize: 12 }} />
            <YAxis tick={{ fill: "rgba(255,255,255,0.5)", fontSize: 12 }} />
            <Tooltip
              contentStyle={{
                background: "#1c2128",
                border: "1px solid rgba(255,255,255,0.1)",
                borderRadius: "8px",
                color: "#fff",
              }}
              formatter={(value: number) => [`${value}%`, ""]}
            />
            <Line type="monotone" dataKey="google" stroke="#60a5fa" strokeWidth={2} dot={false} />
            <Line type="monotone" dataKey="meta" stroke="#f472b6" strokeWidth={2} dot={false} />
            <Line type="monotone" dataKey="tiktok" stroke="#34d399" strokeWidth={2} dot={false} />
          </LineChart>
        </ResponsiveContainer>
      </div>
      <div className="flex justify-center gap-6 mt-4">
        {[
          { name: "Google", color: "#60a5fa" },
          { name: "Meta", color: "#f472b6" },
          { name: "TikTok", color: "#34d399" },
        ].map((item) => (
          <div key={item.name} className="flex items-center gap-2 text-sm">
            <span className="h-2 w-2 rounded-full" style={{ backgroundColor: item.color }} />
            <span className="text-white/60">{item.name}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

/* ===== FAQ ITEM ===== */
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
        <span
          className={cn(
            "text-white/50 text-xl font-light transition-transform duration-300",
            open && "rotate-45"
          )}
        >
          +
        </span>
      </button>
      <div
        className={cn(
          "overflow-hidden transition-all duration-300",
          open ? "max-h-96" : "max-h-0"
        )}
      >
        <div className="px-6 pb-5 pt-2 text-sm text-white/65 leading-relaxed space-y-2 bg-[#12141A]">
          {a.map((line, i) => (
            <p key={i}>{line}</p>
          ))}
        </div>
      </div>
    </div>
  );
}

/* ===== MAIN PAGE ===== */
export default function Page() {
  return (
    <main className="min-h-screen bg-[#0B0D12] relative overflow-hidden">
      {/* Mesh Gradient Background */}
      <div className="fixed inset-0 pointer-events-none">
        <div className="absolute top-0 left-1/4 w-[800px] h-[800px] bg-emerald-500/8 rounded-full blur-[150px] animate-pulse" style={{ animationDuration: "8s" }} />
        <div className="absolute top-1/3 right-1/4 w-[600px] h-[600px] bg-blue-500/8 rounded-full blur-[150px] animate-pulse" style={{ animationDuration: "10s", animationDelay: "2s" }} />
        <div className="absolute bottom-1/4 left-1/3 w-[500px] h-[500px] bg-purple-500/5 rounded-full blur-[150px] animate-pulse" style={{ animationDuration: "12s", animationDelay: "4s" }} />
      </div>

      {/* HEADER */}
      <header className="fixed top-0 left-0 right-0 z-50">
        <div className="bg-[#0B0D12]/60 backdrop-blur-2xl border-b border-white/5">
          <div className="mx-auto max-w-7xl px-6 h-16 flex items-center justify-between">
            <Link href="/" className="flex items-center gap-2.5 group">
              <div className="h-9 w-9 rounded-xl bg-gradient-to-br from-emerald-400 to-emerald-600 flex items-center justify-center shadow-lg shadow-emerald-500/20 group-hover:shadow-emerald-500/40 transition-shadow">
                <span className="text-white font-bold text-sm">B</span>
              </div>
              <span className="text-lg font-bold text-white">BoardIQ</span>
            </Link>

            <nav className="hidden md:flex items-center gap-8 text-sm text-white/60">
              <button onClick={() => scrollToSection("product")} className="hover:text-white transition">
                Продукт
              </button>
              <button onClick={() => scrollToSection("attribution")} className="hover:text-white transition">
                Атрибуция
              </button>
              <button onClick={() => scrollToSection("integrations")} className="hover:text-white transition">
                Интеграции
              </button>
              <button onClick={() => scrollToSection("pricing")} className="hover:text-white transition">
                Тарифы
              </button>
              <button onClick={() => scrollToSection("faq")} className="hover:text-white transition">
                FAQ
              </button>
            </nav>

            <div className="flex items-center gap-3">
              <Link href="/login" className="text-sm text-white/70 hover:text-white transition px-4 py-2">
                Вход
              </Link>
              <button
                onClick={() => scrollToSection("pricing")}
                className="text-sm font-semibold text-[#0B0D12] bg-gradient-to-r from-emerald-400 to-emerald-500 hover:from-emerald-300 hover:to-emerald-400 px-5 py-2.5 rounded-xl transition-all shadow-lg shadow-emerald-500/20 hover:shadow-emerald-500/40"
              >
                Начать
              </button>
            </div>
          </div>
        </div>
      </header>

      {/* HERO */}
      <section className="pt-32 pb-20 px-6 relative">
        <div className="mx-auto max-w-7xl">
          <div className="grid lg:grid-cols-2 gap-16 items-start">
            {/* LEFT */}
            <div className="space-y-8">
              <FadeIn>
                <div className="flex flex-wrap gap-2">
                  <span className="text-xs font-medium text-emerald-400 bg-emerald-500/10 border border-emerald-500/20 px-3 py-1.5 rounded-full">
                    Прозрачные данные
                  </span>
                  <span className="text-xs font-medium text-blue-400 bg-blue-500/10 border border-blue-500/20 px-3 py-1.5 rounded-full">
                    DDA-атрибуция
                  </span>
                  <span className="text-xs font-medium text-amber-400 bg-amber-500/10 border border-amber-500/20 px-3 py-1.5 rounded-full">
                    AI-рекомендации
                  </span>
                </div>
              </FadeIn>

              <FadeIn delay={100}>
                <h1 className="text-4xl md:text-5xl lg:text-6xl font-bold leading-[1.1] text-white text-balance">
                  Управленческая аналитика{" "}
                  <span className="bg-gradient-to-r from-emerald-400 to-blue-400 bg-clip-text text-transparent">
                    без искажённых данных
                  </span>
                </h1>
              </FadeIn>

              <FadeIn delay={200}>
                <p className="text-lg text-white/55 leading-relaxed max-w-lg">
                  BoardIQ объединяет рекламные кабинеты, CRM и аналитику в единую систему. 
                  Видите реальную выручку, CAC, ROMI и вклад каналов — без искажений.
                </p>
              </FadeIn>

              <FadeIn delay={300}>
                <div className="space-y-4">
                  {[
                    { text: "Честная сквозная аналитика с проверкой источников", color: "bg-emerald-400" },
                    { text: "Реальный вклад каналов через Data-Driven Attribution", color: "bg-blue-400" },
                    { text: "Рекомендации: где резать, где масштабировать", color: "bg-amber-400" },
                    { text: "Мониторинг качества данных и аномалий", color: "bg-pink-400" },
                  ].map((item, i) => (
                    <div key={i} className="flex items-center gap-3 text-sm text-white/70">
                      <span className={cn("h-2 w-2 rounded-full", item.color)} />
                      {item.text}
                    </div>
                  ))}
                </div>
              </FadeIn>

              <FadeIn delay={400}>
                <div className="flex flex-wrap gap-4">
                  <button
                    onClick={() => scrollToSection("pricing")}
                    className="inline-flex items-center px-6 py-3.5 text-sm font-semibold text-[#0B0D12] bg-gradient-to-r from-emerald-400 to-emerald-500 hover:from-emerald-300 hover:to-emerald-400 rounded-xl transition-all shadow-lg shadow-emerald-500/20 hover:shadow-emerald-500/40"
                  >
                    Начать бесплатно
                    <svg className="w-4 h-4 ml-2" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 8l4 4m0 0l-4 4m4-4H3" />
                    </svg>
                  </button>
                  <button
                    onClick={() => scrollToSection("demo")}
                    className="inline-flex items-center px-6 py-3.5 text-sm font-semibold text-white/80 bg-white/5 hover:bg-white/10 border border-white/10 hover:border-white/20 rounded-xl transition-all"
                  >
                    Посмотреть демо
                  </button>
                </div>
              </FadeIn>

              <FadeIn delay={500}>
                <div className="flex items-center gap-8 pt-4">
                  <div className="text-center">
                    <div className="text-2xl font-bold text-white">
                      <AnimatedNumber value={127} suffix="+" />
                    </div>
                    <div className="text-xs text-white/40">компаний</div>
                  </div>
                  <div className="h-8 w-px bg-white/10" />
                  <div className="text-center">
                    <div className="text-2xl font-bold text-white">
                      $<AnimatedNumber value={12} />M+
                    </div>
                    <div className="text-xs text-white/40">под управлением</div>
                  </div>
                  <div className="h-8 w-px bg-white/10" />
                  <div className="text-center">
                    <div className="text-2xl font-bold text-emerald-400">
                      <AnimatedNumber value={94} suffix="%" />
                    </div>
                    <div className="text-xs text-white/40">Data Health</div>
                  </div>
                </div>
              </FadeIn>
            </div>

            {/* RIGHT — DASHBOARD */}
            <FadeIn delay={200}>
              <div id="demo">
                <InteractiveDashboard />
              </div>
            </FadeIn>
          </div>
        </div>
      </section>

      {/* SIGNALS */}
      <section className="py-20 px-6">
        <div className="mx-auto max-w-7xl">
          <FadeIn>
            <div className="text-center mb-12">
              <h2 className="text-3xl md:text-4xl font-bold text-white mb-4">
                Что требует внимания прямо сейчас
              </h2>
              <p className="text-white/50 max-w-xl mx-auto">
                Система находит проблемы и формирует конкретные действия на основе данных
              </p>
            </div>
          </FadeIn>

          <div className="grid md:grid-cols-2 gap-4">
            <SignalCard
              type="success"
              title="Оптимизация бюджета"
              text="Перераспределите 15% бюджета с кампаний с ROMI < 100% на топ-2 кампании. Прогноз роста: +12%"
              metric="+$18.5k"
              delay={0}
            />
            <SignalCard
              type="warning"
              title="Расхождение CRM ↔ Ads"
              text="7.2% транзакций не связаны с рекламными кликами. Проверьте external_id и дедупликацию событий."
              metric="7.2%"
              delay={100}
            />
            <SignalCard
              type="danger"
              title="Аномальный рост CAC"
              text="CAC в TikTok вырос на 23% за неделю при той же выручке. Проверьте частоту и аудитории."
              metric="+23%"
              delay={200}
            />
            <SignalCard
              type="info"
              title="Потеря UTM-меток"
              text="12% сессий теряют UTM на этапе оплаты. Проверьте редиректы платёжной системы."
              metric="12%"
              delay={300}
            />
          </div>
        </div>
      </section>

      {/* PRODUCT VALUE */}
      <section id="product" className="py-20 px-6 relative">
        <div className="absolute inset-0 bg-gradient-to-b from-transparent via-emerald-500/3 to-transparent pointer-events-none" />
        <div className="mx-auto max-w-7xl relative">
          <FadeIn>
            <div className="text-center mb-16">
              <h2 className="text-3xl md:text-4xl font-bold text-white mb-4">
                Единая система для маркетинговых решений
              </h2>
              <p className="text-white/50 max-w-2xl mx-auto">
                Прозрачные расчёты, DDA-атрибуция и управленческие подсказки — без "красивых цифр" из рекламных кабинетов
              </p>
            </div>
          </FadeIn>

          <div className="grid md:grid-cols-2 lg:grid-cols-4 gap-6 mb-12">
            {[
              {
                title: "Прозрачные расчёты",
                text: "Единая логика метрик, сверка CRM с рекламными кабинетами. Знаете, откуда каждая цифра.",
                icon: (
                  <svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
                  </svg>
                ),
                color: "emerald",
              },
              {
                title: "DDA-атрибуция",
                text: "Оценка вклада касаний по всему пути клиента, а не по last click из кабинетов.",
                icon: (
                  <svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M13 10V3L4 14h7v7l9-11h-7z" />
                  </svg>
                ),
                color: "blue",
              },
              {
                title: "Рекомендации",
                text: "Автоматические подсказки: где сократить бюджет, где масштабировать, что починить.",
                icon: (
                  <svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9.663 17h4.673M12 3v1m6.364 1.636l-.707.707M21 12h-1M4 12H3m3.343-5.657l-.707-.707m2.828 9.9a5 5 0 117.072 0l-.548.547A3.374 3.374 0 0014 18.469V19a2 2 0 11-4 0v-.531c0-.895-.356-1.754-.988-2.386l-.548-.547z" />
                  </svg>
                ),
                color: "amber",
              },
              {
                title: "Контроль качества",
                text: "Мониторинг полноты данных, расхождений и аномалий. Понимаете, когда данные неполные.",
                icon: (
                  <svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z" />
                  </svg>
                ),
                color: "pink",
              },
            ].map((item, i) => (
              <FadeIn key={item.title} delay={i * 100}>
                <div className="bg-[#12141A]/80 backdrop-blur border border-white/10 rounded-xl p-6 hover:border-white/20 transition-all group h-full">
                  <div
                    className={cn(
                      "h-12 w-12 rounded-xl flex items-center justify-center mb-4 transition-transform group-hover:scale-110",
                      item.color === "emerald" && "bg-emerald-500/20 text-emerald-400",
                      item.color === "blue" && "bg-blue-500/20 text-blue-400",
                      item.color === "amber" && "bg-amber-500/20 text-amber-400",
                      item.color === "pink" && "bg-pink-500/20 text-pink-400"
                    )}
                  >
                    {item.icon}
                  </div>
                  <h3 className="text-lg font-semibold text-white mb-2">{item.title}</h3>
                  <p className="text-sm text-white/55 leading-relaxed">{item.text}</p>
                </div>
              </FadeIn>
            ))}
          </div>

          {/* Channel Performance Chart */}
          <FadeIn delay={200}>
            <ChannelPerformanceChart />
          </FadeIn>
        </div>
      </section>

      {/* ATTRIBUTION */}
      <section id="attribution" className="py-20 px-6">
        <div className="mx-auto max-w-7xl">
          <FadeIn>
            <div className="text-center mb-16">
              <h2 className="text-3xl md:text-4xl font-bold text-white mb-4">
                Data-Driven Attribution (DDA)
              </h2>
              <p className="text-white/50 max-w-xl mx-auto">
                Поймите реальный вклад каналов, а не искажение от last click
              </p>
            </div>
          </FadeIn>

          <DDAComparison />

          <FadeIn delay={200}>
            <div className="mt-12 grid md:grid-cols-3 gap-6">
              {[
                { title: "Все касания", text: "Анализируем весь путь клиента, не только последний клик" },
                { title: "Вероятности", text: "Оцениваем влияние каждого касания на конверсию" },
                { title: "Точность", text: "Учитываем порядок, частоту и время между контактами" },
              ].map((item, i) => (
                <div key={item.title} className="bg-[#12141A]/80 backdrop-blur border border-white/10 rounded-xl p-6 text-center">
                  <div className="h-10 w-10 rounded-full bg-blue-500/20 text-blue-400 flex items-center justify-center mx-auto mb-3 text-lg font-bold">
                    {i + 1}
                  </div>
                  <h3 className="font-semibold text-white mb-2">{item.title}</h3>
                  <p className="text-sm text-white/50">{item.text}</p>
                </div>
              ))}
            </div>
          </FadeIn>
        </div>
      </section>

      {/* INTEGRATIONS */}
      <section id="integrations" className="py-20 px-6 relative">
        <div className="absolute inset-0 bg-gradient-to-b from-transparent via-blue-500/3 to-transparent pointer-events-none" />
        <div className="mx-auto max-w-7xl relative">
          <FadeIn>
            <div className="text-center mb-12">
              <h2 className="text-3xl md:text-4xl font-bold text-white mb-4">
                Интеграции
              </h2>
              <p className="text-white/50">
                Подключение за 10-15 минут. Данные синхронизируются автоматически.
              </p>
            </div>
          </FadeIn>

          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            {[
              { name: "Meta Ads", icon: "📘", popular: true },
              { name: "Google Ads", icon: "🔍", popular: true },
              { name: "TikTok Ads", icon: "🎵", new: true },
              { name: "VK Ads", icon: "💬" },
              { name: "Яндекс.Директ", icon: "🎯" },
              { name: "GA4", icon: "📊" },
              { name: "amoCRM", icon: "💼" },
              { name: "Bitrix24", icon: "🏢" },
            ].map((item, i) => (
              <FadeIn key={item.name} delay={i * 50}>
                <div className="bg-[#12141A]/80 backdrop-blur border border-white/10 rounded-xl p-5 hover:border-white/20 transition-all group cursor-pointer">
                  <div className="flex items-center gap-3">
                    <span className="text-2xl group-hover:scale-110 transition-transform">{item.icon}</span>
                    <div>
                      <div className="font-semibold text-white text-sm">{item.name}</div>
                      {item.popular && <div className="text-xs text-emerald-400">Популярный</div>}
                      {item.new && <div className="text-xs text-blue-400">Новый</div>}
                    </div>
                  </div>
                </div>
              </FadeIn>
            ))}
          </div>

          <FadeIn delay={400}>
            <div className="mt-8 text-center">
              <p className="text-sm text-white/40">
                + API, Webhooks, PostgreSQL, BigQuery и другие источники
              </p>
            </div>
          </FadeIn>
        </div>
      </section>

      {/* PRICING */}
      <section id="pricing" className="py-20 px-6">
        <div className="mx-auto max-w-7xl">
          <FadeIn>
            <div className="text-center mb-12">
              <h2 className="text-3xl md:text-4xl font-bold text-white mb-4">
                Тарифы
              </h2>
              <p className="text-white/50">
                Начните бесплатно, масштабируйтесь по мере роста
              </p>
            </div>
          </FadeIn>

          <div className="grid md:grid-cols-3 gap-6 max-w-5xl mx-auto">
            {[
              {
                name: "Starter",
                price: "$39",
                description: "Для небольших проектов",
                features: [
                  "До 3 рекламных источников",
                  "Базовые отчёты и метрики",
                  "DDA-атрибуция",
                  "Email поддержка",
                ],
                popular: false,
              },
              {
                name: "Growth",
                price: "$99",
                description: "Для растущих команд",
                features: [
                  "До 10 рекламных источников",
                  "Управленческие отчёты",
                  "Рекомендации по бюджетам",
                  "Data Health мониторинг",
                  "Приоритетная поддержка",
                ],
                popular: true,
              },
              {
                name: "Agency",
                price: "$249",
                description: "Для агентств и enterprise",
                features: [
                  "Неограниченные источники",
                  "Несколько проектов",
                  "Роли и доступы",
                  "Расширенная аналитика",
                  "Выделенный менеджер",
                ],
                popular: false,
              },
            ].map((plan, i) => (
              <FadeIn key={plan.name} delay={i * 100}>
                <div
                  className={cn(
                    "bg-[#12141A]/80 backdrop-blur border rounded-2xl p-8 relative transition-all",
                    plan.popular
                      ? "border-emerald-500/30 scale-105"
                      : "border-white/10 hover:border-white/20"
                  )}
                >
                  {plan.popular && (
                    <div className="absolute -top-3 left-1/2 -translate-x-1/2 bg-gradient-to-r from-emerald-400 to-emerald-500 text-[#0B0D12] text-xs font-semibold px-4 py-1 rounded-full">
                      Популярный
                    </div>
                  )}
                  <div className="text-lg font-semibold text-white mb-1">{plan.name}</div>
                  <div className="text-4xl font-bold text-white mb-1">
                    {plan.price}
                    <span className="text-sm text-white/40 font-normal">/мес</span>
                  </div>
                  <div className="text-sm text-white/40 mb-6">{plan.description}</div>
                  <ul className="space-y-3 text-sm text-white/60 mb-8">
                    {plan.features.map((feature) => (
                      <li key={feature} className="flex items-center gap-2">
                        <span className="h-1.5 w-1.5 rounded-full bg-emerald-400" />
                        {feature}
                      </li>
                    ))}
                  </ul>
                  <Link
                    href={`/signup?plan=${plan.name.toLowerCase()}`}
                    className={cn(
                      "block w-full text-center py-3 text-sm font-semibold rounded-xl transition-all",
                      plan.popular
                        ? "text-[#0B0D12] bg-gradient-to-r from-emerald-400 to-emerald-500 hover:from-emerald-300 hover:to-emerald-400 shadow-lg shadow-emerald-500/20"
                        : "text-white/80 bg-white/5 hover:bg-white/10 border border-white/10"
                    )}
                  >
                    Начать
                  </Link>
                </div>
              </FadeIn>
            ))}
          </div>
        </div>
      </section>

      {/* FAQ */}
      <section id="faq" className="py-20 px-6">
        <div className="mx-auto max-w-3xl">
          <FadeIn>
            <div className="text-center mb-12">
              <h2 className="text-3xl md:text-4xl font-bold text-white mb-4">
                Частые вопросы
              </h2>
            </div>
          </FadeIn>

          <FadeIn delay={100}>
            <div className="space-y-3">
              <FaqItem
                q="Чем BoardIQ отличается от отчётов в рекламных кабинетах?"
                a={[
                  "Рекламные кабинеты показывают завышенные конверсии из-за self-attribution: каждый кабинет присваивает себе касания, которые были и у других каналов.",
                  "BoardIQ сопоставляет данные из CRM, рекламы и аналитики, считает по единой логике и применяет DDA-атрибуцию для понимания реального вклада каналов.",
                ]}
                defaultOpen
              />
              <FaqItem
                q="Что такое DDA и чем это лучше last click?"
                a={[
                  "Data-Driven Attribution (DDA) — это модель, которая оценивает вклад каждого касания в конверсию на основе данных, а не правил.",
                  "Last click присваивает 100% ценности последнему клику, игнорируя всех, кто привёл клиента раньше. DDA распределяет ценность пропорционально реальному влиянию.",
                ]}
              />
              <FaqItem
                q="Сколько времени занимает интеграция?"
                a={[
                  "Подключение стандартных источников (Meta, Google, TikTok, CRM) занимает 10-15 минут через OAuth.",
                  "Полная настройка с проверкой качества данных — 1-2 дня. Мы помогаем с онбордингом на всех тарифах.",
                ]}
              />
              <FaqItem
                q="Какие CRM поддерживаются?"
                a={[
                  "amoCRM, Bitrix24, HubSpot, Salesforce, Pipedrive и другие через API.",
                  "Также поддерживаем прямую интеграцию с PostgreSQL и BigQuery для кастомных хранилищ.",
                ]}
              />
              <FaqItem
                q="Есть ли бесплатный период?"
                a={[
                  "Да, 14 дней бесплатно на любом тарифе. Карта не требуется.",
                  "После окончания триала можете выбрать подходящий план или продолжить на бесплатном с ограничениями.",
                ]}
              />
            </div>
          </FadeIn>
        </div>
      </section>

      {/* FINAL CTA */}
      <section className="py-20 px-6">
        <div className="mx-auto max-w-4xl">
          <FadeIn>
            <div className="bg-gradient-to-br from-emerald-500/10 to-blue-500/10 border border-white/10 rounded-3xl p-12 text-center relative overflow-hidden">
              <div className="absolute inset-0 bg-[url('data:image/svg+xml;base64,PHN2ZyB3aWR0aD0iNjAiIGhlaWdodD0iNjAiIHZpZXdCb3g9IjAgMCA2MCA2MCIgeG1sbnM9Imh0dHA6Ly93d3cudzMub3JnLzIwMDAvc3ZnIj48ZyBmaWxsPSJub25lIiBmaWxsLXJ1bGU9ImV2ZW5vZGQiPjxwYXRoIGQ9Ik0wIDBoNjB2NjBIMHoiLz48Y2lyY2xlIGZpbGw9InJnYmEoMjU1LDI1NSwyNTUsMC4wMykiIGN4PSIzMCIgY3k9IjMwIiByPSIxIi8+PC9nPjwvc3ZnPg==')] opacity-50" />
              <div className="relative">
                <h2 className="text-3xl md:text-4xl font-bold text-white mb-4">
                  Готовы видеть реальные цифры?
                </h2>
                <p className="text-lg text-white/55 mb-8 max-w-xl mx-auto">
                  Подключите источники за 15 минут и начните принимать решения на основе данных, а не отчётов кабинетов.
                </p>
                <div className="flex flex-wrap justify-center gap-4">
                  <button
                    onClick={() => scrollToSection("pricing")}
                    className="inline-flex items-center px-8 py-4 text-sm font-semibold text-[#0B0D12] bg-gradient-to-r from-emerald-400 to-emerald-500 hover:from-emerald-300 hover:to-emerald-400 rounded-xl transition-all shadow-lg shadow-emerald-500/20 hover:shadow-emerald-500/40"
                  >
                    Начать бесплатно
                    <svg className="w-4 h-4 ml-2" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 8l4 4m0 0l-4 4m4-4H3" />
                    </svg>
                  </button>
                  <Link
                    href="/contact"
                    className="inline-flex items-center px-8 py-4 text-sm font-semibold text-white/80 bg-white/5 hover:bg-white/10 border border-white/10 rounded-xl transition-all"
                  >
                    Связаться с нами
                  </Link>
                </div>
              </div>
            </div>
          </FadeIn>
        </div>
      </section>

      {/* FOOTER */}
      <footer className="py-12 px-6 border-t border-white/5">
        <div className="mx-auto max-w-7xl">
          <div className="flex flex-col md:flex-row items-center justify-between gap-6">
            <div className="flex items-center gap-2.5">
              <div className="h-8 w-8 rounded-lg bg-gradient-to-br from-emerald-400 to-emerald-600 flex items-center justify-center">
                <span className="text-white font-bold text-sm">B</span>
              </div>
              <span className="text-lg font-bold text-white">BoardIQ</span>
            </div>
            <div className="flex items-center gap-6 text-sm text-white/40">
              <Link href="/privacy" className="hover:text-white transition">
                Конфиденциальность
              </Link>
              <Link href="/terms" className="hover:text-white transition">
                Условия
              </Link>
              <Link href="/contact" className="hover:text-white transition">
                Контакты
              </Link>
            </div>
            <div className="text-sm text-white/30">
              © 2026 BoardIQ. Все права защищены.
            </div>
          </div>
        </div>
      </footer>
    </main>
  );
}
