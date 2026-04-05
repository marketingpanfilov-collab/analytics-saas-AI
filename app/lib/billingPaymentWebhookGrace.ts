/**
 * After checkout.completed, webhook may lag — grace window for soft "processing payment" UX.
 * Persisted in localStorage so refresh / new tab still sees grace until expiry.
 */
import type { BillingPaymentSource } from "@/app/lib/billingFunnelAnalytics";

export const PAYMENT_WEBHOOK_GRACE_MS = 3 * 60 * 1000;

const GRACE_LS_KEY = "boardiq_payment_webhook_grace_v2";
/** Legacy sessionStorage key (migrated once into localStorage). */
const GRACE_SS_LEGACY = "boardiq_payment_webhook_grace_v1";

export type PaymentWebhookGraceRecordV2 = {
  v: 2;
  started_at: number;
  expires_at: number;
  checkout_attempt_id: string | null;
  source: BillingPaymentSource;
};

function isBrowser() {
  return typeof window !== "undefined";
}

function migrateLegacySessionToLocal(): void {
  if (!isBrowser() || typeof sessionStorage === "undefined") return;
  try {
    const raw = sessionStorage.getItem(GRACE_SS_LEGACY);
    if (!raw) return;
    const o = JSON.parse(raw) as { marked_at?: number; checkout_attempt_id?: string | null };
    const started = typeof o.marked_at === "number" ? o.marked_at : Date.now();
    const elapsed = Date.now() - started;
    if (!Number.isFinite(elapsed) || elapsed < 0 || elapsed >= PAYMENT_WEBHOOK_GRACE_MS) {
      sessionStorage.removeItem(GRACE_SS_LEGACY);
      return;
    }
    const payload: PaymentWebhookGraceRecordV2 = {
      v: 2,
      started_at: started,
      expires_at: started + PAYMENT_WEBHOOK_GRACE_MS,
      checkout_attempt_id:
        typeof o.checkout_attempt_id === "string" && o.checkout_attempt_id.trim()
          ? o.checkout_attempt_id.trim()
          : null,
      source: "login",
    };
    localStorage.setItem(GRACE_LS_KEY, JSON.stringify(payload));
    sessionStorage.removeItem(GRACE_SS_LEGACY);
  } catch {
    /* ignore */
  }
}

function readRecord(): PaymentWebhookGraceRecordV2 | null {
  if (!isBrowser()) return null;
  migrateLegacySessionToLocal();
  try {
    const raw = localStorage.getItem(GRACE_LS_KEY);
    if (!raw) return null;
    const o = JSON.parse(raw) as Partial<PaymentWebhookGraceRecordV2>;
    if (o.v !== 2) return null;
    const started = typeof o.started_at === "number" ? o.started_at : 0;
    const expires = typeof o.expires_at === "number" ? o.expires_at : started + PAYMENT_WEBHOOK_GRACE_MS;
    const src = o.source === "in_app" ? "in_app" : "login";
    const ca =
      typeof o.checkout_attempt_id === "string" && o.checkout_attempt_id.trim()
        ? o.checkout_attempt_id.trim()
        : null;
    if (!started || !expires) return null;
    return {
      v: 2,
      started_at: started,
      expires_at: expires,
      checkout_attempt_id: ca,
      source: src,
    };
  } catch {
    return null;
  }
}

export type MarkPaymentWebhookGraceOpts = {
  checkoutAttemptId?: string | null;
  source: BillingPaymentSource;
};

export function markPaymentWebhookGrace(opts: MarkPaymentWebhookGraceOpts): void {
  if (!isBrowser()) return;
  const started = Date.now();
  const payload: PaymentWebhookGraceRecordV2 = {
    v: 2,
    started_at: started,
    expires_at: started + PAYMENT_WEBHOOK_GRACE_MS,
    checkout_attempt_id:
      typeof opts.checkoutAttemptId === "string" && opts.checkoutAttemptId.trim()
        ? opts.checkoutAttemptId.trim()
        : null,
    source: opts.source,
  };
  try {
    localStorage.setItem(GRACE_LS_KEY, JSON.stringify(payload));
    if (typeof sessionStorage !== "undefined") {
      try {
        sessionStorage.removeItem(GRACE_SS_LEGACY);
      } catch {
        /* ignore */
      }
    }
  } catch {
    /* quota */
  }
}

export function peekPaymentWebhookGrace(): {
  active: boolean;
  remainingMs: number;
  checkoutAttemptId: string | null;
  source: BillingPaymentSource | null;
  record: PaymentWebhookGraceRecordV2 | null;
} {
  if (!isBrowser()) {
    return { active: false, remainingMs: 0, checkoutAttemptId: null, source: null, record: null };
  }
  const rec = readRecord();
  if (!rec) {
    return { active: false, remainingMs: 0, checkoutAttemptId: null, source: null, record: null };
  }
  const now = Date.now();
  if (now >= rec.expires_at) {
    clearPaymentWebhookGrace();
    return { active: false, remainingMs: 0, checkoutAttemptId: null, source: null, record: null };
  }
  return {
    active: true,
    remainingMs: Math.max(0, rec.expires_at - now),
    checkoutAttemptId: rec.checkout_attempt_id,
    source: rec.source,
    record: rec,
  };
}

/**
 * Снять grace, если bootstrap уже показывает оплаченный тариф / живую подписку,
 * даже при временном рассинхроне access_state (например до фикса статусов Paddle).
 */
export function bootstrapPayloadIndicatesPaidForGraceClear(payload: {
  access_state?: string;
  effective_plan?: string | null;
  subscription?: { plan?: string; status?: string } | null;
} | null | undefined): boolean {
  if (!payload) return false;
  if (payload.access_state && payload.access_state !== "no_subscription") return true;
  const ep = String(payload.effective_plan ?? "").toLowerCase();
  if (ep === "starter" || ep === "growth" || ep === "scale") return true;
  const sp = String(payload.subscription?.plan ?? "").toLowerCase();
  if (sp === "starter" || sp === "growth" || sp === "scale" || sp === "agency") return true;
  const st = String(payload.subscription?.status ?? "").toLowerCase();
  if (st === "active" || st === "trialing" || st === "past_due" || st === "completed") return true;
  return false;
}

export function clearPaymentWebhookGrace(): void {
  if (!isBrowser()) return;
  try {
    localStorage.removeItem(GRACE_LS_KEY);
  } catch {
    /* ignore */
  }
  if (typeof sessionStorage !== "undefined") {
    try {
      sessionStorage.removeItem(GRACE_SS_LEGACY);
    } catch {
      /* ignore */
    }
  }
}

/** Short copy for grace banner / stuck states (login, in-app, shell). */
export const BILLING_SOFT_PAYMENT_HEADLINE = "Мы обрабатываем вашу оплату";
export const BILLING_SOFT_PAYMENT_DETAIL =
  "Обычно это занимает до 1 минуты. Нажмите «Проверить оплату» или «Обновить статус», если доступ не появился. При необходимости — поддержка.";
