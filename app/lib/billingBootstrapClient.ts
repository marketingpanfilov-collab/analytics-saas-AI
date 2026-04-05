/**
 * Client helpers for billing bootstrap (UX Hardening §5, §13.2, §13.5, §14.4–§14.7).
 */
import {
  ActionId,
  CtaKey,
  ReasonCode,
  RESOLVED_UI_CONTRACT_VERSION,
  ScreenId,
  type BlockingLevel,
  type ResolvedUiStateV1,
} from "@/app/lib/billingUiContract";
import type { PlanFeatureMatrix } from "@/app/lib/planConfig";
import type { OnboardingProgress } from "@/app/lib/billingCurrentPlan";

export const BILLING_BOOTSTRAP_RETRY_DELAYS_MS = [1000, 3000, 5000] as const;
export const BILLING_LAST_KNOWN_TTL_MS = 5 * 60 * 1000;
/** P1-RUN-03: suppress rapid screen/reason flicker after webhook vs client races */
export const BILLING_STABILIZATION_WINDOW_MS = 450;
/** Временное снятие жёсткого OVER_LIMIT после успешного apply, пока webhook не обновил лимиты. */
export const BILLING_OVER_LIMIT_UPGRADE_GRACE_MS = 90_000;
export const MAX_SHELL_REDIRECT_DEPTH = 3;
export const BILLING_BC_NAME = "boardiq-billing-bootstrap";
export const STORAGE_LAST_BOOTSTRAP = "boardiq_billing_last_bootstrap_v1";
export const STORAGE_REDIRECT_DEPTH = "boardiq_shell_redirect_depth";
export const STORAGE_INTENDED_ROUTE = "boardiq_intended_route";
export const STORAGE_BILLING_ORIGIN_ROUTE = "boardiq_billing_origin_route";

/** READ_ONLY reasons that mean “still need payment / renewal” (single source for isBillingBlocking). */
const READ_ONLY_BILLING_PAYMENT_REASONS = new Set<string>([
  ReasonCode.BILLING_UNPAID,
  ReasonCode.BILLING_EXPIRED,
  ReasonCode.BILLING_PAST_DUE,
]);

/** Опции для `isBillingBlocking` / редиректов после оплаты. */
export type BillingBlockingOptions = {
  /**
   * После успешного apply апгрейда: временно не считать OVER_LIMIT жёсткой блокировкой,
   * пока webhook не обновил entitlements (см. BillingBootstrapProvider).
   */
  overLimitApplyGraceUntilMs?: number | null;
  /**
   * После истечения 90s grace: мягкий shell/banner, пока optimistic ждёт webhook.
   */
  relaxOverLimitForPendingWebhook?: boolean;
};

/**
 * Whether billing still blocks product access in the “need to pay” sense.
 * `null` / no data → conservative `true` (do not trust redirect targets until bootstrap is known).
 */
export function isBillingBlocking(resolvedUi: ResolvedUiStateV1 | null, opts?: BillingBlockingOptions): boolean {
  if (!resolvedUi) return true;
  if (resolvedUi.screen === ScreenId.PAYWALL) return true;
  if (resolvedUi.screen === ScreenId.OVER_LIMIT_FULLSCREEN) {
    const g = opts?.overLimitApplyGraceUntilMs;
    if (typeof g === "number" && g > Date.now()) return false;
    if (opts?.relaxOverLimitForPendingWebhook === true) return false;
    return true;
  }
  if (resolvedUi.screen === ScreenId.READ_ONLY_SHELL) {
    if (!READ_ONLY_BILLING_PAYMENT_REASONS.has(resolvedUi.reason)) return false;
    return resolvedUi.blocking_level !== "none";
  }
  return false;
}

/** User can open inline / manage checkout UX (not blocked by pending plan change). */
export function canOfferBillingInlinePricing(resolved: ResolvedUiStateV1 | null): boolean {
  if (!resolved || resolved.pending_plan_change) return false;
  return (
    billingActionAllowed(resolved, ActionId.billing_checkout) ||
    billingActionAllowed(resolved, ActionId.billing_manage)
  );
}

export function routePathnameOnly(path: string): string {
  const q = path.indexOf("?");
  return q >= 0 ? path.slice(0, q) : path;
}

export type BillingFeatureFlagsClient = {
  resolved_ui_shell: boolean;
  over_limit_ui: boolean;
  pending_plan_banner: boolean;
  client_gating: boolean;
};

export const DEFAULT_BILLING_FEATURE_FLAGS: BillingFeatureFlagsClient = {
  resolved_ui_shell: true,
  over_limit_ui: true,
  pending_plan_banner: true,
  client_gating: true,
};

export function normalizeBillingFeatureFlags(raw: unknown): BillingFeatureFlagsClient {
  if (!raw || typeof raw !== "object") return { ...DEFAULT_BILLING_FEATURE_FLAGS };
  const o = raw as Record<string, unknown>;
  return {
    resolved_ui_shell: o.resolved_ui_shell !== false,
    over_limit_ui: o.over_limit_ui !== false,
    pending_plan_banner: o.pending_plan_banner !== false,
    client_gating: o.client_gating !== false,
  };
}

export type BillingBootstrapApiOk = {
  success: true;
  request_id: string;
  client_safe_mode?: boolean;
  primary_org_id?: string | null;
  feature_flags?: BillingFeatureFlagsClient;
  subscription: {
    plan?: string;
    status?: string;
    billing_period?: string;
    current_period_end?: string | null;
    provider?: string;
    provider_subscription_id?: string | null;
  } | null;
  access_state?: string;
  effective_plan?: string | null;
  requires_post_checkout_onboarding?: boolean;
  post_checkout_onboarding_step?: number;
  company_profile_completed?: boolean;
  onboarding_state?: string;
  has_any_accessible_project?: boolean;
  has_org_membership?: boolean;
  onboarding_progress?: OnboardingProgress | null;
  plan_feature_matrix?: PlanFeatureMatrix;
  /** Включённые рекламные аккаунты в организации (см. bootstrap). */
  org_enabled_ad_accounts?: number | null;
  resolved_ui_state: ResolvedUiStateV1;
};

function isBrowser() {
  return typeof window !== "undefined";
}

export function fingerprintResolvedUi(r: ResolvedUiStateV1): string {
  return `${r.screen}|${r.reason}|${r.blocking_level}`;
}

export function blockingLevelRank(b: BlockingLevel): number {
  if (b === "hard") return 2;
  if (b === "soft") return 1;
  return 0;
}

export function shouldApplyResolvedImmediately(reason: ReasonCode): boolean {
  return reason === ReasonCode.BILLING_REFUNDED;
}

export function makeSafeFallbackResolvedUi(requestId: string): ResolvedUiStateV1 {
  return {
    version: RESOLVED_UI_CONTRACT_VERSION,
    request_id: requestId,
    screen: ScreenId.READ_ONLY_SHELL,
    reason: ReasonCode.BOOTSTRAP_UNAVAILABLE,
    cta: CtaKey.retry_bootstrap,
    allowed_actions: [ActionId.retry_bootstrap, ActionId.navigate_settings, ActionId.sign_out, ActionId.support],
    blocking_level: "hard",
    pending_plan_change: false,
    intended_route: null,
    data_state_default: "BLOCKED",
  };
}

/**
 * After bootstrap failure: never grant more than safe-default actions (P0-RUN-01).
 * Preserves stricter of blocking levels; strips wildcard; intersects allowed_actions with safe set.
 */
export function capResolvedUiNeverExpand(last: ResolvedUiStateV1, requestId: string): ResolvedUiStateV1 {
  const safe = makeSafeFallbackResolvedUi(requestId);
  const rLast = blockingLevelRank(last.blocking_level);
  const rSafe = blockingLevelRank(safe.blocking_level);
  const strictShell = rLast >= rSafe ? last : safe;
  const safeSet = new Set(safe.allowed_actions);
  let actions: string[];
  if (strictShell.allowed_actions.includes(ActionId.wildcard)) {
    actions = [...safe.allowed_actions];
  } else {
    actions = strictShell.allowed_actions.filter((a) => safeSet.has(a));
  }
  if (actions.length === 0) actions = [...safe.allowed_actions];
  return {
    ...strictShell,
    version: RESOLVED_UI_CONTRACT_VERSION,
    request_id: requestId,
    screen: rLast >= rSafe ? strictShell.screen : safe.screen,
    reason: rLast >= rSafe ? strictShell.reason : safe.reason,
    cta: rLast >= rSafe ? strictShell.cta : safe.cta,
    blocking_level: rLast >= rSafe ? strictShell.blocking_level : safe.blocking_level,
    pending_plan_change: rLast >= rSafe ? strictShell.pending_plan_change : false,
    intended_route: null,
    allowed_actions: actions,
    data_state_default: "BLOCKED",
  };
}

export function validateIntendedRoute(path: string | null | undefined): string | null {
  if (!path || typeof path !== "string") return null;
  const p = path.trim();
  if (!p.startsWith("/app")) return null;
  if (p.includes("..") || p.includes("//")) return null;
  if (p.length > 512) return null;
  const pathOnly = p.split("?")[0] ?? p;
  if (!/^\/app(\/[a-zA-Z0-9._-]+)*\/?$/.test(pathOnly)) return null;
  return pathOnly.endsWith("/") && pathOnly.length > 1 ? pathOnly.slice(0, -1) : pathOnly;
}

/**
 * Validates pathname + optional query for return/origin storage (must stay under `/app`).
 */
export function validateBillingReturnPath(raw: string | null | undefined): string | null {
  if (!raw || typeof raw !== "string") return null;
  const t = raw.trim();
  if (!t.startsWith("/app")) return null;
  if (t.includes("..")) return null;
  if (t.length > 512) return null;
  const qIndex = t.indexOf("?");
  const pathPart = (qIndex >= 0 ? t.slice(0, qIndex) : t).trim();
  const queryPart = qIndex >= 0 ? t.slice(qIndex + 1) : "";
  const basePath = validateIntendedRoute(pathPart);
  if (!basePath) return null;
  if (!queryPart) return basePath;
  if (!/^[a-zA-Z0-9._&=%-]{0,256}$/.test(queryPart)) return null;
  return `${basePath}?${queryPart}`;
}

export function isBootstrapResponseValid(json: unknown): json is BillingBootstrapApiOk {
  if (!json || typeof json !== "object") return false;
  const o = json as Record<string, unknown>;
  if (o.success !== true) return false;
  if (typeof o.request_id !== "string" || !o.request_id) return false;
  const ru = o.resolved_ui_state;
  if (!ru || typeof ru !== "object") return false;
  const r = ru as Record<string, unknown>;
  if (r.version !== RESOLVED_UI_CONTRACT_VERSION) return false;
  if (typeof r.screen !== "string" || typeof r.reason !== "string") return false;
  if (typeof r.blocking_level !== "string") return false;
  if (!Array.isArray(r.allowed_actions)) return false;
  if (typeof r.pending_plan_change !== "boolean") return false;
  if (r.intended_route != null && typeof r.intended_route !== "string") return false;
  if (o.feature_flags !== undefined && o.feature_flags !== null) {
    const f = o.feature_flags;
    if (typeof f !== "object") return false;
    const fr = f as Record<string, unknown>;
    if (typeof fr.resolved_ui_shell !== "boolean") return false;
    if (typeof fr.over_limit_ui !== "boolean") return false;
    if (typeof fr.pending_plan_banner !== "boolean") return false;
    if (typeof fr.client_gating !== "boolean") return false;
  }
  return true;
}

export function billingActionAllowed(resolved: ResolvedUiStateV1 | null, action: string): boolean {
  if (!resolved) return false;
  if (resolved.allowed_actions.includes(ActionId.wildcard)) return true;
  return resolved.allowed_actions.includes(action);
}

export function readLastKnownBootstrap(): BillingBootstrapApiOk | null {
  if (!isBrowser()) return null;
  try {
    const raw = sessionStorage.getItem(STORAGE_LAST_BOOTSTRAP);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as { savedAt?: number; payload?: unknown };
    if (!parsed.savedAt || !parsed.payload) return null;
    if (Date.now() - parsed.savedAt > BILLING_LAST_KNOWN_TTL_MS) return null;
    if (!isBootstrapResponseValid(parsed.payload)) return null;
    return parsed.payload;
  } catch {
    return null;
  }
}

export function writeLastKnownBootstrap(payload: BillingBootstrapApiOk): void {
  if (!isBrowser()) return;
  try {
    sessionStorage.setItem(
      STORAGE_LAST_BOOTSTRAP,
      JSON.stringify({ savedAt: Date.now(), payload })
    );
  } catch {
    /* ignore quota */
  }
}

export function newBootstrapRequestId(): string {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }
  return `bb-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

export function getShellRedirectDepth(): number {
  if (!isBrowser()) return 0;
  try {
    const v = sessionStorage.getItem(STORAGE_REDIRECT_DEPTH);
    const n = v ? parseInt(v, 10) : 0;
    return Number.isFinite(n) ? Math.max(0, n) : 0;
  } catch {
    return 0;
  }
}

export function setShellRedirectDepth(n: number): void {
  if (!isBrowser()) return;
  try {
    if (n <= 0) sessionStorage.removeItem(STORAGE_REDIRECT_DEPTH);
    else sessionStorage.setItem(STORAGE_REDIRECT_DEPTH, String(n));
  } catch {
    /* ignore */
  }
}

export function bumpShellRedirectDepth(): number {
  const next = getShellRedirectDepth() + 1;
  setShellRedirectDepth(next);
  return next;
}

export function readStoredIntendedRoute(): string | null {
  if (!isBrowser()) return null;
  try {
    return validateIntendedRoute(sessionStorage.getItem(STORAGE_INTENDED_ROUTE));
  } catch {
    return null;
  }
}

export function storeIntendedRoute(path: string | null): void {
  if (!isBrowser()) return;
  try {
    const v = validateIntendedRoute(path);
    if (!v) sessionStorage.removeItem(STORAGE_INTENDED_ROUTE);
    else sessionStorage.setItem(STORAGE_INTENDED_ROUTE, v);
  } catch {
    /* ignore */
  }
}

export function storeOriginRoute(path: string | null): void {
  if (!isBrowser()) return;
  try {
    const v = validateBillingReturnPath(path);
    if (!v) sessionStorage.removeItem(STORAGE_BILLING_ORIGIN_ROUTE);
    else sessionStorage.setItem(STORAGE_BILLING_ORIGIN_ROUTE, v);
  } catch {
    /* ignore */
  }
}

export function readOriginRoute(): string | null {
  if (!isBrowser()) return null;
  try {
    return validateBillingReturnPath(sessionStorage.getItem(STORAGE_BILLING_ORIGIN_ROUTE));
  } catch {
    return null;
  }
}

export function clearOriginRoute(): void {
  if (!isBrowser()) return;
  try {
    sessionStorage.removeItem(STORAGE_BILLING_ORIGIN_ROUTE);
  } catch {
    /* ignore */
  }
}

/** Clears client billing navigation context (logout / user switch). */
export function clearBillingRouteStorage(): void {
  storeIntendedRoute(null);
  clearOriginRoute();
}

export function broadcastBillingBootstrapInvalidate(): void {
  if (typeof BroadcastChannel === "undefined") return;
  try {
    const ch = new BroadcastChannel(BILLING_BC_NAME);
    ch.postMessage({ type: "invalidate", ts: Date.now() });
    ch.close();
  } catch {
    /* ignore */
  }
}

export function routeAllowedByResolved(path: string, resolved: ResolvedUiStateV1): boolean {
  if (resolved.allowed_actions.includes(ActionId.wildcard)) return true;
  if (path === "/app/onboarding" || path.startsWith("/app/onboarding/")) {
    if (resolved.screen === ScreenId.POST_CHECKOUT_MODAL) return true;
  }
  if (path.startsWith("/app/settings")) {
    return resolved.allowed_actions.includes(ActionId.navigate_settings);
  }
  if (path === "/app" || path.match(/^\/app\/projects(\/|$)/)) {
    return (
      resolved.allowed_actions.includes(ActionId.navigate_app) ||
      resolved.allowed_actions.includes(ActionId.navigate_projects)
    );
  }
  if (resolved.screen === ScreenId.OVER_LIMIT_FULLSCREEN) {
    const remedial =
      path.startsWith("/app/org-members") ||
      path.startsWith("/app/accounts") ||
      path.startsWith("/app/support");
    if (remedial) {
      return (
        resolved.allowed_actions.includes(ActionId.billing_manage) ||
        resolved.allowed_actions.includes(ActionId.navigate_settings) ||
        resolved.allowed_actions.includes(ActionId.support) ||
        resolved.allowed_actions.includes(ActionId.navigate_projects)
      );
    }
  }
  return resolved.allowed_actions.includes(ActionId.navigate_app);
}

function pickSafeAppFallback(resolvedUi: ResolvedUiStateV1): string {
  if (resolvedUi.screen === ScreenId.POST_CHECKOUT_MODAL) return "/app/onboarding";
  const projectsPath = "/app/projects";
  if (routeAllowedByResolved(projectsPath, resolvedUi)) return projectsPath;
  if (routeAllowedByResolved("/app", resolvedUi)) return "/app";
  return "/app";
}

export type ResolvePostPaymentRedirectOptions = {
  currentPath?: string;
  billingBlockingOptions?: BillingBlockingOptions;
};

/**
 * After unlock (`!isBillingBlocking(resolvedUi)`). Picks intended → origin → /app/onboarding (post-checkout) или /app/projects → /app.
 */
export function resolvePostPaymentRedirect(
  resolvedUi: ResolvedUiStateV1,
  options?: ResolvePostPaymentRedirectOptions
): string {
  if (isBillingBlocking(resolvedUi, options?.billingBlockingOptions)) {
    return pickSafeAppFallback(resolvedUi);
  }
  const current = options?.currentPath ? routePathnameOnly(options.currentPath) : null;

  const tryCandidate = (raw: string | null): string | null => {
    if (!raw) return null;
    const v = validateBillingReturnPath(raw);
    if (!v || !v.startsWith("/app")) return null;
    const pathOnly = routePathnameOnly(v);
    if (current && pathOnly === current) return null;
    if (!routeAllowedByResolved(pathOnly, resolvedUi)) return null;
    if (isBillingBlocking(resolvedUi, options?.billingBlockingOptions)) return null;
    return v;
  };

  const fromIntended = tryCandidate(readStoredIntendedRoute());
  if (fromIntended) return fromIntended;

  const fromOrigin = tryCandidate(readOriginRoute());
  if (fromOrigin) return fromOrigin;

  return pickSafeAppFallback(resolvedUi);
}
