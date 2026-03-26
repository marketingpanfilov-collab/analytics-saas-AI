"use client";

import { useEffect, useState, useCallback } from "react";
import Link from "next/link";
import { InsightTooltip } from "./InsightTooltip";
import { fmtProjectCurrency, type ProjectCurrency } from "@/app/lib/currency";

type PathRow = {
  path_label: string;
  conversions_count: number;
  purchases_count: number;
  registrations_count: number;
  revenue_total: number;
};

/** Единый стиль карточки с AssistedAttributionCard */
const CARD_STYLE = {
  borderRadius: 16,
  border: "1px solid rgba(255,255,255,0.10)",
  background: "rgba(255,255,255,0.03)",
  padding: 18,
  boxShadow: "0 20px 60px rgba(0,0,0,0.55)",
} as const;

const TOOLTIP_MAIN =
  "Путь показывает последовательность источников, через которые пользователь прошёл до конверсии.";
const TOOLTIP_SECONDARY =
  "Например, пользователь мог сначала прийти из рекламы, затем вернуться напрямую и только потом совершить покупку.";

/** Демо-пути, когда API вернул пусто — показывают смысл блока. */
const DEMO_PATHS: PathRow[] = [
  { path_label: "Meta Ads → Прямой переход → Покупка", conversions_count: 18, purchases_count: 18, registrations_count: 0, revenue_total: 4200 },
  { path_label: "Google Ads → Регистрация → Покупка", conversions_count: 9, purchases_count: 9, registrations_count: 9, revenue_total: 1850 },
  { path_label: "TikTok Ads → Органический поиск → Покупка", conversions_count: 5, purchases_count: 5, registrations_count: 0, revenue_total: 900 },
  { path_label: "Meta Ads → Google Ads → Регистрация", conversions_count: 4, purchases_count: 0, registrations_count: 4, revenue_total: 0 },
  { path_label: "Прямой переход → Покупка", conversions_count: 3, purchases_count: 3, registrations_count: 0, revenue_total: 650 },
];

type Props = { projectId: string | null; days?: number; limit?: number };

export default function TopAttributionPathsCard({ projectId, days = 30, limit = 5 }: Props) {
  const [paths, setPaths] = useState<PathRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [projectCurrency, setProjectCurrency] = useState<ProjectCurrency>("USD");
  const [usdToKztRate, setUsdToKztRate] = useState<number | null>(null);

  const fetchData = useCallback(async () => {
    if (!projectId) {
      setPaths([]);
      setLoading(false);
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(
        `/api/top-attribution-paths?project_id=${encodeURIComponent(projectId)}&days=${days}&limit=${limit}`,
        { cache: "no-store" }
      );
      const json = await res.json();
      if (!res.ok || !json?.success) {
        setError(json?.error ?? "Ошибка загрузки");
        setPaths([]);
        return;
      }
      setPaths(Array.isArray(json.paths) ? json.paths : []);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Ошибка загрузки");
      setPaths([]);
    } finally {
      setLoading(false);
    }
  }, [projectId, days, limit]);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  useEffect(() => {
    if (!projectId) return;
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch(`/api/projects/currency?project_id=${encodeURIComponent(projectId)}`, {
          cache: "no-store",
        });
        const json = await res.json();
        if (cancelled) return;
        if (res.ok && json?.success && typeof json.currency === "string") {
          setProjectCurrency(json.currency.toUpperCase() === "KZT" ? "KZT" : "USD");
        }
      } catch {
        if (!cancelled) setProjectCurrency("USD");
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [projectId]);

  useEffect(() => {
    if (projectCurrency !== "KZT") {
      setUsdToKztRate(null);
      return;
    }
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch("/api/system/update-rates", { method: "POST" });
        const json = await res.json();
        if (cancelled) return;
        const rate = Number(json?.rate ?? 0);
        setUsdToKztRate(res.ok && json?.success && rate > 0 ? rate : null);
      } catch {
        if (!cancelled) setUsdToKztRate(null);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [projectCurrency]);

  const isDemo = !loading && !error && paths.length === 0;
  const displayPaths = paths.length > 0 ? paths : DEMO_PATHS;
  const formatRevenue = (n: number): string => {
    if (n === 0) return "";
    return fmtProjectCurrency(n, projectCurrency, usdToKztRate).replace(/\.00$/, "");
  };

  const HEADER_FRAME = {
    margin: "0 -18px 0 -18px",
    padding: "16px 20px",
    borderBottom: "1px solid rgba(255,255,255,0.06)",
    background: "rgba(255,255,255,0.02)",
  } as const;

  return (
    <div style={CARD_STYLE}>
      {/* Header */}
      <div style={HEADER_FRAME}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 8, marginBottom: 4 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
            <h2 style={{ fontWeight: 700, fontSize: 17, margin: 0, color: "rgba(255,255,255,0.95)" }}>
              Топ путей атрибуции
            </h2>
            <InsightTooltip text={TOOLTIP_MAIN} secondary={TOOLTIP_SECONDARY}>
              <span
                style={{
                  display: "inline-flex",
                  width: 16,
                  height: 16,
                  borderRadius: "50%",
                  border: "1px solid rgba(255,255,255,0.22)",
                  color: "rgba(255,255,255,0.5)",
                  fontSize: 11,
                  fontWeight: 600,
                  alignItems: "center",
                  justifyContent: "center",
                  flexShrink: 0,
                }}
                aria-label="Подсказка"
              >
                ?
              </span>
            </InsightTooltip>
          </div>
          {isDemo && (
            <span
              style={{
                padding: "3px 8px",
                borderRadius: 6,
                fontSize: 10,
                fontWeight: 600,
                background: "rgba(248,113,113,0.18)",
                border: "1px solid rgba(248,113,113,0.5)",
                color: "rgba(248,113,113,0.95)",
                textTransform: "uppercase",
                letterSpacing: 0.4,
              }}
            >
              DEMO PATH DATA
            </span>
          )}
        </div>
        <p style={{ fontSize: 12, color: "rgba(255,255,255,0.55)", margin: 0, lineHeight: 1.4 }}>
          Показывает самые частые маршруты пользователей до регистрации и покупки.
        </p>
      </div>

      {loading ? (
        <div style={{ marginBottom: 12 }}>
          {[1, 2, 3, 4, 5].map((i) => (
            <div
              key={i}
              style={{ height: 48, background: "rgba(255,255,255,0.05)", borderRadius: 8, marginBottom: 6 }}
            />
          ))}
        </div>
      ) : error ? (
        <p style={{ color: "rgba(255,180,140,0.9)", fontSize: 12, marginBottom: 12 }}>{error}</p>
      ) : (
        <>
          {/* 3. Микропояснение */}
          <p style={{ fontSize: 11, color: "rgba(255,255,255,0.45)", marginBottom: 10, lineHeight: 1.35 }}>
            Маршрут показывает, через какие источники пользователь прошёл до конверсии.
          </p>

          {/* 4. Список путей */}
          <ul style={{ listStyle: "none", margin: 0, padding: 0, marginBottom: 12 }}>
            {displayPaths.map((row, index) => {
              const rank = index + 1;
              const isTop = rank <= 3;
              const revenueStr = formatRevenue(row.revenue_total);
              const secondary = [
                `${row.conversions_count} конверсий`,
                revenueStr ? revenueStr : null,
              ].filter(Boolean).join(" · ");
              return (
                <li
                  key={`${row.path_label}-${index}`}
                  style={{
                    borderBottom: index < displayPaths.length - 1 ? "1px solid rgba(255,255,255,0.06)" : "none",
                    padding: "10px 0",
                  }}
                >
                  <div style={{ display: "flex", alignItems: "flex-start", gap: 10 }}>
                    <span
                      style={{
                        flexShrink: 0,
                        width: 22,
                        height: 22,
                        borderRadius: 6,
                        background: isTop ? "rgba(255,255,255,0.1)" : "rgba(255,255,255,0.05)",
                        color: isTop ? "rgba(255,255,255,0.95)" : "rgba(255,255,255,0.6)",
                        fontSize: 11,
                        fontWeight: 700,
                        display: "inline-flex",
                        alignItems: "center",
                        justifyContent: "center",
                      }}
                    >
                      #{rank}
                    </span>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div
                        style={{
                          fontSize: 13,
                          fontWeight: isTop ? 600 : 500,
                          color: isTop ? "rgba(255,255,255,0.95)" : "rgba(255,255,255,0.88)",
                          lineHeight: 1.4,
                        }}
                      >
                        {row.path_label}
                      </div>
                      <div
                        style={{
                          fontSize: 12,
                          color: "rgba(255,255,255,0.5)",
                          marginTop: 4,
                        }}
                      >
                        {secondary}
                      </div>
                    </div>
                  </div>
                </li>
              );
            })}
          </ul>

          {/* 5. CTA */}
          <Link
            href={projectId ? `/app/attribution-debugger?project_id=${encodeURIComponent(projectId)}` : "/app/attribution-debugger"}
            style={{
              display: "inline-flex",
              alignItems: "center",
              padding: "8px 14px",
              borderRadius: 10,
              border: "1px solid rgba(255,255,255,0.10)",
              background: "rgba(255,255,255,0.04)",
              color: "rgba(255,255,255,0.82)",
              fontSize: 12,
              fontWeight: 600,
              textDecoration: "none",
            }}
          >
            Смотреть все цепочки
          </Link>
        </>
      )}
    </div>
  );
}
