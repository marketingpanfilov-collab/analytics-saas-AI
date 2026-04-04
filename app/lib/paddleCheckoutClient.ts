/**
 * In-app Paddle subscription checkout (logged-in users).
 * Login/signup uses LoginPageClient + addPaddleEventListener (stacks with this module).
 */
import type { PaddleEventData } from "@paddle/paddle-js";
import type { PricingPlanId } from "@/app/lib/auth/loginPurchaseUrl";
import { addPaddleEventListener, getPaddle } from "@/app/lib/paddle";
import { getPaddlePriceId, getPaddleProductId, type BillingPeriod } from "@/app/lib/paddlePriceMap";

export type OpenPaddleSubscriptionCheckoutArgs = {
  plan: PricingPlanId;
  billing: BillingPeriod;
  email: string;
  userId: string | null;
  /** Paddle Retain customer id when known */
  pwCustomerId?: string | null;
  primaryOrgId?: string | null;
  projectId?: string | null;
  onCompleted?: () => void;
  onAborted?: () => void;
};

type ActiveSession = {
  paid: boolean;
  onCompleted: () => void;
  onAborted: () => void;
};

let activeSession: ActiveSession | null = null;
let listenerAttached = false;
let checkoutTimeoutId: number | null = null;

const CHECKOUT_WAIT_MS = 25_000;

function clearCheckoutTimer() {
  if (checkoutTimeoutId != null && typeof window !== "undefined") {
    window.clearTimeout(checkoutTimeoutId);
    checkoutTimeoutId = null;
  }
}

function onPaddleEvent(event: PaddleEventData) {
  if (!activeSession) return;
  const name = event?.name;
  if (name === "checkout.completed") {
    activeSession.paid = true;
    const s = activeSession;
    activeSession = null;
    clearCheckoutTimer();
    s.onCompleted();
    return;
  }
  if (name === "checkout.closed" || name === "checkout.failed" || name === "checkout.error") {
    if (!activeSession.paid) {
      const s = activeSession;
      activeSession = null;
      clearCheckoutTimer();
      s.onAborted();
    }
  }
}

function ensureListener() {
  if (listenerAttached) return;
  listenerAttached = true;
  addPaddleEventListener(onPaddleEvent);
}

export async function openPaddleSubscriptionCheckout(
  args: OpenPaddleSubscriptionCheckoutArgs
): Promise<{ ok: true } | { ok: false; error: string }> {
  const priceId = getPaddlePriceId(args.plan, args.billing);
  if (!priceId) {
    return { ok: false, error: "Цена тарифа не настроена (env NEXT_PUBLIC_PADDLE_PRICE_*)." };
  }
  const productId = getPaddleProductId(args.plan, args.billing);
  const paddle = await getPaddle({ pwCustomerId: args.pwCustomerId ?? null });
  if (!paddle?.Checkout?.open) {
    return { ok: false, error: "Не удалось инициализировать оплату. Попробуйте позже." };
  }

  if (activeSession) {
    return { ok: false, error: "Дождитесь завершения текущего окна оплаты." };
  }

  ensureListener();

  const email = args.email.trim();
  activeSession = {
    paid: false,
    onCompleted: args.onCompleted ?? (() => {}),
    onAborted: args.onAborted ?? (() => {}),
  };

  clearCheckoutTimer();
  if (typeof window !== "undefined") {
    checkoutTimeoutId = window.setTimeout(() => {
      if (!activeSession || activeSession.paid) return;
      const s = activeSession;
      activeSession = null;
      s.onAborted();
      checkoutTimeoutId = null;
    }, CHECKOUT_WAIT_MS);
  }

  paddle.Checkout.open({
    items: [{ priceId, quantity: 1 }],
    customer: { email },
    customData: {
      ...(productId ? { paddle_product_id: productId } : {}),
      plan: args.plan,
      billing_period: args.billing,
      app_user_id: args.userId,
      app_email: email.toLowerCase(),
      ...(args.primaryOrgId ? { primary_org_id: args.primaryOrgId } : {}),
      ...(args.projectId ? { project_id: args.projectId } : {}),
    },
  });

  return { ok: true };
}
