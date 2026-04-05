import type { PricingPlanId } from "@/app/lib/auth/loginPurchaseUrl";
import { getPaddlePriceId, type BillingPeriod } from "@/app/lib/paddlePriceMap";
import {
  paddleBillingRequest,
  PADDLE_UPGRADE_PRORATION_MODE,
  type PaddleApiErrorBody,
} from "@/app/lib/paddleBillingServer";
import {
  isSubscriptionUpgradeAllowed,
  type CurrentSubscriptionSlice,
} from "@/app/lib/subscriptionUpgradeEligibility";

type PaddleSubscriptionItem = { price_id?: string; quantity?: number };

type PaddleSubscriptionEntity = {
  id?: string;
  items?: Array<{ price_id?: string; quantity?: number; price?: { id?: string } }>;
};

function paddleErrorMessage(err: { text: string; json?: PaddleApiErrorBody }): string {
  const d = err.json?.error?.detail ?? err.json?.error?.code;
  if (d && typeof d === "string") return d;
  return err.text.slice(0, 400) || "Paddle request failed";
}

export async function fetchPaddleSubscriptionItems(
  subscriptionId: string
): Promise<{ ok: true; items: PaddleSubscriptionItem[] } | { ok: false; error: string }> {
  const r = await paddleBillingRequest<PaddleSubscriptionEntity>("GET", `/subscriptions/${subscriptionId}`);
  if (!r.ok) return { ok: false, error: paddleErrorMessage(r) };
  const items = (r.data.items ?? []).map((it) => ({
    price_id: it.price?.id ?? it.price_id,
    quantity: it.quantity ?? 1,
  }));
  const normalized = items.filter((x) => x.price_id);
  if (!normalized.length) return { ok: false, error: "Подписка без позиций в Paddle." };
  return { ok: true, items: normalized };
}

function buildUpgradeRequestBody(
  subscriptionId: string,
  targetPriceId: string,
  currentItems: PaddleSubscriptionItem[]
) {
  if (currentItems.length > 1) {
    const payload = { subscriptionId, itemCount: currentItems.length };
    console.error("[paddle_upgrade] multi-item subscription: upgrading first item only; audit recommended", payload);
  }
  const [first, ...rest] = currentItems;
  if (!first?.price_id) {
    throw new Error("Первая позиция подписки без price_id.");
  }
  const items = [
    { price_id: targetPriceId, quantity: first.quantity ?? 1 },
    ...rest.map((i) => ({
      price_id: i.price_id as string,
      quantity: i.quantity ?? 1,
    })),
  ];
  return {
    items,
    proration_billing_mode: PADDLE_UPGRADE_PRORATION_MODE,
    on_payment_failure: "prevent_change" as const,
  };
}

/** Если Paddle не применил смену price (например prevent_change при неуспешной оплате), первый item остаётся со старым pri_. */
export function verifySubscriptionUpdateAppliedPrice(
  paddleResponse: unknown,
  expectedPriceId: string
): { ok: true } | { ok: false; error: string } {
  const d = paddleResponse as { items?: Array<{ price?: { id?: string }; price_id?: string }> } | null;
  const got = d?.items?.[0]?.price?.id ?? d?.items?.[0]?.price_id;
  if (!got || !expectedPriceId) return { ok: true };
  if (String(got) !== String(expectedPriceId)) {
    return {
      ok: false,
      error:
        "Оплата не прошла или подписка не изменена. Проверьте способ оплаты в Paddle и попробуйте снова.",
    };
  }
  return { ok: true };
}

export function assertUpgradeAllowed(
  current: CurrentSubscriptionSlice,
  targetPlan: PricingPlanId,
  targetBilling: BillingPeriod
): void {
  const r = isSubscriptionUpgradeAllowed(current, { plan: targetPlan, billing: targetBilling });
  if (!r.ok) {
    throw new Error(r.reason);
  }
}

export async function previewSubscriptionUpgrade(
  subscriptionId: string,
  targetPlan: PricingPlanId,
  targetBilling: BillingPeriod
): Promise<
  | { ok: true; paddle: unknown; requestBody: ReturnType<typeof buildUpgradeRequestBody> }
  | { ok: false; error: string }
> {
  const targetPriceId = getPaddlePriceId(targetPlan, targetBilling);
  if (!targetPriceId) {
    return { ok: false, error: "Целевой price_id не настроен (NEXT_PUBLIC_PADDLE_PRICE_*)." };
  }
  const itemsR = await fetchPaddleSubscriptionItems(subscriptionId);
  if (!itemsR.ok) return itemsR;
  try {
    const body = buildUpgradeRequestBody(subscriptionId, targetPriceId, itemsR.items);
    const r = await paddleBillingRequest("PATCH", `/subscriptions/${subscriptionId}/preview`, body);
    if (!r.ok) return { ok: false, error: paddleErrorMessage(r) };
    return { ok: true, paddle: r.data, requestBody: body };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}

export async function applySubscriptionUpgrade(
  subscriptionId: string,
  targetPlan: PricingPlanId,
  targetBilling: BillingPeriod,
  options?: { paddleIdempotencyKey?: string }
): Promise<
  | { ok: true; paddle: unknown }
  /** По умолчанию ошибка считается связанной с оплатой; `nonPaymentFailure` — конфиг/чтение подписки, не платёж. */
  | { ok: false; error: string; nonPaymentFailure?: true }
> {
  const targetPriceId = getPaddlePriceId(targetPlan, targetBilling);
  if (!targetPriceId) {
    return { ok: false, error: "Целевой price_id не настроен.", nonPaymentFailure: true };
  }
  const itemsR = await fetchPaddleSubscriptionItems(subscriptionId);
  if (!itemsR.ok) return { ok: false, error: itemsR.error, nonPaymentFailure: true };
  try {
    const body = buildUpgradeRequestBody(subscriptionId, targetPriceId, itemsR.items);
    const r = await paddleBillingRequest("PATCH", `/subscriptions/${subscriptionId}`, body, {
      idempotencyKey: options?.paddleIdempotencyKey,
    });
    if (!r.ok) return { ok: false, error: paddleErrorMessage(r) };
    const verified = verifySubscriptionUpdateAppliedPrice(r.data, targetPriceId);
    if (!verified.ok) return { ok: false, error: verified.error };
    return { ok: true, paddle: r.data };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}

/** Упрощённое представление для UI из ответа preview (структура Paddle может меняться — читаем через optional chaining). */
function formatPaddleMoneyish(v: unknown): string | null {
  if (v == null) return null;
  if (typeof v === "string" && v.trim()) return v.trim();
  if (typeof v === "object" && v !== null && "amount" in v) {
    const o = v as { amount?: unknown; currency_code?: string };
    if (o.amount == null) return null;
    return `${o.amount} ${String(o.currency_code ?? "")}`.trim();
  }
  return null;
}

export function shapeUpgradePreviewForUi(
  current: { plan: string; billing: string },
  target: { plan: string; billing: string },
  paddlePreview: unknown
): {
  current_label: string;
  target_label: string;
  currency_code: string | null;
  due_now: string | null;
  /** Явная сумма кредита из preview Paddle (если есть в ответе). */
  credit_label: string | null;
  next_recurring_hint: string | null;
  update_summary: unknown;
} {
  const p = paddlePreview as Record<string, unknown> | null;
  const imm = p?.immediate_transaction as Record<string, unknown> | null | undefined;
  const details = imm?.details as Record<string, unknown> | null | undefined;
  const totals = details?.totals as Record<string, unknown> | null | undefined;
  const grand = totals?.grand_total as Record<string, unknown> | string | null | undefined;
  let due_now: string | null = null;
  if (typeof grand === "string") due_now = grand;
  else if (grand && typeof grand === "object" && grand.amount != null) {
    due_now = `${grand.amount} ${String((grand as { currency_code?: string }).currency_code ?? "")}`.trim();
  }
  let credit_label: string | null = formatPaddleMoneyish(totals?.credit);
  if (!credit_label && Array.isArray(details?.line_items)) {
    for (const raw of details.line_items as unknown[]) {
      const li = raw as Record<string, unknown>;
      const t = String(li?.type ?? li?.item_type ?? "").toLowerCase();
      if (t.includes("credit") || t.includes("proration") || t === "adjustment") {
        const unit = formatPaddleMoneyish(li?.totals) ?? formatPaddleMoneyish(li?.unit_totals);
        if (unit) {
          credit_label = unit;
          break;
        }
      }
    }
  }
  const recurring = p?.recurring_transaction_details as Record<string, unknown> | null | undefined;
  const nextRecurring =
    recurring && typeof recurring === "object"
      ? JSON.stringify(recurring).slice(0, 500)
      : null;
  const currency =
    (p?.currency_code as string | undefined) ??
    (typeof grand === "object" && grand && (grand as { currency_code?: string }).currency_code
      ? String((grand as { currency_code?: string }).currency_code)
      : null);

  return {
    current_label: `${current.plan} · ${current.billing === "monthly" ? "месяц" : "год"}`,
    target_label: `${target.plan} · ${target.billing === "monthly" ? "месяц" : "год"}`,
    currency_code: currency ?? null,
    due_now,
    credit_label,
    next_recurring_hint: nextRecurring,
    update_summary: p?.update_summary ?? null,
  };
}
