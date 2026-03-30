/**
 * Detect BoardIQ retention marker in URL query or url_tags-style strings.
 * Aligns with UTM Builder / redirect: campaign_intent=retention
 */
export function detectRetentionInSnippet(snippet: string | null | undefined): boolean {
  if (snippet == null) return false;
  const s = String(snippet).trim();
  if (!s) return false;
  const lower = s.toLowerCase();
  if (lower.includes("campaign_intent=retention")) return true;
  if (lower.includes("campaign_intent%3dretention")) return true;
  try {
    const href = s.includes("://") ? s : `https://placeholder.invalid/?${s.replace(/^\?/, "")}`;
    const u = new URL(href);
    const intent = u.searchParams.get("campaign_intent");
    if (intent?.trim().toLowerCase() === "retention") return true;
  } catch {
    /* ignore */
  }
  return false;
}

/** Collect string values from nested JSON (creative payloads). */
export function collectJsonStrings(obj: unknown, out: string[], depth = 0, maxDepth = 20): void {
  if (depth > maxDepth) return;
  if (obj == null) return;
  if (typeof obj === "string") {
    if (obj.length > 0 && obj.length < 16000) out.push(obj);
    return;
  }
  if (Array.isArray(obj)) {
    for (const x of obj) collectJsonStrings(x, out, depth + 1, maxDepth);
    return;
  }
  if (typeof obj === "object") {
    for (const v of Object.values(obj as Record<string, unknown>)) {
      collectJsonStrings(v, out, depth + 1, maxDepth);
    }
  }
}

export function metaAdPayloadIndicatesRetention(ad: {
  url_tags?: string | null;
  creative?: Record<string, unknown> | null;
}): boolean {
  if (detectRetentionInSnippet(ad.url_tags ?? null)) return true;
  const creative = ad.creative;
  if (!creative || typeof creative !== "object") return false;
  const strings: string[] = [];
  collectJsonStrings(creative, strings);
  for (const t of strings) {
    if (detectRetentionInSnippet(t)) return true;
  }
  return false;
}

/** Deep scan (e.g. TikTok ad JSON) for retention URL markers. */
export function jsonPayloadIndicatesRetention(obj: unknown): boolean {
  const strings: string[] = [];
  collectJsonStrings(obj, strings);
  for (const t of strings) {
    if (detectRetentionInSnippet(t)) return true;
  }
  return false;
}

import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * Persist marketing_intent on campaigns.meta rows for one ad account.
 * @param retentionMetaCampaignIds — Meta campaign ids (numeric string) that have ≥1 retention ad.
 */
export async function applyMetaMarketingIntentForAdAccount(
  admin: SupabaseClient,
  projectId: string,
  metaAdAccountExternalId: string,
  retentionMetaCampaignIds: Set<string>
): Promise<{ updatedRetention: number; updatedAcquisition: number }> {
  const { data: rows, error: selErr } = await admin
    .from("campaigns")
    .select("id, meta_campaign_id")
    .eq("project_id", projectId)
    .eq("platform", "meta")
    .eq("ad_account_id", metaAdAccountExternalId);

  if (selErr) {
    console.warn("[META_MARKETING_INTENT_SELECT]", selErr);
    return { updatedRetention: 0, updatedAcquisition: 0 };
  }
  if (!rows?.length) {
    return { updatedRetention: 0, updatedAcquisition: 0 };
  }

  const list = rows as { id: string; meta_campaign_id: string | null }[];
  const now = new Date().toISOString();
  const retentionIds = list.filter((r) => r.meta_campaign_id && retentionMetaCampaignIds.has(String(r.meta_campaign_id))).map((r) => r.id);
  const acquisitionIds = list.filter((r) => r.meta_campaign_id && !retentionMetaCampaignIds.has(String(r.meta_campaign_id))).map((r) => r.id);

  let updatedRetention = 0;
  let updatedAcquisition = 0;
  const chunk = 80;

  for (let i = 0; i < retentionIds.length; i += chunk) {
    const part = retentionIds.slice(i, i + chunk);
    const { error } = await admin
      .from("campaigns")
      .update({ marketing_intent: "retention", marketing_intent_updated_at: now })
      .in("id", part);
    if (!error) updatedRetention += part.length;
  }
  for (let i = 0; i < acquisitionIds.length; i += chunk) {
    const part = acquisitionIds.slice(i, i + chunk);
    const { error } = await admin
      .from("campaigns")
      .update({ marketing_intent: "acquisition", marketing_intent_updated_at: now })
      .in("id", part);
    if (!error) updatedAcquisition += part.length;
  }

  return { updatedRetention, updatedAcquisition };
}

type TikTokAdGetResponse = {
  code?: number;
  message?: string;
  data?: {
    list?: Record<string, unknown>[];
    page_info?: { page?: number; total_page?: number };
  };
};

/**
 * TikTok: paginate ad/get, detect campaign_intent=retention in ad payload strings, update campaigns rows for this ad account.
 */
export async function applyTiktokMarketingIntentFromAdsApi(
  admin: SupabaseClient,
  opts: {
    projectId: string;
    canonicalAdAccountId: string;
    externalAdvertiserId: string;
    accessToken: string;
  }
): Promise<{ updatedRetention: number; updatedAcquisition: number; adsScanned: number }> {
  const { projectId, canonicalAdAccountId, externalAdvertiserId, accessToken } = opts;
  const retentionExt = new Set<string>();
  const anyAdExt = new Set<string>();
  let adsScanned = 0;
  let page = 1;

  try {
    for (;;) {
      const params = new URLSearchParams({
        advertiser_id: externalAdvertiserId,
        page: String(page),
        page_size: "1000",
      });
      const res = await fetch(`https://business-api.tiktok.com/open_api/v1.3/ad/get/?${params.toString()}`, {
        headers: {
          "Access-Token": accessToken,
          "Content-Type": "application/json",
        },
      });
      const json = (await res.json().catch(() => ({}))) as TikTokAdGetResponse;
      if (!res.ok || Number(json.code ?? 0) !== 0) {
        console.warn("[TIKTOK_MARKETING_INTENT_AD_GET]", {
          message: json.message,
          code: json.code,
          http: res.status,
          page,
        });
        break;
      }
      const list = json.data?.list ?? [];
      adsScanned += list.length;
      for (const ad of list) {
        if (!ad || typeof ad !== "object") continue;
        const cid = String((ad as { campaign_id?: unknown }).campaign_id ?? "").trim();
        if (!cid) continue;
        anyAdExt.add(cid);
        if (jsonPayloadIndicatesRetention(ad)) retentionExt.add(cid);
      }
      const tp = json.data?.page_info?.total_page;
      if (typeof tp === "number" && tp > 0) {
        if (page >= tp) break;
      } else if (list.length === 0 || list.length < 1000) {
        break;
      }
      page += 1;
      if (page > 500) break;
    }
  } catch (e) {
    console.warn("[TIKTOK_MARKETING_INTENT_AD_GET_EXCEPTION]", e);
    return { updatedRetention: 0, updatedAcquisition: 0, adsScanned };
  }

  if (anyAdExt.size === 0) {
    return { updatedRetention: 0, updatedAcquisition: 0, adsScanned };
  }

  const { data: rows, error: selErr } = await admin
    .from("campaigns")
    .select("id, external_campaign_id")
    .eq("project_id", projectId)
    .eq("platform", "tiktok")
    .eq("ad_accounts_id", canonicalAdAccountId);

  if (selErr) {
    console.warn("[TIKTOK_MARKETING_INTENT_SELECT]", selErr);
    return { updatedRetention: 0, updatedAcquisition: 0, adsScanned };
  }

  const list = (rows ?? []) as { id: string; external_campaign_id: string | null }[];
  const now = new Date().toISOString();
  const retentionIds: string[] = [];
  const acquisitionIds: string[] = [];
  for (const r of list) {
    const ext = r.external_campaign_id != null ? String(r.external_campaign_id).trim() : "";
    if (!ext || !anyAdExt.has(ext)) continue;
    if (retentionExt.has(ext)) retentionIds.push(r.id);
    else acquisitionIds.push(r.id);
  }

  let updatedRetention = 0;
  let updatedAcquisition = 0;
  const chunk = 80;

  for (let i = 0; i < retentionIds.length; i += chunk) {
    const part = retentionIds.slice(i, i + chunk);
    const { error } = await admin
      .from("campaigns")
      .update({ marketing_intent: "retention", marketing_intent_updated_at: now })
      .in("id", part);
    if (!error) updatedRetention += part.length;
  }
  for (let i = 0; i < acquisitionIds.length; i += chunk) {
    const part = acquisitionIds.slice(i, i + chunk);
    const { error } = await admin
      .from("campaigns")
      .update({ marketing_intent: "acquisition", marketing_intent_updated_at: now })
      .in("id", part);
    if (!error) updatedAcquisition += part.length;
  }

  return { updatedRetention, updatedAcquisition, adsScanned };
}
