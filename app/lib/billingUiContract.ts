/**
 * Master UI contract enums (BoardIQ Billing UX Hardening §3, §14).
 * Backend is source of truth; clients must not infer shell from raw access_state alone.
 */

export const RESOLVED_UI_CONTRACT_VERSION = "v1" as const;

export type ResolvedUiContractVersion = typeof RESOLVED_UI_CONTRACT_VERSION;

/** Shell screens — uppercase ids for analytics / i18n keys */
export const ScreenId = {
  POST_CHECKOUT_MODAL: "POST_CHECKOUT_MODAL",
  INVITE_LOADING: "INVITE_LOADING",
  INVITE_FALLBACK: "INVITE_FALLBACK",
  NO_PROJECT: "NO_PROJECT",
  NO_ACCESS: "NO_ACCESS",
  NO_ORG_ACCESS: "NO_ORG_ACCESS",
  DASHBOARD: "DASHBOARD",
  OVER_LIMIT_FULLSCREEN: "OVER_LIMIT_FULLSCREEN",
  PAYWALL: "PAYWALL",
  DEMO_SHELL: "DEMO_SHELL",
  READ_ONLY_SHELL: "READ_ONLY_SHELL",
  SETTINGS: "SETTINGS",
  PRICING: "PRICING",
  LTV: "LTV",
  REPORTS: "REPORTS",
  BILLING_REFUNDED: "BILLING_REFUNDED",
} as const;
export type ScreenId = (typeof ScreenId)[keyof typeof ScreenId];

export const ReasonCode = {
  POST_CHECKOUT_REQUIRED: "POST_CHECKOUT_REQUIRED",
  INVITE_PENDING: "INVITE_PENDING",
  INVITE_TIMEOUT: "INVITE_TIMEOUT",
  NO_ACTIVE_PROJECT: "NO_ACTIVE_PROJECT",
  NO_ACCESS_TO_ORG: "NO_ACCESS_TO_ORG",
  PAID_NO_PROJECT: "PAID_NO_PROJECT",
  PLAN_CHANGE_PENDING: "PLAN_CHANGE_PENDING",
  BILLING_NO_SUBSCRIPTION: "BILLING_NO_SUBSCRIPTION",
  BILLING_DEMO_MODE: "BILLING_DEMO_MODE",
  BILLING_UNPAID: "BILLING_UNPAID",
  BILLING_PAST_DUE: "BILLING_PAST_DUE",
  BILLING_GRACE: "BILLING_GRACE",
  BILLING_EXPIRED: "BILLING_EXPIRED",
  BILLING_REFUNDED: "BILLING_REFUNDED",
  /** Client-only fallback when bootstrap failed (§13.2); not emitted by shell resolver */
  BOOTSTRAP_UNAVAILABLE: "BOOTSTRAP_UNAVAILABLE",
  OVER_LIMIT_PROJECTS: "OVER_LIMIT_PROJECTS",
  OVER_LIMIT_SEATS: "OVER_LIMIT_SEATS",
  OVER_LIMIT_AD_ACCOUNTS: "OVER_LIMIT_AD_ACCOUNTS",
  OK: "OK",
} as const;
export type ReasonCode = (typeof ReasonCode)[keyof typeof ReasonCode];

export const ActionId = {
  create_project: "create_project",
  sync_refresh: "sync_refresh",
  export: "export",
  billing_manage: "billing_manage",
  navigate_app: "navigate_app",
  navigate_settings: "navigate_settings",
  navigate_projects: "navigate_projects",
  billing_checkout: "billing_checkout",
  sign_out: "sign_out",
  support: "support",
  retry_bootstrap: "retry_bootstrap",
  wildcard: "*",
} as const;
export type ActionId = (typeof ActionId)[keyof typeof ActionId];

export const CtaKey = {
  subscribe: "subscribe",
  create_project: "create_project",
  support: "support",
  retry_bootstrap: "retry_bootstrap",
  contact_owner: "contact_owner",
  upgrade: "upgrade",
} as const;
export type CtaKey = (typeof CtaKey)[keyof typeof CtaKey];

export type BlockingLevel = "hard" | "soft" | "none";

export type DataStateDefault = "EMPTY" | "LIMITED" | "BLOCKED";

export type ResolvedUiStateV1 = {
  screen: ScreenId;
  reason: ReasonCode;
  cta: CtaKey | null;
  allowed_actions: string[];
  blocking_level: BlockingLevel;
  version: ResolvedUiContractVersion;
  request_id: string;
  pending_plan_change: boolean;
  intended_route: string | null;
  data_state_default?: DataStateDefault;
  /** When multiple over-limit types apply, first drives reason; full list for UI copy */
  over_limit_details?: { type: "projects" | "seats" | "ad_accounts"; current: number; limit: number }[];
};

const ALL_SCREENS = new Set<string>(Object.values(ScreenId));
const ALL_REASONS = new Set<string>(Object.values(ReasonCode));

export function isValidScreenId(v: string): v is ScreenId {
  return ALL_SCREENS.has(v);
}

export function isValidReasonCode(v: string): v is ReasonCode {
  return ALL_REASONS.has(v);
}

export function parseResolvedUiStateLoose(raw: unknown): ResolvedUiStateV1 | null {
  if (!raw || typeof raw !== "object") return null;
  const o = raw as Record<string, unknown>;
  const screen = o.screen;
  const reason = o.reason;
  const version = o.version;
  if (typeof screen !== "string" || typeof reason !== "string") return null;
  if (version !== RESOLVED_UI_CONTRACT_VERSION) return null;
  return raw as ResolvedUiStateV1;
}

const BLOCKING_LEVELS = new Set<BlockingLevel>(["hard", "soft", "none"]);

/** Server-side guard: success responses must include a full v1 contract (P0-CON-01). */
export function isCompleteResolvedUiStateV1(raw: unknown): raw is ResolvedUiStateV1 {
  if (!raw || typeof raw !== "object") return false;
  const o = raw as Record<string, unknown>;
  if (o.version !== RESOLVED_UI_CONTRACT_VERSION) return false;
  if (typeof o.screen !== "string" || !isValidScreenId(o.screen)) return false;
  if (typeof o.reason !== "string" || !isValidReasonCode(o.reason)) return false;
  if (!BLOCKING_LEVELS.has(o.blocking_level as BlockingLevel)) return false;
  if (typeof o.request_id !== "string" || o.request_id.length === 0) return false;
  if (!Array.isArray(o.allowed_actions)) return false;
  if (typeof o.pending_plan_change !== "boolean") return false;
  if (o.intended_route != null && typeof o.intended_route !== "string") return false;
  if (o.cta != null && typeof o.cta !== "string") return false;
  return true;
}
