import type { SupabaseClient } from "@supabase/supabase-js";

export type WebhookOrgResolutionSource = "payload" | "customer_map" | "subscriptions_snapshot";

export type WebhookOrgResolution =
  | { ok: true; organizationId: string; source: WebhookOrgResolutionSource }
  | {
      ok: false;
      reason: "missing_customer_id" | "not_found" | "ambiguous" | "invalid_payload_uuid";
      ambiguousOrganizationIds?: string[];
    };

const UUID_RE = /^[0-9a-f-]{36}$/i;

function normalizeUuid(raw: string | null | undefined): string | null {
  const s = raw != null ? String(raw).trim() : "";
  if (!UUID_RE.test(s)) return null;
  return s.toLowerCase();
}

/**
 * Резолв organization_id для Paddle webhook: custom_data → billing_customer_map → снимок подписок.
 * Не использует user-level billing; только org, уже привязанные к customer_id в БД.
 */
export async function resolvePaddleWebhookOrganizationId(
  admin: SupabaseClient,
  params: {
    customerId: string | null | undefined;
    payloadOrganizationRaw: string | null | undefined;
  }
): Promise<WebhookOrgResolution> {
  const fromPayload = normalizeUuid(params.payloadOrganizationRaw ?? null);
  if (params.payloadOrganizationRaw != null && String(params.payloadOrganizationRaw).trim() !== "" && !fromPayload) {
    return { ok: false, reason: "invalid_payload_uuid" };
  }
  if (fromPayload) {
    return { ok: true, organizationId: fromPayload, source: "payload" };
  }

  const customerId = params.customerId != null ? String(params.customerId).trim() : "";
  if (!customerId) {
    return { ok: false, reason: "missing_customer_id" };
  }

  const { data: mapRows, error: mapErr } = await admin
    .from("billing_customer_map")
    .select("organization_id")
    .eq("provider", "paddle")
    .eq("provider_customer_id", customerId)
    .not("organization_id", "is", null)
    .limit(5);

  if (mapErr) {
    return { ok: false, reason: "not_found" };
  }

  const mapOrgs = [...new Set((mapRows ?? []).map((r) => r.organization_id).filter(Boolean).map(String))];
  if (mapOrgs.length === 1) {
    return { ok: true, organizationId: mapOrgs[0]!, source: "customer_map" };
  }
  if (mapOrgs.length > 1) {
    return { ok: false, reason: "ambiguous", ambiguousOrganizationIds: mapOrgs };
  }

  const { data: subRows, error: subErr } = await admin
    .from("billing_subscriptions")
    .select("organization_id")
    .eq("provider", "paddle")
    .eq("provider_customer_id", customerId)
    .not("organization_id", "is", null)
    .limit(50);

  if (subErr) {
    return { ok: false, reason: "not_found" };
  }

  const subOrgs = [...new Set((subRows ?? []).map((r) => r.organization_id).filter(Boolean).map(String))];
  if (subOrgs.length === 1) {
    return { ok: true, organizationId: subOrgs[0]!, source: "subscriptions_snapshot" };
  }
  if (subOrgs.length > 1) {
    return { ok: false, reason: "ambiguous", ambiguousOrganizationIds: subOrgs };
  }

  return { ok: false, reason: "not_found" };
}
