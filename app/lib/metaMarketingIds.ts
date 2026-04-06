/** Meta event_id: alphanumeric, underscore, hyphen; max 64 (Graph API). */

const MAX_LEN = 64;

export function sanitizeMetaEventIdSegment(raw: string): string {
  return String(raw).replace(/[^a-zA-Z0-9_-]/g, "_");
}

export function buildMetaEventId(parts: string[]): string {
  const joined = parts.map(sanitizeMetaEventIdSegment).join("_");
  return joined.length <= MAX_LEN ? joined : joined.slice(0, MAX_LEN);
}

/** Дедуп Pixel + CAPI для InitiateCheckout; основа — checkout_attempt_id. */
export function metaInitiateCheckoutEventId(checkoutAttemptId: string): string {
  return buildMetaEventId(["ic", checkoutAttemptId]);
}

/**
 * Дедуп Pixel + CAPI для Purchase; стабильно для одной пары (ca, tx).
 * Укладываемся в 64 символа без обрезки UUID attempt (36) + хвост transaction_id.
 */
export function metaPurchaseEventId(checkoutAttemptId: string, transactionId: string): string {
  const caC = sanitizeMetaEventIdSegment(checkoutAttemptId);
  const txC = sanitizeMetaEventIdSegment(transactionId);
  const prefix = `p_${caC}_`;
  const budget = MAX_LEN - prefix.length;
  if (budget < 6) return buildMetaEventId(["p", caC, txC]);
  const txPart = txC.length <= budget ? txC : txC.slice(-budget);
  return `${prefix}${txPart}`;
}
