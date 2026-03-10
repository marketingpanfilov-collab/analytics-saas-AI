"use client";

import { useSearchParams } from "next/navigation";
import { useEffect, useState, useCallback } from "react";

function cx(...a: (string | false | null | undefined)[]) {
  return a.filter(Boolean).join(" ");
}

function formatRelativeTime(iso: string): string {
  try {
    const d = new Date(iso);
    const now = new Date();
    const diffMs = now.getTime() - d.getTime();
    const diffSec = Math.floor(diffMs / 1000);
    const diffMin = Math.floor(diffSec / 60);
    const diffHr = Math.floor(diffMin / 60);
    const diffDay = Math.floor(diffHr / 24);

    if (diffSec < 60) return "just now";
    if (diffMin < 60) return `${diffMin} min ago`;
    if (diffHr < 24) return `${diffHr} hr ago`;
    if (diffDay < 7) return `${diffDay} day(s) ago`;
    return d.toLocaleDateString();
  } catch {
    return iso;
  }
}

function truncateUrl(url: string | null, maxLen = 50): string {
  if (!url) return "—";
  try {
    const u = new URL(url);
    const host = u.hostname;
    const path = u.pathname + u.search;
    const full = host + path;
    return full.length > maxLen ? full.slice(0, maxLen) + "…" : full;
  } catch {
    return url.length > maxLen ? url.slice(0, maxLen) + "…" : url;
  }
}

function formatSourceClassification(s: string | null): string {
  if (!s) return "—";
  const map: Record<string, string> = {
    paid: "Paid",
    organic_search: "Organic search",
    organic_social: "Organic social",
    referral: "Referral",
    direct: "Direct",
    unknown: "Unknown",
  };
  return map[s] ?? s;
}

type InstallMethod = "browser" | "gtm" | "server";

type TrackerStatus = {
  status: "no_events" | "active" | "error";
  lastEventAt: string | null;
  lastEvent?: {
    landing_url: string | null;
    referrer: string | null;
    source_classification: string | null;
  } | null;
};

export default function PixelsPageClient() {
  const searchParams = useSearchParams();
  const projectId = searchParams.get("project_id")?.trim() ?? null;

  const [origin, setOrigin] = useState<string>("");
  const [installMethod, setInstallMethod] = useState<InstallMethod>("browser");
  const [copied, setCopied] = useState(false);
  const [status, setStatus] = useState<TrackerStatus | null>(null);
  const [statusLoading, setStatusLoading] = useState(false);

  useEffect(() => {
    setOrigin(typeof window !== "undefined" ? window.location.origin : "");
  }, []);

  const snippet =
    origin && projectId
      ? `<script src="${origin}/tracker.js?site_id=${projectId}"></script>`
      : "";

  const copyToClipboard = useCallback(
    async (text: string) => {
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
    },
    []
  );

  const fetchStatus = useCallback(async () => {
    if (!projectId) return;
    setStatusLoading(true);
    try {
      const res = await fetch(
        `/api/tracking/source/status?site_id=${encodeURIComponent(projectId)}`,
        { cache: "no-store" }
      );
      const json = (await res.json()) as {
        success?: boolean;
        status?: "no_events" | "active";
        lastEventAt?: string | null;
        lastEvent?: {
          landing_url: string | null;
          referrer: string | null;
          source_classification: string | null;
        } | null;
      };
      if (json?.success) {
        setStatus({
          status: json.status ?? "no_events",
          lastEventAt: json.lastEventAt ?? null,
          lastEvent: json.lastEvent ?? null,
        });
      } else {
        setStatus({ status: "error", lastEventAt: null });
      }
    } catch {
      setStatus({ status: "error", lastEventAt: null });
    } finally {
      setStatusLoading(false);
    }
  }, [projectId]);

  // Initial load only; polling disabled for local dev stability
  useEffect(() => {
    fetchStatus();
  }, [fetchStatus]);

  const statusLabel =
    statusLoading ? "Checking…" :
    status?.status === "active" ? "Active" :
    status?.status === "error" ? "Error" :
    "Waiting for events";

  const statusPillVariant =
    status?.status === "active" ? "success" :
    status?.status === "error" ? "error" :
    "neutral";

  if (!projectId) {
    return (
      <div className="flex min-h-[320px] items-center justify-center p-8">
        <div className="text-center">
          <div className="text-base font-semibold text-neutral-300">
            No project selected
          </div>
          <div className="mt-3 text-sm text-neutral-500">
            Open this page with{" "}
            <code className="rounded bg-neutral-800 px-2 py-1 text-neutral-400">
              ?project_id=YOUR_PROJECT_ID
            </code>
          </div>
          <div className="mt-2 text-sm text-neutral-200/70">
            Or use the sidebar to navigate from a project context.
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-4xl p-6 pb-16">
      {/* 1. Hero / overview */}
      <div className="mb-8">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
          <div>
            <h1 className="text-2xl font-semibold tracking-tight text-white">
              Tracking & Attribution
            </h1>
            <p className="mt-2 max-w-xl text-sm text-neutral-400">
              First-party source tracking captures visit attribution, UTM parameters, referrer, and click IDs
              on your site. Install the script once and we'll surface source data for your campaigns.
            </p>
            <div className="mt-4 flex flex-wrap items-center gap-3">
              <span
                className={cx(
                  "inline-flex items-center rounded-full px-3 py-1 text-xs font-medium",
                  statusPillVariant === "success" &&
                    "bg-emerald-500/15 border border-emerald-500/25 text-emerald-300",
                  statusPillVariant === "error" &&
                    "bg-red-500/15 border border-red-500/25 text-red-300",
                  statusPillVariant === "neutral" &&
                    "bg-neutral-800 border border-neutral-700 text-neutral-400"
                )}
              >
                {statusLabel}
              </span>
              <span className="text-xs text-neutral-500">
                Site ID: <code className="font-mono text-neutral-400">{projectId}</code>
              </span>
            </div>
          </div>
        </div>
      </div>

      {/* 2. Installation methods */}
      <div className="mb-6">
        <div className="flex gap-1 rounded-xl bg-neutral-900/80 p-1 ring-1 ring-neutral-800">
          {[
            { id: "browser" as const, label: "Browser Script" },
            { id: "gtm" as const, label: "Google Tag Manager" },
            { id: "server" as const, label: "Server Events", comingSoon: true },
          ].map((tab) => (
            <button
              key={tab.id}
              type="button"
              onClick={() => !tab.comingSoon && setInstallMethod(tab.id)}
              disabled={tab.comingSoon}
              className={cx(
                "flex-1 rounded-lg px-4 py-2.5 text-sm font-medium transition-colors",
                installMethod === tab.id
                  ? "bg-neutral-800 text-white shadow-sm"
                  : tab.comingSoon
                    ? "cursor-not-allowed text-neutral-400"
                    : "text-neutral-400 hover:text-neutral-200"
              )}
            >
              {tab.label}
              {tab.comingSoon && (
                <span className="ml-1.5 text-xs text-neutral-500">(coming soon)</span>
              )}
            </button>
          ))}
        </div>
      </div>

      {/* 3. Snippet block */}
      {(installMethod === "browser" || installMethod === "gtm") && (
        <div className="mb-8 rounded-2xl border border-neutral-800 bg-neutral-900/80 p-6 shadow-lg">
          <div className="mb-4 flex items-center justify-between">
            <span className="text-sm font-medium text-white">
              {installMethod === "browser" ? "Tracking script" : "GTM Custom HTML"}
            </span>
            <button
              type="button"
              onClick={() => copyToClipboard(snippet)}
              disabled={!snippet}
              className={cx(
                "flex items-center gap-2 rounded-xl px-4 py-2 text-sm font-medium transition-all",
                copied
                  ? "bg-emerald-500/20 text-emerald-300 ring-1 ring-emerald-500/30"
                  : "bg-neutral-800 text-neutral-200 ring-1 ring-neutral-700 hover:bg-neutral-700"
              )}
            >
              {copied ? "✓ Copied" : "Copy"}
            </button>
          </div>
          <pre className="overflow-x-auto rounded-xl bg-neutral-950 border border-neutral-800 px-4 py-3.5 text-sm leading-relaxed text-neutral-300">
            {snippet || "—"}
          </pre>
        </div>
      )}

      {/* 4. Installation instructions */}
      <div className="mb-8 rounded-2xl border border-neutral-800 bg-neutral-900/60 p-6">
        <h3 className="mb-4 text-sm font-semibold text-white">Installation</h3>
        {installMethod === "browser" && (
          <ul className="space-y-3 text-sm text-neutral-400">
            <li className="flex gap-2">
              <span className="text-neutral-500">1.</span>
              Place the script before <code className="rounded bg-neutral-800 px-1.5 py-0.5 text-neutral-300">&lt;/body&gt;</code> on every page.
            </li>
            <li className="flex gap-2">
              <span className="text-neutral-500">2.</span>
              Do not install twice — one script per page is enough.
            </li>
            <li className="flex gap-2">
              <span className="text-neutral-500">3.</span>
              Publish your site after adding the script.
            </li>
          </ul>
        )}
        {installMethod === "gtm" && (
          <ul className="space-y-3 text-sm text-neutral-400">
            <li className="flex gap-2">
              <span className="text-neutral-500">1.</span>
              In GTM, create a new <strong className="text-neutral-300">Custom HTML</strong> tag.
            </li>
            <li className="flex gap-2">
              <span className="text-neutral-500">2.</span>
              Paste the script above into the tag content.
            </li>
            <li className="flex gap-2">
              <span className="text-neutral-500">3.</span>
              Set trigger to <strong className="text-neutral-300">All Pages</strong>.
            </li>
            <li className="flex gap-2">
              <span className="text-neutral-500">4.</span>
              Publish your container after changes.
            </li>
          </ul>
        )}
        {installMethod === "server" && (
          <p className="text-sm text-neutral-500">
            Server-side event tracking will be available in a future version.
          </p>
        )}
      </div>

      {/* 5. Live tracker status / diagnostics */}
      <div className="mb-8 rounded-2xl border border-neutral-800 bg-neutral-900/60 p-6">
        <div className="mb-4 flex items-center justify-between">
          <h3 className="text-sm font-semibold text-white">Tracker status</h3>
          <button
            type="button"
            onClick={() => fetchStatus()}
            disabled={statusLoading || !projectId}
            className="rounded-lg px-3 py-1.5 text-xs font-medium text-neutral-300 ring-1 ring-neutral-700 hover:bg-neutral-800 disabled:opacity-50"
          >
            {statusLoading ? "Checking…" : "Refresh"}
          </button>
        </div>
        {statusLoading ? (
          <div className="text-sm text-neutral-500">Checking…</div>
        ) : status?.status === "active" ? (
          <div className="space-y-4">
            <div className="flex flex-wrap items-center gap-2">
              <span className="rounded-full bg-emerald-500/15 px-3 py-1 text-xs font-medium text-emerald-300 ring-1 ring-emerald-500/25">
                Events arriving
              </span>
              {status.lastEventAt && (
                <span className="text-xs text-neutral-500">
                  Last event: {formatRelativeTime(status.lastEventAt)}
                </span>
              )}
            </div>
            <div className="grid gap-3 rounded-xl bg-neutral-950/80 border border-neutral-800 p-4 sm:grid-cols-2">
              <div>
                <div className="text-xs text-neutral-500">Last source</div>
                <div className="mt-0.5 text-sm font-medium text-neutral-200">
                  {formatSourceClassification(status.lastEvent?.source_classification ?? null)}
                </div>
              </div>
              <div>
                <div className="text-xs text-neutral-500">Last referrer</div>
                <div className="mt-0.5 truncate text-sm text-neutral-300" title={status.lastEvent?.referrer ?? undefined}>
                  {status.lastEvent?.referrer || "—"}
                </div>
              </div>
              <div className="sm:col-span-2">
                <div className="text-xs text-neutral-500">Last landing URL</div>
                <div className="mt-0.5 truncate text-sm text-neutral-300" title={status.lastEvent?.landing_url ?? undefined}>
                  {truncateUrl(status.lastEvent?.landing_url ?? null, 60)}
                </div>
              </div>
            </div>
          </div>
        ) : status?.status === "error" ? (
          <div className="rounded-xl bg-red-500/10 border border-red-500/20 p-4 text-sm text-red-200">
            Unable to load tracker status. Please try again later.
          </div>
        ) : (
          <div className="rounded-xl bg-neutral-800/60 border border-neutral-700 p-4">
            <p className="text-sm text-neutral-400">
              No events received yet. Install the script on your site and visit a page to verify.
            </p>
            <p className="mt-2 text-xs text-neutral-500">
              Use Refresh to check again.
            </p>
          </div>
        )}
      </div>

      {/* 6. Attribution readiness */}
      <div className="mb-8 rounded-2xl border border-neutral-800 bg-neutral-900/60 p-6">
        <h3 className="mb-4 text-sm font-semibold text-white">Attribution readiness</h3>
        <div className="grid gap-3 sm:grid-cols-2">
          {[
            { label: "Visit tracking", status: "active" as const, desc: "Source capture" },
            { label: "Registration linkage", status: "coming_soon" as const, desc: "User ID mapping" },
            { label: "Purchase attribution", status: "coming_soon" as const, desc: "Conversion events" },
            { label: "Revenue attribution", status: "coming_soon" as const, desc: "Value tracking" },
          ].map((item) => (
            <div
              key={item.label}
              className="flex items-center justify-between rounded-xl bg-neutral-950/80 border border-neutral-800 p-4"
            >
              <div>
                <div className="text-sm font-medium text-white">{item.label}</div>
                <div className="text-xs text-neutral-500">{item.desc}</div>
              </div>
              <span
                className={cx(
                  "rounded-full px-2.5 py-1 text-xs font-medium",
                  item.status === "active" &&
                    "bg-emerald-500/15 text-emerald-300 ring-1 ring-emerald-500/25",
                  item.status === "coming_soon" &&
                    "bg-neutral-800 text-neutral-500 ring-1 ring-neutral-700"
                )}
              >
                {item.status === "active" ? "Active" : "Coming soon"}
              </span>
            </div>
          ))}
        </div>
      </div>

      {/* 7. Domain / site readiness */}
      <div className="rounded-2xl border border-neutral-800 bg-neutral-900/60 p-6">
        <h3 className="mb-4 text-sm font-semibold text-white">Site configuration</h3>
        <div className="grid gap-4 sm:grid-cols-2">
          <div>
            <div className="text-xs text-neutral-500">Site ID</div>
            <code className="mt-1 block truncate text-sm text-neutral-300">{projectId}</code>
          </div>
          <div>
            <div className="text-xs text-neutral-500">Primary domain</div>
            <div className="mt-1 text-sm text-neutral-500">Not configured</div>
          </div>
        </div>
      </div>
    </div>
  );
}
