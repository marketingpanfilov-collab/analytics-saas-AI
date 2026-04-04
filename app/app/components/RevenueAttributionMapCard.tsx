"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { InsightTooltip } from "./InsightTooltip";
import { fmtProjectCurrency, type ProjectCurrency } from "@/app/lib/currency";
import { useBillingBootstrap } from "@/app/app/components/BillingBootstrapProvider";
import { billingActionAllowed } from "@/app/lib/billingBootstrapClient";
import { ActionId } from "@/app/lib/billingUiContract";

type ChannelRow = {
  source: string;
  revenue_closed: number;
  revenue_assisted: number;
  purchases_closed: number;
  purchases_assisted: number;
  total_revenue_influence: number;
};

type Summary = {
  total_closed_revenue: number;
  total_assisted_revenue: number;
  strongest_closer: string | null;
  strongest_influencer: string | null;
};

type ApiResponse =
  | {
      success: true;
      summary: Summary;
      channels: ChannelRow[];
    }
  | {
      success: false;
      error: string;
    };

const CARD_STYLE = {
  borderRadius: 16,
  border: "1px solid rgba(255,255,255,0.10)",
  background: "rgba(255,255,255,0.03)",
  padding: 18,
  boxShadow: "0 20px 60px rgba(0,0,0,0.55)",
  minHeight: 260,
  display: "flex",
  flexDirection: "column",
} as const;

// Revenue map: muted teal (closed), muted amber (assisted)
const BAR_CLOSED = "rgba(91,184,168,0.9)";
const BAR_CLOSED_HOVER = "#6FD1BF";
const BAR_ASSISTED = "rgba(200,169,107,0.9)";
const BAR_ASSISTED_HOVER = "#D9B97A";
const BAR_EMPTY = "rgba(255,255,255,0.06)";
const BAR_HEIGHT = 14;
const BAR_HEIGHT_HOVER = 18;
const BAR_RADIUS = 6; /* track and fill: square corners, not pill */
const BAR_TRANSITION = "transform 0.2s ease";
const TOOLTIP_OFFSET = { x: 12, y: 8 };
const VISIBLE_ROWS = 4;
const ROW_MIN_HEIGHT = 86;
const ROW_GAP = 10;
const VISIBLE_AREA_EXTRA = 12;

const CHANNEL_ROW_BASE = {
  borderRadius: 12,
  border: "1px solid rgba(255,255,255,0.06)",
  background: "rgba(255,255,255,0.02)",
  padding: "10px 12px",
  minHeight: ROW_MIN_HEIGHT,
  boxSizing: "border-box" as const,
  cursor: "default",
  transition: "transform 0.2s ease, border-color 0.2s ease, box-shadow 0.2s ease",
} as const;
const CHANNEL_ROW_HOVER = {
  transform: "scale(1.01)",
  border: "1px solid rgba(255,255,255,0.12)",
  boxShadow: "0 4px 12px rgba(0,0,0,0.15)",
} as const;

const SOURCE_LABELS: Record<string, string> = {
  meta: "Meta Ads",
  google: "Google Ads",
  tiktok: "TikTok Ads",
  direct: "Прямой переход",
  organic_search: "Органический поиск",
  referral: "Реферальный переход",
};

const TOOLTIP_BLOCK_MAIN =
  "Показывает, какие каналы закрывают выручку как последнее касание, а какие участвуют в пути пользователя и влияют на покупку до её завершения.";
const EMPTY_DATA_HELP_TEXT =
  "Если данные должны быть, проверьте источники выручки и атрибуцию покупок.";
const EMPTY_DATA_HELP_STEPS =
  "1) Purchase из Pixel/CRM: value > 0.\n2) UTM-ссылки в рекламе: корректные метки.\n3) Период/фильтры: выбран верный срез.\n4) Синк: завершился и применился.";

function srcLabel(source: string | null | undefined): string {
  if (!source) return "—";
  const key = source.toLowerCase();
  return SOURCE_LABELS[key] ?? source;
}

type Props = {
  projectId: string | null;
  days?: number;
  start?: string | null;
  end?: string | null;
  sources?: string[];
  accountIds?: string[];
};

function insightLabel(closed: number, assisted: number): string {
  const total = closed + assisted;
  if (total === 0) return "—";
  const closedShare = closed / total;
  const assistedShare = assisted / total;
  if (Math.abs(closedShare - assistedShare) < 0.15) return "Баланс влияния";
  if (closed > assisted) return "Чаще закрывает выручку";
  return "Чаще влияет на путь пользователя";
}

export function RevenueAttributionMapCard({
  projectId,
  days = 30,
  start,
  end,
  sources = [],
  accountIds = [],
}: Props) {
  const { resolvedUi } = useBillingBootstrap();
  const [summary, setSummary] = useState<Summary | null>(null);
  const [channels, setChannels] = useState<ChannelRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [projectCurrency, setProjectCurrency] = useState<ProjectCurrency>("USD");
  const [usdToKztRate, setUsdToKztRate] = useState<number | null>(null);
  type SegmentKind = "closed" | "assisted";
  const [tooltip, setTooltip] = useState<{
    channel: ChannelRow;
    segment: SegmentKind;
    x: number;
    y: number;
  } | null>(null);

  const fetchData = useCallback(async () => {
    if (!projectId) {
      setSummary(null);
      setChannels([]);
      setLoading(false);
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const q = new URLSearchParams({
        project_id: projectId,
        days: String(days),
        ...(start ? { start } : {}),
        ...(end ? { end } : {}),
        ...(sources.length ? { sources: sources.join(",") } : {}),
        ...(accountIds.length ? { account_ids: accountIds.join(",") } : {}),
      });
      const res = await fetch(`/api/revenue-attribution-map?${q.toString()}`, { cache: "no-store" });
      const json = (await res.json()) as ApiResponse;
      if (!res.ok || !json.success) {
        setError((json as any)?.error ?? "Ошибка загрузки");
        setSummary(null);
        setChannels([]);
        return;
      }
      setSummary(json.summary);
      setChannels(json.channels ?? []);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Ошибка загрузки");
      setSummary(null);
      setChannels([]);
    } finally {
      setLoading(false);
    }
  }, [projectId, days, start, end, sources, accountIds]);

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
        if (!billingActionAllowed(resolvedUi, ActionId.sync_refresh)) return;
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
  }, [projectCurrency, resolvedUi]);

  const totalPurchases = useMemo(
    () =>
      channels.reduce(
        (acc, ch) => acc + ch.purchases_closed + ch.purchases_assisted,
        0
      ),
    [channels]
  );

  const isEmptyRealData =
    !loading &&
    !error &&
    (summary?.total_closed_revenue ?? 0) === 0 &&
    (summary?.total_assisted_revenue ?? 0) === 0;

  // Block-level: show demo badge only when there is no real revenue data (not by purchase count).
  const isDemo = false;

  const displayChannels = channels.length > 0 ? channels : [];

  // Ranking by total revenue (closed + assisted); single source of truth
  const sortedChannels = useMemo(
    () =>
      [...displayChannels].sort((a, b) => {
        const at = (a.revenue_closed || 0) + (a.revenue_assisted || 0);
        const bt = (b.revenue_closed || 0) + (b.revenue_assisted || 0);
        return bt - at;
      }),
    [displayChannels]
  );

  const totalRevenueAll = useMemo(
    () =>
      sortedChannels.reduce(
        (acc, ch) => acc + (ch.revenue_closed || 0) + (ch.revenue_assisted || 0),
        0
      ),
    [sortedChannels]
  );

  const isActive = !loading && !error && !isEmptyRealData;
  const formatCurrency = (n: number): string => {
    if (!Number.isFinite(n)) return projectCurrency === "KZT" ? "₸0" : "$0";
    return fmtProjectCurrency(n, projectCurrency, usdToKztRate).replace(/\.00$/, "");
  };

  const HEADER_FRAME = {
    margin: "0 -18px 0 -18px",
    padding: "16px 20px",
    borderBottom: "1px solid rgba(255,255,255,0.06)",
    background: "rgba(255,255,255,0.02)",
  } as const;

  return (
    <div style={{ ...CARD_STYLE, display: "flex", flexDirection: "column" }}>
      {/* Header */}
      <div style={HEADER_FRAME}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 8, marginBottom: 4 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
            <h2 style={{ fontWeight: 700, fontSize: 17, margin: 0, color: "rgba(255,255,255,0.95)" }}>
              Карта выручки по атрибуции
            </h2>
            <InsightTooltip text={TOOLTIP_BLOCK_MAIN}>
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
          {isActive && (
            <span
              style={{
                padding: "3px 8px",
                borderRadius: 999,
                fontSize: 10,
                fontWeight: 600,
                background: "rgba(34,197,94,0.18)",
                border: "1px solid rgba(34,197,94,0.6)",
                color: "rgba(34,197,94,0.95)",
                textTransform: "uppercase",
                letterSpacing: 0.4,
              }}
            >
              Активно
            </span>
          )}
        </div>
        <p
          style={{
            fontSize: 12,
            color: "rgba(255,255,255,0.55)",
            margin: 0,
            lineHeight: 1.4,
          }}
        >
          Показывает, какие каналы закрывают выручку и какие участвуют в пути пользователя до покупки.
        </p>
      </div>

      {/* Scrollable body */}
      <div style={{ minHeight: 0 }}>
        {loading ? (
          <div>
            <div
              style={{
                height: 14,
                background: "rgba(255,255,255,0.06)",
                borderRadius: 6,
                marginBottom: 8,
                maxWidth: "80%",
              }}
            />
            {[1, 2, 3].map((i) => (
              <div
                key={i}
                style={{
                  height: 52,
                  background: "rgba(255,255,255,0.05)",
                  borderRadius: 8,
                  marginBottom: 6,
                }}
              />
            ))}
          </div>
        ) : error ? (
          <div style={{ minHeight: 140, display: "flex", alignItems: "center", justifyContent: "center", textAlign: "center", padding: "0 16px" }}>
            <p style={{ color: "rgba(255,180,140,0.9)", fontSize: 12, margin: 0 }}>
              {error}
            </p>
          </div>
        ) : isEmptyRealData ? (
          <div style={{ minHeight: 140, display: "flex", alignItems: "center", justifyContent: "center", textAlign: "center", padding: "0 16px" }}>
            <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 8 }}>
              <p style={{ color: "rgba(255,255,255,0.7)", fontSize: 12, margin: 0 }}>
                Нет данных выручки по атрибуции за выбранный период.
              </p>
              <InsightTooltip text={EMPTY_DATA_HELP_TEXT} secondary={EMPTY_DATA_HELP_STEPS}>
                <span style={{ fontSize: 12, color: "rgba(255,255,255,0.58)", textDecoration: "underline dotted", cursor: "help" }}>
                  Почему так и что проверить?
                </span>
              </InsightTooltip>
            </div>
          </div>
        ) : (
          <div
            className="scrollbar-hidden"
            style={{
              overflowY: "auto",
              maxHeight:
                VISIBLE_ROWS * ROW_MIN_HEIGHT + (VISIBLE_ROWS - 1) * ROW_GAP + VISIBLE_AREA_EXTRA,
              paddingRight: 6,
              scrollbarWidth: "thin",
              scrollbarColor: "rgba(255,255,255,0.15) transparent",
            }}
          >
            <div style={{ display: "flex", flexDirection: "column", gap: ROW_GAP }}>
              {sortedChannels.map((ch, index) => {
                const closed = ch.revenue_closed || 0;
                const assisted = ch.revenue_assisted || 0;
                const totalChannel = closed + assisted;
                const isHovered = tooltip?.channel === ch;
                const sharePct =
                  totalRevenueAll > 0 && totalChannel >= 0
                    ? Math.round((totalChannel / totalRevenueAll) * 100)
                    : 0;
                const rank = index + 1;
                // Bar segments: proportion of this channel's total (closed vs assisted)
                const sum = totalChannel || 1;
                const pClosed = totalChannel > 0 ? (closed / sum) * 100 : 0;
                const pAssist = totalChannel > 0 ? (assisted / sum) * 100 : 0;

                const hoveredClosed = isHovered && tooltip?.segment === "closed";
                const hoveredAssisted = isHovered && tooltip?.segment === "assisted";

                return (
                  <div
                    key={ch.source}
                    style={{
                      ...CHANNEL_ROW_BASE,
                      ...(isHovered ? CHANNEL_ROW_HOVER : {}),
                    }}
                  >
                    <div
                      style={{
                        display: "flex",
                        alignItems: "center",
                        justifyContent: "space-between",
                        gap: 8,
                        marginBottom: 4,
                      }}
                    >
                      <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                        <span
                          style={{
                            minWidth: 20,
                            height: 20,
                            borderRadius: 6,
                            border: `1px solid ${rank <= 3 ? (rank === 1 ? "#C7A86C" : rank === 2 ? "#A9B0B8" : "#A06A4F") : "rgba(255,255,255,0.08)"}`,
                            display: "inline-flex",
                            alignItems: "center",
                            justifyContent: "center",
                            fontSize: 10,
                            fontWeight: 600,
                            color: rank <= 3 ? (rank === 1 ? "#C7A86C" : rank === 2 ? "#A9B0B8" : "#A06A4F") : "rgba(255,255,255,0.5)",
                            background: rank <= 3 ? (rank === 1 ? "#C7A86C22" : rank === 2 ? "#A9B0B822" : "#A06A4F22") : "rgba(255,255,255,0.03)",
                          }}
                        >
                          #{rank}
                        </span>
                        <span
                          style={{
                            fontWeight: 600,
                            fontSize: 13,
                            color: "rgba(255,255,255,0.95)",
                          }}
                        >
                          {srcLabel(ch.source)}
                        </span>
                      </div>
                      <div
                        style={{
                          display: "flex",
                          alignItems: "baseline",
                          gap: 6,
                          fontSize: 12,
                          color: "rgba(255,255,255,0.75)",
                        }}
                      >
                        <span>{formatCurrency(totalChannel)}</span>
                        {sharePct >= 0 && (
                          <span
                            style={{
                              fontSize: 11,
                              color: "rgba(255,255,255,0.45)",
                            }}
                          >
                            {sharePct}%
                          </span>
                        )}
                      </div>
                    </div>
                    <div
                      style={{
                        fontSize: 11,
                        color: "rgba(255,255,255,0.6)",
                        marginBottom: 6,
                      }}
                    >
                      Закрытая выручка {formatCurrency(closed)} • Выручка с участием {formatCurrency(assisted)}
                    </div>
                    <div
                      style={{
                        marginTop: 6,
                        height: BAR_HEIGHT,
                        borderRadius: BAR_RADIUS,
                        background: BAR_EMPTY,
                        overflow: "visible",
                        display: "flex",
                        width: "100%",
                        alignItems: "center",
                      }}
                    >
                      {pClosed > 0 && (
                        <div
                          style={{
                            width: `${pClosed}%`,
                            minWidth: 4,
                            height: "100%",
                            display: "flex",
                            alignItems: "center",
                            justifyContent: "center",
                            cursor: "pointer",
                            borderRadius: 0,
                          }}
                          onMouseEnter={(e) =>
                            setTooltip({
                              channel: ch,
                              segment: "closed",
                              x: e.clientX + TOOLTIP_OFFSET.x,
                              y: e.clientY + TOOLTIP_OFFSET.y,
                            })
                          }
                          onMouseMove={(e) =>
                            setTooltip((prev) =>
                              prev?.channel === ch && prev?.segment === "closed"
                                ? { ...prev, x: e.clientX + TOOLTIP_OFFSET.x, y: e.clientY + TOOLTIP_OFFSET.y }
                                : prev
                            )
                          }
                          onMouseLeave={() => setTooltip(null)}
                        >
                          <div
                            style={{
                              width: "100%",
                              height: "100%",
                              background: hoveredClosed ? BAR_CLOSED_HOVER : BAR_CLOSED,
                              borderRadius: BAR_RADIUS,
                              transition: `${BAR_TRANSITION}, background 0.2s ease`,
                              transform: hoveredClosed ? `scaleY(${BAR_HEIGHT_HOVER / BAR_HEIGHT})` : "scaleY(1)",
                              transformOrigin: "bottom",
                              opacity: isHovered && !hoveredClosed ? 0.65 : 1,
                            }}
                          />
                        </div>
                      )}
                      {pAssist > 0 && (
                        <div
                          style={{
                            width: `${pAssist}%`,
                            minWidth: 4,
                            height: "100%",
                            display: "flex",
                            alignItems: "center",
                            justifyContent: "center",
                            cursor: "pointer",
                            borderRadius: 0,
                          }}
                          onMouseEnter={(e) =>
                            setTooltip({
                              channel: ch,
                              segment: "assisted",
                              x: e.clientX + TOOLTIP_OFFSET.x,
                              y: e.clientY + TOOLTIP_OFFSET.y,
                            })
                          }
                          onMouseMove={(e) =>
                            setTooltip((prev) =>
                              prev?.channel === ch && prev?.segment === "assisted"
                                ? { ...prev, x: e.clientX + TOOLTIP_OFFSET.x, y: e.clientY + TOOLTIP_OFFSET.y }
                                : prev
                            )
                          }
                          onMouseLeave={() => setTooltip(null)}
                        >
                          <div
                            style={{
                              width: "100%",
                              height: "100%",
                              background: hoveredAssisted ? BAR_ASSISTED_HOVER : BAR_ASSISTED,
                              borderRadius: BAR_RADIUS,
                              transition: `${BAR_TRANSITION}, background 0.2s ease`,
                              transform: hoveredAssisted ? `scaleY(${BAR_HEIGHT_HOVER / BAR_HEIGHT})` : "scaleY(1)",
                              transformOrigin: "bottom",
                              opacity: isHovered && !hoveredAssisted ? 0.65 : 1,
                            }}
                          />
                        </div>
                      )}
                    </div>
                    <div
                      style={{
                        fontSize: 12,
                        color: "rgba(255,255,255,0.55)",
                        marginTop: 6,
                      }}
                    >
                      {insightLabel(closed, assisted)}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        )}
      </div>

      {tooltip && (() => {
        const c = tooltip.channel;
        const closed = c.revenue_closed || 0;
        const assisted = c.revenue_assisted || 0;
        const tot = closed + assisted;
        const closedSharePct = tot > 0 ? Math.round((closed / tot) * 100) : 0;
        const assistedSharePct = tot > 0 ? Math.round((assisted / tot) * 100) : 0;
        const isClosed = tooltip.segment === "closed";
        return (
          <div
            role="tooltip"
            style={{
              position: "fixed",
              left: tooltip.x,
              top: tooltip.y,
              zIndex: 9999,
              padding: "12px 14px",
              borderRadius: 12,
              background: "rgba(18,18,24,0.98)",
              border: "1px solid rgba(255,255,255,0.10)",
              boxShadow: "0 12px 40px rgba(0,0,0,0.45)",
              fontSize: 12,
              color: "rgba(255,255,255,0.9)",
              lineHeight: 1.5,
              maxWidth: 280,
              pointerEvents: "none",
            }}
          >
            <div style={{ marginBottom: 8, fontWeight: 600, fontSize: 13 }}>
              {srcLabel(c.source)}
            </div>
            {isClosed ? (
              <>
                <div style={{ marginBottom: 4, color: "rgba(255,255,255,0.75)" }}>
                  Закрытая выручка: {formatCurrency(closed)}
                </div>
                <div style={{ marginBottom: 6, color: "rgba(255,255,255,0.75)" }}>
                  Доля закрытых продаж: {closedSharePct}%
                </div>
                <div style={{ color: "rgba(255,255,255,0.6)", fontSize: 11 }}>
                  Канал является последним касанием перед покупкой.
                </div>
              </>
            ) : (
              <>
                <div style={{ marginBottom: 4, color: "rgba(255,255,255,0.75)" }}>
                  Выручка с участием: {formatCurrency(assisted)}
                </div>
                <div style={{ marginBottom: 6, color: "rgba(255,255,255,0.75)" }}>
                  Доля участия в пути: {assistedSharePct}%
                </div>
                <div style={{ color: "rgba(255,255,255,0.6)", fontSize: 11 }}>
                  Канал участвует в пути пользователя, но не является финальным касанием.
                </div>
              </>
            )}
          </div>
        );
      })()}
    </div>
  );
}

