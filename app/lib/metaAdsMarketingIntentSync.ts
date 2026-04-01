import type { SupabaseClient } from "@supabase/supabase-js";
import { applyMetaMarketingIntentForAdAccount, metaAdPayloadIntent } from "@/app/lib/campaignMarketingIntent";
import { fetchMetaGraphGetJsonWithRetry } from "@/app/lib/metaGraphRetry";

/** P1 meta intent sync: fewer retries per page to avoid long "retry storms" on rate limits. */
const META_INTENT_GRAPH_MAX_ATTEMPTS = 2;

/** Max /ads pages per HTTP invocation; if more data exists, return incomplete_scan (no DB apply). */
const META_INTENT_MAX_PAGES_PER_RUN = 3;

/** Pause between successful page fetches to reduce burst against ad-account limits (ms). */
const META_INTENT_INTER_PAGE_SLEEP_MS = 350;

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

function isMetaRateLimitMessage(message: string | undefined): boolean {
  if (!message) return false;
  const m = message.toLowerCase();
  return (
    /too many calls/.test(m) ||
    /rate limit/.test(m) ||
    /#80004|#80007|#80008/.test(m)
  );
}

async function fbGetJson(url: string) {
  const res = await fetchMetaGraphGetJsonWithRetry(url, { maxAttempts: META_INTENT_GRAPH_MAX_ATTEMPTS });
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

export type MetaMarketingIntentSyncCode = "incomplete_scan" | "rate_limited";

export type SyncMetaMarketingIntentFromAdsApiResult = {
  success: boolean;
  ads_scanned: number;
  retention_campaign_ids: number;
  updated_retention: number;
  updated_acquisition: number;
  error?: string;
  code?: MetaMarketingIntentSyncCode;
  has_more?: boolean;
  pages_fetched?: number;
};

/**
 * Paginate Meta /ads for an ad account; classify campaigns by retention marker in url_tags / creative JSON.
 */
export async function syncMetaMarketingIntentFromAdsApi(
  accessToken: string,
  adAccountId: string,
  admin: SupabaseClient,
  projectId: string
): Promise<SyncMetaMarketingIntentFromAdsApiResult> {
  const t0 = Date.now();
  const accountPath = adAccountId.startsWith("act_") ? adAccountId : `act_${adAccountId}`;
  const fields = "campaign_id,url_tags,creative{object_story_spec,link_url,asset_feed_spec}";

  const retentionCampaigns = new Set<string>();
  const acquisitionCampaigns = new Set<string>();
  let adsScanned = 0;
  let pagesFetched = 0;
  let nextUrl: string | null =
    `https://graph.facebook.com/v19.0/${accountPath}/ads?` +
    new URLSearchParams({
      fields,
      // Large nested creatives: start small; fbGetJsonWithAdaptiveLimit lowers further if Meta complains.
      limit: "25",
      access_token: accessToken,
    }).toString();

  while (nextUrl) {
    const pageStart = Date.now();
    const json = (await fbGetJsonWithAdaptiveLimit(nextUrl)) as {
      error?: { message?: string };
      data?: MetaAdRow[];
      paging?: { next?: string };
    };
    pagesFetched += 1;
    if (json?.error) {
      const errMsg = json.error?.message ?? JSON.stringify(json.error);
      const rateLimited = isMetaRateLimitMessage(json.error?.message);
      console.log("[META_INTENT_SYNC] step: campaigns_loaded", {
        ms: Date.now() - t0,
        pagesFetched,
        ads_scanned: adsScanned,
        retention_campaign_ids: retentionCampaigns.size,
        error: errMsg,
        code: rateLimited ? "rate_limited" : undefined,
      });
      return {
        success: false,
        ads_scanned: adsScanned,
        retention_campaign_ids: retentionCampaigns.size,
        updated_retention: 0,
        updated_acquisition: 0,
        error: errMsg,
        code: rateLimited ? "rate_limited" : undefined,
        pages_fetched: pagesFetched,
      };
    }
    const list: MetaAdRow[] = Array.isArray(json?.data) ? json.data : [];
    console.log("[META_INTENT_SYNC] page", {
      page: pagesFetched,
      pageMs: Date.now() - pageStart,
      rows: list.length,
    });
    for (const ad of list) {
      adsScanned += 1;
      const cid = ad.campaign_id != null ? String(ad.campaign_id) : "";
      if (!cid) continue;
      const intent = metaAdPayloadIntent(ad);
      if (intent === "retention") retentionCampaigns.add(cid);
      else if (intent === "acquisition") acquisitionCampaigns.add(cid);
    }
    const next = json?.paging?.next;
    const hasMore = typeof next === "string" && next.length > 0;

    if (hasMore && pagesFetched >= META_INTENT_MAX_PAGES_PER_RUN) {
      console.log("[META_INTENT_SYNC] incomplete_scan", {
        project_id: projectId,
        ad_account_id: adAccountId,
        pages_fetched: pagesFetched,
        ads_scanned: adsScanned,
      });
      return {
        success: false,
        code: "incomplete_scan",
        ads_scanned: adsScanned,
        retention_campaign_ids: retentionCampaigns.size,
        updated_retention: 0,
        updated_acquisition: 0,
        error: "Partial ads scan: more pages available; retry to continue.",
        has_more: true,
        pages_fetched: pagesFetched,
      };
    }

    if (hasMore) {
      await sleep(META_INTENT_INTER_PAGE_SLEEP_MS);
      nextUrl = next;
    } else {
      nextUrl = null;
    }
  }
  console.log("[META_INTENT_SYNC] step: campaigns_loaded", {
    ms: Date.now() - t0,
    pagesFetched,
    ads_scanned: adsScanned,
    retention_campaign_ids: retentionCampaigns.size,
  });

  const tDbStart = Date.now();
  const apply = await applyMetaMarketingIntentForAdAccount(
    admin,
    projectId,
    adAccountId,
    retentionCampaigns,
    acquisitionCampaigns
  );
  console.log("[META_INTENT_SYNC] step: db_write_done", {
    ms: Date.now() - tDbStart,
    updated_retention: apply.updatedRetention,
    updated_acquisition: apply.updatedAcquisition,
  });

  return {
    success: true,
    ads_scanned: adsScanned,
    retention_campaign_ids: retentionCampaigns.size,
    updated_retention: apply.updatedRetention,
    updated_acquisition: apply.updatedAcquisition,
  };
}
