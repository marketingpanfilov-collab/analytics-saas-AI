"use client";

import Link from "next/link";
import { usePathname, useSearchParams } from "next/navigation";
import { useMemo, useState, useEffect, useCallback } from "react";

const itemStyle = (active: boolean) => ({
  display: "block",
  padding: "10px 12px",
  borderRadius: 10,
  textDecoration: "none",
  color: "white",
  background: active ? "rgba(255,255,255,0.10)" : "transparent",
  border: active ? "1px solid rgba(255,255,255,0.10)" : "1px solid transparent",
});

const cardStyle = {
  borderRadius: 18,
  border: "1px solid rgba(255,255,255,0.10)",
  background:
    "radial-gradient(700px 240px at 30% 0%, rgba(120,120,255,0.18), transparent 60%), rgba(255,255,255,0.03)",
  boxShadow: "0 18px 60px rgba(0,0,0,0.45)",
  padding: 14,
  overflow: "hidden", // ✅ фикс: чтобы «Сегодня» не раздувал/не ломал ширину сайдбара
};

function badgeColor(deltaPct: number) {
  if (deltaPct <= 0) return "rgba(110,255,200,0.10)";
  return "rgba(255,120,120,0.10)";
}
function badgeBorder(deltaPct: number) {
  if (deltaPct <= 0) return "rgba(110,255,200,0.25)";
  return "rgba(255,120,120,0.25)";
}
function badgeText(deltaPct: number) {
  if (deltaPct <= 0) return "rgba(140,255,210,0.95)";
  return "rgba(255,170,170,0.95)";
}

function fmtKzt(n: number) {
  return new Intl.NumberFormat("ru-RU").format(Math.round(n)) + " ₸";
}
function fmtPct(n: number) {
  return n.toFixed(1).replace(".", ",") + "%";
}

type MetricKey = "spend" | "sales" | "roas" | "cac" | "cpr";

type Metric = {
  key: MetricKey;
  title: string;
  fact: number;
  plan: number;
  format: "kzt" | "num" | "roas";
};

function formatValue(m: Metric, v: number) {
  if (m.format === "kzt") return fmtKzt(v).replace(" ₸", "₸");
  if (m.format === "roas") return String(v).replace(".", ",");
  return new Intl.NumberFormat("ru-RU").format(Math.round(v));
}

function deltaPct(fact: number, plan: number) {
  if (!plan) return 0;
  return ((fact - plan) / plan) * 100;
}

function MetricRow({ m }: { m: Metric }) {
  const d = deltaPct(m.fact, m.plan);
  const sign = d > 0 ? "+" : "";
  return (
    <div
      style={{
        padding: 12,
        borderRadius: 14,
        border: "1px solid rgba(255,255,255,0.10)",
        background: "rgba(255,255,255,0.02)",
        minWidth: 0, // ✅ фикс: даём блоку сжиматься в узком сайдбаре
      }}
    >
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          gap: 10,
          alignItems: "center",
          minWidth: 0, // ✅ фикс
        }}
      >
        <div
          style={{
            fontWeight: 900,
            minWidth: 0, // ✅ фикс
            overflow: "hidden", // ✅ фикс
            textOverflow: "ellipsis", // ✅ фикс
            whiteSpace: "nowrap", // ✅ фикс
          }}
        >
          {m.title}
        </div>

        <div
          style={{
            display: "inline-flex",
            alignItems: "center",
            gap: 5,
            padding: "4px 8px",
            borderRadius: 999,
            background: badgeColor(d),
            border: `1px solid ${badgeBorder(d)}`,
            color: badgeText(d),
            fontWeight: 900,
            fontSize: 11,
            lineHeight: 1.2,
            whiteSpace: "nowrap",
            flexShrink: 0,
          }}
          title="Отклонение факт vs план"
        >
          {sign}
          {fmtPct(d)}
          <span
            style={{
              width: 6,
              height: 6,
              borderRadius: 999,
              background: badgeText(d),
              opacity: 0.9,
              flexShrink: 0,
            }}
          />
        </div>
      </div>

      <div style={{ display: "grid", gap: 6, marginTop: 10, minWidth: 0 }}>
        <div
          style={{
            display: "flex",
            justifyContent: "space-between",
            gap: 10,
            opacity: 0.75,
            minWidth: 0, // ✅ фикс
          }}
        >
          <span style={{ minWidth: 0 }}>Факт</span>
          <span
            style={{
              fontWeight: 900,
              opacity: 1,
              whiteSpace: "nowrap", // ✅ фикс: не переносим числа
              fontVariantNumeric: "tabular-nums", // ✅ фикс: стабильная ширина цифр
              flexShrink: 0, // ✅ фикс
            }}
          >
            {formatValue(m, m.fact)}
          </span>
        </div>

        <div
          style={{
            display: "flex",
            justifyContent: "space-between",
            gap: 10,
            opacity: 0.75,
            minWidth: 0, // ✅ фикс
          }}
        >
          <span style={{ minWidth: 0 }}>План</span>
          <span
            style={{
              fontWeight: 900,
              opacity: 1,
              whiteSpace: "nowrap",
              fontVariantNumeric: "tabular-nums",
              flexShrink: 0,
            }}
          >
            {formatValue(m, m.plan)}
          </span>
        </div>
      </div>
    </div>
  );
}

function safeGetProjectIdFromStorage() {
  try {
    return localStorage.getItem("active_project_id");
  } catch {
    return null;
  }
}
function safeSetProjectIdToStorage(v: string) {
  try {
    localStorage.setItem("active_project_id", v);
  } catch {}
}

function todayYmd() {
  const d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

const TODAY_SPEND_PLAN_USD = 20;

function fmtUsd(n: number) {
  return "$" + n.toFixed(2).replace(/\B(?=(\d{3})+(?!\d))/g, ",");
}

type TodaySpendCardProps = {
  todaySpend: number | null;
};

function TodaySpendCard({ todaySpend }: TodaySpendCardProps) {
  const plan = TODAY_SPEND_PLAN_USD;
  const fact = todaySpend ?? 0;
  const delta = fact - plan;
  const overPlan = fact > plan;
  const pillRed = overPlan;
  const pillYellow = !overPlan;

  return (
    <div
      style={{
        padding: 12,
        borderRadius: 14,
        border: "1px solid rgba(255,255,255,0.10)",
        background: "rgba(255,255,255,0.02)",
        minWidth: 0,
      }}
    >
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          gap: 10,
          alignItems: "center",
          minWidth: 0,
        }}
      >
        <div style={{ fontWeight: 900, minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
          Расход
        </div>
        <div
          style={{
            display: "inline-flex",
            alignItems: "center",
            gap: 5,
            padding: "4px 8px",
            borderRadius: 999,
            background: pillRed ? "rgba(220,38,38,0.18)" : "rgba(234,179,8,0.18)",
            border: `1px solid ${pillRed ? "rgba(220,38,38,0.45)" : "rgba(234,179,8,0.45)"}`,
            color: pillRed ? "rgba(255,200,200,0.98)" : "rgba(250,230,150,0.98)",
            fontWeight: 900,
            fontSize: 11,
            lineHeight: 1.2,
            whiteSpace: "nowrap",
            flexShrink: 0,
          }}
          title="Отклонение факт vs план"
        >
          {delta >= 0 ? "+" : ""}
          {fmtUsd(delta)}
        </div>
      </div>
      <div style={{ display: "grid", gap: 6, marginTop: 10, minWidth: 0 }}>
        <div
          style={{
            display: "flex",
            justifyContent: "space-between",
            gap: 10,
            opacity: 0.75,
            minWidth: 0,
          }}
        >
          <span style={{ minWidth: 0 }}>Факт</span>
          <span
            style={{
              fontWeight: 900,
              opacity: 1,
              whiteSpace: "nowrap",
              fontVariantNumeric: "tabular-nums",
              flexShrink: 0,
            }}
          >
            {todaySpend != null ? fmtUsd(todaySpend) : "—"}
          </span>
        </div>
        <div
          style={{
            display: "flex",
            justifyContent: "space-between",
            gap: 10,
            opacity: 0.75,
            minWidth: 0,
          }}
        >
          <span style={{ minWidth: 0 }}>План</span>
          <span
            style={{
              fontWeight: 900,
              opacity: 1,
              whiteSpace: "nowrap",
              fontVariantNumeric: "tabular-nums",
              flexShrink: 0,
            }}
          >
            {fmtUsd(plan)}
          </span>
        </div>
      </div>
    </div>
  );
}

export default function Sidebar() {
  const pathname = usePathname();
  const searchParams = useSearchParams();

  const [todayOpen, setTodayOpen] = useState(false);
  const [projectId, setProjectId] = useState<string | null>(null);
  const [todaySpend, setTodaySpend] = useState<number | null>(null);

  useEffect(() => {
    const fromUrl = searchParams.get("project_id");
    if (fromUrl) {
      setProjectId(fromUrl);
      safeSetProjectIdToStorage(fromUrl);
      return;
    }
    const fromStore = safeGetProjectIdFromStorage();
    if (fromStore) setProjectId(fromStore);
  }, [searchParams]);

  const fetchTodaySpend = useCallback(async () => {
    if (!projectId) {
      setTodaySpend(null);
      return;
    }
    const today = todayYmd();
    try {
      const res = await fetch(
        `/api/dashboard/summary?project_id=${encodeURIComponent(projectId)}&start=${today}&end=${today}`,
        { cache: "no-store" }
      );
      const json = (await res.json()) as { success?: boolean; totals?: { spend?: number } };
      if (json?.success && json?.totals) {
        const spend = Number(json.totals.spend ?? 0) || 0;
        setTodaySpend(spend);
      } else {
        setTodaySpend(null);
      }
    } catch {
      setTodaySpend(null);
    }
  }, [projectId]);

  const startParam = searchParams.get("start");
  const endParam = searchParams.get("end");

  useEffect(() => {
    if (!projectId) return;
    fetchTodaySpend();
  }, [projectId, startParam, endParam, fetchTodaySpend]);

  useEffect(() => {
    if (!projectId) return;
    const interval = setInterval(fetchTodaySpend, 30 * 60 * 1000);
    return () => clearInterval(interval);
  }, [projectId, fetchTodaySpend]);

  const withProjectId = useCallback(
    (path: string) => {
      if (!projectId) return path;
      const hasQuery = path.includes("?");
      const sep = hasQuery ? "&" : "?";
      return `${path}${sep}project_id=${encodeURIComponent(projectId)}`;
    },
    [projectId]
  );

  const metrics: Metric[] = useMemo(
    () => [
      { key: "sales", title: "Продажи", fact: 28, plan: 35, format: "num" },
      { key: "roas", title: "ROAS", fact: 4.23, plan: 4.5, format: "roas" },
      { key: "cac", title: "CAC", fact: 35_000, plan: 32_000, format: "kzt" },
      { key: "cpr", title: "CPR", fact: 4_455, plan: 4_200, format: "kzt" },
    ],
    []
  );

  const visibleTop = metrics.filter((m) => m.key === "sales");
  const hidden = metrics.filter((m) => m.key !== "sales");

  return (
    <aside
      style={{
        padding: 16,
        borderRight: "1px solid rgba(255,255,255,0.08)",
        background:
          "radial-gradient(800px 260px at 30% 0%, rgba(120,120,255,0.16), transparent 60%), linear-gradient(180deg, rgba(255,255,255,0.05), rgba(255,255,255,0.01))",
        minWidth: 260,
        width: 260,
        maxWidth: 260,
      }}
    >
      <div style={{ fontWeight: 900, fontSize: 16, marginBottom: 12 }}>Analytics SaaS</div>

      {/* Сегодня */}
      <div style={{ ...cardStyle, padding: 14, marginBottom: 14 }}>
        <button
          type="button"
          onClick={() => setTodayOpen((v) => !v)}
          style={{
            width: "100%",
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            gap: 10,
            background: "transparent",
            border: "none",
            color: "white",
            padding: 0,
            cursor: "pointer",
            minWidth: 0, // ✅ фикс: кнопка тоже может сжиматься
          }}
        >
          <div style={{ fontSize: 34, fontWeight: 900, lineHeight: 1.05, minWidth: 0 }}>
            Сегодня
          </div>

          <div
            style={{
              width: 34,
              height: 34,
              borderRadius: 12,
              border: "1px solid rgba(255,255,255,0.10)",
              background: "rgba(255,255,255,0.03)",
              display: "grid",
              placeItems: "center",
              transform: todayOpen ? "rotate(180deg)" : "rotate(0deg)",
              transition: "transform 160ms ease",
              flexShrink: 0, // ✅ фикс: иконка не «давит» на текст
            }}
            aria-hidden="true"
          >
            ▾
          </div>
        </button>

        <div style={{ display: "grid", gap: 10, marginTop: 12, minWidth: 0 }}>
          <TodaySpendCard todaySpend={todaySpend} />
          {visibleTop.map((m) => (
            <MetricRow key={m.key} m={m} />
          ))}

          {todayOpen ? (
            <div style={{ display: "grid", gap: 10, minWidth: 0 }}>
              {hidden.map((m) => (
                <MetricRow key={m.key} m={m} />
              ))}
              <div style={{ opacity: 0.55, fontSize: 12, marginTop: 2 }}>
                * пока заглушка (план/факт подтянем из проекта)
              </div>
            </div>
          ) : (
            <div style={{ opacity: 0.55, fontSize: 12 }}>Показать ROAS / CAC / CPR</div>
          )}
        </div>
      </div>

      {/* Навигация */}
      <div style={{ display: "grid", gap: 8 }}>
        <Link href={withProjectId("/app")} style={itemStyle(pathname === "/app")}>
          📊 Дашборд
        </Link>

        <Link href={withProjectId("/app/reports")} style={itemStyle(pathname.startsWith("/app/reports"))}>
          📑 Отчёты
        </Link>

        <Link href={withProjectId("/app/ltv")} style={itemStyle(pathname.startsWith("/app/ltv"))}>
          📈 LTV
        </Link>

        <Link href={withProjectId("/app/utm-builder")} style={itemStyle(pathname.startsWith("/app/utm-builder"))}>
          🔗 UTM Builder
        </Link>

        <Link href={withProjectId("/app/pixels")} style={itemStyle(pathname.startsWith("/app/pixels"))}>
          🛜 BQ Pixel
        </Link>

        <div
          style={{
            height: 1,
            background: "rgba(255,255,255,0.10)",
            opacity: 0.45,
            margin: "10px 2px",
          }}
        />

        <Link href={withProjectId("/app/accounts")} style={itemStyle(pathname.startsWith("/app/accounts"))}>
          🌎 Аккаунты
        </Link>

        <Link href={withProjectId("/app/sales-data")} style={itemStyle(pathname.startsWith("/app/sales-data"))}>
          🧾 Sales Data
        </Link>

        <Link href={withProjectId("/app/api")} style={itemStyle(pathname.startsWith("/app/api"))}>
          🔑 API
        </Link>

        <Link href={withProjectId("/app/settings")} style={itemStyle(pathname.startsWith("/app/settings"))}>
          ⚙️ Настройки
        </Link>

        <Link href={withProjectId("/app/support")} style={itemStyle(pathname.startsWith("/app/support"))}>
          🛟 Поддержка
        </Link>
      </div>

      <div style={{ marginTop: 18, opacity: 0.6, fontSize: 12 }}>v0.1 — локальная версия</div>
    </aside>
  );
}