"use client";

import { Fragment, useEffect, useMemo, useRef, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import type { IntegrationStatusRow, IntegrationStatusValue } from "@/app/api/oauth/integration/status/route";

/** Canonical account (same as dashboard). Optional fields from coverage + sync_runs. */
type CanonicalAccount = {
  id: string;
  name: string | null;
  platform_account_id: string;
  platform: string;
  is_enabled: boolean;
  has_data?: boolean;
  min_date?: string | null;
  max_date?: string | null;
  row_count?: number;
  last_sync_at?: string | null;
  last_sync_status?: string | null;
};

type Toast = { type: "success" | "error" | "info"; text: string };

const pageWrap: React.CSSProperties = { padding: 22, color: "white" };

const headerRow: React.CSSProperties = {
  display: "flex",
  alignItems: "flex-start",
  justifyContent: "space-between",
  gap: 16,
  marginBottom: 16,
};

const h1: React.CSSProperties = { fontSize: 40, fontWeight: 950, lineHeight: 1.05, margin: 0 };
const subtitle: React.CSSProperties = { opacity: 0.8, marginTop: 10, fontSize: 16 };

const grid3: React.CSSProperties = {
  display: "grid",
  gridTemplateColumns: "repeat(3, minmax(0, 1fr))",
  gap: 14,
};

const grid2: React.CSSProperties = {
  display: "grid",
  gridTemplateColumns: "minmax(0, 2fr) minmax(0, 1fr)",
  gap: 14,
  marginTop: 14,
};

const card: React.CSSProperties = {
  borderRadius: 18,
  border: "1px solid rgba(255,255,255,0.10)",
  background:
    "radial-gradient(700px 240px at 30% 0%, rgba(120,120,255,0.12), transparent 60%), rgba(255,255,255,0.03)",
  boxShadow: "0 18px 60px rgba(0,0,0,0.45)",
  padding: 16,
  minHeight: 260,
  display: "flex",
  flexDirection: "column",
};

const cardTitleRow: React.CSSProperties = {
  display: "flex",
  justifyContent: "space-between",
  alignItems: "center",
  gap: 12,
};

const badgeBase: React.CSSProperties = {
  height: 28,
  display: "inline-flex",
  alignItems: "center",
  padding: "0 10px",
  borderRadius: 999,
  fontWeight: 850,
  fontSize: 12,
  border: "1px solid rgba(255,255,255,0.14)",
  background: "rgba(255,255,255,0.06)",
  color: "rgba(255,255,255,0.75)",
  whiteSpace: "nowrap",
};

const smallMuted: React.CSSProperties = { opacity: 0.72, fontSize: 13, lineHeight: 1.35 };

function Button({
  children,
  onClick,
  disabled,
  kind = "primary",
}: {
  children: React.ReactNode;
  onClick?: () => void;
  disabled?: boolean;
  kind?: "primary" | "ghost";
}) {
  const isPrimary = kind === "primary";
  return (
    <button
      type="button"
      disabled={!!disabled}
      onClick={onClick}
      style={{
        height: 44,
        padding: "0 14px",
        borderRadius: 14,
        border: "1px solid rgba(255,255,255,0.12)",
        background: isPrimary ? "rgba(120,120,255,0.20)" : "rgba(255,255,255,0.04)",
        color: "white",
        fontWeight: 850,
        cursor: disabled ? "not-allowed" : "pointer",
        opacity: disabled ? 0.5 : 1,
        whiteSpace: "nowrap",
      }}
    >
      {children}
    </button>
  );
}

function ToastView({ toast, onClose }: { toast: Toast | null; onClose: () => void }) {
  if (!toast) return null;

  const bg =
    toast.type === "success"
      ? "rgba(110,255,200,0.12)"
      : toast.type === "error"
      ? "rgba(255,120,120,0.12)"
      : "rgba(255,255,255,0.08)";
  const br =
    toast.type === "success"
      ? "rgba(110,255,200,0.25)"
      : toast.type === "error"
      ? "rgba(255,120,120,0.25)"
      : "rgba(255,255,255,0.16)";

  return (
    <div
      style={{
        position: "fixed",
        right: 18,
        top: 18,
        zIndex: 9999,
        width: 520,
        maxWidth: "calc(100vw - 36px)",
        borderRadius: 16,
        padding: 14,
        border: `1px solid ${br}`,
        background: bg,
        boxShadow: "0 18px 60px rgba(0,0,0,0.55)",
        display: "flex",
        justifyContent: "space-between",
        gap: 12,
        alignItems: "center",
      }}
    >
      <div style={{ fontWeight: 800, lineHeight: 1.2 }}>{toast.text}</div>
      <button
        onClick={onClose}
        style={{
          height: 34,
          width: 34,
          borderRadius: 12,
          border: "1px solid rgba(255,255,255,0.16)",
          background: "rgba(0,0,0,0.12)",
          color: "white",
          cursor: "pointer",
        }}
        aria-label="close"
      >
        ✕
      </button>
    </div>
  );
}

function storeProjectId(pid: string) {
  try {
    localStorage.setItem("last_project_id", pid);
  } catch {}
}
function readProjectId(): string | null {
  try {
    return localStorage.getItem("last_project_id");
  } catch {
    return null;
  }
}

const PLATFORM_LABELS: Record<string, string> = {
  meta: "Meta",
  google: "Google",
  tiktok: "TikTok",
  yandex: "Yandex",
};
const PLATFORM_ORDER = ["meta", "google", "tiktok", "yandex"];

function formatDataThrough(maxDate: string | null | undefined): string {
  if (!maxDate) return "No data";
  const d = String(maxDate).slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(d)) return "No data";
  const [y, m, day] = d.split("-");
  return `Data through ${day}.${m}.${y}`;
}

/** Order-independent equality for id lists (e.g. platform_account_id sets). */
function sameSet(a: string[], b: string[]): boolean {
  if (a.length !== b.length) return false;
  const sa = new Set(a);
  const sb = new Set(b);
  if (sa.size !== sb.size) return false;
  for (const x of sa) if (!sb.has(x)) return false;
  return true;
}

function formatLastSync(iso: string | null | undefined, status: string | null | undefined): string {
  if (!iso) return "—";
  try {
    const d = new Date(iso);
    const day = d.getDate().toString().padStart(2, "0");
    const month = (d.getMonth() + 1).toString().padStart(2, "0");
    const year = d.getFullYear();
    const h = d.getHours().toString().padStart(2, "0");
    const min = d.getMinutes().toString().padStart(2, "0");
    const statusStr = status === "ok" ? "ok" : status === "error" ? "error" : status ?? "";
    return statusStr ? `Last sync: ${statusStr} — ${day}.${month}.${year} ${h}:${min}` : `Last sync: ${day}.${month}.${year} ${h}:${min}`;
  } catch {
    return "—";
  }
}

export default function AccountsPageClient() {
  const router = useRouter();
  const sp = useSearchParams();

  const urlProjectId = sp.get("project_id") || "";
  const connectedParam = sp.get("connected"); // meta / meta_error
  const reasonParam = sp.get("reason"); // optional: project_id_missing / callback_exception / etc

  const [projectId, setProjectId] = useState<string>(urlProjectId);
  const [toast, setToast] = useState<Toast | null>(null);

  const [loading, setLoading] = useState(false);
  const [accounts, setAccounts] = useState<CanonicalAccount[]>([]);
  const [integrationId, setIntegrationId] = useState<string | null>(null);

  /** Unified integration status (same contract as dashboard). */
  const [integrations, setIntegrations] = useState<IntegrationStatusRow[]>([]);
  /** Google: platform_account_id (external_account_id) of selected accounts; synced from is_enabled on refresh. */
  const [selectedGoogleIds, setSelectedGoogleIds] = useState<string[]>([]);
  const [selectedTikTokIds, setSelectedTikTokIds] = useState<string[]>([]);
  const [showGoogleDisconnectConfirm, setShowGoogleDisconnectConfirm] = useState(false);
  const [googleDisconnectLoading, setGoogleDisconnectLoading] = useState(false);
  const [showTikTokDisconnectConfirm, setShowTikTokDisconnectConfirm] = useState(false);
  const [tiktokDisconnectLoading, setTikTokDisconnectLoading] = useState(false);

  /** Meta only: platform_account_id (act_*) of accounts currently enabled (saved). Derived from canonical is_enabled after fetch. */
  const [activeIds, setActiveIds] = useState<string[]>([]);
  /** Meta only: user selection (platform_account_id) before Save. */
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  /** platform_account_id of account currently syncing (for "Sync now" button state). */
  const [syncingAccountId, setSyncingAccountId] = useState<string | null>(null);
  const [showDisconnectConfirm, setShowDisconnectConfirm] = useState(false);
  const [disconnectLoading, setDisconnectLoading] = useState(false);

  // restore project_id
  useEffect(() => {
    if (urlProjectId) {
      setProjectId(urlProjectId);
      storeProjectId(urlProjectId);
      return;
    }
    const remembered = readProjectId();
    if (remembered) {
      router.replace(`/app/accounts?project_id=${encodeURIComponent(remembered)}`);
      setProjectId(remembered);
    }
  }, [urlProjectId, router]);

  // toast after oauth redirect (and errors)
  useEffect(() => {
    if (!projectId && !urlProjectId) return;

    // если вернулись без project_id (редкий кейс) — покажем нормальную ошибку
    if (connectedParam === "meta_error") {
      const suffix = reasonParam ? ` (${reasonParam})` : "";
      setToast({ type: "error", text: `Meta OAuth не завершился. Попробуй ещё раз${suffix}.` });

      // если projectId есть — чистим query; если нет — просто чистим connected/reason
      if (projectId) router.replace(`/app/accounts?project_id=${encodeURIComponent(projectId)}`);
      else router.replace(`/app/accounts`);
      return;
    }

    if (connectedParam === "meta") {
      setToast({ type: "success", text: "Meta подключена. Нажми «Обновить», выбери кабинеты и сохрани." });
      if (projectId) router.replace(`/app/accounts?project_id=${encodeURIComponent(projectId)}`);
      else router.replace(`/app/accounts`);
      return;
    }

    if (connectedParam === "google_error") {
      const suffix = reasonParam ? ` (${reasonParam})` : "";
      setToast({ type: "error", text: `Google OAuth не завершился. Попробуй ещё раз${suffix}.` });
      if (projectId) router.replace(`/app/accounts?project_id=${encodeURIComponent(projectId)}`);
      else router.replace(`/app/accounts`);
      return;
    }

    if (connectedParam === "google") {
      setToast({ type: "success", text: "Google Ads подключён." });
      if (projectId) router.replace(`/app/accounts?project_id=${encodeURIComponent(projectId)}`);
      else router.replace(`/app/accounts`);
      return;
    }

    if (connectedParam === "tiktok_error") {
      const suffix = reasonParam ? ` (${reasonParam})` : "";
      setToast({ type: "error", text: `TikTok OAuth не завершился. Попробуй ещё раз${suffix}.` });
      if (projectId) router.replace(`/app/accounts?project_id=${encodeURIComponent(projectId)}`);
      else router.replace(`/app/accounts`);
      return;
    }

    if (connectedParam === "tiktok") {
      setToast({ type: "success", text: "TikTok Ads подключён." });
      if (projectId) router.replace(`/app/accounts?project_id=${encodeURIComponent(projectId)}`);
      else router.replace(`/app/accounts`);
    }
  }, [connectedParam, reasonParam, projectId, urlProjectId, router]);

  // auto-hide toast
  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(null), 3800);
    return () => clearTimeout(t);
  }, [toast]);

  const metaRow = useMemo(() => integrations.find((i) => i.platform === "meta"), [integrations]);
  const googleRow = useMemo(() => integrations.find((i) => i.platform === "google"), [integrations]);
  const tiktokRow = useMemo(() => integrations.find((i) => i.platform === "tiktok"), [integrations]);
  const metaStatus = (metaRow?.status ?? "not_connected") as IntegrationStatusValue;
  const googleStatus = (googleRow?.status ?? "not_connected") as IntegrationStatusValue;
  const tiktokStatus = (tiktokRow?.status ?? "not_connected") as IntegrationStatusValue;

  /** Allow sync attempts whenever the platform row exists (not never connected); server runs refresh inside sync. */
  const metaSyncEnabled = metaStatus !== "not_connected";
  const googleSyncEnabled = googleStatus !== "not_connected";
  const tiktokSyncEnabled = tiktokStatus !== "not_connected";

  const metaCanShowAccountSelection =
    metaStatus === "healthy" ||
    metaStatus === "stale" ||
    metaStatus === "no_accounts" ||
    metaStatus === "error" ||
    metaStatus === "disconnected";
  const googleCanShowAccountSelection =
    googleStatus === "healthy" ||
    googleStatus === "stale" ||
    googleStatus === "no_accounts" ||
    googleStatus === "error" ||
    googleStatus === "disconnected";
  const tiktokCanShowAccountSelection =
    tiktokStatus === "healthy" ||
    tiktokStatus === "stale" ||
    tiktokStatus === "no_accounts" ||
    tiktokStatus === "error" ||
    tiktokStatus === "disconnected";

  const metaConnectedLike = metaCanShowAccountSelection;
  const googleConnectedLike = googleCanShowAccountSelection;
  const tiktokConnectedLike = tiktokCanShowAccountSelection;

  /** Enabled ids from last accounts fetch (DB / is_enabled), not local checkbox state. */
  const enabledMetaIds = useMemo(
    () => accounts.filter((a) => a.platform === "meta" && a.is_enabled).map((a) => a.platform_account_id),
    [accounts]
  );
  const enabledGoogleIds = useMemo(
    () => accounts.filter((a) => a.platform === "google" && a.is_enabled).map((a) => a.platform_account_id),
    [accounts]
  );
  const enabledTikTokIds = useMemo(
    () => accounts.filter((a) => a.platform === "tiktok" && a.is_enabled).map((a) => a.platform_account_id),
    [accounts]
  );

  const metaSelectionChanged = !sameSet(selectedIds, enabledMetaIds) || enabledMetaIds.length === 0;
  const googleSelectionChanged = !sameSet(selectedGoogleIds, enabledGoogleIds) || enabledGoogleIds.length === 0;
  const tiktokSelectionChanged = !sameSet(selectedTikTokIds, enabledTikTokIds) || enabledTikTokIds.length === 0;

  const metaShowSaveSelection =
    metaConnectedLike && selectedIds.length > 0 && metaSelectionChanged;

  const googleShowSaveSelection =
    googleConnectedLike && selectedGoogleIds.length > 0 && googleSelectionChanged;
  const tiktokShowSaveSelection =
    tiktokConnectedLike && selectedTikTokIds.length > 0 && tiktokSelectionChanged;

  const metaShowDisconnect = metaCanShowAccountSelection;
  const googleShowDisconnect = googleCanShowAccountSelection;
  const tiktokShowDisconnect = tiktokCanShowAccountSelection;

  const metaMainButtonText =
    metaStatus === "disconnected" || metaStatus === "not_connected"
      ? "Подключить"
      : metaStatus === "error"
        ? "Переподключить"
        : "Подключено";

  const googleMainButtonText =
    googleStatus === "disconnected" || googleStatus === "not_connected"
      ? "Подключить"
      : googleStatus === "error"
        ? "Переподключить"
        : "Подключено";
  const tiktokMainButtonText =
    tiktokStatus === "disconnected" || tiktokStatus === "not_connected"
      ? "Подключить"
      : tiktokStatus === "error"
        ? "Переподключить"
        : "Подключено";

  const metaPrimaryButtonKind = metaStatus === "disconnected" || metaStatus === "not_connected" ? "primary" : "ghost";
  const googlePrimaryButtonKind = googleStatus === "disconnected" || googleStatus === "not_connected" ? "primary" : "ghost";
  const tiktokPrimaryButtonKind = tiktokStatus === "disconnected" || tiktokStatus === "not_connected" ? "primary" : "ghost";

  const metaStatusLabel = useMemo(() => {
    if (metaStatus === "healthy") return "Подключено";
    if (metaStatus === "no_accounts") return "Подключено — выбери кабинеты";
    if (metaStatus === "error") return "Ошибка синка";
    if (metaStatus === "stale")
      return metaRow?.token_temporary ? "Временная ошибка OAuth" : "Данные устарели";
    if (metaStatus === "disconnected") return "Требуется переподключение";
    return "Не подключено";
  }, [metaStatus, metaRow?.token_temporary]);

  const googleStatusLabel = useMemo(() => {
    if (googleStatus === "healthy") return "Подключено";
    if (googleStatus === "no_accounts") return "Подключено — выбери аккаунты";
    if (googleStatus === "error") return "Ошибка синка";
    if (googleStatus === "stale")
      return googleRow?.token_temporary ? "Временная ошибка OAuth" : "Данные устарели";
    if (googleStatus === "disconnected") return "Требуется переподключение";
    return "Не подключено";
  }, [googleStatus, googleRow?.token_temporary]);
  const tiktokStatusLabel = useMemo(() => {
    if (tiktokStatus === "healthy") return "Подключено";
    if (tiktokStatus === "no_accounts") return "Подключено — выбери аккаунты";
    if (tiktokStatus === "error") return "Ошибка синка";
    if (tiktokStatus === "stale")
      return tiktokRow?.token_temporary ? "Временная ошибка OAuth" : "Данные устарели";
    if (tiktokStatus === "disconnected") return "Требуется переподключение";
    return "Не подключено";
  }, [tiktokStatus, tiktokRow?.token_temporary]);

  const statusToStyles: Record<IntegrationStatusValue, React.CSSProperties> = useMemo(
    () => ({
      healthy: {
        background: "rgba(110,255,200,0.12)",
        border: "1px solid rgba(110,255,200,0.25)",
        color: "rgba(140,255,210,0.95)",
      },
      error: {
        background: "rgba(239,68,68,0.15)",
        border: "1px solid rgba(239,68,68,0.35)",
        color: "rgba(255,170,170,0.95)",
      },
      stale: {
        background: "rgba(249,115,22,0.15)",
        border: "1px solid rgba(249,115,22,0.35)",
        color: "rgba(255,200,150,0.95)",
      },
      no_accounts: {
        background: "rgba(255,200,100,0.12)",
        border: "1px solid rgba(255,200,100,0.3)",
        color: "rgba(255,220,140,0.95)",
      },
      disconnected: {
        background: "rgba(148,163,184,0.12)",
        border: "1px solid rgba(148,163,184,0.25)",
        color: "rgba(180,200,220,0.95)",
      },
      not_connected: {
        background: "rgba(255,255,255,0.06)",
        border: "1px solid rgba(255,255,255,0.14)",
        color: "rgba(255,255,255,0.75)",
      },
    }),
    []
  );
  const metaStatusStyles = statusToStyles[metaStatus];
  const googleStatusStyles = statusToStyles[googleStatus];
  const tiktokStatusStyles = statusToStyles[tiktokStatus];

  async function refresh() {
    if (!projectId) return;
    setLoading(true);
    try {
      const statusRes = await fetch(`/api/oauth/integration/status?project_id=${encodeURIComponent(projectId)}`);
      const statusJson = (await statusRes.json()) as { success?: boolean; integrations?: IntegrationStatusRow[] };
      const statusList = statusJson?.integrations ?? [];
      setIntegrations(statusList);

      const metaFromUnified = statusList.find((i) => i.platform === "meta");
      const googleFromUnified = statusList.find((i) => i.platform === "google");
      const tiktokFromUnified = statusList.find((i) => i.platform === "tiktok");
      setIntegrationId(metaFromUnified?.integration_id ?? null);

      const accRes = await fetch(`/api/dashboard/accounts?project_id=${encodeURIComponent(projectId)}`);
      const accJson = (await accRes.json()) as { success?: boolean; accounts?: CanonicalAccount[] };
      let list = accJson?.accounts ?? [];

      const googleShouldDiscover =
        googleFromUnified &&
        googleFromUnified.oauth_valid &&
        (googleFromUnified.status === "healthy" ||
          googleFromUnified.status === "stale" ||
          googleFromUnified.status === "error" ||
          googleFromUnified.status === "no_accounts") &&
        list.filter((a) => a.platform === "google").length === 0;
      const tiktokShouldDiscover =
        tiktokFromUnified &&
        tiktokFromUnified.oauth_valid &&
        (tiktokFromUnified.status === "healthy" ||
          tiktokFromUnified.status === "stale" ||
          tiktokFromUnified.status === "error" ||
          tiktokFromUnified.status === "no_accounts") &&
        list.filter((a) => a.platform === "tiktok").length === 0;

      if (googleShouldDiscover) {
        try {
          await fetch("/api/oauth/google/accounts", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ project_id: projectId }),
          });
          const accRes2 = await fetch(`/api/dashboard/accounts?project_id=${encodeURIComponent(projectId)}`);
          const accJson2 = (await accRes2.json()) as { success?: boolean; accounts?: CanonicalAccount[] };
          list = accJson2?.accounts ?? [];
        } catch {
          // non-blocking: keep list as is
        }
      }

      if (tiktokShouldDiscover) {
        try {
          const discoverRes = await fetch("/api/oauth/tiktok/accounts", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ project_id: projectId }),
          });
          const discoverJson = await discoverRes.json().catch(() => ({} as { success?: boolean; error?: string }));
          if (!discoverRes.ok || !discoverJson?.success) {
            setToast({ type: "error", text: discoverJson?.error ?? "Не удалось загрузить аккаунты TikTok" });
          }
          const accRes3 = await fetch(`/api/dashboard/accounts?project_id=${encodeURIComponent(projectId)}`);
          const accJson3 = (await accRes3.json()) as { success?: boolean; accounts?: CanonicalAccount[] };
          list = accJson3?.accounts ?? [];
        } catch {
          setToast({ type: "error", text: "Ошибка загрузки аккаунтов TikTok" });
        }
      }

      setAccounts(list);

      const metaEnabled = list
        .filter((a) => a.platform === "meta" && a.is_enabled)
        .map((a) => a.platform_account_id);
      setActiveIds(metaEnabled);
      setSelectedIds(metaEnabled);

      const googleEnabled = list
        .filter((a) => a.platform === "google" && a.is_enabled)
        .map((a) => a.platform_account_id);
      setSelectedGoogleIds(googleEnabled);
      const tiktokEnabled = list
        .filter((a) => a.platform === "tiktok" && a.is_enabled)
        .map((a) => a.platform_account_id);
      setSelectedTikTokIds(tiktokEnabled);
    } catch {
      setToast({ type: "error", text: "Ошибка загрузки кабинетов/подключений" });
    } finally {
      setLoading(false);
    }
  }

  const refreshRef = useRef(refresh);
  refreshRef.current = refresh;
  const lastAccountsVisRefreshRef = useRef(0);
  useEffect(() => {
    if (!projectId) return;
    const onVis = () => {
      if (document.visibilityState !== "visible") return;
      const now = Date.now();
      if (now - lastAccountsVisRefreshRef.current < 45_000) return;
      lastAccountsVisRefreshRef.current = now;
      void refreshRef.current();
    };
    document.addEventListener("visibilitychange", onVis);
    return () => document.removeEventListener("visibilitychange", onVis);
  }, [projectId]);

  useEffect(() => {
    if (!projectId) return;
    refresh();
  }, [projectId]);

  const accountsByPlatform = useMemo(() => {
    const map = new Map<string, CanonicalAccount[]>();
    for (const a of accounts) {
      const list = map.get(a.platform) ?? [];
      list.push(a);
      map.set(a.platform, list);
    }
    return map;
  }, [accounts]);

  /** For "Подключённые аккаунты": only enabled accounts. Meta and Google = is_enabled from ad_account_settings. */
  const connectedAccountsByPlatform = useMemo(() => {
    const map = new Map<string, CanonicalAccount[]>();
    for (const a of accounts) {
      if ((a.platform === "meta" || a.platform === "google" || a.platform === "tiktok") && !a.is_enabled) continue;
      const list = map.get(a.platform) ?? [];
      list.push(a);
      map.set(a.platform, list);
    }
    return map;
  }, [accounts]);

  /** Show enabled accounts for all statuses except not_connected (disconnected still lists cabinets + reconnect CTA). */
  const platformActiveForList = useMemo(() => {
    const metaOk =
      metaStatus === "healthy" ||
      metaStatus === "stale" ||
      metaStatus === "no_accounts" ||
      metaStatus === "error" ||
      metaStatus === "disconnected";
    const googleOk =
      googleStatus === "healthy" ||
      googleStatus === "stale" ||
      googleStatus === "no_accounts" ||
      googleStatus === "error" ||
      googleStatus === "disconnected";
    const tiktokOk =
      tiktokStatus === "healthy" ||
      tiktokStatus === "stale" ||
      tiktokStatus === "no_accounts" ||
      tiktokStatus === "error" ||
      tiktokStatus === "disconnected";
    return { meta: metaOk, google: googleOk, tiktok: tiktokOk };
  }, [metaStatus, googleStatus, tiktokStatus]);

  const connectedAccountsByPlatformFiltered = useMemo(() => {
    const map = new Map<string, CanonicalAccount[]>();
    for (const [platformId, list] of connectedAccountsByPlatform) {
      if (platformId === "meta" && !platformActiveForList.meta) continue;
      if (platformId === "google" && !platformActiveForList.google) continue;
      if (platformId === "tiktok" && !platformActiveForList.tiktok) continue;
      if (list?.length) map.set(platformId, list);
    }
    return map;
  }, [connectedAccountsByPlatform, platformActiveForList]);

  const metaDiscoveredCount = accountsByPlatform.get("meta")?.length ?? 0;
  const googleDiscoveredCount = accountsByPlatform.get("google")?.length ?? 0;
  const tiktokDiscoveredCount = accountsByPlatform.get("tiktok")?.length ?? 0;
  const googleEnabledCount = (accountsByPlatform.get("google") ?? []).filter((a) => a.is_enabled).length;
  const tiktokEnabledCount = (accountsByPlatform.get("tiktok") ?? []).filter((a) => a.is_enabled).length;

  function toggleSelected(platformAccountId: string) {
    setSelectedIds((prev) => (prev.includes(platformAccountId) ? prev.filter((x) => x !== platformAccountId) : [...prev, platformAccountId]));
  }

  function toggleSelectedGoogle(platformAccountId: string) {
    setSelectedGoogleIds((prev) =>
      prev.includes(platformAccountId) ? prev.filter((x) => x !== platformAccountId) : [...prev, platformAccountId]
    );
  }

  function toggleSelectedTikTok(platformAccountId: string) {
    setSelectedTikTokIds((prev) =>
      prev.includes(platformAccountId) ? prev.filter((x) => x !== platformAccountId) : [...prev, platformAccountId]
    );
  }

  async function saveGoogleSelection() {
    if (!projectId) return;
    if (googleStatus === "not_connected") {
      setToast({ type: "error", text: "Google не подключён. Подключи OAuth и нажми «Обновить»." });
      return;
    }
    if (!googleShowSaveSelection) {
      setToast({ type: "error", text: "Сохранение недоступно для текущего статуса интеграции." });
      return;
    }
    if (selectedGoogleIds.length === 0) {
      setToast({ type: "info", text: "Выбери хотя бы один аккаунт." });
      return;
    }
    setLoading(true);
    try {
      const r = await fetch("/api/oauth/google/connections/save", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          project_id: projectId,
          ad_account_ids: selectedGoogleIds,
        }),
      });
      const j = await r.json();
      if (!j?.success) {
        setToast({
          type: "error",
          text:
            j?.error ??
            (googleStatus === "disconnected"
              ? "Не удалось сохранить: переподключи Google OAuth и попробуй снова."
              : "Не удалось сохранить выбор Google"),
        });
      } else {
        setToast({ type: "success", text: `Сохранено аккаунтов Google: ${j.saved ?? selectedGoogleIds.length}` });
        await refresh();
      }
    } catch {
      setToast({ type: "error", text: "Ошибка сохранения выбора Google" });
    } finally {
      setLoading(false);
    }
  }

  async function saveTikTokSelection() {
    if (!projectId) return;
    if (tiktokStatus === "not_connected") {
      setToast({ type: "error", text: "TikTok не подключён. Подключи OAuth и нажми «Обновить»." });
      return;
    }
    if (!tiktokShowSaveSelection) {
      setToast({ type: "error", text: "Сохранение недоступно для текущего статуса TikTok." });
      return;
    }
    if (selectedTikTokIds.length === 0) {
      setToast({ type: "info", text: "Выбери хотя бы один TikTok аккаунт." });
      return;
    }
    setLoading(true);
    try {
      const r = await fetch("/api/oauth/tiktok/connections/save", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          project_id: projectId,
          ad_account_ids: selectedTikTokIds,
        }),
      });
      const j = await r.json();
      if (!j?.success) {
        setToast({
          type: "error",
          text:
            j?.error ??
            (tiktokStatus === "disconnected"
              ? "Не удалось сохранить: переподключи TikTok OAuth и попробуй снова."
              : "Не удалось сохранить выбор TikTok"),
        });
      } else {
        setToast({ type: "success", text: `Сохранено TikTok аккаунтов: ${j.saved ?? selectedTikTokIds.length}` });
        await refresh();
      }
    } catch {
      setToast({ type: "error", text: "Ошибка сохранения выбора TikTok" });
    } finally {
      setLoading(false);
    }
  }

  async function saveSelection() {
    if (!projectId) return;

    if (!integrationId || !metaShowSaveSelection) {
      setToast({ type: "error", text: "Сначала подключи Meta (OAuth), затем выбирай кабинеты." });
      return;
    }
    if (selectedIds.length === 0) {
      setToast({ type: "info", text: "Выбери хотя бы один кабинет для sync." });
      return;
    }

    setLoading(true);
    try {
      const r = await fetch("/api/oauth/meta/connections/save", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          project_id: projectId,
          integration_id: integrationId,
          ad_account_ids: selectedIds,
        }),
      });
      const j = await r.json();
      if (!j?.success) {
        setToast({ type: "error", text: "Не удалось сохранить выбор кабинетов" });
      } else {
        setToast({ type: "success", text: `Сохранено кабинетов: ${j.saved ?? selectedIds.length}. Синхронизация…` });
        await refresh();
        const toSync = selectedIds;
        let totalRows = 0;
        for (const ad of toSync) {
          const syncRes = await fetch("/api/sync/run", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              project_id: projectId,
              platform: "meta",
              ad_account_id: ad,
              sync_type: "insights",
            }),
          });
          const syncJson = await syncRes.json();
          if (syncJson?.success) totalRows += Number(syncJson?.rows_written ?? 0);
        }
        setToast({ type: "success", text: `Сохранено и синхронизировано: ${totalRows} строк` });
        await refresh();
      }
    } catch {
      setToast({ type: "error", text: "Ошибка сохранения (connections/save)" });
    } finally {
      setLoading(false);
    }
  }

  function connectMeta() {
    if (!projectId) return;
    const returnTo = `/app/accounts?project_id=${encodeURIComponent(projectId)}`;
    window.location.href = `/api/oauth/meta/start?project_id=${encodeURIComponent(projectId)}&return_to=${encodeURIComponent(
      returnTo
    )}`;
  }

  function connectGoogle() {
    if (!projectId) return;
    const returnTo = `/app/accounts?project_id=${encodeURIComponent(projectId)}`;
    window.location.href = `/api/oauth/google/start?project_id=${encodeURIComponent(projectId)}&return_to=${encodeURIComponent(
      returnTo
    )}`;
  }

  async function connectTikTok() {
    if (!projectId) return;
    if (tiktokConnectedLike) {
      try {
        setLoading(true);
        const r = await fetch("/api/oauth/tiktok/accounts", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ project_id: projectId }),
        });
        const j = await r.json().catch(() => ({} as { success?: boolean; error?: string }));
        if (!r.ok || !j?.success) {
          setToast({ type: "error", text: j?.error ?? "Не удалось загрузить аккаунты TikTok" });
          return;
        }
        setToast({ type: "success", text: `Найдено TikTok аккаунтов: ${j?.discovered ?? 0}` });
        await refresh();
      } finally {
        setLoading(false);
      }
      return;
    }
    const returnTo = `/app/accounts?project_id=${encodeURIComponent(projectId)}`;
    window.location.href = `/api/oauth/tiktok/start?project_id=${encodeURIComponent(projectId)}&return_to=${encodeURIComponent(
      returnTo
    )}`;
  }

  async function disconnectGoogle() {
    if (!projectId) return;
    setGoogleDisconnectLoading(true);
    try {
      const r = await fetch("/api/oauth/google/integration/disconnect", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ project_id: projectId }),
      });
      const j = await r.json();
      if (!r.ok || !j?.success) {
        setToast({ type: "error", text: j?.error ?? "Не удалось отключить Google" });
        return;
      }
      setShowGoogleDisconnectConfirm(false);
      setSelectedGoogleIds([]);
      setToast({ type: "success", text: "Google отключён." });
      await refresh();
    } catch {
      setToast({ type: "error", text: "Ошибка отключения Google" });
    } finally {
      setGoogleDisconnectLoading(false);
    }
  }

  async function disconnectTikTok() {
    if (!projectId) return;
    setTikTokDisconnectLoading(true);
    try {
      const r = await fetch("/api/oauth/tiktok/integration/disconnect", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ project_id: projectId }),
      });
      const j = await r.json();
      if (!r.ok || !j?.success) {
        setToast({ type: "error", text: j?.error ?? "Не удалось отключить TikTok" });
        return;
      }
      setShowTikTokDisconnectConfirm(false);
      setSelectedTikTokIds([]);
      setToast({ type: "success", text: "TikTok отключён." });
      await refresh();
    } catch {
      setToast({ type: "error", text: "Ошибка отключения TikTok" });
    } finally {
      setTikTokDisconnectLoading(false);
    }
  }

  const hasAnyEnabledAccounts =
    (metaSyncEnabled && enabledMetaIds.length > 0) ||
    (googleSyncEnabled && enabledGoogleIds.length > 0) ||
    (tiktokSyncEnabled && enabledTikTokIds.length > 0);

  async function syncAll() {
    if (!projectId) return;
    if (!hasAnyEnabledAccounts) {
      setToast({ type: "info", text: "Сначала подключи источник (Meta или Google) и выбери аккаунты для sync." });
      return;
    }

    setLoading(true);
    try {
      let totalRows = 0;

      for (const ad of enabledMetaIds) {
        const r = await fetch("/api/sync/run", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            project_id: projectId,
            platform: "meta",
            ad_account_id: ad,
            sync_type: "insights",
          }),
        });
        const j = await r.json();
        if (!j?.success) {
          setToast({ type: "error", text: j?.error ?? `Sync ошибка для ${ad}` });
          setLoading(false);
          return;
        }
        totalRows += Number(j?.rows_written ?? 0);
      }

      for (const ad of enabledGoogleIds) {
        const r = await fetch("/api/sync/run", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            project_id: projectId,
            platform: "google",
            ad_account_id: ad,
            sync_type: "insights",
          }),
        });
        const j = await r.json();
        if (!j?.success) {
          setToast({ type: "error", text: j?.error ?? `Sync ошибка для Google ${ad}` });
          setLoading(false);
          return;
        }
        totalRows += Number(j?.rows_written ?? 0);
      }

      for (const ad of enabledTikTokIds) {
        const r = await fetch("/api/sync/run", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            project_id: projectId,
            platform: "tiktok",
            ad_account_id: ad,
            sync_type: "insights",
          }),
        });
        const j = await r.json();
        if (!j?.success) {
          setToast({ type: "error", text: j?.error ?? `Sync ошибка для TikTok ${ad}` });
          setLoading(false);
          return;
        }
        totalRows += Number(j?.rows_written ?? 0);
      }

      setToast({ type: "success", text: `Синхронизация завершена: ${totalRows} строк` });
      await refresh();
    } catch {
      setToast({ type: "error", text: "Ошибка синхронизации" });
    } finally {
      setLoading(false);
    }
  }

  async function disconnectMeta() {
    if (!projectId) return;
    setDisconnectLoading(true);
    try {
      const r = await fetch("/api/oauth/meta/integration/disconnect", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ project_id: projectId }),
      });
      const j = await r.json();
      if (!r.ok || !j?.success) {
        setToast({ type: "error", text: j?.error ?? "Не удалось отключить" });
        return;
      }
      setShowDisconnectConfirm(false);
      setToast({ type: "success", text: "Meta отключена. Исторические данные сохранены." });
      await refresh();
    } catch {
      setToast({ type: "error", text: "Ошибка отключения" });
    } finally {
      setDisconnectLoading(false);
    }
  }

  async function syncOneAccount(platformAccountId: string, platform: "meta" | "google" | "tiktok") {
    if (!projectId) return;
    if (platform === "meta" && metaStatus === "not_connected") return;
    if (platform === "google" && googleStatus === "not_connected") return;
    if (platform === "tiktok" && tiktokStatus === "not_connected") return;
    setSyncingAccountId(platformAccountId);
    try {
      const r = await fetch("/api/sync/run", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          project_id: projectId,
          platform,
          ad_account_id: platformAccountId,
          sync_type: "insights",
        }),
      });
      const j = await r.json();
      if (!j?.success) {
        setToast({ type: "error", text: j?.error ?? `Sync failed for ${platformAccountId}` });
        return;
      }
      const rows = Number(j?.rows_written ?? 0);
      setToast({ type: "success", text: `Синхронизировано: ${rows} строк` });
      await refresh();
    } catch {
      setToast({ type: "error", text: "Ошибка синхронизации" });
    } finally {
      setSyncingAccountId(null);
    }
  }

  const primaryButtons = (
    <div style={{ display: "flex", gap: 10, alignItems: "center" }}>
      <Button kind="ghost" onClick={refresh} disabled={!projectId || loading}>
        Обновить
      </Button>
      <Button onClick={syncAll} disabled={!projectId || loading || !hasAnyEnabledAccounts}>
        Запустить sync
      </Button>
    </div>
  );

  if (!projectId) {
    return (
      <div style={pageWrap}>
        <ToastView toast={toast} onClose={() => setToast(null)} />

        <div style={headerRow}>
          <div>
            <h1 style={h1}>Аккаунты и интеграции</h1>
            <div style={subtitle}>Подключай рекламные кабинеты и синхронизируй расходы/показы в аналитику.</div>
          </div>
          {primaryButtons}
        </div>

        <div
          style={{
            borderRadius: 18,
            border: "1px solid rgba(255,120,120,0.25)",
            background: "rgba(255,120,120,0.08)",
            padding: 16,
          }}
        >
          <div style={{ fontWeight: 900, fontSize: 20 }}>Не найден project_id</div>
          <div style={{ opacity: 0.8, marginTop: 8 }}>
            Открой страницу так: <code>/app/accounts?project_id=...</code>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div style={pageWrap}>
      <ToastView toast={toast} onClose={() => setToast(null)} />

      {showGoogleDisconnectConfirm ? (
        <div
          style={{
            position: "fixed",
            inset: 0,
            zIndex: 9998,
            background: "rgba(0,0,0,0.6)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            padding: 24,
          }}
          onClick={() => !googleDisconnectLoading && setShowGoogleDisconnectConfirm(false)}
        >
          <div
            style={{
              background: "rgba(28,28,36,0.98)",
              borderRadius: 20,
              padding: 24,
              maxWidth: 420,
              border: "1px solid rgba(255,255,255,0.12)",
              boxShadow: "0 24px 80px rgba(0,0,0,0.5)",
            }}
            onClick={(e) => e.stopPropagation()}
          >
            <div style={{ fontWeight: 900, fontSize: 20, marginBottom: 12 }}>
              Отключить интеграцию Google?
            </div>
            <div style={{ ...smallMuted, marginBottom: 20 }}>
              Будет удалено подключение. Исторические данные (метрики, аккаунты) сохранятся.
            </div>
            <div style={{ display: "flex", gap: 10, justifyContent: "flex-end" }}>
              <button
                type="button"
                onClick={() => !googleDisconnectLoading && setShowGoogleDisconnectConfirm(false)}
                disabled={googleDisconnectLoading}
                style={{
                  padding: "10px 16px",
                  borderRadius: 12,
                  border: "1px solid rgba(255,255,255,0.2)",
                  background: "rgba(255,255,255,0.06)",
                  color: "white",
                  cursor: googleDisconnectLoading ? "not-allowed" : "pointer",
                  fontWeight: 700,
                }}
              >
                Отмена
              </button>
              <button
                type="button"
                onClick={disconnectGoogle}
                disabled={googleDisconnectLoading}
                style={{
                  padding: "10px 16px",
                  borderRadius: 12,
                  border: "1px solid rgba(255,100,100,0.4)",
                  background: "rgba(255,80,80,0.2)",
                  color: "rgba(255,180,180,0.95)",
                  cursor: googleDisconnectLoading ? "not-allowed" : "pointer",
                  fontWeight: 700,
                }}
              >
                {googleDisconnectLoading ? "Отключение…" : "Отключить Google"}
              </button>
            </div>
          </div>
        </div>
      ) : null}

      {showTikTokDisconnectConfirm ? (
        <div
          style={{
            position: "fixed",
            inset: 0,
            zIndex: 9998,
            background: "rgba(0,0,0,0.6)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            padding: 24,
          }}
          onClick={() => !tiktokDisconnectLoading && setShowTikTokDisconnectConfirm(false)}
        >
          <div
            style={{
              background: "rgba(28,28,36,0.98)",
              borderRadius: 20,
              padding: 24,
              maxWidth: 420,
              border: "1px solid rgba(255,255,255,0.12)",
              boxShadow: "0 24px 80px rgba(0,0,0,0.5)",
            }}
            onClick={(e) => e.stopPropagation()}
          >
            <div style={{ fontWeight: 900, fontSize: 20, marginBottom: 12 }}>
              Отключить интеграцию TikTok?
            </div>
            <div style={{ ...smallMuted, marginBottom: 20 }}>
              Будет удалено подключение. Исторические данные (метрики, аккаунты) сохранятся.
            </div>
            <div style={{ display: "flex", gap: 10, justifyContent: "flex-end" }}>
              <button
                type="button"
                onClick={() => !tiktokDisconnectLoading && setShowTikTokDisconnectConfirm(false)}
                disabled={tiktokDisconnectLoading}
                style={{
                  padding: "10px 16px",
                  borderRadius: 12,
                  border: "1px solid rgba(255,255,255,0.2)",
                  background: "rgba(255,255,255,0.06)",
                  color: "white",
                  cursor: tiktokDisconnectLoading ? "not-allowed" : "pointer",
                  fontWeight: 700,
                }}
              >
                Отмена
              </button>
              <button
                type="button"
                onClick={disconnectTikTok}
                disabled={tiktokDisconnectLoading}
                style={{
                  padding: "10px 16px",
                  borderRadius: 12,
                  border: "1px solid rgba(255,100,100,0.4)",
                  background: "rgba(255,80,80,0.2)",
                  color: "rgba(255,180,180,0.95)",
                  cursor: tiktokDisconnectLoading ? "not-allowed" : "pointer",
                  fontWeight: 700,
                }}
              >
                {tiktokDisconnectLoading ? "Отключение…" : "Отключить TikTok"}
              </button>
            </div>
          </div>
        </div>
      ) : null}

      {showDisconnectConfirm ? (
        <div
          style={{
            position: "fixed",
            inset: 0,
            zIndex: 9998,
            background: "rgba(0,0,0,0.6)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            padding: 24,
          }}
          onClick={() => !disconnectLoading && setShowDisconnectConfirm(false)}
        >
          <div
            style={{
              background: "rgba(28,28,36,0.98)",
              borderRadius: 20,
              padding: 24,
              maxWidth: 420,
              border: "1px solid rgba(255,255,255,0.12)",
              boxShadow: "0 24px 80px rgba(0,0,0,0.5)",
            }}
            onClick={(e) => e.stopPropagation()}
          >
            <div style={{ fontWeight: 900, fontSize: 20, marginBottom: 12 }}>
              Отключить интеграцию Meta?
            </div>
            <div style={{ ...smallMuted, marginBottom: 20 }}>
              Будет удалено подключение и выбранные кабинеты. Исторические данные (метрики, кампании) сохранятся.
            </div>
            <div style={{ display: "flex", gap: 10, justifyContent: "flex-end" }}>
              <button
                type="button"
                onClick={() => !disconnectLoading && setShowDisconnectConfirm(false)}
                disabled={disconnectLoading}
                style={{
                  padding: "10px 16px",
                  borderRadius: 12,
                  border: "1px solid rgba(255,255,255,0.2)",
                  background: "rgba(255,255,255,0.06)",
                  color: "white",
                  cursor: disconnectLoading ? "not-allowed" : "pointer",
                  fontWeight: 700,
                }}
              >
                Отмена
              </button>
              <button
                type="button"
                onClick={disconnectMeta}
                disabled={disconnectLoading}
                style={{
                  padding: "10px 16px",
                  borderRadius: 12,
                  border: "1px solid rgba(255,120,120,0.4)",
                  background: "rgba(255,80,80,0.25)",
                  color: "rgba(255,180,180,0.98)",
                  cursor: disconnectLoading ? "not-allowed" : "pointer",
                  fontWeight: 700,
                }}
              >
                {disconnectLoading ? "Отключение…" : "Отключить Meta"}
              </button>
            </div>
          </div>
        </div>
      ) : null}

      <div style={headerRow}>
        <div>
          <h1 style={h1}>Аккаунты и интеграции</h1>
          <div style={subtitle}>Подключай рекламные кабинеты и синхронизируй расходы/показы в аналитику.</div>
        </div>
        {primaryButtons}
      </div>

      {/* top cards */}
      <div style={grid3}>
        {/* Meta */}
        <div style={card}>
          <div style={cardTitleRow}>
            <div style={{ fontSize: 24, fontWeight: 950 }}>Meta Ads</div>

            <div style={{ ...badgeBase, ...metaStatusStyles }}>
              {metaStatusLabel}
            </div>
          </div>

          <div style={{ opacity: 0.8, marginTop: 6 }}>Facebook/Instagram рекламные кабинеты</div>

          {metaStatus === "error" && metaRow?.reason ? (
            <div style={{ ...smallMuted, marginTop: 8, color: "rgba(255,170,170,0.95)", opacity: 0.9 }}>
              Причина: {metaRow.reason}
            </div>
          ) : null}
          {metaRow?.token_reason_code &&
          (metaStatus === "stale" || metaStatus === "disconnected" || metaStatus === "error") ? (
            <div style={{ ...smallMuted, marginTop: 6, opacity: 0.8 }}>Диагностика: {metaRow.token_reason_code}</div>
          ) : null}

          <div style={{ marginTop: 12, display: "grid", gap: 8 }}>
            <div style={smallMuted}>1) Нажми «Подключить» → авторизуйся в Meta</div>
            <div style={smallMuted}>2) Вернёшься назад → нажми «Обновить»</div>
            <div style={smallMuted}>3) Выбери кабинеты → «Сохранить выбор» → Sync now по аккаунту или «Запустить sync»</div>
          </div>

          <div style={{ marginTop: "auto", display: "flex", gap: 10, flexWrap: "wrap", paddingTop: 14 }}>
            <Button onClick={connectMeta} disabled={!projectId || loading} kind={metaPrimaryButtonKind}>
              {metaMainButtonText}
            </Button>
            {metaShowSaveSelection ? (
              <Button
                kind="ghost"
                onClick={saveSelection}
                disabled={!projectId || loading || selectedIds.length === 0}
              >
                Сохранить выбор
              </Button>
            ) : null}
            {metaShowDisconnect ? (
              <button
                type="button"
                onClick={() => setShowDisconnectConfirm(true)}
                disabled={loading || disconnectLoading}
                style={{
                  height: 44,
                  padding: "0 14px",
                  borderRadius: 14,
                  border: "1px solid rgba(255,100,100,0.4)",
                  background: "rgba(255,80,80,0.12)",
                  color: "rgba(255,180,180,0.95)",
                  fontWeight: 850,
                  cursor: loading || disconnectLoading ? "not-allowed" : "pointer",
                  opacity: loading || disconnectLoading ? 0.6 : 1,
                }}
              >
                Отключить Meta
              </button>
            ) : null}
          </div>

          <div style={{ ...smallMuted, marginTop: 10 }}>
            Найдено: <b>{metaDiscoveredCount}</b> • Выбрано: <b>{selectedIds.length}</b> • В sync: <b>{activeIds.length}</b>
          </div>

          {/* Selection UI: all discovered Meta accounts (only when connected) */}
          {metaCanShowAccountSelection && metaDiscoveredCount > 0 ? (
            <details style={{ marginTop: 12 }}>
              <summary style={{ cursor: "pointer", fontWeight: 800, fontSize: 13, opacity: 0.9 }}>
                Выбери кабинеты для проекта ({metaDiscoveredCount})
              </summary>
              <div style={{ marginTop: 8, display: "flex", flexDirection: "column", gap: 6 }}>
                {(accountsByPlatform.get("meta") ?? []).map((a) => {
                  const checked = selectedIds.includes(a.platform_account_id);
                  return (
                    <label key={a.id} style={{ display: "flex", alignItems: "center", gap: 8, cursor: "pointer" }}>
                      <input
                        type="checkbox"
                        checked={checked}
                        onChange={() => toggleSelected(a.platform_account_id)}
                        style={{ width: 18, height: 18, flexShrink: 0 }}
                      />
                      <span style={{ fontSize: 13 }}>{a.name || a.platform_account_id}</span>
                      <span style={{ ...smallMuted, fontSize: 11 }}>{a.platform_account_id}</span>
                    </label>
                  );
                })}
              </div>
            </details>
          ) : null}
        </div>

        {/* Google */}
        <div style={card}>
          <div style={cardTitleRow}>
            <div style={{ fontSize: 24, fontWeight: 950 }}>Google Ads</div>
            <div style={{ ...badgeBase, ...googleStatusStyles }}>{googleStatusLabel}</div>
          </div>
          <div style={{ opacity: 0.8, marginTop: 6 }}>Расходы и конверсии из Google Ads</div>

          {googleStatus === "error" && googleRow?.reason ? (
            <div style={{ ...smallMuted, marginTop: 8, color: "rgba(255,170,170,0.95)", opacity: 0.9 }}>
              Причина: {googleRow.reason}
            </div>
          ) : null}
          {googleRow?.token_reason_code &&
          (googleStatus === "stale" || googleStatus === "disconnected" || googleStatus === "error") ? (
            <div style={{ ...smallMuted, marginTop: 6, opacity: 0.8 }}>Диагностика: {googleRow.token_reason_code}</div>
          ) : null}

          <div style={{ marginTop: 12, display: "grid", gap: 8 }}>
            <div style={smallMuted}>1) Нажми «Подключить» → авторизуйся в Google</div>
            <div style={smallMuted}>2) Вернёшься назад → нажми «Обновить»</div>
            <div style={smallMuted}>3) Выбери аккаунты для проекта → «Сохранить выбор» → Sync now по аккаунту или «Запустить sync»</div>
          </div>

          <div style={{ marginTop: "auto", display: "flex", gap: 10, flexWrap: "wrap", paddingTop: 14 }}>
            <Button onClick={connectGoogle} disabled={!projectId || loading} kind={googlePrimaryButtonKind}>
              {googleMainButtonText}
            </Button>
            {googleShowSaveSelection ? (
              <Button
                kind="ghost"
                onClick={saveGoogleSelection}
                disabled={!projectId || loading || selectedGoogleIds.length === 0}
              >
                Сохранить выбор
              </Button>
            ) : null}
            {googleShowDisconnect ? (
              <button
                type="button"
                onClick={() => setShowGoogleDisconnectConfirm(true)}
                disabled={loading || googleDisconnectLoading}
                style={{
                  height: 44,
                  padding: "0 14px",
                  borderRadius: 14,
                  border: "1px solid rgba(255,100,100,0.4)",
                  background: "rgba(255,80,80,0.12)",
                  color: "rgba(255,180,180,0.95)",
                  fontWeight: 850,
                  cursor: loading || googleDisconnectLoading ? "not-allowed" : "pointer",
                  opacity: loading || googleDisconnectLoading ? 0.6 : 1,
                }}
              >
                {googleDisconnectLoading ? "Отключение…" : "Отключить Google"}
              </button>
            ) : null}
          </div>

          <div style={{ ...smallMuted, marginTop: 10 }}>
            Найдено: <b>{googleDiscoveredCount}</b> • Выбрано: <b>{selectedGoogleIds.length}</b> • Включено: <b>{googleEnabledCount}</b>
          </div>

          {googleCanShowAccountSelection && googleDiscoveredCount > 0 ? (
            <details style={{ marginTop: 12 }}>
              <summary style={{ cursor: "pointer", fontWeight: 800, fontSize: 13, opacity: 0.9 }}>
                Выбери аккаунты Google для проекта ({googleDiscoveredCount})
              </summary>
              <div style={{ marginTop: 8, display: "flex", flexDirection: "column", gap: 6 }}>
                {(accountsByPlatform.get("google") ?? []).map((a) => {
                  const checked = selectedGoogleIds.includes(a.platform_account_id);
                  return (
                    <label key={a.id} style={{ display: "flex", alignItems: "center", gap: 8, cursor: "pointer" }}>
                      <input
                        type="checkbox"
                        checked={checked}
                        onChange={() => toggleSelectedGoogle(a.platform_account_id)}
                        style={{ width: 18, height: 18, flexShrink: 0 }}
                      />
                      <span style={{ fontSize: 13 }}>{a.name || a.platform_account_id}</span>
                      <span style={{ ...smallMuted, fontSize: 11 }}>{a.platform_account_id}</span>
                    </label>
                  );
                })}
              </div>
            </details>
          ) : null}
        </div>

        {/* TikTok */}
        <div style={card}>
          <div style={cardTitleRow}>
            <div style={{ fontSize: 24, fontWeight: 950 }}>TikTok Ads</div>
            <div style={{ ...badgeBase, ...tiktokStatusStyles }}>{tiktokStatusLabel}</div>
          </div>
          <div style={{ opacity: 0.8, marginTop: 6 }}>Расходы, показы, клики TikTok</div>
          {tiktokRow?.token_reason_code &&
          (tiktokStatus === "stale" || tiktokStatus === "disconnected" || tiktokStatus === "error") ? (
            <div style={{ ...smallMuted, marginTop: 8, opacity: 0.8 }}>Диагностика: {tiktokRow.token_reason_code}</div>
          ) : null}
          <div style={{ marginTop: 12, display: "grid", gap: 8 }}>
            <div style={smallMuted}>1) Нажми «Подключить» → авторизуйся в TikTok</div>
            <div style={smallMuted}>2) Вернёшься назад → нажми «Обновить»</div>
            <div style={smallMuted}>3) Нажми «Подключить» ещё раз для загрузки аккаунтов, затем выбери их и сохрани</div>
          </div>
          <div style={{ marginTop: "auto", display: "flex", gap: 10, flexWrap: "wrap", paddingTop: 14 }}>
            <Button onClick={connectTikTok} disabled={!projectId || loading} kind={tiktokPrimaryButtonKind}>
              {tiktokMainButtonText}
            </Button>
            {tiktokShowSaveSelection ? (
              <Button
                kind="ghost"
                onClick={saveTikTokSelection}
                disabled={!projectId || loading || selectedTikTokIds.length === 0}
              >
                Сохранить выбор
              </Button>
            ) : null}
            {tiktokShowDisconnect ? (
              <button
                type="button"
                onClick={() => setShowTikTokDisconnectConfirm(true)}
                disabled={loading || tiktokDisconnectLoading}
                style={{
                  height: 44,
                  padding: "0 14px",
                  borderRadius: 14,
                  border: "1px solid rgba(255,100,100,0.4)",
                  background: "rgba(255,80,80,0.12)",
                  color: "rgba(255,180,180,0.95)",
                  fontWeight: 850,
                  cursor: loading || tiktokDisconnectLoading ? "not-allowed" : "pointer",
                  opacity: loading || tiktokDisconnectLoading ? 0.6 : 1,
                }}
              >
                Отключить TikTok
              </button>
            ) : null}
          </div>
          <div style={{ ...smallMuted, marginTop: 10 }}>
            Найдено: <b>{tiktokDiscoveredCount}</b> • Выбрано: <b>{selectedTikTokIds.length}</b> • Включено: <b>{tiktokEnabledCount}</b>
          </div>

          {tiktokCanShowAccountSelection && tiktokDiscoveredCount > 0 ? (
            <details style={{ marginTop: 12 }}>
              <summary style={{ cursor: "pointer", fontWeight: 800, fontSize: 13, opacity: 0.9 }}>
                Выбери аккаунты TikTok для проекта ({tiktokDiscoveredCount})
              </summary>
              <div style={{ marginTop: 8, display: "flex", flexDirection: "column", gap: 6 }}>
                {(accountsByPlatform.get("tiktok") ?? []).map((a) => {
                  const checked = selectedTikTokIds.includes(a.platform_account_id);
                  return (
                    <label key={a.id} style={{ display: "flex", alignItems: "center", gap: 8, cursor: "pointer" }}>
                      <input
                        type="checkbox"
                        checked={checked}
                        onChange={() => toggleSelectedTikTok(a.platform_account_id)}
                        style={{ width: 18, height: 18, flexShrink: 0 }}
                      />
                      <span style={{ fontSize: 13 }}>{a.name || a.platform_account_id}</span>
                      <span style={{ ...smallMuted, fontSize: 11 }}>{a.platform_account_id}</span>
                    </label>
                  );
                })}
              </div>
            </details>
          ) : null}
        </div>
      </div>

      {/* нижняя зона */}
      <div style={grid2}>
        {/* accounts list */}
        <div style={{ ...card, minHeight: 320 }}>
          <div style={{ fontSize: 22, fontWeight: 950 }}>Подключённые аккаунты</div>
          <div style={{ ...smallMuted, marginTop: 6 }}>
            Статус, данные и действия по каждому аккаунту. Meta и Google: выбор кабинетов/аккаунтов и «Sync now» по одному.
          </div>

          {(() => {
            const connectedCount = PLATFORM_ORDER.reduce(
              (n, pid) => n + (connectedAccountsByPlatformFiltered.get(pid)?.length ?? 0),
              0
            );
            if (connectedCount === 0) {
              return (
                <div style={{ ...smallMuted, marginTop: 14 }}>
                  {accounts.length === 0
                    ? "Нет подключённых аккаунтов. Подключи источник (Meta или Google) и нажми «Обновить»."
                    : "Нет выбранных кабинетов. Выбери кабинеты в карточке Meta или Google выше и нажми «Сохранить выбор»."}
                </div>
              );
            }
            return (
              <div style={{ marginTop: 14, display: "flex", flexDirection: "column", gap: 16 }}>
                {PLATFORM_ORDER.map((platformId) => {
                  const list = connectedAccountsByPlatformFiltered.get(platformId);
                  const isMeta = platformId === "meta";
                  const isGoogle = platformId === "google";
                  const isTikTok = platformId === "tiktok";
                  if (isMeta && !platformActiveForList.meta) return null;
                  if (isGoogle && !platformActiveForList.google) return null;
                  if (isTikTok && !platformActiveForList.tiktok) return null;
                  if (isMeta && (!list || list.length === 0)) {
                    return (
                      <div key={platformId}>
                        <div style={{ fontSize: 13, fontWeight: 800, opacity: 0.85, marginBottom: 8 }}>
                          {PLATFORM_LABELS[platformId]} (0)
                        </div>
                        <div style={{ ...smallMuted, padding: 10, borderRadius: 12, background: "rgba(255,255,255,0.03)" }}>
                          Нет выбранных кабинетов. Раскрой «Выбери кабинеты для проекта» в карточке Meta выше.
                        </div>
                      </div>
                    );
                  }
                  if (isGoogle && (!list || list.length === 0)) {
                    return (
                      <div key={platformId}>
                        <div style={{ fontSize: 13, fontWeight: 800, opacity: 0.85, marginBottom: 8 }}>
                          {PLATFORM_LABELS[platformId]} (0)
                        </div>
                        <div style={{ ...smallMuted, padding: 10, borderRadius: 12, background: "rgba(255,255,255,0.03)" }}>
                          Нет выбранных аккаунтов. Раскрой «Выбери аккаунты Google для проекта» в карточке Google выше.
                        </div>
                      </div>
                    );
                  }
                  if (!list?.length) return null;
                  const label = PLATFORM_LABELS[platformId] ?? platformId;
                  return (
                    <div key={platformId}>
                      <div style={{ fontSize: 13, fontWeight: 800, opacity: 0.85, marginBottom: 8 }}>
                        {label} ({list.length})
                      </div>
                      <div style={{ display: "grid", gap: 10 }}>
                        {list.map((a) => {
                          const syncing = syncingAccountId === a.platform_account_id;
                          const dataStatus = a.has_data ? "Has data" : "No data";
                          const rowHighlight = a.is_enabled;
                          const row = (
                            <div
                              style={{
                                padding: 14,
                                borderRadius: 12,
                                border: "1px solid rgba(255,255,255,0.10)",
                                background: rowHighlight ? "rgba(120,120,255,0.08)" : "rgba(255,255,255,0.02)",
                                display: "flex",
                                flexWrap: "wrap",
                                alignItems: "flex-start",
                                gap: 12,
                              }}
                            >
                              <span style={{ width: 18, flexShrink: 0 }} />
                              <div style={{ minWidth: 0, flex: 1 }}>
                                <div style={{ fontWeight: 800, fontSize: 15 }}>
                                  {a.name || a.platform_account_id}
                                </div>
                                <div style={{ ...smallMuted, marginTop: 2, fontSize: 12 }}>
                                  {a.platform_account_id}
                                </div>
                                <div style={{ ...smallMuted, marginTop: 8, fontSize: 12 }}>
                                  {formatDataThrough(a.max_date)}
                                  {a.has_data && a.row_count != null && a.row_count > 0 ? ` · ${a.row_count} rows` : ""}
                                </div>
                                <div style={{ ...smallMuted, marginTop: 4, fontSize: 12 }}>
                                  {formatLastSync(a.last_sync_at, a.last_sync_status)}
                                </div>
                              </div>
                              <div style={{ display: "flex", flexDirection: "column", gap: 6, alignItems: "flex-end" }}>
                                <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                                  <span
                                    style={{
                                      ...badgeBase,
                                      background: a.is_enabled ? "rgba(110,255,200,0.12)" : "rgba(255,255,255,0.06)",
                                      border: a.is_enabled ? "1px solid rgba(110,255,200,0.25)" : "1px solid rgba(255,255,255,0.14)",
                                      color: a.is_enabled ? "rgba(140,255,210,0.95)" : "rgba(255,255,255,0.6)",
                                    }}
                                  >
                                    {a.is_enabled ? "enabled" : "disabled"}
                                  </span>
                                  <span
                                    style={{
                                      ...badgeBase,
                                      background: a.has_data ? "rgba(100,180,255,0.12)" : "rgba(255,255,255,0.06)",
                                      border: a.has_data ? "1px solid rgba(100,180,255,0.25)" : "1px solid rgba(255,255,255,0.14)",
                                      color: a.has_data ? "rgba(160,200,255,0.95)" : "rgba(255,255,255,0.6)",
                                    }}
                                  >
                                    {dataStatus}
                                  </span>
                                </div>
                                <div style={{ display: "flex", gap: 6, marginTop: 4 }}>
                                  {isMeta ? (
                                    <button
                                      type="button"
                                      onClick={(e) => {
                                        e.preventDefault();
                                        syncOneAccount(a.platform_account_id, "meta");
                                      }}
                                      disabled={syncing || !metaSyncEnabled}
                                      style={{
                                        height: 28,
                                        padding: "0 10px",
                                        borderRadius: 10,
                                        border: "1px solid rgba(255,255,255,0.14)",
                                        background: "rgba(120,120,255,0.15)",
                                        color: "white",
                                        fontSize: 11,
                                        fontWeight: 700,
                                        cursor: syncing || !metaSyncEnabled ? "not-allowed" : "pointer",
                                        opacity: syncing || !metaSyncEnabled ? 0.6 : 1,
                                      }}
                                    >
                                      {syncing ? "Syncing…" : "Sync now"}
                                    </button>
                                  ) : isGoogle ? (
                                    <button
                                      type="button"
                                      onClick={(e) => {
                                        e.preventDefault();
                                        syncOneAccount(a.platform_account_id, "google");
                                      }}
                                      disabled={syncing || !googleSyncEnabled}
                                      style={{
                                        height: 28,
                                        padding: "0 10px",
                                        borderRadius: 10,
                                        border: "1px solid rgba(255,255,255,0.14)",
                                        background: "rgba(120,120,255,0.15)",
                                        color: "white",
                                        fontSize: 11,
                                        fontWeight: 700,
                                        cursor: syncing || !googleSyncEnabled ? "not-allowed" : "pointer",
                                        opacity: syncing || !googleSyncEnabled ? 0.6 : 1,
                                      }}
                                    >
                                      {syncing ? "Syncing…" : "Sync now"}
                                    </button>
                                  ) : isTikTok ? (
                                    <button
                                      type="button"
                                      onClick={(e) => {
                                        e.preventDefault();
                                        syncOneAccount(a.platform_account_id, "tiktok");
                                      }}
                                      disabled={syncing || !tiktokSyncEnabled}
                                      style={{
                                        height: 28,
                                        padding: "0 10px",
                                        borderRadius: 10,
                                        border: "1px solid rgba(255,255,255,0.14)",
                                        background: "rgba(120,120,255,0.15)",
                                        color: "white",
                                        fontSize: 11,
                                        fontWeight: 700,
                                        cursor: syncing || !tiktokSyncEnabled ? "not-allowed" : "pointer",
                                        opacity: syncing || !tiktokSyncEnabled ? 0.6 : 1,
                                      }}
                                    >
                                      {syncing ? "Syncing…" : "Sync now"}
                                    </button>
                                  ) : (
                                    <button
                                      type="button"
                                      disabled
                                      style={{
                                        height: 28,
                                        padding: "0 10px",
                                        borderRadius: 10,
                                        border: "1px solid rgba(255,255,255,0.10)",
                                        background: "rgba(255,255,255,0.04)",
                                        color: "rgba(255,255,255,0.45)",
                                        fontSize: 11,
                                        cursor: "not-allowed",
                                      }}
                                    >
                                      Sync (soon)
                                    </button>
                                  )}
                                </div>
                              </div>
                            </div>
                          );
                          return <Fragment key={a.id}>{row}</Fragment>;
                        })}
                      </div>
                    </div>
                  );
                })}
              </div>
            );
          })()}
        </div>

        {/* actions */}
        <div style={{ ...card, minHeight: 320 }}>
          <div style={{ fontSize: 22, fontWeight: 950 }}>Действия</div>

          <div style={{ ...smallMuted, marginTop: 10 }}>
            Подключение:{" "}
            <b>
              Meta{" "}
              {metaStatus === "healthy" || metaStatus === "stale" || metaStatus === "no_accounts"
                ? "токен OK"
                : metaStatus === "error"
                  ? "ошибка синка"
                  : metaStatus === "disconnected"
                    ? "нужно переподключение"
                    : "не подключено"}
              {", "}
              Google{" "}
              {googleStatus === "healthy" || googleStatus === "stale" || googleStatus === "no_accounts"
                ? "токен OK"
                : googleStatus === "error"
                  ? "ошибка синка"
                  : googleStatus === "disconnected"
                    ? "нужно переподключение"
                    : "не подключено"}
              {", "}
              TikTok{" "}
              {tiktokStatus === "healthy" || tiktokStatus === "stale" || tiktokStatus === "no_accounts"
                ? "токен OK"
                : tiktokStatus === "error"
                  ? "ошибка синка"
                  : tiktokStatus === "disconnected"
                    ? "нужно переподключение"
                    : "не подключено"}
            </b>
          </div>

          <div style={{ ...smallMuted, marginTop: 8 }}>
            Сохранено для sync (из БД):
            <br />
            Meta:{" "}
            <b>{enabledMetaIds.length ? enabledMetaIds.join(", ") : "—"}</b>
            {enabledMetaIds.length > 0 && metaRow?.oauth_valid === false ? (
              <span style={{ opacity: 0.9 }}> — ожидает валидный токен, переподключи OAuth</span>
            ) : null}
            <br />
            Google:{" "}
            <b>{enabledGoogleIds.length ? enabledGoogleIds.join(", ") : "—"}</b>
            {enabledGoogleIds.length > 0 && googleRow?.oauth_valid === false ? (
              <span style={{ opacity: 0.9 }}> — ожидает валидный токен, переподключи OAuth</span>
            ) : null}
            <br />
            TikTok:{" "}
            <b>{enabledTikTokIds.length ? enabledTikTokIds.join(", ") : "—"}</b>
            {enabledTikTokIds.length > 0 && tiktokRow?.oauth_valid === false ? (
              <span style={{ opacity: 0.9 }}> — ожидает валидный токен, переподключи OAuth</span>
            ) : null}
          </div>

          <div style={{ ...smallMuted, marginTop: 12 }}>
            По умолчанию sync тянет с начала месяца по TZ рекламного аккаунта.
          </div>

          <div style={{ marginTop: "auto", paddingTop: 14, display: "flex", gap: 10, flexWrap: "wrap" }}>
            <Button kind="ghost" onClick={refresh} disabled={loading}>
              Обновить
            </Button>
            <Button onClick={syncAll} disabled={loading || !hasAnyEnabledAccounts}>
              Запустить sync
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}
