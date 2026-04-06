/**
 * Извлечение полей для Meta из Paddle (checkout.completed в браузере или webhook transaction.*).
 */

export function extractCheckoutAttemptIdFromCustomData(customData: unknown): string | null {
  if (!customData || typeof customData !== "object") return null;
  const v = (customData as Record<string, unknown>).checkout_attempt_id;
  return typeof v === "string" && v.trim() ? v.trim() : null;
}

function numishToAmount(n: unknown): number | null {
  if (typeof n === "number" && Number.isFinite(n)) return n;
  if (typeof n === "string" && n.trim()) {
    const x = Number.parseFloat(n.replace(/,/g, "."));
    return Number.isFinite(x) ? x : null;
  }
  return null;
}

/** Paddle checkout.completed: CheckoutEventsData */
export function extractPurchaseFromPaddleCheckoutCompletedData(data: unknown): {
  transactionId: string;
  checkoutAttemptId: string | null;
  value: number | null;
  currency: string | null;
  country: string | null;
  plan: string | null;
  billingPeriod: string | null;
} | null {
  if (!data || typeof data !== "object") return null;
  const d = data as Record<string, unknown>;
  const transactionId = typeof d.transaction_id === "string" && d.transaction_id.trim() ? d.transaction_id.trim() : null;
  if (!transactionId) return null;

  const currency = typeof d.currency_code === "string" && d.currency_code.trim() ? d.currency_code.trim().toUpperCase() : null;
  const totals = d.totals as Record<string, unknown> | undefined;
  const value = totals && typeof totals === "object" ? numishToAmount(totals.total) : null;

  const custom = d.custom_data as Record<string, unknown> | null | undefined;
  const checkoutAttemptId = extractCheckoutAttemptIdFromCustomData(custom ?? null);
  const plan = custom && typeof custom.plan === "string" ? custom.plan : null;
  const billingPeriod = custom && typeof custom.billing_period === "string" ? custom.billing_period : null;

  const customer = d.customer as Record<string, unknown> | undefined;
  const address = customer?.address as Record<string, unknown> | undefined;
  const country =
    address && typeof address.country_code === "string" && address.country_code.trim()
      ? address.country_code.trim().toUpperCase()
      : null;

  return {
    transactionId,
    checkoutAttemptId,
    value,
    currency,
    country,
    plan,
    billingPeriod,
  };
}

/** Webhook transaction.* data object (Paddle Billing). */
export function extractPurchaseFromPaddleTransactionWebhookData(
  data: unknown,
  customData: Record<string, unknown>
): {
  transactionId: string;
  checkoutAttemptId: string | null;
  value: number | null;
  currency: string | null;
  country: string | null;
  plan: string | null;
  billingPeriod: string | null;
  subscriptionId: string | null;
} | null {
  if (!data || typeof data !== "object") return null;
  const d = data as Record<string, unknown>;
  const transactionId =
    (typeof d.id === "string" && d.id.trim() ? d.id.trim() : null) ??
    (typeof d.transaction_id === "string" && d.transaction_id.trim() ? d.transaction_id.trim() : null);
  if (!transactionId) return null;

  const details = d.details as Record<string, unknown> | undefined;
  const totals = details?.totals as Record<string, unknown> | undefined;
  const grand = totals?.grand_total as Record<string, unknown> | string | undefined;
  let value: number | null = null;
  let currency: string | null =
    (typeof d.currency_code === "string" && d.currency_code.trim() ? d.currency_code.trim().toUpperCase() : null) ?? null;
  if (grand && typeof grand === "object" && grand !== null) {
    value = numishToAmount((grand as { amount?: unknown }).amount);
    const cc = (grand as { currency_code?: unknown }).currency_code;
    if (typeof cc === "string" && cc.trim()) currency = cc.trim().toUpperCase();
  } else if (typeof grand === "string") {
    value = numishToAmount(grand);
  }
  if (value == null && totals && typeof totals === "object") {
    value = numishToAmount((totals as { total?: unknown }).total);
  }

  const checkoutAttemptId = extractCheckoutAttemptIdFromCustomData(customData);
  const plan = typeof customData.plan === "string" ? customData.plan : null;
  const billingPeriod = typeof customData.billing_period === "string" ? customData.billing_period : null;

  const customer = d.customer as Record<string, unknown> | undefined;
  const address = customer?.address as Record<string, unknown> | undefined;
  const country =
    address && typeof address.country_code === "string" && address.country_code.trim()
      ? address.country_code.trim().toUpperCase()
      : null;

  const sub =
    (typeof d.subscription_id === "string" && d.subscription_id.trim() ? d.subscription_id.trim() : null) ??
    (d.subscription && typeof d.subscription === "object" && d.subscription !== null
      ? String((d.subscription as { id?: string }).id ?? "").trim() || null
      : null);

  return {
    transactionId,
    checkoutAttemptId,
    value,
    currency,
    country,
    plan,
    billingPeriod,
    subscriptionId: sub,
  };
}
