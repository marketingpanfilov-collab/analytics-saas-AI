import type { SupabaseClient } from "@supabase/supabase-js";
import { applyMetaMarketingIntentForAdAccount, metaAdPayloadIntent } from "@/app/lib/campaignMarketingIntent";
import { fetchMetaGraphGetJsonWithRetry } from "@/app/lib/metaGraphRetry";

async function fbGetJson(url: string) {
  const res = await fetchMetaGraphGetJsonWithRetry(url);
  if (!res.ok) {
    const body = res.json as { error?: { message?: string; code?: number } };
    if (body && typeof body === "object" && body.error) {
      return body;
    }
    return { error: { message: `Graph request failed (http ${res.httpStatus})` } };
  }
  return res.json;
}

function isReduceAmountOfDataError(json: unknown): boolean {
  const msg = (json as { error?: { message?: string } })?.error?.message ?? "";
  return /reduce the amount of data/i.test(String(msg));
}

/** Meta returns "reduce the amount of data" when page size × nested creative is too large. */
async function fbGetJsonWithAdaptiveLimit(url: string): Promise<unknown> {
  const retryLimits = [15, 10, 5];
  const u = new URL(url);
  let json = await fbGetJson(u.toString());

  for (const lim of retryLimits) {
    if (!json || typeof json !== "object") return json;
    if (!("error" in json)) return json;
    if (!isReduceAmountOfDataError(json)) return json;
    u.searchParams.set("limit", String(lim));
    json = await fbGetJson(u.toString());
  }
  return json;
}

type MetaAdRow = {
  campaign_id?: string;
  url_tags?: string | null;
  creative?: Record<string, unknown> | null;
};

/**
 * Paginate Meta /ads for an ad account; classify campaigns by retention marker in url_tags / creative JSON.
 */
export async function syncMetaMarketingIntentFromAdsApi(
  accessToken: string,
  adAccountId: string,
  admin: SupabaseClient,
  projectId: string
): Promise<{
  success: boolean;
  ads_scanned: number;
  retention_campaign_ids: number;
  updated_retention: number;
  updated_acquisition: number;
  error?: string;
}> {
  const accountPath = adAccountId.startsWith("act_") ? adAccountId : `act_${adAccountId}`;
  const fields = "campaign_id,url_tags,creative{object_story_spec,link_url,asset_feed_spec}";

  const retentionCampaigns = new Set<string>();
  const acquisitionCampaigns = new Set<string>();
  let adsScanned = 0;
  let nextUrl: string | null =
    `https://graph.facebook.com/v19.0/${accountPath}/ads?` +
    new URLSearchParams({
      fields,
      // Large nested creatives: start small; fbGetJsonWithAdaptiveLimit lowers further if Meta complains.
      limit: "25",
      access_token: accessToken,
    }).toString();

  while (nextUrl) {
    const json = (await fbGetJsonWithAdaptiveLimit(nextUrl)) as {
      error?: { message?: string };
      data?: MetaAdRow[];
      paging?: { next?: string };
    };
    if (json?.error) {
      return {
        success: false,
        ads_scanned: adsScanned,
        retention_campaign_ids: retentionCampaigns.size,
        updated_retention: 0,
        updated_acquisition: 0,
        error: json.error?.message ?? JSON.stringify(json.error),
      };
    }
    const list: MetaAdRow[] = Array.isArray(json?.data) ? json.data : [];
    for (const ad of list) {
      adsScanned += 1;
      const cid = ad.campaign_id != null ? String(ad.campaign_id) : "";
      if (!cid) continue;
      const intent = metaAdPayloadIntent(ad);
      if (intent === "retention") retentionCampaigns.add(cid);
      else if (intent === "acquisition") acquisitionCampaigns.add(cid);
    }
    const next = json?.paging?.next;
    nextUrl = typeof next === "string" && next.length > 0 ? next : null;
  }

  const apply = await applyMetaMarketingIntentForAdAccount(
    admin,
    projectId,
    adAccountId,
    retentionCampaigns,
    acquisitionCampaigns
  );

  return {
    success: true,
    ads_scanned: adsScanned,
    retention_campaign_ids: retentionCampaigns.size,
    updated_retention: apply.updatedRetention,
    updated_acquisition: apply.updatedAcquisition,
  };
}
