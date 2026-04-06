import { getMetaCheckoutCapiContext } from "@/app/lib/metaCheckoutCapiContext";
import { sendMetaPurchase } from "@/app/lib/metaCapi";
import { metaPurchaseEventId } from "@/app/lib/metaMarketingIds";
import { extractPurchaseFromPaddleTransactionWebhookData } from "@/app/lib/paddleMetaExtract";
import { supabaseAdmin } from "@/app/lib/supabaseAdmin";

/**
 * CAPI Purchase после transaction.completed. UA/URL/IP/fbp/fbc — из снимка при InitiateCheckout (см. meta_checkout_capi_context).
 */
export async function sendMetaPurchaseFromPaddleTransactionWebhook(args: {
  paddleWebhookEventId: string;
  eventOccurredAtIso: string | null;
  data: unknown;
  customData: Record<string, unknown>;
  appEmail: string | null;
  appUserId: string | null;
}): Promise<void> {
  const extracted = extractPurchaseFromPaddleTransactionWebhookData(args.data, args.customData);
  if (!extracted?.checkoutAttemptId) return;
  if (extracted.value == null || !extracted.currency) {
    console.warn("[meta_purchase_webhook] missing value/currency, skip CAPI");
    return;
  }

  const eventId = metaPurchaseEventId(extracted.checkoutAttemptId);
  const externalId =
    args.appUserId && /^[0-9a-f-]{36}$/i.test(args.appUserId.trim()) ? args.appUserId.trim() : null;

  const eventTimeSeconds = args.eventOccurredAtIso
    ? Math.floor(Date.parse(args.eventOccurredAtIso) / 1000)
    : Math.floor(Date.now() / 1000);

  const admin = supabaseAdmin();
  const ctx = await getMetaCheckoutCapiContext(admin, extracted.checkoutAttemptId);
  const appBase = process.env.NEXT_PUBLIC_APP_URL?.replace(/\/$/, "") ?? "";
  const eventSourceUrl =
    (ctx?.event_source_url && String(ctx.event_source_url).trim()) ||
    (appBase ? `${appBase}/` : null);
  const userAgent = (ctx?.client_user_agent && String(ctx.client_user_agent).trim()) || null;
  const clientIp = (ctx?.client_ip && String(ctx.client_ip).trim()) || null;
  const fbp = ctx?.fbp?.trim() || null;
  const fbc = ctx?.fbc?.trim() || null;

  if (!userAgent) {
    console.warn(
      "[meta_purchase_webhook] missing client_user_agent for website CAPI; matching may be degraded"
    );
  }

  await sendMetaPurchase({
    eventId,
    eventTimeSeconds,
    eventSourceUrl,
    email: args.appEmail,
    externalId,
    subscriptionId: extracted.subscriptionId,
    clientIp,
    userAgent,
    fbp,
    fbc,
    country: extracted.country,
    customData: {
      value: extracted.value,
      currency: extracted.currency,
      plan: extracted.plan,
      billing_period: extracted.billingPeriod,
      transaction_id: extracted.transactionId,
      checkout_attempt_id: extracted.checkoutAttemptId,
      source: "paddle",
    },
  });
}
