"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";

function formatMoney(n: number) {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 2,
    minimumFractionDigits: 0,
  }).format(n);
}

function toISO(d: Date) {
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  return `${yyyy}-${mm}-${dd}`;
}

function fmtRuDate(iso: string) {
  const [y, m, d] = iso.split("-");
  return `${d}.${m}.${y}`;
}

function safeIso(input: any): string | null {
  if (!input) return null;
  const t = Date.parse(String(input));
  if (!Number.isNaN(t)) return new Date(t).toISOString();
  return null;
}

function toErrorText(x: any): string {
  if (!x) return "";
  if (typeof x === "string") return x;
  if (x instanceof Error) return x.message || String(x);
  try {
    return JSON.stringify(x);
  } catch {
    return String(x);
  }
}

function extractApiError(payload: any): string {
  if (!payload) return "";

  const err = payload?.error ?? payload;
  const parts: string[] = [];

  const msg =
    err?.message ||
    err?.sync?.error ||
    payload?.sync?.error ||
    payload?.message ||
    payload?.error_description;

  if (msg) parts.push(String(msg));

  if (err?.code) parts.push(`code=${err.code}`);
  if (err?.details) parts.push(String(err.details));
  if (err?.hint) parts.push(String(err.hint));
  if (err?.type) parts.push(`type=${err.type}`);
  if (err?.fbtrace_id) parts.push(`fbtrace_id=${err.fbtrace_id}`);

  return parts.filter(Boolean).join(" | ");
}

/** Treat as expected cancellation; do not surface as dashboard error. */
function isAbortError(e: unknown): boolean {
  if (!e || typeof e !== "object") return false;
  const name = (e as { name?: string }).name;
  const message = String((e as { message?: string }).message ?? "");
  const code = (e as { code?: number }).code;
  if (name === "AbortError") return true;
  if (name === "DOMException" && (code === 20 || /abort/i.test(message))) return true;
  if (/aborted|signal is aborted/i.test(message)) return true;
  return false;
}

type Summary = {
  spend: number;
  impressions?: number;
  clicks?: number;
};

type Point = {
  date: string;
  spend: number;
};

function SpendLineChart({ points }: { points: Point[] }) {
  const w = 860;
  const h = 280;
  const pad = 22;

  if (!points || points.length < 2) {
    return (
      <div
        style={{
          border: "1px solid rgba(255,255,255,0.10)",
          borderRadius: 16,
          height: h,
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          opacity: 0.78,
        }}
      >
        Нет данных за выбранный период (или sync ещё не записал строки).
      </div>
    );
  }

  const maxSpend = Math.max(...points.map((p) => p.spend), 1);
  const xStep = (w - pad * 2) / (points.length - 1);
  const yMap = (v: number) => pad + (h - pad * 2) * (1 - v);

  const mkPath = (arr: number[], max: number) =>
    arr
      .map((v, i) => {
        const x = pad + i * xStep;
        const y = yMap(v / max);
        return `${i === 0 ? "M" : "L"} ${x.toFixed(2)} ${y.toFixed(2)}`;
      })
      .join(" ");

  const spendPath = mkPath(points.map((p) => p.spend), maxSpend);

  return (
    <div
      style={{
        border: "1px solid rgba(255,255,255,0.10)",
        borderRadius: 16,
        padding: 12,
      }}
    >
      <svg
        width="100%"
        viewBox={`0 0 ${w} ${h}`}
        preserveAspectRatio="none"
        style={{ display: "block" }}
      >
        {Array.from({ length: 5 }).map((_, i) => {
          const y = pad + ((h - pad * 2) * i) / 4;
          return (
            <line
              key={i}
              x1={pad}
              x2={w - pad}
              y1={y}
              y2={y}
              stroke="rgba(255,255,255,0.06)"
              strokeWidth="1"
            />
          );
        })}

        <path d={spendPath} fill="none" stroke="rgba(130,255,200,0.85)" strokeWidth="3" />

        <text x={pad} y={h - 6} fill="rgba(255,255,255,0.55)" fontSize="12">
          {fmtRuDate(points[0].date)}
        </text>
        <text x={w - pad - 80} y={h - 6} fill="rgba(255,255,255,0.55)" fontSize="12">
          {fmtRuDate(points[points.length - 1].date)}
        </text>
      </svg>
    </div>
  );
}

const PLATFORM_LABELS: Record<string, string> = {
  meta: "Meta",
  google: "Google",
  tiktok: "TikTok",
  yandex: "Yandex",
};

type DashboardAccount = {
  id: string;
  name: string | null;
  platform_account_id: string;
  platform: string;
  is_enabled: boolean;
};

export default function AppDashboardClient() {
  const router = useRouter();
  const sp = useSearchParams();
  const projectId = sp.get("project_id") || "";

  const [selectedSources, setSelectedSources] = useState<string[]>([]);
  const [selectedAccountIds, setSelectedAccountIds] = useState<string[]>([]);
  const [dashboardAccounts, setDashboardAccounts] = useState<DashboardAccount[]>([]);
  const [sourcesOpen, setSourcesOpen] = useState(false);
  const [accountsOpen, setAccountsOpen] = useState(false);
  const sourcesDropdownRef = useRef<HTMLDivElement>(null);
  const accountsDropdownRef = useRef<HTMLDivElement>(null);

  const enabledAccounts = useMemo(
    () => dashboardAccounts.filter((a) => a.is_enabled),
    [dashboardAccounts]
  );
  const activeSourceOptions = useMemo(() => {
    const platforms = [...new Set(enabledAccounts.map((a) => a.platform))].filter(Boolean);
    return platforms.map((id) => ({ id, label: PLATFORM_LABELS[id] ?? id }));
  }, [enabledAccounts]);

  const initial = useMemo(() => {
    const d = new Date();
    return {
      from: toISO(new Date(d.getFullYear(), d.getMonth(), 1)),
      to: toISO(d),
    };
  }, []);

  // Draft: what user sees/edits in the date inputs
  const [draftDateFrom, setDraftDateFrom] = useState<string>(initial.from);
  const [draftDateTo, setDraftDateTo] = useState<string>(initial.to);

  // Applied: what we fetch with (set on Apply click)
  const [appliedDateFrom, setAppliedDateFrom] = useState<string>(initial.from);
  const [appliedDateTo, setAppliedDateTo] = useState<string>(initial.to);

  const [loading, setLoading] = useState(false);
  const [syncLoading, setSyncLoading] = useState(false);
  const [errorText, setErrorText] = useState<string | null>(null);

  const [summary, setSummary] = useState<Summary>({ spend: 0 });
  const [points, setPoints] = useState<Point[]>([]);
  const [updatedAt, setUpdatedAt] = useState<string | null>(null);
  const [lastOkAt, setLastOkAt] = useState<string | null>(null);

  const [showAdvanced, setShowAdvanced] = useState(false);
  const [lastDebug, setLastDebug] = useState<any>(null);

  const isInvalidRange = useMemo(() => draftDateFrom > draftDateTo, [draftDateFrom, draftDateTo]);
  const isInvalidApplied = useMemo(
    () => appliedDateFrom > appliedDateTo,
    [appliedDateFrom, appliedDateTo]
  );

  useEffect(() => {
    if (!projectId) {
      setDashboardAccounts([]);
      return;
    }
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch(
          `/api/dashboard/accounts?project_id=${encodeURIComponent(projectId)}`,
          { cache: "no-store" }
        );
        const json = (await res.json()) as { success?: boolean; accounts?: DashboardAccount[] };
        if (cancelled) return;
        setDashboardAccounts(json?.accounts ?? []);
      } catch {
        if (!cancelled) setDashboardAccounts([]);
      }
    })();
    return () => { cancelled = true; };
  }, [projectId]);

  // Abort + гонки
  const abortRef = useRef<AbortController | null>(null);
  const reqSeqRef = useRef(0);
  /** Prevents duplicate loadFromDb for the same applied key (e.g. Strict Mode double effect). */
  const loadingKeyRef = useRef<string | null>(null);

  const effectiveSources = useMemo(
    () => selectedSources.filter((s) => activeSourceOptions.some((o) => o.id === s)),
    [selectedSources, activeSourceOptions]
  );
  const effectiveAccountIds = useMemo(
    () => selectedAccountIds.filter((id) => enabledAccounts.some((a) => a.id === id)),
    [selectedAccountIds, enabledAccounts]
  );
  const sourcesKey = effectiveSources.length ? [...effectiveSources].sort().join(",") : "all";
  const accountIdsKey = effectiveAccountIds.length ? [...effectiveAccountIds].sort().join(",") : "all";
  function appliedKey() {
    return `${projectId}:${appliedDateFrom}:${appliedDateTo}:${sourcesKey}:${accountIdsKey}`;
  }

  function abortInFlight() {
    const c = abortRef.current;
    abortRef.current = null;
    if (!c) return;
    try {
      c.abort();
    } catch {
      // Ignore: abort() may throw in some environments; cancellation is expected.
    }
  }

  function makeController() {
    abortInFlight();
    const c = new AbortController();
    abortRef.current = c;
    return c;
  }

  const isSupportedNow = true;

  async function loadFromDb(
    signal?: AbortSignal,
    overrideStart?: string,
    overrideEnd?: string
  ) {
    if (!projectId) {
      setErrorText("Нет project_id в URL. Открой /app?project_id=...");
      return;
    }

    const start = overrideStart ?? appliedDateFrom;
    const end = overrideEnd ?? appliedDateTo;
    if (!start || !end || start > end) return;

    const fetchKey = `${projectId}:${start}:${end}:${sourcesKey}:${accountIdsKey}`;
    setLoading(true);
    setErrorText(null);

    const mySeq = ++reqSeqRef.current;

    const params = new URLSearchParams({
      project_id: projectId,
      start,
      end,
    });
    if (effectiveSources.length) params.set("sources", effectiveSources.join(","));
    if (effectiveAccountIds.length) params.set("account_ids", effectiveAccountIds.join(","));

    try {
      const qs = params.toString();

      const [sRes, tRes] = await Promise.all([
        fetch(`/api/dashboard/summary?${qs}`, { cache: "no-store", signal }),
        fetch(`/api/dashboard/timeseries?${qs}`, { cache: "no-store", signal }),
      ]);

      const sText = await sRes.text();
      const tText = await tRes.text();

      const sJson = sText ? JSON.parse(sText) : null;
      const tJson = tText ? JSON.parse(tText) : null;

      console.log("[SUMMARY_RESPONSE_RAW]", { ok: sRes.ok, totals: sJson?.totals, source: sJson?.source, raw: sJson });
      console.log("[TIMESERIES_RESPONSE_RAW]", { ok: tRes.ok, pointsCount: tJson?.points?.length, firstSpend: tJson?.points?.[0]?.spend, raw: tJson });

      if (!sRes.ok || !sJson?.success) {
        const apiErr = extractApiError(sJson);
        throw new Error(apiErr || sJson?.error?.message || sJson?.error || "summary: ошибка");
      }
      if (!tRes.ok || !tJson?.success) {
        const apiErr = extractApiError(tJson);
        throw new Error(apiErr || tJson?.error?.message || tJson?.error || "timeseries: ошибка");
      }

      if (mySeq !== reqSeqRef.current) return;

      const apiUpdated = safeIso(sJson?.updated_at) || safeIso(sJson?.server_time);
      setUpdatedAt(apiUpdated || new Date().toISOString());
      setLastOkAt(new Date().toISOString());

      const totals = sJson?.totals ?? {};
      const nextSummary = {
        spend: Number(totals.spend ?? 0) || 0,
        impressions: Number(totals.impressions ?? 0) || 0,
        clicks: Number(totals.clicks ?? 0) || 0,
      };
      console.log("[STATE_SET_SUMMARY]", { totals, parsed: nextSummary });
      setSummary(nextSummary);

      const pts = (tJson?.points ?? []).map((p: any) => ({
        date: String(p.date),
        spend: Number(p.spend ?? 0) || 0,
      })) as Point[];
      console.log("[STATE_SET_POINTS]", { pointsCount: pts.length, firstSpend: pts[0]?.spend, sample: pts.slice(0, 2) });
      setPoints(pts);

      setLastDebug({
        summary: sJson,
        timeseries: tJson,
        params: { projectId, start, end, effectiveSources, effectiveAccountIds },
      });
    } catch (e: any) {
      if (isAbortError(e)) return;

      setErrorText(toErrorText(e));
      // Keep previous summary/points visible on error
    } finally {
      if (loadingKeyRef.current === fetchKey) loadingKeyRef.current = null;
      setLoading(false);
    }
  }

  async function refreshAndReload() {
    if (!projectId) return;
    if (isInvalidApplied) return;
    if (!isSupportedNow) return;

    const c = makeController();
    const mySeq = ++reqSeqRef.current;

    setSyncLoading(true);
    setErrorText(null);

    try {
      const r = await fetch("/api/dashboard/refresh", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          project_id: projectId,
          start: appliedDateFrom,
          end: appliedDateTo,
          sources: effectiveSources,
          account_ids: effectiveAccountIds,
        }),
        signal: c.signal,
      });

      const text = await r.text();
      let json: any = null;
      try {
        json = text ? JSON.parse(text) : null;
      } catch {
        json = null;
      }

      if (!r.ok || !json?.success) {
        const apiErr = extractApiError(json);
        const human =
          apiErr ||
          (text ? text.slice(0, 500) : "") ||
          `HTTP ${r.status} ${r.statusText || ""}`.trim();
        throw new Error(`Refresh failed (${r.status} ${r.statusText}): ${human}`.trim());
      }

      if (mySeq !== reqSeqRef.current) return;

      const fromApi = safeIso(json?.refreshed_at) || safeIso(json?.sync?.refreshed_at);
      setUpdatedAt(fromApi || new Date().toISOString());

      await loadFromDb(c.signal);
    } catch (e: any) {
      if (isAbortError(e)) return;
      setErrorText(toErrorText(e));
    } finally {
      setSyncLoading(false);
    }
  }

  // Load metrics when applied range changes (not on draft changes)
  const hasLoadedRef = useRef(false);
  useEffect(() => {
    const key = `${projectId}:${appliedDateFrom}:${appliedDateTo}:${sourcesKey}:${accountIdsKey}`;
    console.log("[DASHBOARD_EFFECT]", {
      projectId,
      appliedDateFrom,
      appliedDateTo,
      sourcesKey,
      accountIdsKey,
      key,
      loadingKeyRef: loadingKeyRef.current,
      guardBlocks: loadingKeyRef.current === key,
      noProject: !projectId,
      invalidApplied: isInvalidApplied,
    });
    if (!projectId) return;
    if (!isSupportedNow) return;
    if (isInvalidApplied) return;

    if (loadingKeyRef.current === key) {
      console.log("[LOAD_BLOCKED_BY_GUARD]", { key, loadingKeyRef: loadingKeyRef.current });
      return;
    }

    hasLoadedRef.current = true;
    loadingKeyRef.current = key;
    const c = makeController();
    console.log("[LOAD_FROM_DB_CALL]", { start: appliedDateFrom, end: appliedDateTo, key });
    loadFromDb(c.signal, appliedDateFrom, appliedDateTo);

    return () => {
      abortInFlight();
      loadingKeyRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [projectId, appliedDateFrom, appliedDateTo, sourcesKey, accountIdsKey]);

  // Auto-refresh every 30 min (uses applied range)
  useEffect(() => {
    if (!projectId) return;
    if (!isSupportedNow) return;

    const MS = 30 * 60 * 1000;
    const id = window.setInterval(() => {
      if (loading || syncLoading) return;
      refreshAndReload();
    }, MS);

    return () => window.clearInterval(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [projectId, appliedDateFrom, appliedDateTo, sourcesKey, accountIdsKey, loading, syncLoading]);

  useEffect(() => {
    return () => abortInFlight();
  }, []);

  // Close dropdowns on outside click or Escape
  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      const target = e.target as Node;
      if (sourcesDropdownRef.current?.contains(target) || accountsDropdownRef.current?.contains(target)) return;
      setSourcesOpen(false);
      setAccountsOpen(false);
    }
    function handleKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") {
        setSourcesOpen(false);
        setAccountsOpen(false);
      }
    }
    if (sourcesOpen || accountsOpen) {
      document.addEventListener("mousedown", handleClickOutside);
      document.addEventListener("keydown", handleKeyDown);
      return () => {
        document.removeEventListener("mousedown", handleClickOutside);
        document.removeEventListener("keydown", handleKeyDown);
      };
    }
  }, [sourcesOpen, accountsOpen]);

  const updatedStr = useMemo(() => {
    const iso = safeIso(updatedAt);
    if (!iso) return "—";
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return "—";
    return `${String(d.getDate()).padStart(2, "0")}.${String(d.getMonth() + 1).padStart(
      2,
      "0"
    )}.${d.getFullYear()}, ${String(d.getHours()).padStart(2, "0")}:${String(
      d.getMinutes()
    ).padStart(2, "0")}`;
  }, [updatedAt]);

  const lastOkStr = useMemo(() => {
    const iso = safeIso(lastOkAt);
    if (!iso) return "—";
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return "—";
    return `${String(d.getDate()).padStart(2, "0")}.${String(d.getMonth() + 1).padStart(
      2,
      "0"
    )}.${d.getFullYear()}, ${String(d.getHours()).padStart(2, "0")}:${String(
      d.getMinutes()
    ).padStart(2, "0")}`;
  }, [lastOkAt]);

  const card = {
    borderRadius: 18,
    border: "1px solid rgba(255,255,255,0.10)",
    background:
      "radial-gradient(1200px 400px at 30% 0%, rgba(125,125,255,0.12), transparent 60%), linear-gradient(180deg, rgba(255,255,255,0.04), rgba(255,255,255,0.02))",
    boxShadow: "0 20px 60px rgba(0,0,0,0.55)",
  } as const;

  const mini = {
    borderRadius: 16,
    border: "1px solid rgba(255,255,255,0.10)",
    background: "rgba(255,255,255,0.03)",
    padding: 18,
  } as const;

  const badge = {
    display: "inline-flex",
    alignItems: "center",
    gap: 8,
    padding: "6px 10px",
    borderRadius: 999,
    border: "1px solid rgba(255,255,255,0.10)",
    background: "rgba(255,255,255,0.04)",
    color: "rgba(255,255,255,0.9)",
    fontSize: 12,
    lineHeight: 1,
    whiteSpace: "nowrap" as const,
  } as const;

  const tag = (text: string, tone: "meta" | "soon" = "meta") => {
    if (tone === "soon") {
      return {
        display: "inline-flex",
        alignItems: "center",
        padding: "6px 10px",
        borderRadius: 999,
        border: "1px solid rgba(255,255,255,0.14)",
        background: "rgba(255,255,255,0.05)",
        color: "rgba(255,255,255,0.75)",
        fontSize: 12,
        fontWeight: 800 as const,
      };
    }
    return {
      display: "inline-flex",
      alignItems: "center",
      padding: "6px 10px",
      borderRadius: 999,
      border: "1px solid rgba(120,255,180,0.35)",
      background: "rgba(120,255,180,0.08)",
      color: "rgba(150,255,200,0.95)",
      fontSize: 12,
      fontWeight: 700 as const,
    };
  };

  const tabStyle = (active: boolean, disabled?: boolean) => ({
    height: 32,
    padding: "0 12px",
    borderRadius: 999,
    border: "1px solid rgba(255,255,255,0.10)",
    background: active ? "rgba(255,255,255,0.09)" : "rgba(255,255,255,0.04)",
    color: disabled ? "rgba(255,255,255,0.45)" : "rgba(255,255,255,0.92)",
    cursor: disabled ? "not-allowed" : "pointer",
    fontWeight: 800,
    fontSize: 12,
    opacity: disabled ? 0.7 : 1,
    whiteSpace: "nowrap" as const,
  });

  const statusState = useMemo<"loading" | "success" | "error">(() => {
    if (loading || syncLoading) return "loading";
    if (errorText) return "error";
    return "success";
  }, [loading, syncLoading, errorText]);

  const statusLabel = useMemo(() => {
    if (statusState === "loading") return syncLoading ? "Идёт обновление…" : "Загрузка…";
    if (statusState === "error") return "Ошибка";
    return "Готово";
  }, [statusState, syncLoading]);

  const accountsByPlatform = useMemo(() => {
    const map = new Map<string, DashboardAccount[]>();
    for (const a of enabledAccounts) {
      const list = map.get(a.platform) ?? [];
      list.push(a);
      map.set(a.platform, list);
    }
    return map;
  }, [enabledAccounts]);

  const platformsForAccounts = selectedSources.length
    ? activeSourceOptions.filter((s) => selectedSources.includes(s.id))
    : activeSourceOptions;

  const sourcesLabel =
    selectedSources.length === 0
      ? "All"
      : selectedSources.length >= activeSourceOptions.length
        ? "All"
        : selectedSources.map((id) => activeSourceOptions.find((o) => o.id === id)?.label ?? id).join(", ");
  const accountsLabel = selectedAccountIds.length === 0 ? "All" : `${selectedAccountIds.length} selected`;

  const handleDateBlur = () => {
    if (draftDateFrom > draftDateTo) return;
    if (draftDateFrom === appliedDateFrom && draftDateTo === appliedDateTo) return;
    setAppliedDateFrom(draftDateFrom);
    setAppliedDateTo(draftDateTo);
    const params = new URLSearchParams(sp.toString());
    if (projectId) params.set("project_id", projectId);
    params.set("start", draftDateFrom);
    params.set("end", draftDateTo);
    router.replace(`${window.location.pathname}?${params.toString()}`, { scroll: false });
  };

  return (
    <div style={{ padding: 28, position: "relative" }}>
      {/* Header */}
      <div style={{ marginBottom: 10 }}>
        <div style={{ fontSize: 34, fontWeight: 900, lineHeight: 1.1 }}>Дашборд</div>
        <div style={{ opacity: 0.75, marginTop: 6 }}>
          Spend, Impressions, Clicks из Meta (daily_ad_metrics). Конверсии и продажи — позже.
        </div>

        {errorText ? (
          <div style={{ marginTop: 10, color: "rgba(255,170,170,0.95)", fontWeight: 700 }}>
            {errorText}
          </div>
        ) : null}
      </div>

      {/* ✅ Строка фильтров + табы (одной линией) */}
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          gap: 12,
          flexWrap: "wrap",
          marginBottom: 8,
        }}
      >
        <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
          {/* Sources: multi-select — only active/connected platforms */}
          <div style={{ position: "relative" }} ref={sourcesDropdownRef}>
            <button
              type="button"
              style={{ ...tabStyle(false), minWidth: 140 }}
              onClick={() => { setSourcesOpen((v) => !v); setAccountsOpen(false); }}
              title="Traffic sources"
            >
              Sources: {sourcesLabel} ▼
            </button>
            {sourcesOpen ? (
              <div
                style={{
                  position: "absolute",
                  top: "100%",
                  left: 0,
                  marginTop: 4,
                  padding: 10,
                  borderRadius: 12,
                  border: "1px solid rgba(255,255,255,0.12)",
                  background: "rgba(20,20,28,0.98)",
                  zIndex: 50,
                  minWidth: 180,
                  boxShadow: "0 8px 24px rgba(0,0,0,0.4)",
                }}
              >
                {activeSourceOptions.length === 0 ? (
                  <div style={{ fontSize: 12, opacity: 0.7 }}>No connected sources</div>
                ) : (
                  activeSourceOptions.map((opt) => {
                    const checked = selectedSources.length === 0 || selectedSources.includes(opt.id);
                    return (
                      <label key={opt.id} style={{ display: "flex", alignItems: "center", gap: 8, cursor: "pointer", marginBottom: 6 }}>
                        <input
                          type="checkbox"
                          checked={checked}
                          onChange={() => {
                            if (checked) {
                              if (selectedSources.length === 0) {
                                setSelectedSources(activeSourceOptions.map((o) => o.id).filter((id) => id !== opt.id));
                              } else {
                                setSelectedSources((prev) => prev.filter((x) => x !== opt.id));
                              }
                            } else {
                              const next = [...selectedSources, opt.id];
                              setSelectedSources(next.length >= activeSourceOptions.length ? [] : next);
                            }
                          }}
                        />
                        <span>{opt.label}</span>
                      </label>
                    );
                  })
                )}
                {activeSourceOptions.length > 0 ? (
                  <div style={{ fontSize: 11, opacity: 0.7, marginTop: 6 }}>Empty = All sources</div>
                ) : null}
              </div>
            ) : null}
          </div>

          {/* Accounts: multi-select, grouped by platform — only enabled accounts */}
          <div style={{ position: "relative" }} ref={accountsDropdownRef}>
            <button
              type="button"
              style={{ ...tabStyle(false), minWidth: 160 }}
              onClick={() => { setAccountsOpen((v) => !v); setSourcesOpen(false); }}
              title="Ad accounts"
            >
              Accounts: {accountsLabel} ▼
            </button>
            {accountsOpen ? (
              <div
                style={{
                  position: "absolute",
                  top: "100%",
                  left: 0,
                  marginTop: 4,
                  padding: 10,
                  borderRadius: 12,
                  border: "1px solid rgba(255,255,255,0.12)",
                  background: "rgba(20,20,28,0.98)",
                  zIndex: 50,
                  maxHeight: 320,
                  overflowY: "auto",
                  minWidth: 240,
                  boxShadow: "0 8px 24px rgba(0,0,0,0.4)",
                }}
              >
                {platformsForAccounts.map((opt) => {
                  const accounts = accountsByPlatform.get(opt.id) ?? [];
                  if (accounts.length === 0) return null;
                  return (
                    <div key={opt.id} style={{ marginBottom: 10 }}>
                      <div style={{ fontSize: 11, fontWeight: 700, opacity: 0.8, marginBottom: 4 }}>{opt.label}</div>
                      {accounts.map((a) => {
                        const checked = selectedAccountIds.length === 0 || selectedAccountIds.includes(a.id);
                        return (
                          <label key={a.id} style={{ display: "flex", alignItems: "center", gap: 8, cursor: "pointer", marginLeft: 8, marginBottom: 4 }}>
                            <input
                              type="checkbox"
                              checked={checked}
                              onChange={() => {
                                if (selectedAccountIds.includes(a.id)) {
                                  setSelectedAccountIds((prev) => prev.filter((x) => x !== a.id));
                                } else {
                                  setSelectedAccountIds((prev) => [...prev, a.id]);
                                }
                              }}
                            />
                            <span>{a.name || a.platform_account_id}</span>
                          </label>
                        );
                      })}
                    </div>
                  );
                })}
                {enabledAccounts.length === 0 ? (
                  <div style={{ fontSize: 12, opacity: 0.7 }}>No enabled accounts</div>
                ) : null}
                {enabledAccounts.length > 0 ? (
                  <div style={{ fontSize: 11, opacity: 0.7, marginTop: 6 }}>Empty = All accounts</div>
                ) : null}
              </div>
            ) : null}
          </div>

          <div
            style={{
              position: "relative",
              display: "flex",
              alignItems: "center",
              gap: 8,
              flexShrink: 0,
              isolation: "isolate",
            }}
          >
            <div
              style={{
                display: "flex",
                alignItems: "center",
                gap: 6,
                padding: "6px 10px",
                borderRadius: 12,
                border: "1px solid rgba(255,255,255,0.10)",
                background: "rgba(255,255,255,0.04)",
              }}
              onBlur={handleDateBlur}
            >
              <input
                type="date"
                value={draftDateFrom}
                onChange={(e) => setDraftDateFrom(e.target.value)}
                onBlur={handleDateBlur}
                style={{
                  background: "transparent",
                  border: "none",
                  color: "white",
                  outline: "none",
                  fontSize: 13,
                  lineHeight: 1,
                  height: 24,
                  padding: 0,
                  minWidth: 120,
                  width: 120,
                }}
              />
              <span style={{ opacity: 0.6, fontSize: 11 }}>—</span>
              <input
                type="date"
                value={draftDateTo}
                onChange={(e) => setDraftDateTo(e.target.value)}
                onBlur={handleDateBlur}
                style={{
                  background: "transparent",
                  border: "none",
                  color: "white",
                  outline: "none",
                  fontSize: 13,
                  lineHeight: 1,
                  height: 24,
                  padding: 0,
                  minWidth: 120,
                  width: 120,
                }}
              />
            </div>

            {/* Done / status indicator: right of date range, color by state */}
            <div
              role="status"
              aria-live="polite"
              title={statusState === "error" ? errorText ?? "Ошибка" : "Статус загрузки данных"}
              style={{
                display: "inline-flex",
                alignItems: "center",
                justifyContent: "center",
                gap: 8,
                minWidth: 100,
                height: 32,
                padding: "0 14px",
                borderRadius: 999,
                border: "1px solid transparent",
                fontWeight: 800,
                fontSize: 12,
                whiteSpace: "nowrap",
                transition: "background-color 0.2s ease, color 0.2s ease, border-color 0.2s ease",
                ...(statusState === "loading"
                  ? {
                      background: "rgba(251,191,36,0.95)",
                      color: "rgba(0,0,0,0.88)",
                      borderColor: "rgba(251,191,36,0.6)",
                    }
                  : statusState === "error"
                    ? {
                        background: "rgba(220,38,38,0.9)",
                        color: "rgba(255,255,255,0.98)",
                        borderColor: "rgba(220,38,38,0.7)",
                      }
                    : {
                        background: "rgba(16,185,129,0.85)",
                        color: "rgba(255,255,255,0.98)",
                        borderColor: "rgba(16,185,129,0.6)",
                      }),
              }}
            >
              {statusState === "loading" ? (
                <>
                  <span
                    style={{
                      display: "inline-block",
                      width: 14,
                      height: 14,
                      flexShrink: 0,
                      border: "2px solid currentColor",
                      borderTopColor: "transparent",
                      borderRadius: "50%",
                      animation: "dashboard-spin 0.7s linear infinite",
                    }}
                  />
                  {statusLabel}
                </>
              ) : (
                statusLabel
              )}
            </div>
          </div>
        </div>

        {/* ✅ “Обновлено/ОК” прямо под хедером справа, отдельным блоком */}
        <div style={{ display: "grid", gap: 6, justifyItems: "end", marginTop: 2 }}>
          <span style={badge} title="Время обновления из API/сервера">
            Обновлено: {updatedStr}
          </span>
          <span style={badge} title="Последний успешный ответ (клиент)">
            OK: {lastOkStr}
          </span>
        </div>
      </div>

      {isInvalidRange ? (
        <div style={{ marginTop: 8, opacity: 0.85, color: "rgba(255,200,160,0.95)" }}>
          Дата начала не может быть позже даты конца
        </div>
      ) : null}


      {/* KPI cards: Расход, Регистрации, Продажи, ROAS */}
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(4, minmax(200px, 1fr))",
          gap: 16,
          marginTop: 16,
          marginBottom: 16,
          opacity: loading && !syncLoading ? 0.95 : 1,
          transition: "opacity 0.2s ease",
        }}
      >
        <div style={{ ...mini, ...card }}>
          <div style={{ display: "flex", justifyContent: "space-between", gap: 10 }}>
            <div style={{ opacity: 0.75 }}>Расход</div>
            <div style={tag(sourcesLabel)}>{sourcesLabel}</div>
          </div>
          <div style={{ fontSize: 36, fontWeight: 900, marginTop: 10 }}>
            {formatMoney(summary.spend)}
          </div>
          <div style={{ opacity: 0.72, marginTop: 6 }}>CPL: — • CAC: —</div>
        </div>

        <div
          style={{
            ...mini,
            ...card,
            background: "rgba(255,255,255,0.02)",
            borderColor: "rgba(255,255,255,0.06)",
            opacity: 0.7,
          }}
        >
          <div style={{ display: "flex", justifyContent: "space-between", gap: 10 }}>
            <div style={{ opacity: 0.6 }}>Регистрации</div>
          </div>
          <div style={{ fontSize: 36, fontWeight: 900, marginTop: 10, opacity: 0.85 }}>—</div>
          <div style={{ opacity: 0.6, marginTop: 6 }}>Конверсия лид → продажа: —</div>
        </div>

        <div
          style={{
            ...mini,
            ...card,
            background: "rgba(255,255,255,0.02)",
            borderColor: "rgba(255,255,255,0.06)",
            opacity: 0.7,
          }}
        >
          <div style={{ display: "flex", justifyContent: "space-between", gap: 10 }}>
            <div style={{ opacity: 0.6 }}>Продажи</div>
          </div>
          <div style={{ fontSize: 36, fontWeight: 900, marginTop: 10, opacity: 0.85 }}>—</div>
          <div style={{ opacity: 0.6, marginTop: 6 }}>Выручка: —</div>
        </div>

        <div
          style={{
            ...mini,
            ...card,
            background: "rgba(255,255,255,0.02)",
            borderColor: "rgba(255,255,255,0.06)",
            opacity: 0.7,
          }}
        >
          <div style={{ display: "flex", justifyContent: "space-between", gap: 10 }}>
            <div style={{ opacity: 0.6 }}>ROAS</div>
          </div>
          <div style={{ fontSize: 36, fontWeight: 900, marginTop: 10, opacity: 0.85 }}>—</div>
          <div style={{ opacity: 0.6, marginTop: 6 }}>Выручка / расход</div>
        </div>
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "2fr 1fr", gap: 16 }}>
        <div style={{ ...mini, ...card, padding: 20 }}>
          <div style={{ fontWeight: 900, fontSize: 18, marginBottom: 10 }}>Динамика расхода</div>
          <div style={{ opacity: 0.7, marginBottom: 14 }}>Spend (по выбранному диапазону)</div>

          <SpendLineChart points={points} />

          <div style={{ display: "flex", gap: 14, marginTop: 12, opacity: 0.85, fontSize: 13 }}>
            <span>● Spend</span>
          </div>
        </div>

        <div style={{ ...mini, ...card, padding: 20 }}>
          <div style={{ fontWeight: 900, fontSize: 18, marginBottom: 12 }}>Data Status</div>

          <div
            style={{
              display: "grid",
              gap: 10,
              fontSize: 13,
              color: "rgba(255,255,255,0.9)",
            }}
          >
            <div style={{ display: "flex", justifyContent: "space-between", gap: 8 }}>
              <span style={{ opacity: 0.7 }}>Source scope</span>
              <span>{sourcesLabel}</span>
            </div>
            <div style={{ display: "flex", justifyContent: "space-between", gap: 8 }}>
              <span style={{ opacity: 0.7 }}>Account scope</span>
              <span>
                {selectedAccountIds.length === 0
                  ? `All (${dashboardAccounts.length})`
                  : `${selectedAccountIds.length} selected`}
              </span>
            </div>
            <div style={{ display: "flex", justifyContent: "space-between", gap: 8 }}>
              <span style={{ opacity: 0.7 }}>Connected accounts</span>
              <span>{dashboardAccounts.length}</span>
            </div>
            <div style={{ display: "flex", justifyContent: "space-between", gap: 8 }}>
              <span style={{ opacity: 0.7 }}>Date range</span>
              <span>
                {appliedDateFrom && appliedDateTo
                  ? `${fmtRuDate(appliedDateFrom)} – ${fmtRuDate(appliedDateTo)}`
                  : "—"}
              </span>
            </div>
            <div style={{ display: "flex", justifyContent: "space-between", gap: 8 }}>
              <span style={{ opacity: 0.7 }}>Last updated</span>
              <span>{updatedStr}</span>
            </div>
            <div style={{ display: "flex", justifyContent: "space-between", gap: 8 }}>
              <span style={{ opacity: 0.7 }}>Last OK</span>
              <span>{lastOkStr}</span>
            </div>
            <div style={{ display: "flex", justifyContent: "space-between", gap: 8 }}>
              <span style={{ opacity: 0.7 }}>Campaigns</span>
              <span>
                {lastDebug?.summary?.debug?.campaigns_cnt != null
                  ? String(lastDebug.summary.debug.campaigns_cnt)
                  : "—"}
              </span>
            </div>
            <div style={{ display: "flex", justifyContent: "space-between", gap: 8 }}>
              <span style={{ opacity: 0.7 }}>Account rows</span>
              <span>
                {lastDebug?.summary?.debug?.account_rows != null
                  ? String(lastDebug.summary.debug.account_rows)
                  : "—"}
              </span>
            </div>
            <div style={{ display: "flex", justifyContent: "space-between", gap: 8 }}>
              <span style={{ opacity: 0.7 }}>Campaign rows</span>
              <span>
                {lastDebug?.summary?.debug?.campaign_rows != null
                  ? String(lastDebug.summary.debug.campaign_rows)
                  : "—"}
              </span>
            </div>
            <div style={{ display: "flex", justifyContent: "space-between", gap: 8 }}>
              <span style={{ opacity: 0.7 }}>Mode</span>
              <span>
                {lastDebug?.summary?.source?.includes("canonical")
                  ? "canonical"
                  : lastDebug?.summary?.source
                    ? "fallback"
                    : "—"}
              </span>
            </div>
          </div>
        </div>
      </div>

      {/* ✅ Advanced кнопка в самый низ справа (sandbars) */}
      <button
        type="button"
        onClick={() => setShowAdvanced((v) => !v)}
        style={{
          position: "fixed",
          right: 20,
          bottom: 20,
          height: 38,
          padding: "0 14px",
          borderRadius: 999,
          border: "1px solid rgba(255,255,255,0.10)",
          background: showAdvanced ? "rgba(255,255,255,0.10)" : "rgba(255,255,255,0.06)",
          color: "white",
          cursor: "pointer",
          fontWeight: 900,
          fontSize: 12,
          boxShadow: "0 20px 60px rgba(0,0,0,0.45)",
          zIndex: 50,
          whiteSpace: "nowrap",
        }}
      >
        Advanced {showAdvanced ? "▲" : "▼"}
      </button>

      {/* Advanced panel */}
      {showAdvanced ? (
        <div
          style={{
            ...mini,
            ...card,
            padding: 20,
            marginTop: 16,
          }}
        >
          <div style={{ display: "flex", justifyContent: "space-between", gap: 12 }}>
            <div>
              <div style={{ fontWeight: 900, fontSize: 18 }}>Advanced</div>
              <div style={{ opacity: 0.72, marginTop: 4 }}>
                Debug спрятан сюда, чтобы не мешал дашборду.
              </div>
            </div>
            <button
              type="button"
              onClick={() => {
                try {
                  navigator.clipboard.writeText(JSON.stringify(lastDebug ?? {}, null, 2));
                } catch {}
              }}
              style={{
                height: 30,
                padding: "0 10px",
                borderRadius: 999,
                border: "1px solid rgba(255,255,255,0.10)",
                background: "rgba(255,255,255,0.05)",
                color: "white",
                cursor: "pointer",
                fontWeight: 800,
                fontSize: 12,
                whiteSpace: "nowrap",
              }}
            >
              Copy debug
            </button>
          </div>

          <pre
            style={{
              marginTop: 12,
              padding: 12,
              borderRadius: 12,
              border: "1px solid rgba(255,255,255,0.10)",
              background: "rgba(0,0,0,0.35)",
              overflow: "auto",
              maxHeight: 320,
              fontSize: 12,
              lineHeight: 1.4,
              color: "rgba(255,255,255,0.85)",
            }}
          >
            {JSON.stringify(lastDebug ?? {}, null, 2)}
          </pre>

          <div style={{ opacity: 0.7, marginTop: 10, fontSize: 12 }}>
            Авто-обновление: каждые <b>30 минут</b> (sync + reload).
            <br />
            Диапазон дат: выберите даты — диапазон применится при выходе из полей.
          </div>
        </div>
      ) : null}
    </div>
  );
}