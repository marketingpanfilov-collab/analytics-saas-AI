import { hashMetaCountryIso2, normalizeAndHashMetaUserData } from "@/app/lib/metaUserDataHash";
import { tryClaimMetaMarketingDispatch } from "@/app/lib/metaDispatch";
import { supabaseAdmin } from "@/app/lib/supabaseAdmin";

function getMetaConfig(): { pixelId: string; accessToken: string; apiVersion: string } | null {
  const pixelId = process.env.META_PIXEL_ID?.trim() ?? "";
  const accessToken = process.env.META_CAPI_ACCESS_TOKEN?.trim() ?? "";
  const rawVer = process.env.META_API_VERSION?.trim() || "v21.0";
  const apiVersion = rawVer.startsWith("v") ? rawVer : `v${rawVer}`;
  if (!pixelId || !accessToken) return null;
  return { pixelId, accessToken, apiVersion };
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

async function postMetaEvents(payload: { data: unknown[] }): Promise<void> {
  const cfg = getMetaConfig();
  if (!cfg) {
    console.warn("[meta_capi] META_PIXEL_ID or META_CAPI_ACCESS_TOKEN missing, skip");
    return;
  }
  const url = new URL(`https://graph.facebook.com/${cfg.apiVersion}/${cfg.pixelId}/events`);
  url.searchParams.set("access_token", cfg.accessToken);
  const res = await fetch(url.toString(), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  if (!res.ok) {
    const t = await res.text().catch(() => "");
    console.error("[meta_capi] Graph error", res.status, t.slice(0, 500));
  }
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
  idempotencyKey: string;
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
    const admin = supabaseAdmin();
    const claimed = await tryClaimMetaMarketingDispatch(admin, args.idempotencyKey, "Purchase");
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
