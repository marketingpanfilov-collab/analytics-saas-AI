import type { PaddleEventData } from "@paddle/paddle-js";
import { addPaddleEventListener } from "@/app/lib/paddle";
import { fireMetaInitiateCheckoutPixelAndCapi } from "@/app/lib/metaPixelBrowser";

function checkoutAttemptFromLoadedEvent(data: unknown): string | null {
  if (!data || typeof data !== "object") return null;
  const cd = (data as Record<string, unknown>).custom_data;
  if (!cd || typeof cd !== "object") return null;
  const v = (cd as Record<string, unknown>).checkout_attempt_id;
  return typeof v === "string" && v.trim() ? v.trim() : null;
}

/**
 * Meta InitiateCheckout (Pixel + CAPI) только после успешной загрузки Paddle checkout
 * (событие checkout.loaded), чтобы не слать событие при сбое open.
 */
export function subscribeMetaInitiateCheckoutWhenCheckoutLoaded(
  checkoutAttemptId: string,
  payload: {
    plan: string;
    billingPeriod: string;
    email: string;
    appUserId?: string | null;
  }
): () => void {
  const off = addPaddleEventListener((event: PaddleEventData) => {
    if (event.name !== "checkout.loaded") return;
    const ca = checkoutAttemptFromLoadedEvent(event.data);
    if (ca !== checkoutAttemptId) return;
    off();
    fireMetaInitiateCheckoutPixelAndCapi({
      checkoutAttemptId,
      plan: payload.plan,
      billingPeriod: payload.billingPeriod,
      email: payload.email,
      eventSourceUrl: typeof window !== "undefined" ? window.location.href : "",
      appUserId: payload.appUserId ?? null,
    });
  });
  return off;
}
