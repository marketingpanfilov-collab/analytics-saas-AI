/** Meta event_id: max 64 (Graph API). Без случайных суффиксов — связка IC ↔ Purchase по checkout_attempt_id. */

const MAX_LEN = 64;
const PURCHASE_SUFFIX = "_purchase";

/** InitiateCheckout: event_id = checkout_attempt_id (обрезка только если > 64). */
export function metaInitiateCheckoutEventId(checkoutAttemptId: string): string {
  const t = String(checkoutAttemptId).trim();
  return t.length > MAX_LEN ? t.slice(0, MAX_LEN) : t;
}

/** Purchase: event_id = checkout_attempt_id + "_purchase" (в пределах 64 символов). */
export function metaPurchaseEventId(checkoutAttemptId: string): string {
  const base = String(checkoutAttemptId).trim();
  const maxBase = MAX_LEN - PURCHASE_SUFFIX.length;
  const b = base.length <= maxBase ? base : base.slice(0, Math.max(1, maxBase));
  return `${b}${PURCHASE_SUFFIX}`;
}
