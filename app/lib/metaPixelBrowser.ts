/**
 * Клиентские вызовы Meta Pixel (fbq). Без node-only зависимостей.
 * external_id в опциях события — SHA256(hex) от UTF-8 строки app user id (как CAPI user_data.external_id).
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

async function sha256Utf8Hex(text: string): Promise<string> {
  const enc = new TextEncoder();
  const buf = await crypto.subtle.digest("SHA-256", enc.encode(text));
  return Array.from(new Uint8Array(buf))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

function isStableAppUserId(id: string | null | undefined): id is string {
  return !!id && /^[0-9a-f-]{36}$/i.test(id.trim());
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
  /** Supabase user UUID — только если пользователь уже известен */
  appUserId?: string | null;
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
  const rawUserId = isStableAppUserId(args.appUserId) ? args.appUserId.trim() : null;

  void (async () => {
    const pixelOpts: Record<string, string> = { eventID };
    if (rawUserId) {
      pixelOpts.external_id = await sha256Utf8Hex(rawUserId);
    }
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
        pixelOpts
      );
    } catch (e) {
      console.warn("[meta_pixel] InitiateCheckout fbq", e);
    }

    const ua = typeof navigator !== "undefined" ? navigator.userAgent : "";
    const body: Record<string, unknown> = {
      checkout_attempt_id: args.checkoutAttemptId,
      plan: args.plan,
      billing_period: args.billingPeriod,
      email: args.email.trim().toLowerCase(),
      event_id: eventID,
      event_source_url: args.eventSourceUrl,
      fbp,
      fbc,
      user_agent: ua || null,
    };
    if (rawUserId) body.app_user_id = rawUserId;

    await fetch("/api/marketing/meta/initiate-checkout", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    }).catch((e) => console.warn("[meta_pixel] initiate-checkout API", e));
  })();
}

export function fireMetaPurchasePixelFromPaddleEvent(event: PaddleEventData): void {
  if (typeof window === "undefined") return;
  const data = event.data;
  const extracted = extractPurchaseFromPaddleCheckoutCompletedData(data);
  if (!extracted || !extracted.checkoutAttemptId) return;
  if (extracted.value == null || !extracted.currency) return;

  const eventID = metaPurchaseEventId(extracted.checkoutAttemptId);
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

  const rawUserId = extracted.appUserId;

  void (async () => {
    const pixelOpts: Record<string, string> = { eventID };
    if (rawUserId) {
      pixelOpts.external_id = await sha256Utf8Hex(rawUserId);
    }

    const pixelPayload: Record<string, unknown> = {
      value: extracted.value,
      currency: extracted.currency,
      order_id: extracted.transactionId,
      ...(email ? { content_name: "BoardIQ subscription" } : {}),
    };
    if (extracted.paddleProductId) {
      pixelPayload.content_ids = [extracted.paddleProductId];
      pixelPayload.content_type = "product";
    }

    try {
      window.fbq?.("track", "Purchase", pixelPayload, pixelOpts);
    } catch (e) {
      console.warn("[meta_pixel] Purchase fbq", e);
    }
  })();
}
