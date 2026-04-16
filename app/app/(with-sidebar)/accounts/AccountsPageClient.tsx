"use client";

import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { flushSync } from "react-dom";
import { useRouter, useSearchParams } from "next/navigation";
import type { IntegrationStatusRow, IntegrationStatusValue } from "@/app/api/oauth/integration/status/route";
import { ActionId } from "@/app/lib/billingUiContract";
import { billingActionAllowed } from "@/app/lib/billingBootstrapClient";
import {
  FREE_AD_ACCOUNTS_LIMIT_USER_MESSAGE,
  FREE_AD_ACCOUNT_LIMIT_DASHBOARD_NOTICE_SESSION_KEY,
  isAdAccountPlanLimitApiCode,
  PAID_PLAN_AD_ACCOUNTS_LIMIT_USER_MESSAGE,
} from "@/app/lib/adAccountPlanLimit";
import { useBillingBootstrap } from "../../components/BillingBootstrapProvider";
import { useBillingPricingModalRequest } from "../../components/BillingPricingModalProvider";

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

type Toast = { type: "success" | "error" | "info"; text: string; detail?: string };

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

const channelsGrid: React.CSSProperties = {
  display: "grid",
  gridTemplateColumns: "repeat(auto-fill, minmax(272px, 1fr))",
  gap: 16,
  marginTop: 8,
  alignItems: "stretch",
};

/** Базовая оболочка карточки канала; вариант (active/setup/…) задаётся отдельно. */
const channelCardBase: React.CSSProperties = {
  position: "relative",
  borderRadius: 16,
  padding: 20,
  minHeight: 248,
  height: "100%",
  display: "flex",
  flexDirection: "column",
  boxSizing: "border-box" as const,
};

const card: React.CSSProperties = {
  borderRadius: 18,
  border: "1px solid rgba(255,255,255,0.10)",
  background:
    "radial-gradient(700px 240px at 30% 0%, rgba(120,120,255,0.12), transparent 60%), rgba(255,255,255,0.03)",
  boxShadow: "0 18px 60px rgba(0,0,0,0.45)",
  padding: 16,
  minHeight: 200,
  display: "flex",
  flexDirection: "column",
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

const accountsSpinKeyframes = `@keyframes accountsSpin { to { transform: rotate(360deg); } }`;

function InlineSpinner({ size = 15 }: { size?: number }) {
  return (
    <span
      aria-hidden
      style={{
        width: size,
        height: size,
        border: "2px solid rgba(255,255,255,0.22)",
        borderTopColor: "rgba(255,255,255,0.95)",
        borderRadius: "50%",
        animation: "accountsSpin 0.65s linear infinite",
        flexShrink: 0,
        display: "inline-block",
        verticalAlign: "middle",
      }}
    />
  );
}

function Button({
  children,
  onClick,
  disabled,
  kind = "primary",
  pending,
  pendingLabel,
  style: styleProp,
}: {
  children: React.ReactNode;
  onClick?: () => void;
  disabled?: boolean;
  kind?: "primary" | "ghost" | "outline";
  pending?: boolean;
  pendingLabel?: string;
  style?: React.CSSProperties;
}) {
  const isPrimary = kind === "primary";
  const isOutline = kind === "outline";
  const busy = !!(pending && pendingLabel);
  const inactive = !!disabled || busy;
  /** Явно «выключено», без синего tint как у активного primary (иначе выглядит как кликабельный CTA). */
  const primaryDisabledLook = isPrimary && !!disabled && !busy;
  const bg = primaryDisabledLook
    ? "rgba(42,42,48,0.95)"
    : isPrimary
      ? "rgba(120,120,255,0.22)"
      : isOutline
        ? "transparent"
        : "rgba(255,255,255,0.04)";
  const border = primaryDisabledLook
    ? "1px solid rgba(255,255,255,0.08)"
    : isOutline
      ? "1px solid rgba(255,255,255,0.28)"
      : "1px solid rgba(255,255,255,0.12)";
  const color = primaryDisabledLook ? "rgba(255,255,255,0.38)" : "white";
  return (
    <button
      type="button"
      disabled={inactive}
      onClick={busy ? undefined : onClick}
      style={{
        height: 44,
        padding: "0 16px",
        borderRadius: 12,
        border,
        background: bg,
        color,
        fontWeight: 750,
        cursor: inactive ? "not-allowed" : "pointer",
        opacity: inactive && !primaryDisabledLook ? 0.55 : 1,
        whiteSpace: "nowrap",
        transition: "opacity 0.18s ease, transform 0.18s ease, border-color 0.18s ease, background 0.18s ease",
        boxSizing: "border-box",
        ...styleProp,
      }}
    >
      <span
        style={{
          display: "inline-flex",
          alignItems: "center",
          justifyContent: "center",
          gap: 8,
          minHeight: 20,
        }}
      >
        {busy ? (
          <>
            <InlineSpinner size={14} />
            <span>{pendingLabel}</span>
          </>
        ) : (
          children
        )}
      </span>
    </button>
  );
}

function formatUpdatedMinutesAgo(iso: string | null | undefined): string {
  if (!iso) return "";
  const t = Date.parse(iso);
  if (Number.isNaN(t)) return "";
  const diffMin = Math.floor((Date.now() - t) / 60_000);
  if (diffMin < 1) return "Обновлено только что";
  const n = diffMin;
  const mod10 = n % 10;
  const mod100 = n % 100;
  let word: string;
  if (mod100 >= 11 && mod100 <= 14) word = "минут";
  else if (mod10 === 1) word = "минуту";
  else if (mod10 >= 2 && mod10 <= 4) word = "минуты";
  else word = "минут";
  return `Обновлено ${n} ${word} назад`;
}

function AccountPickerSkeletonRows({ count = 4 }: { count?: number }) {
  const rows = Array.from({ length: count }, (_, i) => i);
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 8, marginBottom: 12 }}>
      {rows.map((i) => (
        <div
          key={i}
          style={{
            display: "flex",
            alignItems: "center",
            gap: 10,
            padding: "8px 0",
          }}
        >
          <div
            style={{
              width: 18,
              height: 18,
              borderRadius: 4,
              background: "linear-gradient(90deg, rgba(255,255,255,0.06), rgba(255,255,255,0.12), rgba(255,255,255,0.06))",
              backgroundSize: "200% 100%",
              animation: "accountsShimmer 1.2s ease-in-out infinite",
            }}
          />
          <div style={{ flex: 1, minWidth: 0 }}>
            <div
              style={{
                height: 12,
                width: `${68 + (i % 3) * 8}%`,
                borderRadius: 6,
                background: "linear-gradient(90deg, rgba(255,255,255,0.06), rgba(255,255,255,0.11), rgba(255,255,255,0.06))",
                backgroundSize: "200% 100%",
                animation: "accountsShimmer 1.2s ease-in-out infinite",
                animationDelay: `${i * 0.08}s`,
              }}
            />
            <div
              style={{
                marginTop: 8,
                height: 10,
                width: "40%",
                borderRadius: 6,
                background: "linear-gradient(90deg, rgba(255,255,255,0.05), rgba(255,255,255,0.09), rgba(255,255,255,0.05))",
                backgroundSize: "200% 100%",
                animation: "accountsShimmer 1.2s ease-in-out infinite",
                animationDelay: `${0.04 + i * 0.08}s`,
              }}
            />
          </div>
        </div>
      ))}
    </div>
  );
}

function AccountsPageKeyframes() {
  return (
    <style
      dangerouslySetInnerHTML={{
        __html: `${accountsSpinKeyframes}
@keyframes accountsShimmer {
  0% { background-position: 200% 0; }
  100% { background-position: -200% 0; }
}
.int-card {
  transition: transform 0.22s cubic-bezier(0.4, 0, 0.2, 1), box-shadow 0.22s ease, border-color 0.2s ease, background 0.2s ease, opacity 0.2s ease;
}
.int-card:hover {
  transform: translateY(-3px);
}
.int-card--muted:hover {
  transform: translateY(-2px);
}
.accounts-details > summary::-webkit-details-marker {
  display: none;
}
.accounts-details > summary::after {
  content: "▸";
  float: right;
  opacity: 0.45;
  font-size: 12px;
  margin-top: 4px;
  line-height: 1;
}
@media (max-width: 1023px) {
  .accounts-details > summary::after {
    font-size: 22px;
    margin-top: 0;
    opacity: 0.55;
  }
}
.accounts-details[open] > summary::after {
  content: "▾";
}`,
      }}
    />
  );
}

type AdPlatform = "meta" | "google" | "tiktok";

type PageBusy =
  | { kind: "idle" }
  | { kind: "refresh" }
  | { kind: "save"; platform: AdPlatform }
  | { kind: "sync_all" }
  | { kind: "tiktok_discover" };

type PostConnectFlow = { platform: AdPlatform; step: 0 | 1 | 2 };

type ChannelSurfaceState = "idle" | "loading" | "success" | "error";

function deriveChannelSurfaceState(
  platform: AdPlatform,
  status: IntegrationStatusValue,
  flow: PostConnectFlow | null,
  oauthPending: AdPlatform | null,
  busy: PageBusy,
  enabledCount: number
): ChannelSurfaceState {
  if (status === "error") return "error";
  if (flow?.platform === platform && flow.step === 2) return "success";
  if (oauthPending === platform) return "loading";
  if (busy.kind === "save" && busy.platform === platform) return "loading";
  if (busy.kind === "tiktok_discover" && platform === "tiktok") return "loading";
  if (busy.kind === "sync_all" && enabledCount > 0) return "loading";
  if (busy.kind === "refresh" && status !== "not_connected") return "loading";
  return "idle";
}

function PostConnectProgress({ flow }: { flow: PostConnectFlow }) {
  const s = flow.step;
  return (
    <div
      style={{
        paddingTop: 8,
        fontSize: 12,
        lineHeight: 1.55,
        fontWeight: 650,
        color: "rgba(255,255,255,0.78)",
      }}
    >
      <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 4 }}>
        <span style={{ opacity: 0.95 }}>✓</span>
        <span>Подключено</span>
      </div>
      <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 4 }}>
        {s >= 2 ? <span style={{ opacity: 0.95 }}>✓</span> : s >= 1 ? <InlineSpinner size={12} /> : <span style={{ opacity: 0.35 }}>…</span>}
        <span>Загружаем аккаунты</span>
      </div>
      <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
        {s >= 2 ? <span style={{ opacity: 0.95 }}>✓</span> : <span style={{ opacity: 0.35 }}>…</span>}
        <span>Готово</span>
      </div>
    </div>
  );
}

function truncateToastDetail(s: string, max = 220): string {
  const t = s.replace(/<[^>]*>/g, "").replace(/\s+/g, " ").trim();
  if (t.length <= max) return t;
  return `${t.slice(0, max)}…`;
}

function ToastView({ toast, onClose }: { toast: Toast | null; onClose: () => void }) {
  if (!toast) return null;

  const palette =
    toast.type === "success"
      ? {
          bg: "linear-gradient(180deg, rgba(22,40,32,0.98) 0%, rgba(14,26,20,0.99) 100%)",
          border: "1px solid rgba(74,222,128,0.45)",
          title: "rgba(240,255,245,0.98)",
          detail: "rgba(200,230,210,0.88)",
          closeBg: "rgba(255,255,255,0.08)",
          closeBorder: "1px solid rgba(255,255,255,0.14)",
        }
      : toast.type === "error"
        ? {
            bg: "linear-gradient(180deg, rgba(48,22,24,0.99) 0%, rgba(28,14,16,0.995) 100%)",
            border: "1px solid rgba(248,113,113,0.5)",
            title: "rgba(255,235,235,0.98)",
            detail: "rgba(255,200,200,0.88)",
            closeBg: "rgba(0,0,0,0.25)",
            closeBorder: "1px solid rgba(255,255,255,0.12)",
          }
        : {
            bg: "linear-gradient(180deg, rgba(32,32,40,0.99) 0%, rgba(20,20,26,0.995) 100%)",
            border: "1px solid rgba(255,255,255,0.16)",
            title: "rgba(255,255,255,0.96)",
            detail: "rgba(220,220,230,0.85)",
            closeBg: "rgba(255,255,255,0.08)",
            closeBorder: "1px solid rgba(255,255,255,0.12)",
          };

  return (
    <div
      role="alert"
      style={{
        position: "fixed",
        left: "50%",
        bottom: "max(20px, env(safe-area-inset-bottom, 0px))",
        transform: "translateX(-50%)",
        zIndex: 10050,
        width: "min(520px, calc(100vw - 24px))",
        borderRadius: 16,
        padding: "14px 14px 14px 16px",
        border: palette.border,
        background: palette.bg,
        boxShadow: "0 20px 50px rgba(0,0,0,0.65), 0 0 0 1px rgba(0,0,0,0.35)",
        display: "flex",
        alignItems: "flex-start",
        gap: 12,
        boxSizing: "border-box",
      }}
    >
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontWeight: 800, lineHeight: 1.35, fontSize: 15, color: palette.title }}>{toast.text}</div>
        {toast.detail ? (
          <div style={{ marginTop: 6, fontSize: 13, lineHeight: 1.45, color: palette.detail, wordBreak: "break-word" }}>
            {truncateToastDetail(toast.detail)}
          </div>
        ) : null}
      </div>
      <button
        type="button"
        onClick={onClose}
        style={{
          flexShrink: 0,
          width: 36,
          height: 36,
          borderRadius: 10,
          border: palette.closeBorder,
          background: palette.closeBg,
          color: "rgba(255,255,255,0.92)",
          cursor: "pointer",
          display: "inline-flex",
          alignItems: "center",
          justifyContent: "center",
          padding: 0,
          marginTop: 1,
          lineHeight: 1,
          fontSize: 20,
          fontWeight: 500,
        }}
        aria-label="Закрыть уведомление"
      >
        <span aria-hidden style={{ display: "block", transform: "translateY(-0.5px)" }}>
          ×
        </span>
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

/** Order-independent equality for id lists (e.g. platform_account_id sets). */
function sameSet(a: string[], b: string[]): boolean {
  if (a.length !== b.length) return false;
  const sa = new Set(a);
  const sb = new Set(b);
  if (sa.size !== sb.size) return false;
  for (const x of sa) if (!sb.has(x)) return false;
  return true;
}

/** UI-статус канала: от данных и OAuth, не от «X из Y». */
type ChannelUiStatus = "ACTIVE" | "NEEDS_SETUP" | "NOT_CONNECTED" | "ERROR";

function deriveChannelUiStatus(args: {
  rawStatus: IntegrationStatusValue;
  oauthConnected: boolean;
  platformAccounts: CanonicalAccount[];
}): ChannelUiStatus {
  if (args.rawStatus === "error") return "ERROR";
  const enabled = args.platformAccounts.filter((a) => a.is_enabled);
  const hasEnabled = enabled.length > 0;
  const hasData = enabled.some((a) => a.has_data);
  if (hasEnabled && hasData) return "ACTIVE";
  if (args.oauthConnected) return "NEEDS_SETUP";
  return "NOT_CONNECTED";
}

function channelStatusBadgeLabel(s: ChannelUiStatus): string {
  switch (s) {
    case "ACTIVE":
      return "Активно";
    case "NEEDS_SETUP":
      return "Требует настройки";
    case "NOT_CONNECTED":
      return "Не подключено";
    case "ERROR":
      return "Ошибка";
    default:
      return "";
  }
}

function channelStatusBadgeDot(s: ChannelUiStatus): string {
  switch (s) {
    case "ACTIVE":
      return "🟢";
    case "NEEDS_SETUP":
      return "🟡";
    case "NOT_CONNECTED":
      return "⚪";
    case "ERROR":
      return "🔴";
    default:
      return "";
  }
}

function channelStatusBadgeStyle(s: ChannelUiStatus): React.CSSProperties {
  switch (s) {
    case "ACTIVE":
      return {
        background: "rgba(74,222,128,0.12)",
        border: "1px solid rgba(74,222,128,0.38)",
        color: "rgba(210,250,220,0.98)",
      };
    case "NEEDS_SETUP":
      return {
        background: "rgba(251,191,36,0.1)",
        border: "1px solid rgba(251,191,36,0.35)",
        color: "rgba(255,230,175,0.96)",
      };
    case "NOT_CONNECTED":
      return {
        background: "rgba(255,255,255,0.05)",
        border: "1px solid rgba(255,255,255,0.1)",
        color: "rgba(255,255,255,0.58)",
      };
    case "ERROR":
      return {
        background: "rgba(248,113,113,0.1)",
        border: "1px solid rgba(248,113,113,0.38)",
        color: "rgba(255,200,200,0.96)",
      };
    default:
      return {};
  }
}

function ruAccountsWithDataLine(n: number): string {
  if (n <= 0) return "Данные поступают в проект.";
  if (n === 1) return "1 аккаунт подключён с данными.";
  const mod10 = n % 10;
  const mod100 = n % 100;
  if (mod100 >= 11 && mod100 <= 14) return `${n} аккаунтов подключены с данными.`;
  if (mod10 === 1) return `${n} аккаунт подключён с данными.`;
  if (mod10 >= 2 && mod10 <= 4) return `${n} аккаунта подключены с данными.`;
  return `${n} аккаунтов подключены с данными.`;
}

function deriveChannelBodySummary(
  ui: ChannelUiStatus,
  enabledCount: number,
  errorHint: string
): string {
  if (ui === "ERROR") return errorHint.trim() || "Проверьте подключение и повторите попытку.";
  if (ui === "NOT_CONNECTED") return "Подключите OAuth, чтобы загружать метрики в проект.";
  if (ui === "ACTIVE") return ruAccountsWithDataLine(enabledCount);
  if (enabledCount === 0) return "Выберите рекламные аккаунты и сохраните выбор.";
  return "Ожидаем первые данные по выбранным аккаунтам.";
}

function countOAuthConnectedPlatforms(rows: IntegrationStatusRow[]): number {
  let n = 0;
  for (const pid of ["meta", "google", "tiktok"] as const) {
    const row = rows.find((r) => r.platform === pid);
    if (row && row.status !== "not_connected") n++;
  }
  return n;
}

/** Заголовок блока: только подключённые рекламные платформы (Meta/Google/TikTok), без лимитов аккаунтов. */
function ruConnectedSourcesTitle(connected: number): string {
  if (connected <= 0) return "";
  const n = connected;
  const mod10 = n % 10;
  const mod100 = n % 100;
  if (mod100 >= 11 && mod100 <= 14) {
    return `Подключено ${n} источников данных`;
  }
  if (mod10 === 1) {
    return `Подключён ${n} источник данных`;
  }
  if (mod10 >= 2 && mod10 <= 4) {
    return `Подключено ${n} источника данных`;
  }
  return `Подключено ${n} источников данных`;
}

/** Компактный текст бейджа лимита аккаунтов тарифа (отдельно от источников данных). */
function ruTariffLimitBadgeText(max: number): string {
  const n = max;
  const mod10 = n % 10;
  const mod100 = n % 100;
  if (mod100 >= 11 && mod100 <= 14) {
    return `Лимит: ${n} аккаунтов`;
  }
  if (mod10 === 1) {
    return `Лимит: ${n} аккаунт`;
  }
  if (mod10 >= 2 && mod10 <= 4) {
    return `Лимит: ${n} аккаунта`;
  }
  return `Лимит: ${n} аккаунтов`;
}

function channelCardShellForUi(ui: ChannelUiStatus, surface: ChannelSurfaceState): React.CSSProperties {
  const neutral: React.CSSProperties = {
    ...channelCardBase,
    border: "1px solid rgba(255,255,255,0.08)",
    background: "linear-gradient(165deg, rgba(255,255,255,0.045) 0%, rgba(255,255,255,0.012) 100%)",
    boxShadow: "0 12px 40px rgba(0,0,0,0.38)",
    opacity: 0.93,
  };
  const setup: React.CSSProperties = {
    ...channelCardBase,
    border: "1px solid rgba(251,191,36,0.3)",
    background:
      "linear-gradient(165deg, rgba(251,191,36,0.09) 0%, rgba(255,255,255,0.02) 55%), rgba(14,14,18,0.92)",
    boxShadow: "0 16px 48px rgba(0,0,0,0.42), 0 0 36px rgba(251,191,36,0.07)",
    opacity: 1,
  };
  const active: React.CSSProperties = {
    ...channelCardBase,
    border: "1px solid rgba(74,222,128,0.42)",
    background:
      "linear-gradient(155deg, rgba(74,222,128,0.16) 0%, rgba(99,102,241,0.07) 48%, rgba(255,255,255,0.03) 100%)",
    boxShadow:
      "0 0 0 1px rgba(74,222,128,0.15), 0 22px 60px rgba(0,0,0,0.45), 0 0 52px rgba(74,222,128,0.14)",
    opacity: 1,
  };
  const error: React.CSSProperties = {
    ...channelCardBase,
    border: "1px solid rgba(248,113,113,0.42)",
    background: "linear-gradient(165deg, rgba(248,113,113,0.11) 0%, rgba(255,255,255,0.02) 62%)",
    boxShadow: "0 16px 48px rgba(0,0,0,0.42), 0 0 40px rgba(248,113,113,0.09)",
    opacity: 1,
  };
  let shell: React.CSSProperties =
    ui === "ACTIVE" ? active : ui === "ERROR" ? error : ui === "NEEDS_SETUP" ? setup : neutral;
  if (surface === "loading") {
    shell = { ...shell, boxShadow: `${String(shell.boxShadow)}, 0 0 0 1px rgba(129,140,248,0.35)` };
  }
  if (surface === "success") {
    shell = { ...shell, boxShadow: `${String(shell.boxShadow)}, 0 0 0 1px rgba(74,222,128,0.4)` };
  }
  return shell;
}

/** Одна строка подсказки для карточки (коды API → текст). */
function formatIntegrationReasonForUi(code: string | null | undefined): string {
  if (code == null || code === "") return "";
  if (code === "no_data_updates_today") return "Нет данных за сегодня";
  return code;
}

type IntegrationChannelCardProps = {
  title: string;
  uiStatus: ChannelUiStatus;
  rawStatus: IntegrationStatusValue;
  reasonRow: IntegrationStatusRow | null | undefined;
  enabledAccountCount: number;
  accounts: CanonicalAccount[];
  selectedIds: string[];
  onToggleAccount: (platformAccountId: string) => void;
  adLimitNextWouldExceed: boolean;
  adLimitExplain: string;
  canShowAccountPicker: boolean;
  accountsListOpen: boolean;
  onShowAccountsList: () => void;
  onHideAccountsList: () => void;
  hasSaveableSelection: boolean;
  onSave: () => void;
  saveDisabled: boolean;
  saveLimitExceeded: boolean;
  showDisconnect: boolean;
  onDisconnect: () => void;
  disconnectBusy: boolean;
  disconnectLabel: string;
  projectId: string | null;
  pageBusy: PageBusy;
  oauthPending: boolean;
  accountsListLoading: boolean;
  connectPendingLabel: string | null;
  addAccountsPendingLabel: string | null;
  savePendingLabel: string | null;
  postConnect: PostConnectFlow | null;
  surfaceState: ChannelSurfaceState;
  blockFreshOAuth: boolean;
  onConnect: () => void;
};

function IntegrationChannelCard({
  title,
  uiStatus,
  rawStatus,
  reasonRow,
  enabledAccountCount,
  accounts,
  selectedIds,
  onToggleAccount,
  adLimitNextWouldExceed,
  adLimitExplain,
  canShowAccountPicker,
  accountsListOpen,
  onShowAccountsList,
  onHideAccountsList,
  hasSaveableSelection,
  onSave,
  saveDisabled,
  saveLimitExceeded,
  showDisconnect,
  onDisconnect,
  disconnectBusy,
  disconnectLabel,
  projectId,
  pageBusy,
  oauthPending,
  accountsListLoading,
  connectPendingLabel,
  addAccountsPendingLabel,
  savePendingLabel,
  postConnect,
  surfaceState,
  blockFreshOAuth,
  onConnect,
}: IntegrationChannelCardProps) {
  const [menuOpen, setMenuOpen] = useState(false);
  const menuWrapRef = useRef<HTMLDivElement>(null);

  useLayoutEffect(() => {
    if (!menuOpen) return;
    const close = (e: MouseEvent) => {
      const el = menuWrapRef.current;
      if (el && !el.contains(e.target as Node)) setMenuOpen(false);
    };
    document.addEventListener("mousedown", close);
    return () => document.removeEventListener("mousedown", close);
  }, [menuOpen]);

  const errorHint =
    rawStatus === "error" && reasonRow?.reason ? formatIntegrationReasonForUi(reasonRow.reason) : "";
  const hintLine = errorHint.trim();
  const bodyLine = deriveChannelBodySummary(uiStatus, enabledAccountCount, hintLine);

  const pageIdle = pageBusy.kind === "idle";
  const isNotConnected = uiStatus === "NOT_CONNECTED";
  const connectDisabled =
    !projectId ||
    !pageIdle ||
    oauthPending ||
    (blockFreshOAuth && rawStatus === "not_connected");

  const showAddAccountsPrimary =
    (uiStatus === "ACTIVE" || uiStatus === "NEEDS_SETUP") && canShowAccountPicker && !accountsListOpen;
  const saveBtnDisabled =
    !projectId || !pageIdle || saveDisabled || !hasSaveableSelection;

  const cardShellStyle = channelCardShellForUi(uiStatus, surfaceState);
  const cardClass =
    "int-card " + (uiStatus === "NOT_CONNECTED" || uiStatus === "ERROR" ? "int-card--muted" : "");

  const statusBadgeCompact: React.CSSProperties = {
    ...badgeBase,
    height: 26,
    padding: "0 9px",
    fontSize: 11,
    fontWeight: 800,
    letterSpacing: "0.02em",
    ...channelStatusBadgeStyle(uiStatus),
  };

  return (
    <div className={cardClass} style={cardShellStyle}>
      {/* HEADER */}
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 10,
          minHeight: 36,
        }}
      >
        <div
          style={{
            fontSize: 17,
            fontWeight: 800,
            letterSpacing: "-0.02em",
            lineHeight: 1.25,
            minWidth: 0,
            flex: 1,
          }}
        >
          {title}
        </div>
        <span style={{ ...statusBadgeCompact, flexShrink: 0 }} title={channelStatusBadgeLabel(uiStatus)}>
          <span style={{ marginRight: 5, fontSize: 10 }} aria-hidden>
            {channelStatusBadgeDot(uiStatus)}
          </span>
          {channelStatusBadgeLabel(uiStatus)}
        </span>
        {showDisconnect ? (
          <div ref={menuWrapRef} style={{ position: "relative", flexShrink: 0, zIndex: 3 }}>
            <button
              type="button"
              aria-label="Действия"
              aria-expanded={menuOpen}
              onClick={() => setMenuOpen((o) => !o)}
              disabled={!pageIdle || disconnectBusy}
              style={{
                width: 34,
                height: 34,
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                borderRadius: 10,
                border: "1px solid rgba(255,255,255,0.1)",
                background: "rgba(255,255,255,0.04)",
                color: "rgba(255,255,255,0.82)",
                fontSize: 16,
                lineHeight: 1,
                padding: 0,
                cursor: !pageIdle || disconnectBusy ? "not-allowed" : "pointer",
                opacity: !pageIdle || disconnectBusy ? 0.45 : 1,
                transition: "opacity 0.18s ease, background 0.18s ease",
              }}
            >
              ⋯
            </button>
            {menuOpen ? (
              <div
                style={{
                  position: "absolute",
                  right: 0,
                  top: "100%",
                  marginTop: 6,
                  minWidth: 168,
                  padding: 6,
                  borderRadius: 12,
                  border: "1px solid rgba(255,255,255,0.1)",
                  background: "rgba(16,16,22,0.98)",
                  boxShadow: "0 20px 50px rgba(0,0,0,0.55)",
                }}
              >
                <button
                  type="button"
                  onClick={() => {
                    setMenuOpen(false);
                    onDisconnect();
                  }}
                  disabled={!pageIdle || disconnectBusy}
                  style={{
                    width: "100%",
                    textAlign: "left",
                    padding: "10px 12px",
                    borderRadius: 8,
                    border: "none",
                    background: "transparent",
                    color: "rgba(255,170,170,0.96)",
                    fontSize: 13,
                    fontWeight: 700,
                    cursor: !pageIdle || disconnectBusy ? "not-allowed" : "pointer",
                  }}
                >
                  {disconnectLabel}
                </button>
              </div>
            ) : null}
          </div>
        ) : null}
      </div>

      {/* BODY */}
      <div
        style={{
          marginTop: 14,
          flex: 1,
          minHeight: 44,
          display: "flex",
          flexDirection: "column",
          gap: 10,
        }}
      >
        <p
          style={{
            margin: 0,
            fontSize: 13,
            lineHeight: 1.45,
            color: "rgba(255,255,255,0.72)",
            fontWeight: 500,
            transition: "color 0.2s ease",
          }}
        >
          {bodyLine}
        </p>
        {postConnect ? (
          <div style={{ marginTop: 2 }}>
            <PostConnectProgress flow={postConnect} />
          </div>
        ) : null}
      </div>

      {/* FOOTER */}
      <div
        style={{
          marginTop: 18,
          paddingTop: 4,
          display: "flex",
          flexDirection: "column",
          gap: 12,
        }}
      >
        {isNotConnected ? (
          <Button
            onClick={onConnect}
            disabled={connectDisabled}
            kind="outline"
            pending={!!connectPendingLabel}
            pendingLabel={connectPendingLabel ?? undefined}
          >
            Подключить
          </Button>
        ) : null}

        {showAddAccountsPrimary ? (
          <Button
            onClick={onShowAccountsList}
            disabled={!projectId || !pageIdle}
            kind="primary"
            pending={!!addAccountsPendingLabel}
            pendingLabel={addAccountsPendingLabel ?? undefined}
          >
            Добавить аккаунты
          </Button>
        ) : null}

        {!isNotConnected && canShowAccountPicker && accountsListOpen ? (
          <div
            style={{
              borderTop: "1px solid rgba(255,255,255,0.07)",
              paddingTop: 14,
              animation: "none",
            }}
          >
            {accountsListLoading ? (
              <AccountPickerSkeletonRows count={4} />
            ) : accounts.length === 0 ? (
              <div style={{ ...smallMuted, fontSize: 12, marginBottom: 12 }}>
                Список пуст. Обновите страницу или нажмите «Обновить» в шапке.
              </div>
            ) : (
              <div style={{ display: "flex", flexDirection: "column", gap: 8, marginBottom: 12 }}>
                {accounts.map((a) => {
                  const checked = selectedIds.includes(a.platform_account_id);
                  const disablePick = !checked && adLimitNextWouldExceed;
                  return (
                    <label
                      key={a.id}
                      style={{
                        display: "flex",
                        alignItems: "center",
                        gap: 10,
                        cursor: disablePick || !pageIdle ? "not-allowed" : "pointer",
                        opacity: disablePick || !pageIdle ? 0.55 : 1,
                      }}
                      title={disablePick ? adLimitExplain : undefined}
                    >
                      <input
                        type="checkbox"
                        checked={checked}
                        disabled={disablePick || !pageIdle}
                        onChange={() => onToggleAccount(a.platform_account_id)}
                        style={{
                          width: 18,
                          height: 18,
                          flexShrink: 0,
                        }}
                      />
                      <div style={{ minWidth: 0, flex: 1 }}>
                        <div style={{ fontSize: 13, lineHeight: 1.35, wordBreak: "break-word" }}>
                          {a.name || a.platform_account_id}
                        </div>
                        {a.name ? (
                          <div
                            style={{
                              ...smallMuted,
                              fontSize: 11,
                              marginTop: 4,
                              lineHeight: 1.3,
                              wordBreak: "break-all",
                            }}
                          >
                            {a.platform_account_id}
                          </div>
                        ) : null}
                      </div>
                    </label>
                  );
                })}
              </div>
            )}
            <span className="block w-full max-w-full" title={saveLimitExceeded ? adLimitExplain : undefined}>
              <Button
                onClick={onSave}
                disabled={saveBtnDisabled}
                kind="primary"
                pending={!!savePendingLabel}
                pendingLabel={savePendingLabel ?? undefined}
              >
                Сохранить выбор
              </Button>
            </span>
            <button
              type="button"
              onClick={() => {
                onHideAccountsList();
                setMenuOpen(false);
              }}
              style={{
                marginTop: 8,
                alignSelf: "flex-start",
                padding: 0,
                border: "none",
                background: "none",
                color: "rgba(255,255,255,0.5)",
                fontSize: 12,
                fontWeight: 600,
                cursor: "pointer",
                textDecoration: "underline",
                textUnderlineOffset: 3,
              }}
            >
              Свернуть список
            </button>
          </div>
        ) : null}
      </div>
    </div>
  );
}

export default function AccountsPageClient() {
  const router = useRouter();
  const sp = useSearchParams();
  const { resolvedUi, bootstrap, planFeatureMatrix, reloadBootstrap } = useBillingBootstrap();
  const { requestBillingPricingModal } = useBillingPricingModalRequest();
  const maxAdAccounts = planFeatureMatrix?.max_ad_accounts ?? null;
  const orgAdAccountsCount = bootstrap?.org_enabled_ad_accounts ?? null;
  const isFreePlanMatrix = planFeatureMatrix?.plan === "free";
  const adAccountLimitExplain = isFreePlanMatrix
    ? FREE_AD_ACCOUNTS_LIMIT_USER_MESSAGE
    : PAID_PLAN_AD_ACCOUNTS_LIMIT_USER_MESSAGE;
  const freeAdAccountCapReached =
    isFreePlanMatrix &&
    maxAdAccounts != null &&
    orgAdAccountsCount != null &&
    orgAdAccountsCount >= maxAdAccounts;
  const blockFreshAdOAuthConnect = freeAdAccountCapReached;
  const canMutateIntegrations = billingActionAllowed(resolvedUi, ActionId.sync_refresh);
  const guardIntegrationWrite = useCallback(() => {
    if (!canMutateIntegrations) {
      setToast({ type: "error", text: "Действие недоступно при текущем статусе подписки." });
      return false;
    }
    return true;
  }, [canMutateIntegrations]);

  const urlProjectId = sp.get("project_id") || "";
  const connectedParam = sp.get("connected"); // meta / meta_error
  const reasonParam = sp.get("reason"); // optional: project_id_missing / callback_exception / etc

  const [projectId, setProjectId] = useState<string>(urlProjectId);
  const [toast, setToast] = useState<Toast | null>(null);

  const [pageBusy, setPageBusy] = useState<PageBusy>({ kind: "idle" });
  const [postConnectFlow, setPostConnectFlow] = useState<PostConnectFlow | null>(null);
  const [oauthPendingPlatform, setOauthPendingPlatform] = useState<AdPlatform | null>(null);
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
  /** Раскрытый блок выбора аккаунтов для канала (meta | google | tiktok). */
  const [expandedChannel, setExpandedChannel] = useState<string | null>(null);
  const [isMobileViewport, setIsMobileViewport] = useState(false);

  useLayoutEffect(() => {
    if (typeof window === "undefined") return;
    const media = window.matchMedia("(max-width: 1023px)");
    const apply = () => setIsMobileViewport(media.matches);
    apply();
    media.addEventListener("change", apply);
    return () => media.removeEventListener("change", apply);
  }, []);

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

  async function refresh(opts?: { manageBusy?: boolean; quiet?: boolean }) {
    const manageBusy = opts?.manageBusy ?? true;
    const quiet = opts?.quiet ?? false;
    if (!projectId) return;
    if (manageBusy) {
      setPostConnectFlow((f) => (f && f.step === 0 ? { ...f, step: 1 } : f));
      setPageBusy({ kind: "refresh" });
    }
    const showFetchToast = (title: string, detail?: string) => {
      if (quiet) {
        console.warn("[accounts_refresh]", title, detail ?? "");
        return;
      }
      setToast({ type: "error", text: title, detail });
    };
    try {
      const statusRes = await fetch(`/api/oauth/integration/status?project_id=${encodeURIComponent(projectId)}`);
      const statusRaw = await statusRes.text();
      let statusJson: { success?: boolean; integrations?: IntegrationStatusRow[]; error?: string } = {};
      try {
        statusJson = JSON.parse(statusRaw) as typeof statusJson;
      } catch {
        showFetchToast(
          "Не удалось разобрать ответ сервера (статус интеграций)",
          `HTTP ${statusRes.status}. Ответ не JSON — часто это редирект на логин или ошибка прокси.`
        );
        return;
      }
      if (!statusRes.ok) {
        const apiErr = typeof statusJson.error === "string" && statusJson.error.trim() ? statusJson.error.trim() : null;
        showFetchToast(
          "Не удалось загрузить статус подключений каналов",
          apiErr ?? `Код ответа ${statusRes.status}. Попробуй обновить страницу или войти снова.`
        );
        return;
      }
      const statusList = statusJson?.integrations ?? [];
      setIntegrations(statusList);

      const metaFromUnified = statusList.find((i) => i.platform === "meta");
      const googleFromUnified = statusList.find((i) => i.platform === "google");
      const tiktokFromUnified = statusList.find((i) => i.platform === "tiktok");
      setIntegrationId(metaFromUnified?.integration_id ?? null);

      const accRes = await fetch(`/api/dashboard/accounts?project_id=${encodeURIComponent(projectId)}`);
      const accRaw = await accRes.text();
      let accJson: { success?: boolean; accounts?: CanonicalAccount[]; error?: string } = {};
      try {
        accJson = JSON.parse(accRaw) as typeof accJson;
      } catch {
        showFetchToast(
          "Не удалось разобрать ответ сервера (список кабинетов)",
          `HTTP ${accRes.status}. Ответ не JSON.`
        );
        return;
      }
      if (!accRes.ok || accJson.success === false) {
        const apiErr = typeof accJson.error === "string" && accJson.error.trim() ? accJson.error.trim() : null;
        showFetchToast(
          "Не удалось загрузить список рекламных кабинетов",
          apiErr ??
            (!accRes.ok ? `Код ответа ${accRes.status}. Возможно, нет доступа к проекту или подписка не позволяет аналитику.` : "Сервер отклонил запрос.")
        );
        return;
      }
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
    } catch (e) {
      setPostConnectFlow(null);
      const net =
        e instanceof TypeError && (e.message.includes("fetch") || e.message.includes("Failed to fetch"));
      if (quiet) {
        console.warn("[accounts_refresh] network or unexpected", e);
      } else if (net) {
        setToast({
          type: "error",
          text: "Нет соединения с сервером",
          detail: "Проверь интернет, VPN и попробуй снова. Если всё в порядке — зайди позже: возможно, краткий сбой.",
        });
      } else {
        setToast({
          type: "error",
          text: "Сбой при обновлении данных",
          detail: e instanceof Error && e.message ? truncateToastDetail(e.message, 180) : "Неизвестная ошибка.",
        });
      }
    } finally {
      if (manageBusy) {
        setPageBusy({ kind: "idle" });
        setPostConnectFlow((f) => {
          if (!f) return f;
          if (f.step === 1) return { ...f, step: 2 };
          return f;
        });
      }
    }
  }

  const refreshRef = useRef(refresh);
  refreshRef.current = refresh;

  // OAuth redirect: toast, strip query; успех → прогресс на карточке и автоматический refresh (см. refreshRef).
  useEffect(() => {
    if (!projectId && !urlProjectId) return;

    if (connectedParam === "meta_error") {
      const suffix = reasonParam ? ` (${reasonParam})` : "";
      setToast({ type: "error", text: `Meta OAuth не завершился. Попробуй ещё раз${suffix}.` });
      setPostConnectFlow(null);
      if (projectId) router.replace(`/app/accounts?project_id=${encodeURIComponent(projectId)}`);
      else router.replace(`/app/accounts`);
      return;
    }

    if (connectedParam === "meta") {
      setToast({ type: "success", text: "Meta подключена. Загружаем аккаунты и статусы…" });
      if (projectId) {
        flushSync(() => setPostConnectFlow({ platform: "meta", step: 0 }));
        router.replace(`/app/accounts?project_id=${encodeURIComponent(projectId)}`);
        queueMicrotask(() => void refreshRef.current());
      } else router.replace(`/app/accounts`);
      return;
    }

    if (connectedParam === "google_error") {
      const suffix = reasonParam ? ` (${reasonParam})` : "";
      setToast({ type: "error", text: `Google OAuth не завершился. Попробуй ещё раз${suffix}.` });
      setPostConnectFlow(null);
      if (projectId) router.replace(`/app/accounts?project_id=${encodeURIComponent(projectId)}`);
      else router.replace(`/app/accounts`);
      return;
    }

    if (connectedParam === "google") {
      setToast({ type: "success", text: "Google Ads подключён. Загружаем аккаунты…" });
      if (projectId) {
        flushSync(() => setPostConnectFlow({ platform: "google", step: 0 }));
        router.replace(`/app/accounts?project_id=${encodeURIComponent(projectId)}`);
        queueMicrotask(() => void refreshRef.current());
      } else router.replace(`/app/accounts`);
      return;
    }

    if (connectedParam === "tiktok_error") {
      const suffix = reasonParam ? ` (${reasonParam})` : "";
      setToast({ type: "error", text: `TikTok OAuth не завершился. Попробуй ещё раз${suffix}.` });
      setPostConnectFlow(null);
      if (projectId) router.replace(`/app/accounts?project_id=${encodeURIComponent(projectId)}`);
      else router.replace(`/app/accounts`);
      return;
    }

    if (connectedParam === "tiktok") {
      setToast({ type: "success", text: "TikTok Ads подключён. Загружаем аккаунты…" });
      if (projectId) {
        flushSync(() => setPostConnectFlow({ platform: "tiktok", step: 0 }));
        router.replace(`/app/accounts?project_id=${encodeURIComponent(projectId)}`);
        queueMicrotask(() => void refreshRef.current());
      } else router.replace(`/app/accounts`);
    }
  }, [connectedParam, reasonParam, projectId, urlProjectId, router]);

  useEffect(() => {
    if (!postConnectFlow || postConnectFlow.step !== 2) return;
    const t = window.setTimeout(() => setPostConnectFlow(null), 2600);
    return () => window.clearTimeout(t);
  }, [postConnectFlow]);

  useEffect(() => {
    if (!oauthPendingPlatform) return;
    const t = window.setTimeout(() => setOauthPendingPlatform(null), 12_000);
    return () => window.clearTimeout(t);
  }, [oauthPendingPlatform]);

  const lastAccountsVisRefreshRef = useRef(0);
  useEffect(() => {
    if (!projectId) return;
    const onVis = () => {
      if (document.visibilityState !== "visible") return;
      const now = Date.now();
      if (now - lastAccountsVisRefreshRef.current < 45_000) return;
      lastAccountsVisRefreshRef.current = now;
      void refreshRef.current({ manageBusy: false, quiet: true });
    };
    document.addEventListener("visibilitychange", onVis);
    return () => document.removeEventListener("visibilitychange", onVis);
  }, [projectId]);

  useEffect(() => {
    if (!projectId) return;
    void refresh({ manageBusy: false, quiet: true });
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

  const metaUiStatus = useMemo(
    () =>
      deriveChannelUiStatus({
        rawStatus: metaStatus,
        oauthConnected: metaStatus !== "not_connected",
        platformAccounts: accountsByPlatform.get("meta") ?? [],
      }),
    [metaStatus, accountsByPlatform]
  );
  const googleUiStatus = useMemo(
    () =>
      deriveChannelUiStatus({
        rawStatus: googleStatus,
        oauthConnected: googleStatus !== "not_connected",
        platformAccounts: accountsByPlatform.get("google") ?? [],
      }),
    [googleStatus, accountsByPlatform]
  );
  const tiktokUiStatus = useMemo(
    () =>
      deriveChannelUiStatus({
        rawStatus: tiktokStatus,
        oauthConnected: tiktokStatus !== "not_connected",
        platformAccounts: accountsByPlatform.get("tiktok") ?? [],
      }),
    [tiktokStatus, accountsByPlatform]
  );

  const connectedIntegrationPlaces = useMemo(
    () => countOAuthConnectedPlatforms(integrations),
    [integrations]
  );
  const integrationOverview = useMemo(() => {
    const connected = connectedIntegrationPlaces;
    const limitBadgeText = maxAdAccounts != null ? ruTariffLimitBadgeText(maxAdAccounts) : null;
    const limitReached =
      maxAdAccounts != null &&
      orgAdAccountsCount != null &&
      orgAdAccountsCount >= maxAdAccounts;
    if (connected <= 0) {
      return {
        title: "Подключите источники данных для полной аналитики",
        sub: "Ниже — рекламные каналы (Meta, Google, TikTok). Подключение обычно занимает пару минут.",
        limitBadgeText,
        limitReached,
      };
    }
    return {
      title: ruConnectedSourcesTitle(connected),
      sub: "Активные интеграции выделены. Добавляйте каналы по мере необходимости.",
      limitBadgeText,
      limitReached,
    };
  }, [connectedIntegrationPlaces, maxAdAccounts, orgAdAccountsCount]);

  const pageIdle = pageBusy.kind === "idle";

  const metaCardUi = useMemo(() => {
    const showAdd =
      (metaUiStatus === "ACTIVE" || metaUiStatus === "NEEDS_SETUP") &&
      metaCanShowAccountSelection &&
      expandedChannel !== "meta";
    const connectPending = oauthPendingPlatform === "meta" ? "Подключение..." : null;
    let addPending: string | null = null;
    if (showAdd) {
      if (pageBusy.kind === "refresh") addPending = "Загрузка аккаунтов...";
      else if (pageBusy.kind === "sync_all" && enabledMetaIds.length > 0) addPending = "Синхронизация...";
      else if (pageBusy.kind === "save" && pageBusy.platform === "meta") addPending = "Синхронизация...";
    }
    const savePending =
      expandedChannel === "meta" && pageBusy.kind === "save" && pageBusy.platform === "meta"
        ? "Синхронизация..."
        : null;
    return {
      connectPending,
      addPending,
      savePending,
      surface: deriveChannelSurfaceState(
        "meta",
        metaStatus,
        postConnectFlow,
        oauthPendingPlatform,
        pageBusy,
        enabledMetaIds.length
      ),
      accountsListLoading: pageBusy.kind === "refresh" && expandedChannel === "meta",
      postConnect: postConnectFlow?.platform === "meta" ? postConnectFlow : null,
    };
  }, [
    metaUiStatus,
    metaCanShowAccountSelection,
    expandedChannel,
    oauthPendingPlatform,
    pageBusy,
    enabledMetaIds.length,
    metaStatus,
    postConnectFlow,
  ]);

  const googleCardUi = useMemo(() => {
    const showAdd =
      (googleUiStatus === "ACTIVE" || googleUiStatus === "NEEDS_SETUP") &&
      googleCanShowAccountSelection &&
      expandedChannel !== "google";
    const connectPending = oauthPendingPlatform === "google" ? "Подключение..." : null;
    let addPending: string | null = null;
    if (showAdd) {
      if (pageBusy.kind === "refresh") addPending = "Загрузка аккаунтов...";
      else if (pageBusy.kind === "sync_all" && enabledGoogleIds.length > 0) addPending = "Синхронизация...";
      else if (pageBusy.kind === "save" && pageBusy.platform === "google") addPending = "Синхронизация...";
    }
    const savePending =
      expandedChannel === "google" && pageBusy.kind === "save" && pageBusy.platform === "google"
        ? "Синхронизация..."
        : null;
    return {
      connectPending,
      addPending,
      savePending,
      surface: deriveChannelSurfaceState(
        "google",
        googleStatus,
        postConnectFlow,
        oauthPendingPlatform,
        pageBusy,
        enabledGoogleIds.length
      ),
      accountsListLoading: pageBusy.kind === "refresh" && expandedChannel === "google",
      postConnect: postConnectFlow?.platform === "google" ? postConnectFlow : null,
    };
  }, [
    googleUiStatus,
    googleCanShowAccountSelection,
    expandedChannel,
    oauthPendingPlatform,
    pageBusy,
    enabledGoogleIds.length,
    googleStatus,
    postConnectFlow,
  ]);

  const tiktokCardUi = useMemo(() => {
    const showAdd =
      (tiktokUiStatus === "ACTIVE" || tiktokUiStatus === "NEEDS_SETUP") &&
      tiktokCanShowAccountSelection &&
      expandedChannel !== "tiktok";
    const connectPending = oauthPendingPlatform === "tiktok" ? "Подключение..." : null;
    let addPending: string | null = null;
    if (showAdd) {
      if (pageBusy.kind === "refresh") addPending = "Загрузка аккаунтов...";
      else if (pageBusy.kind === "tiktok_discover") addPending = "Загрузка аккаунтов...";
      else if (pageBusy.kind === "sync_all" && enabledTikTokIds.length > 0) addPending = "Синхронизация...";
      else if (pageBusy.kind === "save" && pageBusy.platform === "tiktok") addPending = "Синхронизация...";
    }
    const savePending =
      expandedChannel === "tiktok" && pageBusy.kind === "save" && pageBusy.platform === "tiktok"
        ? "Синхронизация..."
        : null;
    return {
      connectPending,
      addPending,
      savePending,
      surface: deriveChannelSurfaceState(
        "tiktok",
        tiktokStatus,
        postConnectFlow,
        oauthPendingPlatform,
        pageBusy,
        enabledTikTokIds.length
      ),
      accountsListLoading: pageBusy.kind === "refresh" && expandedChannel === "tiktok",
      postConnect: postConnectFlow?.platform === "tiktok" ? postConnectFlow : null,
    };
  }, [
    tiktokUiStatus,
    tiktokCanShowAccountSelection,
    expandedChannel,
    oauthPendingPlatform,
    pageBusy,
    enabledTikTokIds.length,
    tiktokStatus,
    postConnectFlow,
  ]);

  const metaAdProjected =
    orgAdAccountsCount != null ? orgAdAccountsCount - enabledMetaIds.length + selectedIds.length : null;
  const googleAdProjected =
    orgAdAccountsCount != null
      ? orgAdAccountsCount - enabledGoogleIds.length + selectedGoogleIds.length
      : null;
  const tiktokAdProjected =
    orgAdAccountsCount != null
      ? orgAdAccountsCount - enabledTikTokIds.length + selectedTikTokIds.length
      : null;

  const metaAdLimitExceeded =
    maxAdAccounts != null && metaAdProjected != null && metaAdProjected > maxAdAccounts;
  const googleAdLimitExceeded =
    maxAdAccounts != null && googleAdProjected != null && googleAdProjected > maxAdAccounts;
  const tiktokAdLimitExceeded =
    maxAdAccounts != null && tiktokAdProjected != null && tiktokAdProjected > maxAdAccounts;

  const metaNextCheckboxWouldExceed =
    maxAdAccounts != null &&
    orgAdAccountsCount != null &&
    orgAdAccountsCount - enabledMetaIds.length + selectedIds.length + 1 > maxAdAccounts;
  const googleNextCheckboxWouldExceed =
    maxAdAccounts != null &&
    orgAdAccountsCount != null &&
    orgAdAccountsCount - enabledGoogleIds.length + selectedGoogleIds.length + 1 > maxAdAccounts;
  const tiktokNextCheckboxWouldExceed =
    maxAdAccounts != null &&
    orgAdAccountsCount != null &&
    orgAdAccountsCount - enabledTikTokIds.length + selectedTikTokIds.length + 1 > maxAdAccounts;

  const toggleSelected = useCallback(
    (platformAccountId: string) => {
      if (selectedIds.includes(platformAccountId)) {
        setSelectedIds((p) => p.filter((x) => x !== platformAccountId));
        return;
      }
      const next = [...selectedIds, platformAccountId];
      if (
        maxAdAccounts != null &&
        orgAdAccountsCount != null &&
        orgAdAccountsCount - enabledMetaIds.length + next.length > maxAdAccounts
      ) {
        setToast({ type: "error", text: adAccountLimitExplain });
        return;
      }
      setSelectedIds(next);
    },
    [selectedIds, maxAdAccounts, orgAdAccountsCount, enabledMetaIds, adAccountLimitExplain]
  );

  const toggleSelectedGoogle = useCallback(
    (platformAccountId: string) => {
      if (selectedGoogleIds.includes(platformAccountId)) {
        setSelectedGoogleIds((p) => p.filter((x) => x !== platformAccountId));
        return;
      }
      const next = [...selectedGoogleIds, platformAccountId];
      if (
        maxAdAccounts != null &&
        orgAdAccountsCount != null &&
        orgAdAccountsCount - enabledGoogleIds.length + next.length > maxAdAccounts
      ) {
        setToast({ type: "error", text: adAccountLimitExplain });
        return;
      }
      setSelectedGoogleIds(next);
    },
    [selectedGoogleIds, maxAdAccounts, orgAdAccountsCount, enabledGoogleIds, adAccountLimitExplain]
  );

  const toggleSelectedTikTok = useCallback(
    (platformAccountId: string) => {
      if (selectedTikTokIds.includes(platformAccountId)) {
        setSelectedTikTokIds((p) => p.filter((x) => x !== platformAccountId));
        return;
      }
      const next = [...selectedTikTokIds, platformAccountId];
      if (
        maxAdAccounts != null &&
        orgAdAccountsCount != null &&
        orgAdAccountsCount - enabledTikTokIds.length + next.length > maxAdAccounts
      ) {
        setToast({ type: "error", text: adAccountLimitExplain });
        return;
      }
      setSelectedTikTokIds(next);
    },
    [selectedTikTokIds, maxAdAccounts, orgAdAccountsCount, enabledTikTokIds, adAccountLimitExplain]
  );

  async function saveGoogleSelection() {
    if (!projectId) return;
    if (!guardIntegrationWrite()) return;
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
    setPageBusy({ kind: "save", platform: "google" });
    try {
      const r = await fetch("/api/oauth/google/connections/save", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          project_id: projectId,
          ad_account_ids: selectedGoogleIds,
        }),
      });
      const j = (await r.json()) as { success?: boolean; error?: string; code?: string; saved?: number };
      if (!j?.success) {
        if (isAdAccountPlanLimitApiCode(j?.code)) {
          setToast({ type: "error", text: j?.error ?? adAccountLimitExplain });
          if (isFreePlanMatrix) {
            try {
              sessionStorage.setItem(FREE_AD_ACCOUNT_LIMIT_DASHBOARD_NOTICE_SESSION_KEY, "1");
            } catch {
              /* ignore */
            }
          }
        } else {
          setToast({
            type: "error",
            text:
              j?.error ??
              (googleStatus === "disconnected"
                ? "Не удалось сохранить: переподключи Google OAuth и попробуй снова."
                : "Не удалось сохранить выбор Google"),
          });
        }
      } else {
        setToast({ type: "success", text: `Сохранено аккаунтов Google: ${j.saved ?? selectedGoogleIds.length}` });
        await refresh({ manageBusy: false });
        void reloadBootstrap();
      }
    } catch {
      setToast({ type: "error", text: "Ошибка сохранения выбора Google" });
    } finally {
      setPageBusy({ kind: "idle" });
    }
  }

  async function saveTikTokSelection() {
    if (!projectId) return;
    if (!guardIntegrationWrite()) return;
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
    setPageBusy({ kind: "save", platform: "tiktok" });
    try {
      const r = await fetch("/api/oauth/tiktok/connections/save", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          project_id: projectId,
          ad_account_ids: selectedTikTokIds,
        }),
      });
      const j = (await r.json()) as { success?: boolean; error?: string; code?: string; saved?: number };
      if (!j?.success) {
        if (isAdAccountPlanLimitApiCode(j?.code)) {
          setToast({ type: "error", text: j?.error ?? adAccountLimitExplain });
          if (isFreePlanMatrix) {
            try {
              sessionStorage.setItem(FREE_AD_ACCOUNT_LIMIT_DASHBOARD_NOTICE_SESSION_KEY, "1");
            } catch {
              /* ignore */
            }
          }
        } else {
          setToast({
            type: "error",
            text:
              j?.error ??
              (tiktokStatus === "disconnected"
                ? "Не удалось сохранить: переподключи TikTok OAuth и попробуй снова."
                : "Не удалось сохранить выбор TikTok"),
          });
        }
      } else {
        setToast({ type: "success", text: `Сохранено TikTok аккаунтов: ${j.saved ?? selectedTikTokIds.length}` });
        await refresh({ manageBusy: false });
        void reloadBootstrap();
      }
    } catch {
      setToast({ type: "error", text: "Ошибка сохранения выбора TikTok" });
    } finally {
      setPageBusy({ kind: "idle" });
    }
  }

  async function saveSelection() {
    if (!projectId) return;
    if (!guardIntegrationWrite()) return;

    if (!integrationId || !metaShowSaveSelection) {
      setToast({ type: "error", text: "Сначала подключи Meta (OAuth), затем выбирай кабинеты." });
      return;
    }
    if (selectedIds.length === 0) {
      setToast({ type: "info", text: "Выбери хотя бы один кабинет для sync." });
      return;
    }

    setPageBusy({ kind: "save", platform: "meta" });
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
      const j = (await r.json()) as { success?: boolean; error?: string; code?: string; saved?: number };
      if (!j?.success) {
        if (isAdAccountPlanLimitApiCode(j?.code)) {
          setToast({ type: "error", text: j?.error ?? adAccountLimitExplain });
          if (isFreePlanMatrix) {
            try {
              sessionStorage.setItem(FREE_AD_ACCOUNT_LIMIT_DASHBOARD_NOTICE_SESSION_KEY, "1");
            } catch {
              /* ignore */
            }
          }
        } else {
          setToast({ type: "error", text: j?.error ?? "Не удалось сохранить выбор кабинетов" });
        }
      } else {
        setToast({ type: "success", text: `Сохранено кабинетов: ${j.saved ?? selectedIds.length}. Синхронизация…` });
        await refresh({ manageBusy: false });
        void reloadBootstrap();
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
        await refresh({ manageBusy: false });
        void reloadBootstrap();
      }
    } catch {
      setToast({ type: "error", text: "Ошибка сохранения (connections/save)" });
    } finally {
      setPageBusy({ kind: "idle" });
    }
  }

  function connectMeta() {
    if (!projectId) return;
    setOauthPendingPlatform("meta");
    const returnTo = `/app/accounts?project_id=${encodeURIComponent(projectId)}`;
    const url = `/api/oauth/meta/start?project_id=${encodeURIComponent(projectId)}&return_to=${encodeURIComponent(returnTo)}`;
    window.requestAnimationFrame(() => {
      window.location.href = url;
    });
  }

  function connectGoogle() {
    if (!projectId) return;
    setOauthPendingPlatform("google");
    const returnTo = `/app/accounts?project_id=${encodeURIComponent(projectId)}`;
    const url = `/api/oauth/google/start?project_id=${encodeURIComponent(projectId)}&return_to=${encodeURIComponent(returnTo)}`;
    window.requestAnimationFrame(() => {
      window.location.href = url;
    });
  }

  async function connectTikTok() {
    if (!projectId) return;
    if (tiktokConnectedLike) {
      if (!guardIntegrationWrite()) return;
      try {
        setPageBusy({ kind: "tiktok_discover" });
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
        await refresh({ manageBusy: false });
      } finally {
        setPageBusy({ kind: "idle" });
      }
      return;
    }
    setOauthPendingPlatform("tiktok");
    const returnTo = `/app/accounts?project_id=${encodeURIComponent(projectId)}`;
    const url = `/api/oauth/tiktok/start?project_id=${encodeURIComponent(projectId)}&return_to=${encodeURIComponent(returnTo)}`;
    window.requestAnimationFrame(() => {
      window.location.href = url;
    });
  }

  async function disconnectGoogle() {
    if (!projectId) return;
    if (!guardIntegrationWrite()) return;
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
    if (!guardIntegrationWrite()) return;
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
    if (!guardIntegrationWrite()) return;
    if (!hasAnyEnabledAccounts) {
      setToast({ type: "info", text: "Сначала подключи источник (Meta или Google) и выбери аккаунты для sync." });
      return;
    }

    setPageBusy({ kind: "sync_all" });
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
          setPageBusy({ kind: "idle" });
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
          setPageBusy({ kind: "idle" });
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
          setPageBusy({ kind: "idle" });
          return;
        }
        totalRows += Number(j?.rows_written ?? 0);
      }

      setToast({ type: "success", text: `Синхронизация завершена: ${totalRows} строк` });
      await refresh({ manageBusy: false });
    } catch {
      setToast({ type: "error", text: "Ошибка синхронизации" });
    } finally {
      setPageBusy({ kind: "idle" });
    }
  }

  async function disconnectMeta() {
    if (!projectId) return;
    if (!guardIntegrationWrite()) return;
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
    if (!guardIntegrationWrite()) return;
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
      await refresh({ manageBusy: false });
    } catch {
      setToast({ type: "error", text: "Ошибка синхронизации" });
    } finally {
      setSyncingAccountId(null);
    }
  }

  const pageWrapResponsive = useMemo(
    () => ({ ...pageWrap, padding: isMobileViewport ? "14px 14px 96px" : 22, boxSizing: "border-box" as const }),
    [isMobileViewport]
  );
  const headerRowResponsive = useMemo(
    () => ({
      ...headerRow,
      ...(isMobileViewport ? { flexDirection: "column" as const, alignItems: "stretch" as const } : {}),
    }),
    [isMobileViewport]
  );
  const h1Responsive = useMemo(
    () => ({ ...h1, fontSize: isMobileViewport ? 26 : 40, lineHeight: isMobileViewport ? 1.12 : 1.05 }),
    [isMobileViewport]
  );
  const subtitleResponsive = useMemo(
    () => ({
      ...subtitle,
      fontSize: isMobileViewport ? 14 : 16,
      marginTop: isMobileViewport ? 8 : 10,
      lineHeight: 1.45,
    }),
    [isMobileViewport]
  );

  const primaryButtons = (
    <div
      style={{
        display: "flex",
        gap: 10,
        alignItems: "center",
        ...(isMobileViewport ? { flexDirection: "column" as const, alignItems: "stretch" as const, width: "100%" } : {}),
      }}
    >
      <Button
        kind="ghost"
        onClick={() => void refresh()}
        disabled={!projectId || !pageIdle}
        pending={pageBusy.kind === "refresh"}
        pendingLabel="Загрузка аккаунтов..."
        style={isMobileViewport ? { width: "100%" } : undefined}
      >
        Обновить
      </Button>
      <Button
        onClick={syncAll}
        disabled={!projectId || !pageIdle || !hasAnyEnabledAccounts}
        pending={pageBusy.kind === "sync_all"}
        pendingLabel="Синхронизация..."
        style={isMobileViewport ? { width: "100%" } : undefined}
      >
        {isMobileViewport ? "Запустить синк" : "Запустить sync"}
      </Button>
    </div>
  );

  if (!projectId) {
    return (
      <div style={pageWrapResponsive}>
        <AccountsPageKeyframes />
        <ToastView toast={toast} onClose={() => setToast(null)} />

        <div style={headerRowResponsive}>
          <div style={{ minWidth: 0 }}>
            <h1 style={h1Responsive}>Аккаунты и интеграции</h1>
            <div style={subtitleResponsive}>
              Статус каналов и аккаунтов. Загрузка списка и синхронизация обычно занимают до 1–2 минут.
            </div>
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
    <div style={pageWrapResponsive}>
      <AccountsPageKeyframes />
      <ToastView toast={toast} onClose={() => setToast(null)} />

      {freeAdAccountCapReached ? (
        <div
          style={{
            marginBottom: 16,
            padding: "14px 16px",
            borderRadius: 14,
            border: "1px solid rgba(251,191,36,0.35)",
            background: "rgba(251,191,36,0.10)",
            color: "rgba(255,248,220,0.95)",
            fontSize: 14,
            lineHeight: 1.45,
            display: "flex",
            flexWrap: "wrap",
            alignItems: "center",
            gap: 12,
            justifyContent: "space-between",
          }}
        >
          <span>Доступен только один рекламный аккаунт на бесплатном тарифе</span>
          <button
            type="button"
            onClick={() => {
              requestBillingPricingModal("free_ad_accounts_cap_accounts_page", { force: true });
            }}
            style={{
              padding: "10px 16px",
              borderRadius: 12,
              border: "1px solid rgba(52,211,153,0.45)",
              background: "rgba(16,185,129,0.22)",
              color: "rgba(220,255,235,0.98)",
              fontWeight: 800,
              cursor: "pointer",
              whiteSpace: "nowrap",
            }}
          >
            Перейти на Growth
          </button>
        </div>
      ) : null}

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

      <div style={headerRowResponsive}>
        <div style={{ minWidth: 0 }}>
          <h1 style={h1Responsive}>Аккаунты и интеграции</h1>
          <div style={subtitleResponsive}>Подключение каналов, выбор кабинетов и синхронизация данных.</div>
        </div>
        {primaryButtons}
      </div>

      <div
        role="status"
        style={{
          width: "100%",
          boxSizing: "border-box",
          marginBottom: 14,
          padding: "8px 12px",
          borderRadius: 10,
          border: "1px solid rgba(255,255,255,0.055)",
          background: "rgba(255,255,255,0.028)",
          boxShadow: "none",
        }}
      >
        <div
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            gap: 12,
          }}
        >
          <div
            style={{
              fontSize: 15,
              fontWeight: 820,
              letterSpacing: "-0.02em",
              lineHeight: 1.35,
              flex: 1,
              minWidth: 0,
              color: "rgba(255,255,255,0.92)",
            }}
          >
            {integrationOverview.title}
          </div>
          {integrationOverview.limitBadgeText ? (
            <span
              style={{
                display: "inline-flex",
                alignItems: "center",
                flexShrink: 0,
                height: 26,
                padding: "0 9px",
                borderRadius: 999,
                fontSize: 11,
                fontWeight: 750,
                letterSpacing: "0.01em",
                whiteSpace: "nowrap",
                ...(integrationOverview.limitReached
                  ? {
                      border: "1px solid rgba(251,146,60,0.4)",
                      background: "rgba(251,146,60,0.1)",
                      color: "rgba(255,215,175,0.96)",
                    }
                  : {
                      border: "1px solid rgba(255,255,255,0.1)",
                      background: "rgba(255,255,255,0.045)",
                      color: "rgba(255,255,255,0.65)",
                    }),
              }}
            >
              {integrationOverview.limitBadgeText}
            </span>
          ) : null}
        </div>
        <div
          style={{
            ...smallMuted,
            marginTop: 5,
            fontSize: 12,
            lineHeight: 1.45,
            opacity: 0.78,
          }}
        >
          {integrationOverview.sub}
        </div>
        {integrationOverview.limitReached ? (
          <div
            style={{
              marginTop: 6,
              fontSize: 12,
              lineHeight: 1.45,
              color: "rgba(255,255,255,0.62)",
              fontWeight: 500,
            }}
          >
            Вы используете максимальное количество аккаунтов для текущего тарифа
          </div>
        ) : null}
      </div>

      <div style={channelsGrid}>
        <IntegrationChannelCard
          title="Meta Ads"
          uiStatus={metaUiStatus}
          rawStatus={metaStatus}
          reasonRow={metaRow}
          enabledAccountCount={enabledMetaIds.length}
          accounts={accountsByPlatform.get("meta") ?? []}
          selectedIds={selectedIds}
          onToggleAccount={toggleSelected}
          adLimitNextWouldExceed={metaNextCheckboxWouldExceed}
          adLimitExplain={adAccountLimitExplain}
          canShowAccountPicker={metaCanShowAccountSelection}
          accountsListOpen={expandedChannel === "meta"}
          onShowAccountsList={() => setExpandedChannel("meta")}
          onHideAccountsList={() => setExpandedChannel((c) => (c === "meta" ? null : c))}
          hasSaveableSelection={metaShowSaveSelection}
          onSave={saveSelection}
          saveDisabled={selectedIds.length === 0 || metaAdLimitExceeded}
          saveLimitExceeded={metaAdLimitExceeded}
          showDisconnect={metaShowDisconnect}
          onDisconnect={() => setShowDisconnectConfirm(true)}
          disconnectBusy={disconnectLoading}
          disconnectLabel="Отключить"
          projectId={projectId}
          pageBusy={pageBusy}
          oauthPending={oauthPendingPlatform === "meta"}
          accountsListLoading={metaCardUi.accountsListLoading}
          connectPendingLabel={metaCardUi.connectPending}
          addAccountsPendingLabel={metaCardUi.addPending}
          savePendingLabel={metaCardUi.savePending}
          postConnect={metaCardUi.postConnect}
          surfaceState={metaCardUi.surface}
          blockFreshOAuth={blockFreshAdOAuthConnect}
          onConnect={connectMeta}
        />
        <IntegrationChannelCard
          title="Google Ads"
          uiStatus={googleUiStatus}
          rawStatus={googleStatus}
          reasonRow={googleRow}
          enabledAccountCount={enabledGoogleIds.length}
          accounts={accountsByPlatform.get("google") ?? []}
          selectedIds={selectedGoogleIds}
          onToggleAccount={toggleSelectedGoogle}
          adLimitNextWouldExceed={googleNextCheckboxWouldExceed}
          adLimitExplain={adAccountLimitExplain}
          canShowAccountPicker={googleCanShowAccountSelection}
          accountsListOpen={expandedChannel === "google"}
          onShowAccountsList={() => setExpandedChannel("google")}
          onHideAccountsList={() => setExpandedChannel((c) => (c === "google" ? null : c))}
          hasSaveableSelection={googleShowSaveSelection}
          onSave={saveGoogleSelection}
          saveDisabled={selectedGoogleIds.length === 0 || googleAdLimitExceeded}
          saveLimitExceeded={googleAdLimitExceeded}
          showDisconnect={googleShowDisconnect}
          onDisconnect={() => setShowGoogleDisconnectConfirm(true)}
          disconnectBusy={googleDisconnectLoading}
          disconnectLabel="Отключить"
          projectId={projectId}
          pageBusy={pageBusy}
          oauthPending={oauthPendingPlatform === "google"}
          accountsListLoading={googleCardUi.accountsListLoading}
          connectPendingLabel={googleCardUi.connectPending}
          addAccountsPendingLabel={googleCardUi.addPending}
          savePendingLabel={googleCardUi.savePending}
          postConnect={googleCardUi.postConnect}
          surfaceState={googleCardUi.surface}
          blockFreshOAuth={blockFreshAdOAuthConnect}
          onConnect={connectGoogle}
        />
        <IntegrationChannelCard
          title="TikTok Ads"
          uiStatus={tiktokUiStatus}
          rawStatus={tiktokStatus}
          reasonRow={tiktokRow}
          enabledAccountCount={enabledTikTokIds.length}
          accounts={accountsByPlatform.get("tiktok") ?? []}
          selectedIds={selectedTikTokIds}
          onToggleAccount={toggleSelectedTikTok}
          adLimitNextWouldExceed={tiktokNextCheckboxWouldExceed}
          adLimitExplain={adAccountLimitExplain}
          canShowAccountPicker={tiktokCanShowAccountSelection}
          accountsListOpen={expandedChannel === "tiktok"}
          onShowAccountsList={() => setExpandedChannel("tiktok")}
          onHideAccountsList={() => setExpandedChannel((c) => (c === "tiktok" ? null : c))}
          hasSaveableSelection={tiktokShowSaveSelection}
          onSave={saveTikTokSelection}
          saveDisabled={selectedTikTokIds.length === 0 || tiktokAdLimitExceeded}
          saveLimitExceeded={tiktokAdLimitExceeded}
          showDisconnect={tiktokShowDisconnect}
          onDisconnect={() => setShowTikTokDisconnectConfirm(true)}
          disconnectBusy={tiktokDisconnectLoading}
          disconnectLabel="Отключить"
          projectId={projectId}
          pageBusy={pageBusy}
          oauthPending={oauthPendingPlatform === "tiktok"}
          accountsListLoading={tiktokCardUi.accountsListLoading}
          connectPendingLabel={tiktokCardUi.connectPending}
          addAccountsPendingLabel={tiktokCardUi.addPending}
          savePendingLabel={tiktokCardUi.savePending}
          postConnect={tiktokCardUi.postConnect}
          surfaceState={tiktokCardUi.surface}
          blockFreshOAuth={blockFreshAdOAuthConnect}
          onConnect={connectTikTok}
        />
        <div
          className="int-card int-card--muted"
          style={channelCardShellForUi("NOT_CONNECTED", "idle")}
        >
          <div style={{ display: "flex", alignItems: "center", gap: 10, minHeight: 36 }}>
            <div style={{ fontSize: 17, fontWeight: 800, flex: 1, letterSpacing: "-0.02em" }}>Yandex</div>
            <span
              style={{
                ...badgeBase,
                height: 26,
                padding: "0 9px",
                fontSize: 11,
                fontWeight: 800,
                ...channelStatusBadgeStyle("NOT_CONNECTED"),
              }}
            >
              <span style={{ marginRight: 5, fontSize: 10 }} aria-hidden>
                {channelStatusBadgeDot("NOT_CONNECTED")}
              </span>
              {channelStatusBadgeLabel("NOT_CONNECTED")}
            </span>
          </div>
          <div style={{ marginTop: 14, flex: 1, minHeight: 44 }}>
            <p style={{ margin: 0, fontSize: 13, lineHeight: 1.45, color: "rgba(255,255,255,0.68)" }}>
              Канал в разработке. Подключение появится в одном из следующих релизов.
            </p>
          </div>
          <div style={{ marginTop: 18 }}>
            <Button kind="outline" disabled>
              Скоро
            </Button>
          </div>
        </div>
      </div>

      <details
        className="accounts-details"
        style={{
          ...card,
          minHeight: 0,
          marginTop: 20,
          borderRadius: 16,
          border: "1px solid rgba(255,255,255,0.08)",
          padding: "14px 18px 18px",
        }}
      >
        <summary
          style={{
            fontSize: 16,
            fontWeight: 800,
            cursor: "pointer",
            listStyle: "none",
            padding: "4px 0",
            color: "rgba(255,255,255,0.92)",
          }}
        >
          Подключённые аккаунты
        </summary>

        {(() => {
          const connectedCount = PLATFORM_ORDER.reduce(
            (n, pid) => n + (connectedAccountsByPlatformFiltered.get(pid)?.length ?? 0),
            0
          );
          if (connectedCount === 0) {
            return <div style={{ ...smallMuted, marginTop: 12 }}>Нет активных аккаунтов.</div>;
          }
          return (
            <div style={{ marginTop: 12, display: "flex", flexDirection: "column", gap: 14 }}>
              {PLATFORM_ORDER.map((platformId) => {
                const list = connectedAccountsByPlatformFiltered.get(platformId);
                const isMeta = platformId === "meta";
                const isGoogle = platformId === "google";
                const isTikTok = platformId === "tiktok";
                if (platformId === "yandex") return null;
                if (isMeta && !platformActiveForList.meta) return null;
                if (isGoogle && !platformActiveForList.google) return null;
                if (isTikTok && !platformActiveForList.tiktok) return null;
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
                        return (
                          <div
                            key={a.id}
                            style={{
                              padding: 12,
                              borderRadius: 12,
                              border: "1px solid rgba(255,255,255,0.10)",
                              background: "rgba(255,255,255,0.02)",
                              display: "flex",
                              flexWrap: "wrap",
                              alignItems: "flex-start",
                              justifyContent: "space-between",
                              gap: 12,
                            }}
                          >
                            <div style={{ minWidth: 0, flex: 1 }}>
                              <div style={{ fontWeight: 800, fontSize: 14 }}>{a.name || a.platform_account_id}</div>
                              <div style={{ ...smallMuted, marginTop: 4, fontSize: 12 }}>{a.platform_account_id}</div>
                            </div>
                            <div style={{ display: "flex", flexDirection: "column", gap: 8, alignItems: "flex-end" }}>
                              <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                                <span
                                  style={{
                                    ...badgeBase,
                                    background: a.is_enabled ? "rgba(110,255,200,0.12)" : "rgba(255,255,255,0.06)",
                                    border: a.is_enabled
                                      ? "1px solid rgba(110,255,200,0.25)"
                                      : "1px solid rgba(255,255,255,0.14)",
                                    color: a.is_enabled ? "rgba(140,255,210,0.95)" : "rgba(255,255,255,0.6)",
                                  }}
                                >
                                  {a.is_enabled ? "Подключен" : "Не подключен"}
                                </span>
                                <span
                                  style={{
                                    ...badgeBase,
                                    background: a.has_data ? "rgba(100,180,255,0.12)" : "rgba(255,255,255,0.06)",
                                    border: a.has_data
                                      ? "1px solid rgba(100,180,255,0.25)"
                                      : "1px solid rgba(255,255,255,0.14)",
                                    color: a.has_data ? "rgba(160,200,255,0.95)" : "rgba(255,255,255,0.6)",
                                  }}
                                >
                                  {a.has_data ? "Есть данные" : "Нет данных"}
                                </span>
                              </div>
                              <div style={{ display: "flex", flexDirection: "column", gap: 6, alignItems: "flex-end" }}>
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
                                        display: "inline-flex",
                                        alignItems: "center",
                                        gap: 6,
                                      }}
                                    >
                                      {syncing ? (
                                        <>
                                          <InlineSpinner size={11} />
                                          Синхронизация...
                                        </>
                                      ) : (
                                        "Синхронизировать"
                                      )}
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
                                        display: "inline-flex",
                                        alignItems: "center",
                                        gap: 6,
                                      }}
                                    >
                                      {syncing ? (
                                        <>
                                          <InlineSpinner size={11} />
                                          Синхронизация...
                                        </>
                                      ) : (
                                        "Синхронизировать"
                                      )}
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
                                        display: "inline-flex",
                                        alignItems: "center",
                                        gap: 6,
                                      }}
                                    >
                                      {syncing ? (
                                        <>
                                          <InlineSpinner size={11} />
                                          Синхронизация...
                                        </>
                                      ) : (
                                        "Синхронизировать"
                                      )}
                                    </button>
                                  ) : null}
                                </div>
                                {!syncing && formatUpdatedMinutesAgo(a.last_sync_at) ? (
                                  <div style={{ ...smallMuted, fontSize: 11, fontWeight: 600 }}>
                                    {formatUpdatedMinutesAgo(a.last_sync_at)}
                                  </div>
                                ) : null}
                              </div>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                );
              })}
            </div>
          );
        })()}
      </details>
    </div>
  );
}
