/**
 * Выбор «канонической» строки billing_subscriptions для плана и доступа.
 * В одной org/customer_id webhook может писать sub_*, txn_*, add_* — add_/txn_ без price не должны
 * перебивать реальную подписку sub_* с price/product (см. pickTopSubscription ранее).
 */

const ACTIVE_STATUSES = new Set(["active", "trialing", "past_due"]);

export type PaddleSubscriptionPickRow = {
  provider_subscription_id: string;
  provider_price_id?: string | null;
  provider_product_id?: string | null;
  status?: string | null;
  current_period_end?: string | null;
  updated_at?: string | null;
};

function isPaddleSubscriptionId(id: string): boolean {
  return String(id).trim().startsWith("sub_");
}

function hasPlanPricing(row: PaddleSubscriptionPickRow): boolean {
  return (
    Boolean(String(row.provider_price_id ?? "").trim()) ||
    Boolean(String(row.provider_product_id ?? "").trim())
  );
}

/**
 * Сортировка: лучшая строка первая (как раньше — сравнение для `.sort` с `bTs - aTs`).
 */
export function comparePaddleSubscriptionRowsForCanonicalPick(
  a: PaddleSubscriptionPickRow,
  b: PaddleSubscriptionPickRow
): number {
  const aSub = isPaddleSubscriptionId(a.provider_subscription_id) ? 1 : 0;
  const bSub = isPaddleSubscriptionId(b.provider_subscription_id) ? 1 : 0;
  if (aSub !== bSub) return bSub - aSub;

  const aPrice = hasPlanPricing(a) ? 1 : 0;
  const bPrice = hasPlanPricing(b) ? 1 : 0;
  if (aPrice !== bPrice) return bPrice - aPrice;

  const aActive = ACTIVE_STATUSES.has(String(a.status ?? "").toLowerCase()) ? 1 : 0;
  const bActive = ACTIVE_STATUSES.has(String(b.status ?? "").toLowerCase()) ? 1 : 0;
  if (aActive !== bActive) return bActive - aActive;

  const aTs = Date.parse(String(a.current_period_end ?? a.updated_at ?? "")) || 0;
  const bTs = Date.parse(String(b.current_period_end ?? b.updated_at ?? "")) || 0;
  return bTs - aTs;
}

export function pickTopPaddleSubscriptionRow<T extends PaddleSubscriptionPickRow>(list: T[]): T | null {
  if (!list.length) return null;
  return [...list].sort(comparePaddleSubscriptionRowsForCanonicalPick)[0] ?? null;
}
