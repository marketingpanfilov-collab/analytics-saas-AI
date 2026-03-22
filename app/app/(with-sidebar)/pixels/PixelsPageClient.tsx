"use client";

import { useSearchParams } from "next/navigation";
import { useEffect, useState, useCallback } from "react";

function cx(...a: (string | false | null | undefined)[]) {
  return a.filter(Boolean).join(" ");
}

function formatRelativeTime(iso: string | null): string {
  if (!iso) return "—";
  try {
    const d = new Date(iso);
    const now = new Date();
    const diffMs = now.getTime() - d.getTime();
    const diffSec = Math.floor(diffMs / 1000);
    const diffMin = Math.floor(diffSec / 60);
    const diffHr = Math.floor(diffMin / 60);
    const diffDay = Math.floor(diffHr / 24);
    if (diffSec < 60) return "только что";
    if (diffMin < 60) return `${diffMin} мин назад`;
    if (diffHr < 24) return `${diffHr} ч назад`;
    if (diffDay < 7) return `${diffDay} дн. назад`;
    return d.toLocaleString();
  } catch {
    return iso;
  }
}

function daysSince(iso: string | null): number | null {
  if (!iso) return null;
  try {
    const d = new Date(iso).getTime();
    const now = Date.now();
    return (now - d) / (24 * 60 * 60 * 1000);
  } catch {
    return null;
  }
}

type StatusKind = "green" | "yellow" | "red";

const TABS = [
  { id: "pixel" as const, label: "Pixel installation", icon: "🛜" },
  { id: "gtm" as const, label: "Google Tag Manager", icon: "📦" },
  { id: "conversion" as const, label: "Conversion events", icon: "📊" },
  { id: "crm" as const, label: "CRM integration", icon: "🔗" },
];

const AUTO_COLLECTED = [
  "visitor_id", "session_id", "click_id", "page_url", "referrer",
  "utm_source", "utm_medium", "utm_campaign", "utm_content", "utm_term",
  "fbclid", "gclid", "ttclid", "fbc", "fbp",
];

const GTM_STEPS = [
  "Create Tag",
  "Custom HTML",
  "Paste Script",
  "Trigger: All Pages",
];

const CRM_MAPPING = [
  { crm: "CRM user id", api: "user_external_id" },
  { crm: "CRM order id", api: "external_event_id" },
  { crm: "CRM revenue", api: "value" },
  { crm: "CRM currency", api: "currency" },
  { crm: "CRM event time", api: "event_time" },
  { crm: "CRM email", api: "email" },
  { crm: "CRM phone", api: "phone" },
];

// ——— StatusCard ———
function StatusCard({ title, status, loading }: { title: string; status: StatusKind; loading?: boolean }) {
  const dot = status === "green" ? "bg-emerald-500" : status === "yellow" ? "bg-amber-500" : "bg-red-500";
  const label = status === "green" ? "Works" : status === "yellow" ? "Partial" : "Not connected";
  return (
    <div className="rounded-xl border border-neutral-800 bg-neutral-900/80 px-4 py-3 shadow">
      <div className="flex items-center gap-3">
        <span className={cx("inline-block h-2.5 w-2.5 shrink-0 rounded-full", dot, loading && "animate-pulse")} />
        <div className="min-w-0 flex-1">
          <div className="text-[10px] font-medium uppercase tracking-wider text-neutral-500">{title}</div>
          <div className="text-sm font-medium text-white">{loading ? "…" : label}</div>
        </div>
      </div>
    </div>
  );
}

// ——— ActivityBadge: recency → green/yellow/red + label ———
function getVisitRecency(at: string | null): { status: StatusKind; label: string } {
  const days = daysSince(at);
  if (days == null) return { status: "red", label: "Not received yet" };
  if (days < 1) return { status: "green", label: "Active now" };
  if (days <= 7) return { status: "yellow", label: "No recent events" };
  return { status: "red", label: "No recent events" };
}
function getConversionRecency(at: string | null): { status: StatusKind; label: string } {
  const days = daysSince(at);
  if (days == null) return { status: "red", label: "Not received yet" };
  if (days < 7) return { status: "green", label: "Active now" };
  if (days <= 30) return { status: "yellow", label: "No recent events" };
  return { status: "red", label: "No recent events" };
}

function ActivityCard({
  title,
  at,
  recency,
  loading,
}: {
  title: string;
  at: string | null;
  recency: { status: StatusKind; label: string };
  loading?: boolean;
}) {
  const bg = recency.status === "green" ? "bg-emerald-500/10 border-emerald-500/20" : recency.status === "yellow" ? "bg-amber-500/10 border-amber-500/20" : "bg-red-500/10 border-red-500/20";
  const dot = recency.status === "green" ? "bg-emerald-500" : recency.status === "yellow" ? "bg-amber-500" : "bg-red-500";
  return (
    <div className={cx("rounded-xl border p-3", bg)}>
      <div className="text-[10px] font-medium uppercase tracking-wider text-neutral-500">{title}</div>
      <div className="mt-1 flex items-center gap-2">
        <span className={cx("h-1.5 w-1.5 shrink-0 rounded-full", dot)} />
        <span className="text-sm font-medium text-white">{loading ? "…" : formatRelativeTime(at)}</span>
      </div>
      <div className="mt-0.5 text-xs text-neutral-400">{recency.label}</div>
    </div>
  );
}

// ——— CodeBlock ———
function CodeBlock({ code, onCopy, copied, copyLabel = "Copy code" }: { code: string; onCopy: (t: string) => void; copied: boolean; copyLabel?: string }) {
  return (
    <div className="relative">
      <div className="absolute right-2 top-2 z-10">
        <button
          type="button"
          onClick={() => onCopy(code)}
          className={cx(
            "rounded-lg px-3 py-1.5 text-xs font-medium transition-colors",
            copied ? "bg-emerald-500/20 text-emerald-300 ring-1 ring-emerald-500/30" : "bg-neutral-800 text-neutral-300 ring-1 ring-neutral-700 hover:bg-neutral-700"
          )}
        >
          {copied ? "Скопировано" : copyLabel}
        </button>
      </div>
      <pre className="overflow-x-auto rounded-xl border border-neutral-800 bg-neutral-950 px-4 py-3 pr-28 text-sm leading-relaxed text-neutral-300 whitespace-pre">
        <code>{code}</code>
      </pre>
    </div>
  );
}

// ——— EventTable ———
function EventTable({ events, loading }: { events: Array<{ time: string; event_type: string; visitor_id: string | null; utm_source: string | null; value: number | null }>; loading?: boolean }) {
  if (loading) return <div className="rounded-xl border border-neutral-800 bg-neutral-900/60 p-4 text-center text-sm text-neutral-500">Загрузка…</div>;
  if (!events.length) return <div className="rounded-xl border border-neutral-800 bg-neutral-900/60 p-4 text-center text-sm text-neutral-500">Событий пока нет</div>;
  return (
    <div className="overflow-hidden rounded-xl border border-neutral-800 bg-neutral-900/60">
      <table className="w-full text-left text-sm">
        <thead>
          <tr className="border-b border-neutral-800 bg-neutral-950/80">
            <th className="px-3 py-2 font-medium text-neutral-400">time</th>
            <th className="px-3 py-2 font-medium text-neutral-400">event_type</th>
            <th className="px-3 py-2 font-medium text-neutral-400">visitor_id</th>
            <th className="px-3 py-2 font-medium text-neutral-400">utm_source</th>
            <th className="px-3 py-2 font-medium text-neutral-400">value</th>
          </tr>
        </thead>
        <tbody>
          {events.map((e, i) => (
            <tr key={i} className="border-b border-neutral-800/80 last:border-0">
              <td className="px-3 py-2 font-mono text-xs text-neutral-300">{formatRelativeTime(e.time)}</td>
              <td className="px-3 py-2 text-neutral-200">{e.event_type}</td>
              <td className="max-w-[100px] truncate px-3 py-2 font-mono text-xs text-neutral-400">{e.visitor_id ?? "—"}</td>
              <td className="px-3 py-2 text-neutral-400">{e.utm_source ?? "—"}</td>
              <td className="px-3 py-2 text-neutral-300">{e.value != null ? String(e.value) : "—"}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

type VisitStatus = "no_events" | "active" | "error";
type Activity = {
  lastVisit: { at: string } | null;
  lastRegistration: { at: string } | null;
  lastPurchase: { at: string } | null;
  recentEvents: Array<{ time: string; event_type: string; visitor_id: string | null; utm_source: string | null; value: number | null }>;
};

export default function PixelsPageClient() {
  const searchParams = useSearchParams();
  const projectId = searchParams.get("project_id")?.trim() ?? null;

  const [origin, setOrigin] = useState("");
  const [activeTab, setActiveTab] = useState<(typeof TABS)[number]["id"]>("pixel");
  const [copied, setCopied] = useState(false);
  const [visitStatus, setVisitStatus] = useState<VisitStatus | null>(null);
  const [visitLoading, setVisitLoading] = useState(true);
  const [activity, setActivity] = useState<Activity | null>(null);
  const [activityLoading, setActivityLoading] = useState(true);
  const [eventsOpen, setEventsOpen] = useState(false);
  const [conversionTab, setConversionTab] = useState<"registration" | "purchase">("registration");
  const [regOptional, setRegOptional] = useState({ email: false, phone: false, metadata: false });
  const [purchaseOptional, setPurchaseOptional] = useState({ email: false, phone: false, metadata: false });
  const [conversionCodeTab, setConversionCodeTab] = useState<"fetch" | "curl">("fetch");
  const [ingestKey, setIngestKey] = useState<string | null>(null);
  const [ingestKeyLoading, setIngestKeyLoading] = useState(false);
  const [canManageIngestKey, setCanManageIngestKey] = useState(false);
  const [canRegenerateIngestKey, setCanRegenerateIngestKey] = useState(false);
  const [regenerateIngestLoading, setRegenerateIngestLoading] = useState(false);
  const [testEventStatus, setTestEventStatus] = useState<"idle" | "loading" | "success" | "error">("idle");
  const [deleteTestConfirmOpen, setDeleteTestConfirmOpen] = useState(false);
  const [deleteTestLoading, setDeleteTestLoading] = useState(false);
  const [toastMessage, setToastMessage] = useState<{ text: string; type: "success" | "info" } | null>(null);

  useEffect(() => setOrigin(typeof window !== "undefined" ? window.location.origin : ""), []);

  const apiBase = origin || "https://YOUR_DOMAIN";
  const projectIdPlaceholder = projectId || "PROJECT_ID";

  const copyToClipboard = useCallback(async (text: string) => {
    if (!text) return;
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      const ta = document.createElement("textarea");
      ta.value = text;
      document.body.appendChild(ta);
      ta.select();
      document.execCommand("copy");
      document.body.removeChild(ta);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }
  }, []);

  const fetchVisitStatus = useCallback(async () => {
    if (!projectId) return;
    setVisitLoading(true);
    try {
      const res = await fetch(`/api/tracking/source/status?site_id=${encodeURIComponent(projectId)}`, { cache: "no-store" });
      const json = await res.json();
      setVisitStatus(json?.success && json.status === "active" ? "active" : json?.success ? "no_events" : "error");
    } catch {
      setVisitStatus("no_events");
    } finally {
      setVisitLoading(false);
    }
  }, [projectId]);

  const fetchActivity = useCallback(async () => {
    if (!projectId) return;
    setActivityLoading(true);
    try {
      const res = await fetch(`/api/tracking/activity?project_id=${encodeURIComponent(projectId)}`, { cache: "no-store" });
      const json = await res.json();
      if (json?.success) {
        setActivity({
          lastVisit: json.lastVisit ?? null,
          lastRegistration: json.lastRegistration ?? null,
          lastPurchase: json.lastPurchase ?? null,
          recentEvents: json.recentEvents ?? [],
        });
      }
    } catch {
      setActivity(null);
    } finally {
      setActivityLoading(false);
    }
  }, [projectId]);

  const fetchIngestKey = useCallback(async () => {
    if (!projectId) return;
    setIngestKeyLoading(true);
    try {
      const res = await fetch(`/api/projects/ingest-key?project_id=${encodeURIComponent(projectId)}`, { cache: "no-store" });
      const json = await res.json();
      if (json?.success) {
        setIngestKey(json.public_ingest_key ?? null);
        setCanManageIngestKey(!!json.can_manage_ingest_key);
        setCanRegenerateIngestKey(!!json.can_regenerate);
      } else {
        setIngestKey(null);
        setCanManageIngestKey(false);
        setCanRegenerateIngestKey(false);
      }
    } catch {
      setIngestKey(null);
      setCanManageIngestKey(false);
      setCanRegenerateIngestKey(false);
    } finally {
      setIngestKeyLoading(false);
    }
  }, [projectId]);

  const regenerateIngestKey = useCallback(async () => {
    if (!projectId || !canRegenerateIngestKey) return;
    setRegenerateIngestLoading(true);
    try {
      const res = await fetch("/api/projects/ingest-key/regenerate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ project_id: projectId }),
      });
      const json = await res.json();
      if (json?.success && json.public_ingest_key) {
        setIngestKey(json.public_ingest_key);
      }
    } finally {
      setRegenerateIngestLoading(false);
    }
  }, [projectId, canRegenerateIngestKey]);

  const sendTestEvent = useCallback(async () => {
    if (!projectId || !ingestKey || !canManageIngestKey) return;
    setTestEventStatus("loading");
    const ts = Date.now();
    const boardiq = typeof window !== "undefined" ? (window as unknown as { BoardIQ?: { getVisitorId?: () => string; getSessionId?: () => string; getClickId?: () => string } }).BoardIQ : undefined;
    const visitorId = boardiq?.getVisitorId?.() ?? undefined;
    const sessionId = boardiq?.getSessionId?.() ?? undefined;
    const clickId = boardiq?.getClickId?.() ?? undefined;
    const baseIds = {
      user_external_id: `test_user_${ts}`,
      ...(visitorId && { visitor_id: visitorId }),
      ...(sessionId && { session_id: sessionId }),
      ...(clickId && { click_id: clickId }),
    };
    const testMetadata = { generated_from: "bq_pixel_test_ui", is_test: true };
    const body =
      conversionTab === "registration"
        ? {
            project_id: projectId,
            event_name: "registration",
            ...baseIds,
            metadata: testMetadata,
          }
        : {
            project_id: projectId,
            event_name: "purchase",
            ...baseIds,
            external_event_id: `test_order_${ts}`,
            value: 1,
            currency: "USD",
            metadata: testMetadata,
          };
    try {
      const res = await fetch(`${typeof window !== "undefined" ? window.location.origin : ""}/api/tracking/conversion`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-BoardIQ-Key": ingestKey,
        },
        body: JSON.stringify(body),
      });
      const json = await res.json().catch(() => ({}));
      if (res.ok && json?.success) {
        setTestEventStatus("success");
        fetchActivity();
        setTimeout(() => setTestEventStatus("idle"), 4000);
      } else {
        setTestEventStatus("error");
        setTimeout(() => setTestEventStatus("idle"), 4000);
      }
    } catch {
      setTestEventStatus("error");
      setTimeout(() => setTestEventStatus("idle"), 4000);
    }
  }, [projectId, ingestKey, canManageIngestKey, conversionTab, fetchActivity]);

  const deleteTestConversions = useCallback(async () => {
    if (!projectId) return;
    setDeleteTestLoading(true);
    try {
      const res = await fetch("/api/pixels/delete-test-conversions", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ project_id: projectId }),
      });
      const json = await res.json().catch(() => ({}));
      setDeleteTestConfirmOpen(false);
      if (res.ok && json?.success) {
        const deleted = json.deleted ?? 0;
        setToastMessage({
          text: deleted > 0 ? `Удалено ${deleted} тестовых конверсий` : "Тестовые конверсии не найдены.",
          type: deleted > 0 ? "success" : "info",
        });
        fetchActivity();
      } else {
        setToastMessage({ text: json?.error ?? "Ошибка удаления", type: "info" });
      }
    } catch {
      setDeleteTestConfirmOpen(false);
      setToastMessage({ text: "Ошибка удаления", type: "info" });
    } finally {
      setDeleteTestLoading(false);
    }
  }, [projectId, fetchActivity]);

  useEffect(() => {
    if (!toastMessage) return;
    const t = setTimeout(() => setToastMessage(null), 4000);
    return () => clearTimeout(t);
  }, [toastMessage]);

  useEffect(() => {
    fetchVisitStatus();
    fetchActivity();
  }, [fetchVisitStatus, fetchActivity]);

  useEffect(() => {
    fetchIngestKey();
  }, [fetchIngestKey]);

  const hasVisits = visitStatus === "active";
  const hasRegistration = !!activity?.lastRegistration;
  const hasPurchase = !!activity?.lastPurchase;

  const pixelScriptStatus: StatusKind = projectId && origin ? "green" : "red";
  const visitTrackingStatus: StatusKind = visitLoading ? "yellow" : hasVisits ? "green" : projectId ? "yellow" : "red";
  const conversionTrackingStatus: StatusKind = activityLoading ? "yellow" : hasPurchase ? "green" : hasRegistration ? "yellow" : "red";

  const visitRecency = getVisitRecency(activity?.lastVisit?.at ?? null);
  const regRecency = getConversionRecency(activity?.lastRegistration?.at ?? null);
  const purchaseRecency = getConversionRecency(activity?.lastPurchase?.at ?? null);

  const snippetPixel = `<script
  defer
  src="${apiBase}/tracker.js"
  data-project-id="${projectIdPlaceholder}">
</script>`;

  const snippetGTM = `<script
src="${apiBase}/tracker.js"
data-project-id="${projectIdPlaceholder}">
</script>`;

  const ingestKeyDisplay = canManageIngestKey ? (ingestKey ?? "YOUR_PUBLIC_INGEST_KEY") : "YOUR_PUBLIC_INGEST_KEY";

  const buildRegBody = (): Record<string, string | number> => {
    const o: Record<string, string | number> = {
      project_id: projectIdPlaceholder,
      event_name: "registration",
      user_external_id: "user_123",
      visitor_id: "...",
      session_id: "...",
      click_id: "...",
    };
    if (regOptional.email) o.email = "user@example.com";
    if (regOptional.phone) o.phone = "+79001234567";
    if (regOptional.metadata) o.metadata = "{}";
    return o;
  };

  const buildPurchaseBody = (): Record<string, string | number> => {
    const o: Record<string, string | number> = {
      project_id: projectIdPlaceholder,
      event_name: "purchase",
      user_external_id: "user_123",
      visitor_id: "...",
      session_id: "...",
      click_id: "...",
      external_event_id: "order_789",
      value: 120,
      currency: "USD",
    };
    if (purchaseOptional.email) o.email = "user@example.com";
    if (purchaseOptional.phone) o.phone = "+79001234567";
    if (purchaseOptional.metadata) o.metadata = "{}";
    return o;
  };

  const regBody = buildRegBody();
  const purchaseBody = buildPurchaseBody();
  const generatedRegJson = JSON.stringify(regBody, null, 2);
  const generatedPurchaseJson = JSON.stringify(purchaseBody, null, 2);
  const regJsonCompact = JSON.stringify(regBody);
  const purchaseJsonCompact = JSON.stringify(purchaseBody);

  const fullRequestReg = `POST ${apiBase}/api/tracking/conversion

Headers:
Content-Type: application/json
X-BoardIQ-Key: ${ingestKeyDisplay}

Body:
${generatedRegJson}`;

  const fullRequestPurchase = `POST ${apiBase}/api/tracking/conversion

Headers:
Content-Type: application/json
X-BoardIQ-Key: ${ingestKeyDisplay}

Body:
${generatedPurchaseJson}`;

  const snippetRegFetch = `fetch("${apiBase}/api/tracking/conversion", {
  method: "POST",
  headers: {
    "Content-Type": "application/json",
    "X-BoardIQ-Key": "${ingestKeyDisplay}"
  },
  body: JSON.stringify({
    project_id: "${projectIdPlaceholder}",
    event_name: "registration",
    user_external_id: "user_123",
    visitor_id: window.BoardIQ ? window.BoardIQ.getVisitorId() : undefined,
    session_id: window.BoardIQ ? window.BoardIQ.getSessionId() : undefined,
    click_id: window.BoardIQ ? window.BoardIQ.getClickId() : undefined
  })
});`;

  const snippetRegCurl = `curl -X POST "${apiBase}/api/tracking/conversion" \\
  -H "Content-Type: application/json" \\
  -H "X-BoardIQ-Key: ${ingestKeyDisplay}" \\
  -d '${regJsonCompact}'`;

  const snippetPurchaseFetch = `fetch("${apiBase}/api/tracking/conversion", {
  method: "POST",
  headers: {
    "Content-Type": "application/json",
    "X-BoardIQ-Key": "${ingestKeyDisplay}"
  },
  body: JSON.stringify({
    project_id: "${projectIdPlaceholder}",
    event_name: "purchase",
    user_external_id: "user_123",
    visitor_id: window.BoardIQ ? window.BoardIQ.getVisitorId() : undefined,
    session_id: window.BoardIQ ? window.BoardIQ.getSessionId() : undefined,
    click_id: window.BoardIQ ? window.BoardIQ.getClickId() : undefined,
    external_event_id: "order_789",
    value: 120,
    currency: "USD"
  })
});`;

  const snippetPurchaseCurl = `curl -X POST "${apiBase}/api/tracking/conversion" \\
  -H "Content-Type: application/json" \\
  -H "X-BoardIQ-Key: ${ingestKeyDisplay}" \\
  -d '${purchaseJsonCompact}'`;

  const snippetCrmPayload = `{
  "event_name": "purchase",
  "project_id": "${projectIdPlaceholder}",
  "user_external_id": "...",
  "visitor_id": "...",
  "session_id": "...",
  "click_id": "...",
  "external_event_id": "order_123",
  "value": 120,
  "currency": "USD"
}`;

  if (!projectId) {
    return (
      <div className="flex min-h-[280px] items-center justify-center p-6">
        <div className="text-center">
          <div className="text-base font-semibold text-neutral-300">Проект не выбран</div>
          <div className="mt-2 text-sm text-neutral-500">
            <code className="rounded bg-neutral-800 px-2 py-1 text-neutral-400">?project_id=ID</code>
          </div>
        </div>
      </div>
    );
  }

  const eventCount = activity?.recentEvents?.length ?? 0;

  return (
    <div className="mx-auto w-full max-w-7xl p-6 pb-12">
      {/* Hero */}
      <div className="mb-6">
        <h1 className="text-2xl font-semibold tracking-tight text-white">BQ Pixel</h1>
        <p className="mt-1 max-w-2xl text-sm text-neutral-400">
          Подключите пиксель для отслеживания визитов, регистраций и покупок. Это позволит считать CAC, ROAS и реальную эффективность каналов.
        </p>
        <div className="mt-4 grid grid-cols-1 gap-2 sm:grid-cols-3">
          <StatusCard title="Pixel script" status={pixelScriptStatus} loading={!origin} />
          <StatusCard title="Visit tracking" status={visitTrackingStatus} loading={visitLoading} />
          <StatusCard title="Conversion tracking" status={conversionTrackingStatus} loading={activityLoading} />
        </div>
      </div>

      {/* Pixel activity */}
      <section className="mb-6 rounded-xl border border-neutral-800 bg-neutral-900/60 p-4 shadow">
        <div className="flex items-center justify-between">
          <h3 className="text-sm font-semibold text-white">Pixel activity</h3>
          <button type="button" onClick={() => { fetchVisitStatus(); fetchActivity(); }} className="rounded px-2 py-1 text-xs text-neutral-400 hover:bg-neutral-800">Обновить</button>
        </div>
        <div className="mt-3 grid gap-3 sm:grid-cols-3">
          <ActivityCard title="Last visit" at={activity?.lastVisit?.at ?? null} recency={visitRecency} loading={activityLoading} />
          <ActivityCard title="Last registration" at={activity?.lastRegistration?.at ?? null} recency={regRecency} loading={activityLoading} />
          <ActivityCard title="Last purchase" at={activity?.lastPurchase?.at ?? null} recency={purchaseRecency} loading={activityLoading} />
        </div>
      </section>

      {/* Tabs */}
      <div className="mb-4 flex gap-1 rounded-xl bg-neutral-900/80 p-1 ring-1 ring-neutral-800">
        {TABS.map((tab) => (
          <button
            key={tab.id}
            type="button"
            onClick={() => setActiveTab(tab.id)}
            className={cx(
              "flex flex-1 items-center justify-center gap-1.5 rounded-lg px-3 py-2 text-sm font-medium transition-colors",
              activeTab === tab.id ? "bg-neutral-800 text-white shadow-sm" : "text-neutral-400 hover:text-neutral-200"
            )}
          >
            <span>{tab.icon}</span>
            {tab.label}
          </button>
        ))}
      </div>

      {/* Tab content */}
      <div className="rounded-xl border border-neutral-800 bg-neutral-900/60 p-5 shadow-lg">
        {activeTab === "pixel" && (
          <>
            <h2 className="text-base font-semibold text-white">Установка пикселя</h2>
            <p className="mt-1 text-xs text-neutral-400">Скрипт перед <code className="rounded bg-neutral-800 px-1">&lt;/body&gt;</code></p>
            <div className="mt-3">
              <CodeBlock code={snippetPixel} onCopy={copyToClipboard} copied={copied} copyLabel="Copy code" />
            </div>
            <div className="mt-4 rounded-lg border border-emerald-500/20 bg-emerald-500/5 p-3">
              <div className="text-xs font-medium text-emerald-200">Automatic tracking</div>
              <p className="mt-0.5 text-xs text-neutral-400">Визиты и UTM фиксируются без доп. кода.</p>
              <div className="mt-2 flex flex-wrap gap-1.5">
                {AUTO_COLLECTED.map((k) => (
                  <span key={k} className="rounded border border-neutral-700 bg-neutral-800/80 px-2 py-0.5 font-mono text-[10px] text-neutral-300">{k}</span>
                ))}
              </div>
            </div>
          </>
        )}

        {activeTab === "gtm" && (
          <>
            <h2 className="text-base font-semibold text-white">Google Tag Manager</h2>
            <div className="mt-4 flex flex-wrap items-center gap-2">
              {GTM_STEPS.map((step, i) => (
                <span key={i} className="flex items-center gap-2">
                  <span className="rounded-full bg-neutral-700 px-2.5 py-1 text-xs font-medium text-white">{i + 1}. {step}</span>
                  {i < GTM_STEPS.length - 1 && <span className="text-neutral-600">→</span>}
                </span>
              ))}
            </div>
            <div className="mt-4">
              <CodeBlock code={snippetGTM} onCopy={copyToClipboard} copied={copied} copyLabel="Copy code" />
            </div>
          </>
        )}

        {activeTab === "conversion" && (
          <>
            <h2 className="text-base font-semibold text-white">Conversion events</h2>
            <p className="mt-1 text-xs text-neutral-400">BoardIQ automatically collects visitor_id, session_id, UTM and click identifiers. Send conversion events with the project ingest key in request headers.</p>
            <div className="mt-3 rounded-lg border border-emerald-500/25 bg-emerald-500/10 px-3 py-2">
              <div className="text-[10px] font-semibold uppercase text-emerald-300">Recommended for attribution (click → visit → registration → purchase)</div>
              <p className="mt-1 text-[11px] text-neutral-300">For registration and purchase always pass these four identifiers when available:</p>
              <ul className="mt-1.5 space-y-0.5 text-[11px] text-neutral-400">
                <li><code className="text-neutral-200">user_external_id</code> — внутренний ID пользователя в вашей системе</li>
                <li><code className="text-neutral-200">visitor_id</code> — идентификатор посетителя (из пикселя: <code>BoardIQ.getVisitorId()</code>)</li>
                <li><code className="text-neutral-200">session_id</code> — идентификатор текущей сессии (<code>BoardIQ.getSessionId()</code>)</li>
                <li><code className="text-neutral-200">click_id</code> — идентификатор рекламного клика после redirect (<code>BoardIQ.getClickId()</code>)</li>
              </ul>
            </div>

            {/* Public ingest key — inside Conversion events */}
            <div className="mt-4 rounded-xl border border-neutral-700 bg-neutral-900/60 px-4 py-3">
              <div className="text-xs font-semibold text-white">Public ingest key</div>
              <div className="mt-2 flex flex-wrap items-center gap-2">
                {ingestKeyLoading ? (
                  <span className="text-xs text-neutral-500">Загрузка…</span>
                ) : ingestKey ? (
                  <>
                    <code className="rounded border border-neutral-700 bg-neutral-950 px-2 py-1 font-mono text-[11px] text-neutral-300 max-w-full truncate">
                      {ingestKey}
                    </code>
                    {canManageIngestKey && (
                      <>
                        <button
                          type="button"
                          onClick={() => copyToClipboard(ingestKey)}
                          className={cx(
                            "rounded px-2 py-1 text-xs font-medium",
                            copied ? "bg-emerald-500/20 text-emerald-300" : "bg-neutral-800 text-neutral-300 hover:bg-neutral-700"
                          )}
                        >
                          {copied ? "Скопировано" : "Copy"}
                        </button>
                        {canRegenerateIngestKey && (
                          <button
                            type="button"
                            onClick={regenerateIngestKey}
                            disabled={regenerateIngestLoading}
                            className="rounded border border-amber-500/40 bg-amber-500/10 px-2 py-1 text-xs text-amber-200 hover:bg-amber-500/20 disabled:opacity-50"
                          >
                            {regenerateIngestLoading ? "…" : "Regenerate"}
                          </button>
                        )}
                      </>
                    )}
                  </>
                ) : (
                  <>
                    <span className="text-xs text-neutral-500">Ключ не сгенерирован</span>
                    {canRegenerateIngestKey && (
                      <button
                        type="button"
                        onClick={regenerateIngestKey}
                        disabled={regenerateIngestLoading}
                        className="rounded bg-neutral-700 px-2 py-1 text-xs text-white hover:bg-neutral-600 disabled:opacity-50"
                      >
                        {regenerateIngestLoading ? "…" : "Generate key"}
                      </button>
                    )}
                  </>
                )}
              </div>
              {canManageIngestKey && canRegenerateIngestKey && (ingestKey || regenerateIngestLoading) && (
                <p className="mt-1.5 text-[11px] text-amber-200/90">Regenerating the key will require updating client integrations.</p>
              )}
              {!canManageIngestKey && ingestKey && (
                <p className="mt-1.5 text-[11px] text-neutral-500">Only project admins can view or regenerate the full ingest key.</p>
              )}
            </div>

            <div className="mt-4 rounded-lg border-2 border-amber-500/40 bg-amber-500/10 px-3 py-3">
              <div className="text-sm font-semibold text-amber-200">Authentication</div>
              <p className="mt-1.5 text-xs text-neutral-300">
                Use the project public ingest key in request headers. Do not place the token in the URL. Do not use admin or service tokens on the frontend.
              </p>
              <div className="mt-2 rounded border border-neutral-700/80 bg-neutral-900/60 px-2 py-2 font-mono text-[11px] text-neutral-200">
                <div className="text-neutral-500">Headers</div>
                <div>Content-Type: application/json</div>
                <div>X-BoardIQ-Key: {ingestKeyDisplay}</div>
              </div>
            </div>

            <div className="mt-4 flex gap-2">
              <button
                type="button"
                onClick={() => setConversionTab("registration")}
                className={conversionTab === "registration" ? "rounded-md bg-neutral-800 px-3 py-1.5 text-sm font-medium text-white" : "rounded-md bg-neutral-900 px-3 py-1.5 text-sm text-neutral-400 hover:text-neutral-200"}
              >
                Registration
              </button>
              <button
                type="button"
                onClick={() => setConversionTab("purchase")}
                className={conversionTab === "purchase" ? "rounded-md bg-neutral-800 px-3 py-1.5 text-sm font-medium text-white" : "rounded-md bg-neutral-900 px-3 py-1.5 text-sm text-neutral-400 hover:text-neutral-200"}
              >
                Purchase
              </button>
            </div>

            {/* Test conversion event */}
            <div className="mt-4 rounded-lg border border-neutral-700 bg-neutral-800/40 px-3 py-2">
              <div className="flex flex-wrap items-center gap-2">
                <span className="text-xs font-semibold text-white">Test conversion event</span>
                {canManageIngestKey && ingestKey ? (
                  <>
                    <button
                      type="button"
                      onClick={sendTestEvent}
                      disabled={testEventStatus === "loading"}
                      className="rounded bg-emerald-600 px-2.5 py-1 text-xs font-medium text-white hover:bg-emerald-500 disabled:opacity-60"
                    >
                      {testEventStatus === "loading" ? "Sending…" : conversionTab === "registration" ? "Send test registration" : "Send test purchase"}
                    </button>
                    <span className="text-neutral-600">|</span>
                    <button
                      type="button"
                      onClick={() => setDeleteTestConfirmOpen(true)}
                      disabled={deleteTestLoading}
                      className="rounded bg-amber-500/90 px-2.5 py-1 text-xs font-medium text-neutral-900 hover:bg-amber-500 disabled:opacity-60"
                    >
                      {deleteTestLoading ? "…" : "Удалить тестовые конверсии"}
                    </button>
                    {testEventStatus === "success" && <span className="text-xs text-emerald-400">Event sent successfully. Check Pixel activity or Recent pixel events below.</span>}
                    {testEventStatus === "error" && <span className="text-xs text-red-400">Failed to send test event.</span>}
                  </>
                ) : (
                  <span className="text-[11px] text-neutral-500">Only project admins with an ingest key can send test events.</span>
                )}
              </div>
            </div>

            {/* Confirm delete test conversions */}
            {deleteTestConfirmOpen && (
              <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/60" role="dialog" aria-modal="true">
                <div className="mx-4 max-w-md rounded-xl border border-neutral-600 bg-neutral-900 p-4 shadow-xl">
                  <p className="text-sm font-medium text-white">
                    Удалить тестовые конверсии, созданные через этот тестовый интерфейс?
                  </p>
                  <p className="mt-2 text-xs text-neutral-400">
                    Реальные события и production данные затронуты не будут.
                  </p>
                  <div className="mt-4 flex justify-end gap-2">
                    <button
                      type="button"
                      onClick={() => setDeleteTestConfirmOpen(false)}
                      disabled={deleteTestLoading}
                      className="rounded bg-neutral-700 px-3 py-1.5 text-xs font-medium text-white hover:bg-neutral-600 disabled:opacity-50"
                    >
                      Cancel
                    </button>
                    <button
                      type="button"
                      onClick={deleteTestConversions}
                      disabled={deleteTestLoading}
                      className="rounded bg-amber-500 px-3 py-1.5 text-xs font-medium text-neutral-900 hover:bg-amber-400 disabled:opacity-50"
                    >
                      {deleteTestLoading ? "…" : "Delete test conversions"}
                    </button>
                  </div>
                </div>
              </div>
            )}

            {/* Toast after delete */}
            {toastMessage && (
              <div
                className={cx(
                  "fixed bottom-4 right-4 z-[100] rounded-lg border px-4 py-2 text-sm font-medium shadow-lg",
                  toastMessage.type === "success"
                    ? "border-emerald-600/50 bg-emerald-900/90 text-emerald-100"
                    : "border-neutral-600 bg-neutral-800 text-neutral-200"
                )}
              >
                {toastMessage.text}
              </div>
            )}

            {conversionTab === "registration" && (
              <div className="mt-4 space-y-3">
                <h3 className="text-sm font-medium text-white">Registration event</h3>
                <div className="grid gap-3 sm:grid-cols-2">
                  <div className="rounded-lg border border-neutral-700 bg-neutral-800/50 px-3 py-2">
                    <div className="text-[10px] font-semibold uppercase text-emerald-400">Required</div>
                    <ul className="mt-1 space-y-0.5 text-[11px] text-neutral-300">
                      <li><code className="text-neutral-200">project_id</code> — UUID проекта в BoardIQ</li>
                      <li><code className="text-neutral-200">event_name</code> — always &quot;registration&quot;</li>
                      <li><code className="text-neutral-200">user_external_id</code> — внутренний ID пользователя в системе клиента</li>
                      <li><code className="text-neutral-200">visitor_id</code>, <code>session_id</code>, <code>click_id</code> — рекомендуются для атрибуции (из BoardIQ)</li>
                    </ul>
                  </div>
                  <div className="rounded-lg border border-neutral-700 bg-neutral-800/50 px-3 py-2">
                    <div className="text-[10px] font-semibold uppercase text-neutral-400">Optional</div>
                    <ul className="mt-1 space-y-0.5 text-[11px] text-neutral-400">
                      <li><code>email</code> — email пользователя</li>
                      <li><code>phone</code> — телефон пользователя</li>
                      <li><code>metadata</code> — дополнительные JSON-данные</li>
                    </ul>
                  </div>
                </div>
                <div className="flex flex-wrap gap-4">
                  <div className="rounded border border-neutral-700 bg-neutral-900/60 px-3 py-2">
                    <div className="text-[10px] font-semibold uppercase text-neutral-500 mb-1.5">Include in example</div>
                    <label className="flex items-center gap-2 text-xs text-neutral-400"><input type="checkbox" checked disabled className="rounded" /> project_id</label>
                    <label className="flex items-center gap-2 text-xs text-neutral-400"><input type="checkbox" checked disabled className="rounded" /> event_name</label>
                    <label className="flex items-center gap-2 text-xs text-neutral-400"><input type="checkbox" checked disabled className="rounded" /> user_external_id</label>
                    <label className="flex items-center gap-2 text-xs text-neutral-400"><input type="checkbox" checked disabled className="rounded" /> visitor_id, session_id, click_id</label>
                    <label className="flex items-center gap-2 text-xs text-neutral-400"><input type="checkbox" checked={regOptional.email} onChange={(e) => setRegOptional((o) => ({ ...o, email: e.target.checked }))} className="rounded" /> email</label>
                    <label className="flex items-center gap-2 text-xs text-neutral-400"><input type="checkbox" checked={regOptional.phone} onChange={(e) => setRegOptional((o) => ({ ...o, phone: e.target.checked }))} className="rounded" /> phone</label>
                    <label className="flex items-center gap-2 text-xs text-neutral-400"><input type="checkbox" checked={regOptional.metadata} onChange={(e) => setRegOptional((o) => ({ ...o, metadata: e.target.checked }))} className="rounded" /> metadata</label>
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="text-[10px] font-semibold uppercase text-neutral-500 mb-0.5">Full request example</div>
                    <p className="text-[11px] text-neutral-500 mb-1">Complete HTTP request structure.</p>
                    <div className="overflow-x-auto rounded-lg border border-neutral-700 bg-neutral-950">
                      <CodeBlock code={fullRequestReg} onCopy={copyToClipboard} copied={copied} copyLabel="Copy" />
                    </div>
                    <div className="mt-2 flex gap-1 rounded-lg bg-neutral-900/80 p-1">
                      <button type="button" onClick={() => setConversionCodeTab("fetch")} className={cx("rounded px-2 py-1 text-xs font-medium", conversionCodeTab === "fetch" ? "bg-neutral-700 text-white" : "text-neutral-400 hover:text-neutral-200")}>Client-side (JavaScript)</button>
                      <button type="button" onClick={() => setConversionCodeTab("curl")} className={cx("rounded px-2 py-1 text-xs font-medium", conversionCodeTab === "curl" ? "bg-neutral-700 text-white" : "text-neutral-400 hover:text-neutral-200")}>Server-side / API test (cURL)</button>
                    </div>
                    <p className="mt-1 text-[11px] text-neutral-500">
                      {conversionCodeTab === "fetch" ? "Use on website frontend after registration/purchase." : "Use for backend integration or quick testing."}
                    </p>
                    <div className="mt-0.5 overflow-x-auto rounded-lg border border-neutral-800 bg-neutral-950">
                      <CodeBlock code={conversionCodeTab === "fetch" ? snippetRegFetch : snippetRegCurl} onCopy={copyToClipboard} copied={copied} copyLabel="Copy" />
                    </div>
                  </div>
                </div>
              </div>
            )}

            {conversionTab === "purchase" && (
              <div className="mt-4 space-y-3">
                <h3 className="text-sm font-medium text-white">Purchase event</h3>
                <div className="grid gap-3 sm:grid-cols-2">
                  <div className="rounded-lg border border-neutral-700 bg-neutral-800/50 px-3 py-2">
                    <div className="text-[10px] font-semibold uppercase text-emerald-400">Required</div>
                    <ul className="mt-1 space-y-0.5 text-[11px] text-neutral-300">
                      <li><code className="text-neutral-200">project_id</code> — UUID проекта в BoardIQ</li>
                      <li><code className="text-neutral-200">event_name</code> — always &quot;purchase&quot;</li>
                      <li><code className="text-neutral-200">user_external_id</code> — внутренний ID пользователя</li>
                      <li><code className="text-neutral-200">visitor_id</code>, <code>session_id</code>, <code>click_id</code> — рекомендуются для атрибуции (из BoardIQ)</li>
                      <li><code className="text-neutral-200">external_event_id</code> — ID заказа / платежа</li>
                      <li><code className="text-neutral-200">value</code> — сумма покупки</li>
                      <li><code className="text-neutral-200">currency</code> — валюта события</li>
                    </ul>
                  </div>
                  <div className="rounded-lg border border-neutral-700 bg-neutral-800/50 px-3 py-2">
                    <div className="text-[10px] font-semibold uppercase text-neutral-400">Optional</div>
                    <ul className="mt-1 space-y-0.5 text-[11px] text-neutral-400">
                      <li><code>email</code> — email пользователя</li>
                      <li><code>phone</code> — телефон пользователя</li>
                      <li><code>metadata</code> — дополнительные JSON-данные</li>
                    </ul>
                  </div>
                </div>
                <div className="rounded-lg border border-neutral-700 bg-neutral-800/40 px-3 py-2">
                  <div className="text-[10px] font-semibold text-neutral-300">Supported currencies</div>
                  <p className="mt-0.5 text-[11px] text-neutral-400">USD, KZT</p>
                  <p className="text-[11px] text-neutral-500">currency is required for purchase events. Currently supported: USD and KZT.</p>
                </div>
                <div className="flex flex-wrap gap-4">
                  <div className="rounded border border-neutral-700 bg-neutral-900/60 px-3 py-2">
                    <div className="text-[10px] font-semibold uppercase text-neutral-500 mb-1.5">Include in example</div>
                    <label className="flex items-center gap-2 text-xs text-neutral-400"><input type="checkbox" checked disabled className="rounded" /> project_id</label>
                    <label className="flex items-center gap-2 text-xs text-neutral-400"><input type="checkbox" checked disabled className="rounded" /> event_name</label>
                    <label className="flex items-center gap-2 text-xs text-neutral-400"><input type="checkbox" checked disabled className="rounded" /> user_external_id</label>
                    <label className="flex items-center gap-2 text-xs text-neutral-400"><input type="checkbox" checked disabled className="rounded" /> visitor_id, session_id, click_id</label>
                    <label className="flex items-center gap-2 text-xs text-neutral-400"><input type="checkbox" checked disabled className="rounded" /> external_event_id</label>
                    <label className="flex items-center gap-2 text-xs text-neutral-400"><input type="checkbox" checked disabled className="rounded" /> value</label>
                    <label className="flex items-center gap-2 text-xs text-neutral-400"><input type="checkbox" checked disabled className="rounded" /> currency</label>
                    <label className="flex items-center gap-2 text-xs text-neutral-400"><input type="checkbox" checked={purchaseOptional.email} onChange={(e) => setPurchaseOptional((o) => ({ ...o, email: e.target.checked }))} className="rounded" /> email</label>
                    <label className="flex items-center gap-2 text-xs text-neutral-400"><input type="checkbox" checked={purchaseOptional.phone} onChange={(e) => setPurchaseOptional((o) => ({ ...o, phone: e.target.checked }))} className="rounded" /> phone</label>
                    <label className="flex items-center gap-2 text-xs text-neutral-400"><input type="checkbox" checked={purchaseOptional.metadata} onChange={(e) => setPurchaseOptional((o) => ({ ...o, metadata: e.target.checked }))} className="rounded" /> metadata</label>
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="text-[10px] font-semibold uppercase text-neutral-500 mb-0.5">Full request example</div>
                    <p className="text-[11px] text-neutral-500 mb-1">Complete HTTP request structure.</p>
                    <div className="overflow-x-auto rounded-lg border border-neutral-700 bg-neutral-950">
                      <CodeBlock code={fullRequestPurchase} onCopy={copyToClipboard} copied={copied} copyLabel="Copy" />
                    </div>
                    <div className="mt-2 flex gap-1 rounded-lg bg-neutral-900/80 p-1">
                      <button type="button" onClick={() => setConversionCodeTab("fetch")} className={cx("rounded px-2 py-1 text-xs font-medium", conversionCodeTab === "fetch" ? "bg-neutral-700 text-white" : "text-neutral-400 hover:text-neutral-200")}>Client-side (JavaScript)</button>
                      <button type="button" onClick={() => setConversionCodeTab("curl")} className={cx("rounded px-2 py-1 text-xs font-medium", conversionCodeTab === "curl" ? "bg-neutral-700 text-white" : "text-neutral-400 hover:text-neutral-200")}>Server-side / API test (cURL)</button>
                    </div>
                    <p className="mt-1 text-[11px] text-neutral-500">
                      {conversionCodeTab === "fetch" ? "Use on website frontend after registration/purchase." : "Use for backend integration or quick testing."}
                    </p>
                    <div className="mt-0.5 overflow-x-auto rounded-lg border border-neutral-800 bg-neutral-950">
                      <CodeBlock code={conversionCodeTab === "fetch" ? snippetPurchaseFetch : snippetPurchaseCurl} onCopy={copyToClipboard} copied={copied} copyLabel="Copy" />
                    </div>
                  </div>
                </div>
              </div>
            )}
          </>
        )}

        {activeTab === "crm" && (
          <>
            <h2 className="text-base font-semibold text-white">CRM integration</h2>
            <div className="mt-4">
              <button type="button" disabled className="cursor-not-allowed rounded-lg border border-neutral-600 bg-neutral-800 px-4 py-2 text-sm font-medium text-neutral-500">
                Connect CRM — Coming soon
              </button>
            </div>
            <div className="mt-4 rounded-lg border border-neutral-700 bg-neutral-800/50 p-3">
              <div className="text-xs font-semibold text-neutral-300">Field mapping</div>
              <ul className="mt-2 space-y-1 text-[11px] text-neutral-400">
                {CRM_MAPPING.map((r, i) => (
                  <li key={i} className="flex gap-2">
                    <span className="text-neutral-500">{r.crm}</span>
                    <span>→</span>
                    <code className="text-neutral-300">{r.api}</code>
                  </li>
                ))}
              </ul>
            </div>
            <div className="mt-4 rounded-lg border-2 border-red-500/40 bg-red-500/15 p-4">
              <div className="text-xs font-semibold text-red-200">Важно</div>
              <p className="mt-2 text-sm text-red-100/90">
                Если у вас одновременно подключены сайт и CRM, обязательно используйте единый внутренний user id и единый order/payment id. Иначе система создаст дубликаты registration и purchase событий.
              </p>
            </div>
            <p className="mt-3 text-xs text-neutral-500">Сайт и CRM должны использовать согласованные идентификаторы пользователя и заказа.</p>
          </>
        )}
      </div>

      {/* Recent pixel events — collapsible */}
      <section className="mt-6 rounded-xl border border-neutral-800 bg-neutral-900/60 overflow-hidden shadow">
        <button
          type="button"
          onClick={() => setEventsOpen((o) => !o)}
          className="flex w-full items-center justify-between px-4 py-3 text-left hover:bg-neutral-800/50"
        >
          <span className="text-sm font-semibold text-white">Recent pixel events</span>
          <span className="flex items-center gap-2 text-xs text-neutral-500">
            {eventCount}
            <span className={cx("transition-transform", eventsOpen && "rotate-180")}>▼</span>
          </span>
        </button>
        {eventsOpen && (
          <div className="border-t border-neutral-800 px-4 pb-4 pt-2">
            <EventTable events={activity?.recentEvents ?? []} loading={activityLoading} />
          </div>
        )}
      </section>
    </div>
  );
}
