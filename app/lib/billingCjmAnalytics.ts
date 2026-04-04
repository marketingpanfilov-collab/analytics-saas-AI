/**
 * Thin billing CJM funnel events for GTM / dataLayer (string names only).
 */
import type { ResolvedUiStateV1 } from "@/app/lib/billingUiContract";

export type BillingCjmEventPayload = {
  plan: string;
  user_id?: string | null;
  app_user_id?: string | null;
  source_screen: string;
  source_reason: string;
  source_action: string;
  billing_period?: string;
  request_id?: string;
};

const dedupeKeys = new Set<string>();

function billingDebugEnabled(): boolean {
  if (typeof process !== "undefined" && process.env.NODE_ENV === "development") return true;
  if (typeof window !== "undefined" && (window as unknown as { __BILLING_DEBUG__?: boolean }).__BILLING_DEBUG__)
    return true;
  try {
    return process.env.NEXT_PUBLIC_BILLING_DEBUG === "1" || process.env.NEXT_PUBLIC_BILLING_DEBUG === "true";
  } catch {
    return false;
  }
}

function dedupeKey(name: string, requestId: string | undefined, screen: string): string {
  return `${name}|${requestId ?? ""}|${screen}`;
}

function shouldDedupe(name: string): boolean {
  return name === "paywall_shown" || name === "checkout_opened";
}

export function emitBillingCjmEvent(name: string, payload: BillingCjmEventPayload): void {
  if (shouldDedupe(name)) {
    const k = dedupeKey(name, payload.request_id, payload.source_screen);
    if (dedupeKeys.has(k)) return;
    dedupeKeys.add(k);
  }
  if (typeof window === "undefined") return;
  const w = window as unknown as {
    dataLayer?: unknown[];
    gtag?: (...args: unknown[]) => void;
  };
  const row = { event: name, ...payload };
  try {
    if (Array.isArray(w.dataLayer)) {
      w.dataLayer.push(row);
    } else if (typeof w.gtag === "function") {
      w.gtag("event", name, payload);
    } else if (billingDebugEnabled()) {
      console.debug("[billing_cjm]", name, payload);
    }
  } catch {
    /* ignore */
  }
}

export function billingPayloadFromResolved(
  resolved: ResolvedUiStateV1 | null,
  extras: { plan?: string; userId?: string | null; source_action: string }
): BillingCjmEventPayload {
  return {
    plan: extras.plan ?? "unknown",
    app_user_id: extras.userId ?? null,
    source_screen: resolved?.screen ?? "unknown",
    source_reason: resolved?.reason ?? "unknown",
    source_action: extras.source_action,
    request_id: resolved?.request_id,
  };
}
