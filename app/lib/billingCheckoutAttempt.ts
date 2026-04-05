/**
 * Correlate Paddle checkout → webhook → bootstrap (support / debug).
 * Stored in sessionStorage for the current tab; grace record may also hold attempt id (localStorage).
 */
import { peekPaymentWebhookGrace } from "@/app/lib/billingPaymentWebhookGrace";

const SESSION_KEY = "boardiq_checkout_attempt_v1";

export type CheckoutAttemptRecord = { checkout_attempt_id: string; stored_at: number };

export function newCheckoutAttemptId(): string {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }
  return `ca-${Date.now()}-${Math.random().toString(16).slice(2, 10)}`;
}

export function persistCheckoutAttemptForSession(checkoutAttemptId: string): void {
  if (typeof sessionStorage === "undefined") return;
  try {
    sessionStorage.setItem(
      SESSION_KEY,
      JSON.stringify({ checkout_attempt_id: checkoutAttemptId, stored_at: Date.now() } satisfies CheckoutAttemptRecord)
    );
  } catch {
    /* quota / private mode */
  }
}

export function readCheckoutAttemptForSession(): CheckoutAttemptRecord | null {
  if (typeof sessionStorage === "undefined") return null;
  try {
    const raw = sessionStorage.getItem(SESSION_KEY);
    if (!raw) return null;
    const o = JSON.parse(raw) as Partial<CheckoutAttemptRecord>;
    const id = typeof o.checkout_attempt_id === "string" ? o.checkout_attempt_id.trim() : "";
    if (!id) return null;
    return {
      checkout_attempt_id: id,
      stored_at: typeof o.stored_at === "number" ? o.stored_at : Date.now(),
    };
  } catch {
    return null;
  }
}

export function clearCheckoutAttemptSession(): void {
  if (typeof sessionStorage === "undefined") return;
  try {
    sessionStorage.removeItem(SESSION_KEY);
  } catch {
    /* ignore */
  }
}

/** For logging during post-payment polling (tab session or cross-tab grace). */
export function readCheckoutAttemptIdForTracing(): string | null {
  const s = readCheckoutAttemptForSession();
  if (s?.checkout_attempt_id) return s.checkout_attempt_id;
  return peekPaymentWebhookGrace().checkoutAttemptId;
}
