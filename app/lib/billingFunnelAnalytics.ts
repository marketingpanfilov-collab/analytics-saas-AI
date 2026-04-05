/**
 * Minimal payment funnel events for GTM / dataLayer (product diagnostics).
 * Server paths log the same `funnel_event` string via billingLog where applicable.
 */
export type BillingPaymentSource = "login" | "in_app";

export type BillingFunnelPayload = Record<string, unknown> & {
  checkout_attempt_id?: string | null;
  organization_id?: string | null;
  user_id?: string | null;
  plan?: string | null;
  billing_period?: string | null;
  source?: BillingPaymentSource | null;
};

const funnelDedupe = new Set<string>();

function billingFunnelDebugEnabled(): boolean {
  if (typeof process !== "undefined" && process.env.NODE_ENV === "development") return true;
  try {
    return process.env.NEXT_PUBLIC_BILLING_DEBUG === "1" || process.env.NEXT_PUBLIC_BILLING_DEBUG === "true";
  } catch {
    return false;
  }
}

/**
 * Push a funnel-shaped row to dataLayer / gtag, or console in dev.
 * Event names are stable product contracts (e.g. billing_checkout_opened).
 */
export function emitBillingFunnelEvent(name: string, payload: BillingFunnelPayload): void {
  if (typeof window === "undefined") return;
  const row: Record<string, unknown> = {
    event: name,
    funnel_event: name,
    ...payload,
  };
  const w = window as unknown as {
    dataLayer?: unknown[];
    gtag?: (...args: unknown[]) => void;
  };
  try {
    if (Array.isArray(w.dataLayer)) {
      w.dataLayer.push(row);
    } else if (typeof w.gtag === "function") {
      w.gtag("event", name, payload);
    } else if (billingFunnelDebugEnabled()) {
      console.debug("[billing_funnel]", name, payload);
    }
  } catch {
    /* ignore */
  }
}

/** Fire at most once per tab session per key (e.g. onboarding started). */
export function emitBillingFunnelEventOnce(dedupeKey: string, name: string, payload: BillingFunnelPayload): void {
  if (funnelDedupe.has(dedupeKey)) return;
  funnelDedupe.add(dedupeKey);
  emitBillingFunnelEvent(name, payload);
}
