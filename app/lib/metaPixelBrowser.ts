/**
 * Клиентские вызовы Meta Pixel (fbq). Без node-only зависимостей.
 */

import type { PaddleEventData } from "@paddle/paddle-js";
import { metaInitiateCheckoutEventId, metaPurchaseEventId } from "@/app/lib/metaMarketingIds";
import { extractPurchaseFromPaddleCheckoutCompletedData } from "@/app/lib/paddleMetaExtract";

declare global {
  interface Window {
    fbq?: (...args: unknown[]) => void;
    __BOARDIQ_FB_PIXEL_INIT__?: boolean;
  }
}

export function readFacebookBrowserSignals(): { fbp: string | null; fbc: string | null } {
  if (typeof document === "undefined") return { fbp: null, fbc: null };
  const parse = (name: string): string | null => {
    const hit = document.cookie.split("; ").find((x) => x.startsWith(`${name}=`));
    if (!hit) return null;
    const v = hit.slice(name.length + 1);
    try {
      return decodeURIComponent(v);
    } catch {
      return v;
    }
  };
  return { fbp: parse("_fbp"), fbc: parse("_fbc") };
}

const IC_STORAGE_PREFIX = "boardiq_meta_ic_";
const PURCHASE_STORAGE_PREFIX = "boardiq_meta_purchase_";

export function fireMetaInitiateCheckoutPixelAndCapi(args: {
  checkoutAttemptId: string;
  plan: string;
  billingPeriod: string;
  email: string;
  eventSourceUrl: string;
}): void {
  if (typeof window === "undefined") return;

  const storageKey = `${IC_STORAGE_PREFIX}${args.checkoutAttemptId}`;
  try {
    if (sessionStorage.getItem(storageKey)) return;
    sessionStorage.setItem(storageKey, "1");
  } catch {
    /* ignore */
  }

  const eventID = metaInitiateCheckoutEventId(args.checkoutAttemptId);
  const { fbp, fbc } = readFacebookBrowserSignals();

  try {
    window.fbq?.(
      "track",
      "InitiateCheckout",
      {
        content_type: "product",
        num_items: 1,
        currency: "USD",
        content_category: args.plan,
      },
      { eventID }
    );
  } catch (e) {
    console.warn("[meta_pixel] InitiateCheckout fbq", e);
  }

  const ua = typeof navigator !== "undefined" ? navigator.userAgent : "";

  void fetch("/api/marketing/meta/initiate-checkout", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      checkout_attempt_id: args.checkoutAttemptId,
      plan: args.plan,
      billing_period: args.billingPeriod,
      email: args.email.trim().toLowerCase(),
      event_id: eventID,
      event_source_url: args.eventSourceUrl,
      fbp,
      fbc,
      user_agent: ua || null,
    }),
  }).catch((e) => console.warn("[meta_pixel] initiate-checkout API", e));
}

export function fireMetaPurchasePixelFromPaddleEvent(event: PaddleEventData): void {
  if (typeof window === "undefined") return;
  const data = event.data;
  const extracted = extractPurchaseFromPaddleCheckoutCompletedData(data);
  if (!extracted || !extracted.checkoutAttemptId) return;
  if (extracted.value == null || !extracted.currency) return;

  const eventID = metaPurchaseEventId(extracted.checkoutAttemptId, extracted.transactionId);
  const storageKey = `${PURCHASE_STORAGE_PREFIX}${eventID}`;
  try {
    if (sessionStorage.getItem(storageKey)) return;
    sessionStorage.setItem(storageKey, "1");
  } catch {
    /* ignore */
  }

  const email =
    data && typeof data === "object" && typeof (data as { customer?: { email?: string } }).customer?.email === "string"
      ? String((data as { customer: { email: string } }).customer.email).trim().toLowerCase()
      : "";

  try {
    window.fbq?.(
      "track",
      "Purchase",
      {
        value: extracted.value,
        currency: extracted.currency,
        ...(email ? { content_name: "BoardIQ subscription" } : {}),
      },
      { eventID }
    );
  } catch (e) {
    console.warn("[meta_pixel] Purchase fbq", e);
  }
}
