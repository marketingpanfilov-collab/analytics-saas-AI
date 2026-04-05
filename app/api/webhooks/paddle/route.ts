import crypto from "node:crypto";
import { NextResponse } from "next/server";
import {
  billingLog,
  billingMetricAlert,
  recordBillingWebhookFailure,
} from "@/app/lib/billing/billingObservability";
import { resolvePaddleWebhookOrganizationId } from "@/app/lib/billing/paddleWebhookOrgResolution";
import { supabaseAdmin } from "@/app/lib/supabaseAdmin";

type PaddleWebhookEvent = {
  event_id?: string;
  event_type?: string;
  occurred_at?: string;
  data?: Record<string, any>;
};

const MAX_SIGNATURE_AGE_SECONDS = 5 * 60;

function parsePaddleSignature(header: string | null): { ts: string; h1: string } | null {
  if (!header) return null;
  const parts = header.split(";").map((x) => x.trim());
  const map = new Map<string, string>();
  for (const p of parts) {
    const i = p.indexOf("=");
    if (i <= 0) continue;
    const k = p.slice(0, i).trim();
    const v = p.slice(i + 1).trim();
    if (k && v) map.set(k, v);
  }
  const ts = map.get("ts");
  const h1 = map.get("h1");
  if (!ts || !h1) return null;
  return { ts, h1 };
}

function verifyPaddleSignature(rawBody: string, header: string | null, secret: string): boolean {
  const parsed = parsePaddleSignature(header);
  if (!parsed) return false;

  const tsNum = Number(parsed.ts);
  if (!Number.isFinite(tsNum)) return false;

  const age = Math.abs(Math.floor(Date.now() / 1000) - tsNum);
  if (age > MAX_SIGNATURE_AGE_SECONDS) return false;

  const signedPayload = `${parsed.ts}:${rawBody}`;
  const expected = crypto
    .createHmac("sha256", secret)
    .update(signedPayload, "utf8")
    .digest("hex");

  const expectedBuf = Buffer.from(expected, "utf8");
  const receivedBuf = Buffer.from(parsed.h1, "utf8");
  if (expectedBuf.length !== receivedBuf.length) return false;
  return crypto.timingSafeEqual(expectedBuf, receivedBuf);
}

export async function GET() {
  return NextResponse.json({
    success: true,
    provider: "paddle",
    hint: "Send POST with Paddle-Signature header",
  });
}

export async function POST(req: Request) {
  const secret = process.env.PADDLE_WEBHOOK_SECRET?.trim();
  if (!secret) {
    return NextResponse.json(
      { success: false, error: "PADDLE_WEBHOOK_SECRET is not configured" },
      { status: 500 }
    );
  }

  const rawBody = await req.text();
  const signatureHeader = req.headers.get("Paddle-Signature");
  const valid = verifyPaddleSignature(rawBody, signatureHeader, secret);
  if (!valid) {
    return NextResponse.json({ success: false, error: "Invalid signature" }, { status: 401 });
  }

  let payload: PaddleWebhookEvent | null = null;
  try {
    payload = JSON.parse(rawBody) as PaddleWebhookEvent;
  } catch {
    return NextResponse.json({ success: false, error: "Invalid JSON payload" }, { status: 400 });
  }

  const eventType = String(payload?.event_type ?? "");
  const eventId = String(payload?.event_id ?? "");
  const admin = supabaseAdmin();

  billingLog("info", "webhook", "WEBHOOK_RECEIVED", {
    event_id: eventId || null,
    event_type: eventType || null,
    occurred_at: payload?.occurred_at ?? null,
  });

  if (!eventId || !eventType) {
    return NextResponse.json({ success: false, error: "Missing event_id or event_type" }, { status: 400 });
  }

  const occurredAt = payload?.occurred_at ? new Date(payload.occurred_at).toISOString() : null;
  const { error: eventInsertError } = await admin
    .from("billing_webhook_events")
    .insert({
      provider: "paddle",
      provider_event_id: eventId,
      event_type: eventType,
      occurred_at: occurredAt,
      payload: payload,
      process_status: "processed",
    });

  if (eventInsertError) {
    if ((eventInsertError as { code?: string }).code === "23505") {
      return NextResponse.json({ success: true, received: true, duplicate: true });
    }
    billingLog("error", "webhook", "WEBHOOK_EVENT_INSERT_ERROR", {
      message: eventInsertError.message,
    });
    return NextResponse.json({ success: false, error: "Failed to persist webhook event" }, { status: 500 });
  }

  const d = payload.data ?? {};
  const customData = (d.custom_data as Record<string, unknown> | undefined) ?? {};
  const appUserIdRaw =
    (customData.app_user_id as string | undefined) ??
    (customData.user_id as string | undefined) ??
    null;
  const appEmailRaw =
    (customData.app_email as string | undefined) ??
    (d.customer_email as string | undefined) ??
    (d.email as string | undefined) ??
    null;
  const appOrgIdRaw =
    (customData.app_organization_id as string | undefined) ?? (customData.primary_org_id as string | undefined) ?? null;

  const customerId = d.customer_id ? String(d.customer_id) : null;

  const subscriptionIdForLog =
    (d.subscription_id as string | undefined) ??
    (d.id as string | undefined) ??
    (d.subscription?.id as string | undefined) ??
    null;

  const payloadOrgTrim = appOrgIdRaw != null ? String(appOrgIdRaw).trim() : "";
  const hadPayloadOrgKey = appOrgIdRaw != null && String(appOrgIdRaw).trim() !== "";
  const payloadUuidValid = /^[0-9a-f-]{36}$/i.test(payloadOrgTrim);

  if (hadPayloadOrgKey && !payloadUuidValid) {
    billingLog("warn", "webhook", "WEBHOOK_ORG_PAYLOAD_INVALID_UUID", {
      event_id: eventId,
      event_type: eventType,
      customer_id: customerId,
    });
  }

  if (!payloadUuidValid && (customerId != null || subscriptionIdForLog != null)) {
    billingLog("warn", "webhook", "WEBHOOK_WITHOUT_ORG_IN_PAYLOAD", {
      event_id: eventId,
      event_type: eventType,
      customer_id: customerId,
      has_subscription_hint: Boolean(subscriptionIdForLog),
    });
  }

  const orgResolution = await resolvePaddleWebhookOrganizationId(admin, {
    customerId,
    payloadOrganizationRaw: payloadUuidValid ? payloadOrgTrim : null,
  });

  let organizationId: string | null = null;
  let orgResolutionSource: string | null = null;

  if (orgResolution.ok) {
    organizationId = orgResolution.organizationId;
    orgResolutionSource = orgResolution.source;
    if (orgResolution.source !== "payload") {
      billingLog("warn", "webhook", "WEBHOOK_ORG_RECOVERED_FROM_DB", {
        event_id: eventId,
        event_type: eventType,
        customer_id: customerId,
        source: orgResolution.source,
        organization_id: organizationId,
      });
    }
  } else if (orgResolution.reason === "ambiguous") {
    billingLog("error", "webhook", "WEBHOOK_ORG_AMBIGUOUS", {
      event_id: eventId,
      event_type: eventType,
      customer_id: customerId,
      organization_ids: orgResolution.ambiguousOrganizationIds ?? [],
    });
    billingMetricAlert("AMBIGUOUS_ORG", {
      event_id: eventId,
      event_type: eventType,
      customer_id: customerId,
      organization_ids: orgResolution.ambiguousOrganizationIds ?? [],
    });
    await recordBillingWebhookFailure(admin, {
      provider_event_id: eventId,
      event_type: eventType,
      customer_id: customerId,
      subscription_id: subscriptionIdForLog,
      failure_kind: "ambiguous_org",
      metric_alert: true,
      details: {
        ambiguous_organization_ids: orgResolution.ambiguousOrganizationIds ?? [],
      },
    });
  } else if (orgResolution.reason === "not_found" || orgResolution.reason === "missing_customer_id") {
    billingLog("error", "webhook", "WEBHOOK_ORG_RECOVERY_FAILED", {
      event_id: eventId,
      event_type: eventType,
      customer_id: customerId,
      reason: orgResolution.reason,
    });
  }

  let mapUpdated = false;
  let subscriptionUpdated = false;

  const orgResolutionBlocked = !orgResolution.ok && orgResolution.reason === "ambiguous";

  if (customerId) {
    if (!organizationId) {
      billingLog("critical", "webhook", "WEBHOOK_SKIP_CUSTOMER_MAP_NO_ORG", {
        event_id: eventId,
        event_type: eventType,
        customer_id: customerId,
        skipped_due_to_ambiguous_org: orgResolutionBlocked,
      });
      if (!orgResolutionBlocked) {
        await recordBillingWebhookFailure(admin, {
          provider_event_id: eventId,
          event_type: eventType,
          customer_id: customerId,
          subscription_id: subscriptionIdForLog,
          failure_kind: "skip_customer_map",
          details: orgResolution.ok
            ? {}
            : { recovery_reason: orgResolution.reason },
        });
      }
    } else {
      const mappingRow = {
        provider: "paddle",
        provider_customer_id: customerId,
        user_id: appUserIdRaw && /^[0-9a-f-]{36}$/i.test(appUserIdRaw) ? appUserIdRaw : null,
        email: appEmailRaw ? String(appEmailRaw).toLowerCase() : null,
        organization_id: organizationId,
        source: "webhook",
        updated_at: new Date().toISOString(),
      };
      const { error: mapErr } = await admin
        .from("billing_customer_map")
        .upsert(mappingRow, { onConflict: "provider,provider_customer_id" });
      if (mapErr) {
        billingLog("critical", "webhook", "WEBHOOK_CUSTOMER_MAP_UPSERT_ERROR", {
          event_id: eventId,
          message: mapErr.message,
        });
        await recordBillingWebhookFailure(admin, {
          provider_event_id: eventId,
          event_type: eventType,
          customer_id: customerId,
          subscription_id: subscriptionIdForLog,
          failure_kind: "customer_map_upsert_error",
          details: { message: mapErr.message, code: (mapErr as { code?: string }).code },
        });
      } else {
        mapUpdated = true;
      }
    }
  }

  const subscriptionId = subscriptionIdForLog;

  if (subscriptionId) {
    if (!organizationId) {
      billingLog("critical", "webhook", "WEBHOOK_SKIP_SUBSCRIPTION_NO_ORG", {
        event_id: eventId,
        event_type: eventType,
        subscription_id: subscriptionId,
        customer_id: customerId,
        skipped_due_to_ambiguous_org: orgResolutionBlocked,
      });
      if (!orgResolutionBlocked) {
        await recordBillingWebhookFailure(admin, {
          provider_event_id: eventId,
          event_type: eventType,
          customer_id: customerId,
          subscription_id: subscriptionId,
          failure_kind: "skip_subscription",
          details: orgResolution.ok
            ? {}
            : { recovery_reason: orgResolution.reason },
        });
      }
    } else {
      const billingPeriod = (d.billing_period as { starts_at?: string; ends_at?: string } | undefined) ?? {};
      const items = Array.isArray(d.items) ? d.items : [];
      const firstItem = (items[0] ?? {}) as any;
      const firstPrice = (firstItem.price ?? {}) as any;
      const firstLineItem = (Array.isArray(d?.details?.line_items) ? d.details.line_items[0] : null) as any;
      const firstProduct = firstLineItem?.product ?? {};

      const snapshot = {
        provider: "paddle",
        provider_subscription_id: String(subscriptionId),
        provider_customer_id: customerId,
        provider_transaction_id: d.id ? String(d.id) : null,
        provider_price_id:
          (firstPrice.id as string | undefined) ??
          (firstItem.price_id as string | undefined) ??
          (firstLineItem?.price_id as string | undefined) ??
          null,
        provider_product_id:
          (firstPrice.product_id as string | undefined) ??
          (firstProduct.id as string | undefined) ??
          null,
        status: d.status ? String(d.status) : eventType.replace(/^subscription\./, ""),
        currency_code: d.currency_code ? String(d.currency_code) : null,
        current_period_start: billingPeriod.starts_at ? new Date(billingPeriod.starts_at).toISOString() : null,
        current_period_end: billingPeriod.ends_at ? new Date(billingPeriod.ends_at).toISOString() : null,
        canceled_at:
          eventType === "subscription.canceled"
            ? new Date(payload?.occurred_at ?? Date.now()).toISOString()
            : null,
        last_event_id: eventId,
        last_event_type: eventType,
        last_event_at: occurredAt,
        updated_at: new Date().toISOString(),
      };

      const { error: upsertError } = await admin
        .from("billing_subscriptions")
        .upsert({ ...snapshot, organization_id: organizationId }, { onConflict: "provider,provider_subscription_id" });

      if (upsertError) {
        billingLog("critical", "webhook", "WEBHOOK_SUBSCRIPTION_UPSERT_ERROR", {
          event_id: eventId,
          message: upsertError.message,
        });
        await recordBillingWebhookFailure(admin, {
          provider_event_id: eventId,
          event_type: eventType,
          customer_id: customerId,
          subscription_id: subscriptionId,
          failure_kind: "subscription_upsert_error",
          details: { message: upsertError.message, code: (upsertError as { code?: string }).code },
        });
      } else {
        subscriptionUpdated = true;
      }
    }
  }

  const billingSnapshotApplied = mapUpdated || subscriptionUpdated;

  return NextResponse.json({
    success: true,
    received: true,
    billing_snapshot_applied: billingSnapshotApplied,
    organization_id_resolved: organizationId != null,
    organization_id_source: orgResolutionSource,
  });
}
