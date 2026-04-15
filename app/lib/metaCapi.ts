import {
  hashMetaCountryIso2,
  hashMetaFirstLastNameForCapi,
  hashMetaPhoneForCapi,
  normalizeAndHashMetaUserData,
} from "@/app/lib/metaUserDataHash";
import { getMetaPixelIdFromEnv } from "@/app/lib/metaPixelEnv";
import {
  releaseMetaMarketingDispatch,
  tryClaimMetaMarketingDispatch,
  tryClaimMetaMarketingDispatchDetailed,
} from "@/app/lib/metaDispatch";
import { supabaseAdmin } from "@/app/lib/supabaseAdmin";

function getMetaConfig(): { pixelId: string; accessToken: string; apiVersion: string } | null {
  const pixelId = getMetaPixelIdFromEnv();
  const accessToken = process.env.META_CAPI_ACCESS_TOKEN?.trim() ?? "";
  const rawVer = process.env.META_API_VERSION?.trim() || "v21.0";
  const apiVersion = rawVer.startsWith("v") ? rawVer : `v${rawVer}`;
  if (!pixelId || !accessToken) return null;
  return { pixelId, accessToken, apiVersion };
}

/** Не занимать слот в meta_marketing_dispatch, если CAPI не сконфигурирован. */
export function isMetaCapiConfigured(): boolean {
  return getMetaConfig() != null;
}

type CapiUserData = Record<string, unknown>;

function buildCapiUserDataBlock(args: {
  email: string | null;
  externalId: string | null;
  subscriptionId: string | null;
  clientIp: string | null;
  userAgent: string | null;
  fbp: string | null;
  fbc: string | null;
  country: string | null;
}): CapiUserData {
  const hashed = normalizeAndHashMetaUserData({
    email: args.email,
    externalId: args.externalId,
  });
  const ud: CapiUserData = { ...hashed };
  if (args.clientIp) ud.client_ip_address = args.clientIp;
  if (args.userAgent) ud.client_user_agent = args.userAgent;
  if (args.fbp) ud.fbp = args.fbp;
  if (args.fbc) ud.fbc = args.fbc;
  const countryHash = hashMetaCountryIso2(args.country);
  if (countryHash) ud.country = countryHash;
  const sub = args.subscriptionId?.trim();
  if (sub) ud.subscription_id = sub;
  return ud;
}

type MetaCapiConfig = NonNullable<ReturnType<typeof getMetaConfig>>;

/** HTTP 200 у Graph может сопровождаться телом с error или events_received: 0. */
function isMetaConversionsApiResponseSuccess(json: unknown, batchSize: number): boolean {
  if (json == null || typeof json !== "object") {
    console.error("[meta_capi] Graph: empty or non-object JSON body");
    return false;
  }
  const o = json as Record<string, unknown>;
  if (o.error && typeof o.error === "object") {
    console.error("[meta_capi] Graph body error", JSON.stringify(o.error).slice(0, 400));
    return false;
  }
  const received = o.events_received;
  if (typeof received === "number") {
    if (received < 1) {
      console.error("[meta_capi] Graph events_received", received);
      return false;
    }
    if (batchSize > 0 && received < batchSize) {
      console.error("[meta_capi] Graph partial events_received", received, "/", batchSize);
      return false;
    }
  }
  const messages = o.messages;
  if (Array.isArray(messages)) {
    for (const m of messages) {
      if (!m || typeof m !== "object") continue;
      const t = (m as { type?: string }).type;
      if (t === "error") {
        console.error("[meta_capi] Graph message error", JSON.stringify(m).slice(0, 300));
        return false;
      }
    }
  }
  return true;
}

async function postMetaEventsWithConfig(cfg: MetaCapiConfig, payload: { data: unknown[] }): Promise<boolean> {
  const testCode = process.env.META_CAPI_TEST_EVENT_CODE?.trim();
  const body: Record<string, unknown> = { data: payload.data };
  if (testCode) body.test_event_code = testCode;

  const url = new URL(`https://graph.facebook.com/${cfg.apiVersion}/${cfg.pixelId}/events`);
  url.searchParams.set("access_token", cfg.accessToken);
  const res = await fetch(url.toString(), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const rawText = await res.text().catch(() => "");
  if (!res.ok) {
    console.error("[meta_capi] Graph error", res.status, rawText.slice(0, 500));
    return false;
  }
  let parsed: unknown;
  try {
    parsed = rawText ? JSON.parse(rawText) : {};
  } catch {
    console.error("[meta_capi] Graph: invalid JSON body", rawText.slice(0, 300));
    return false;
  }
  return isMetaConversionsApiResponseSuccess(parsed, payload.data.length);
}

async function postMetaEvents(payload: { data: unknown[] }): Promise<void> {
  const cfg = getMetaConfig();
  if (!cfg) {
    console.warn("[meta_capi] META_PIXEL_ID or META_CAPI_ACCESS_TOKEN missing, skip");
    return;
  }
  await postMetaEventsWithConfig(cfg, payload);
}

export async function sendMetaInitiateCheckout(args: {
  idempotencyKey: string;
  eventId: string;
  eventTimeSeconds: number;
  eventSourceUrl: string | null;
  email: string | null;
  externalId: string | null;
  clientIp: string | null;
  userAgent: string | null;
  fbp: string | null;
  fbc: string | null;
  country: string | null;
  customData: {
    plan: string;
    billing_period: string;
    checkout_attempt_id: string;
    source: "paddle";
  };
}): Promise<void> {
  try {
    const admin = supabaseAdmin();
    const claimed = await tryClaimMetaMarketingDispatch(admin, args.idempotencyKey, "InitiateCheckout");
    if (!claimed) return;

    const user_data = buildCapiUserDataBlock({
      email: args.email,
      externalId: args.externalId,
      subscriptionId: null,
      clientIp: args.clientIp,
      userAgent: args.userAgent,
      fbp: args.fbp,
      fbc: args.fbc,
      country: args.country,
    });

    await postMetaEvents({
      data: [
        {
          event_name: "InitiateCheckout",
          event_time: args.eventTimeSeconds,
          event_id: args.eventId,
          action_source: "website",
          event_source_url: args.eventSourceUrl ?? undefined,
          user_data,
          custom_data: {
            num_items: 1,
            ...args.customData,
          },
        },
      ],
    });
  } catch (e) {
    console.error("[meta_capi] sendMetaInitiateCheckout", e);
  }
}

export async function sendMetaPurchase(args: {
  eventId: string;
  eventTimeSeconds: number;
  eventSourceUrl: string | null;
  email: string | null;
  externalId: string | null;
  subscriptionId: string | null;
  clientIp: string | null;
  userAgent: string | null;
  fbp: string | null;
  fbc: string | null;
  country: string | null;
  customData: {
    value: number;
    currency: string;
    plan: string | null;
    billing_period: string | null;
    transaction_id: string | null;
    checkout_attempt_id: string | null;
    source: "paddle";
  };
}): Promise<void> {
  try {
    const txnId = args.customData.transaction_id?.trim();
    if (!txnId) {
      console.warn("[meta_capi] Purchase skipped: missing transaction_id");
      return;
    }
    if (!Number.isFinite(args.customData.value) || args.customData.value < 0) {
      console.warn("[meta_capi] Purchase skipped: invalid value");
      return;
    }

    const admin = supabaseAdmin();
    const claimed = await tryClaimMetaMarketingDispatch(admin, `purchase_capi_txn:${txnId}`, "Purchase");
    if (!claimed) return;

    const user_data = buildCapiUserDataBlock({
      email: args.email,
      externalId: args.externalId,
      subscriptionId: args.subscriptionId,
      clientIp: args.clientIp,
      userAgent: args.userAgent,
      fbp: args.fbp,
      fbc: args.fbc,
      country: args.country,
    });

    await postMetaEvents({
      data: [
        {
          event_name: "Purchase",
          event_time: args.eventTimeSeconds,
          event_id: args.eventId,
          action_source: "website",
          event_source_url: args.eventSourceUrl ?? undefined,
          user_data,
          custom_data: {
            value: args.customData.value,
            currency: args.customData.currency,
            ...(args.customData.plan ? { plan: args.customData.plan } : {}),
            ...(args.customData.billing_period ? { billing_period: args.customData.billing_period } : {}),
            ...(args.customData.transaction_id ? { order_id: args.customData.transaction_id } : {}),
            ...(args.customData.checkout_attempt_id
              ? { checkout_attempt_id: args.customData.checkout_attempt_id }
              : {}),
            source: args.customData.source,
          },
        },
      ],
    });
  } catch (e) {
    console.error("[meta_capi] sendMetaPurchase", e);
  }
}

export type MetaCompleteRegistrationCapiResult = {
  /** Meta приняла CompleteRegistration в этом запросе — клиентский Pixel и флаг в JSON. */
  meta_complete_registration_capi: boolean;
  /**
   * Снять boardiq_meta_cr_eligible: после успешной отправки в Graph или если dispatch уже был
   * (идемпотентность — не оставляем «вечную» cookie).
   */
  clear_meta_cr_eligible_cookie: boolean;
};

export async function sendMetaCompleteRegistration(args: {
  idempotencyKey: string;
  eventId: string;
  eventTimeSeconds: number;
  eventSourceUrl: string | null;
  email: string | null;
  externalId: string | null;
  /** Сырой телефон из формы — внутри хешируется для `ph` */
  contactPhone: string | null;
  /** Полное ФИО — распределяется на fn/ln */
  ownerFullName: string;
  clientIp: string | null;
  userAgent: string | null;
  fbp: string | null;
  fbc: string | null;
  country: string | null;
  /** Например из META_DEFAULT_PHONE_CC_DIGITS — для 10-значного ввода без кода страны */
  phoneDefaultCallingCodeDigits?: string | null;
}): Promise<MetaCompleteRegistrationCapiResult> {
  const noop: MetaCompleteRegistrationCapiResult = {
    meta_complete_registration_capi: false,
    clear_meta_cr_eligible_cookie: false,
  };
  let adminForRelease: ReturnType<typeof supabaseAdmin> | null = null;
  let dispatchClaimed = false;
  try {
    const cfg = getMetaConfig();
    if (!cfg) {
      console.warn("[meta_capi] CompleteRegistration skipped: META_PIXEL_ID or META_CAPI_ACCESS_TOKEN missing");
      return noop;
    }

    const base = normalizeAndHashMetaUserData({
      email: args.email,
      externalId: args.externalId,
    });
    const phoneH = hashMetaPhoneForCapi(args.contactPhone, {
      defaultCallingCodeDigits: args.phoneDefaultCallingCodeDigits,
    });
    const nameParts = hashMetaFirstLastNameForCapi(args.ownerFullName);
    const user_data: Record<string, unknown> = { ...base };
    if (args.clientIp) user_data.client_ip_address = args.clientIp;
    if (args.userAgent) user_data.client_user_agent = args.userAgent;
    if (args.fbp) user_data.fbp = args.fbp;
    if (args.fbc) user_data.fbc = args.fbc;
    const countryHash = hashMetaCountryIso2(args.country);
    if (countryHash) user_data.country = countryHash;
    if (phoneH) user_data.ph = [phoneH];
    if (nameParts.fn) user_data.fn = nameParts.fn;
    if (nameParts.ln) user_data.ln = nameParts.ln;

    adminForRelease = supabaseAdmin();
    const claim = await tryClaimMetaMarketingDispatchDetailed(
      adminForRelease,
      args.idempotencyKey,
      "CompleteRegistration"
    );
    if (claim === "duplicate") {
      return { meta_complete_registration_capi: false, clear_meta_cr_eligible_cookie: true };
    }
    if (claim === "failed") {
      return noop;
    }
    dispatchClaimed = true;

    let graphOk = false;
    try {
      graphOk = await postMetaEventsWithConfig(cfg, {
        data: [
          {
            event_name: "CompleteRegistration",
            event_time: args.eventTimeSeconds,
            event_id: args.eventId,
            action_source: "website",
            event_source_url: args.eventSourceUrl ?? undefined,
            user_data,
            custom_data: {
              registration_method: "post_checkout_onboarding",
            },
          },
        ],
      });
    } catch (postErr) {
      console.error("[meta_capi] CompleteRegistration Graph request failed", postErr);
      await releaseMetaMarketingDispatch(adminForRelease, args.idempotencyKey);
      dispatchClaimed = false;
      return noop;
    }
    if (!graphOk) {
      await releaseMetaMarketingDispatch(adminForRelease, args.idempotencyKey);
      dispatchClaimed = false;
      return noop;
    }

    return { meta_complete_registration_capi: true, clear_meta_cr_eligible_cookie: true };
  } catch (e) {
    if (dispatchClaimed && adminForRelease) {
      await releaseMetaMarketingDispatch(adminForRelease, args.idempotencyKey);
    }
    console.error("[meta_capi] sendMetaCompleteRegistration", e);
    return noop;
  }
}
