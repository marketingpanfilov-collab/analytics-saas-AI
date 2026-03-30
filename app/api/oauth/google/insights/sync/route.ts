/**
 * GET /api/oauth/google/insights/sync
 *
 * Google Ads metrics sync: account-level + campaign-level into shared daily_ad_metrics.
 *
 * Account-level: GAQL FROM customer, segments.date, metrics (cost_micros, impressions, clicks).
 * Campaign-level: GAQL FROM campaign, campaign.id, campaign.name, segments.date, same metrics.
 * Campaign identity: shared campaigns table with external_campaign_id (per ad_account_id).
 * Uniqueness: account-level (ad_account_id, date) WHERE campaign_id IS NULL; campaign-level
 * (ad_account_id, campaign_id, date). Delete-then-insert per range. sync_runs: running -> ok/error, meta.
 *
 * campaigns.marketing_intent (retention vs acquisition for LTV spend): Meta is filled from ad/creative URL sync.
 * Google: phase 2 — derive from ad final URLs when this pipeline fetches ad_group_ad (reuse detectRetentionInSnippet).
 */
import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/app/lib/supabaseAdmin";
import { getGoogleAccessTokenForApi } from "@/app/lib/googleAdsAuth";
import { withSyncLock } from "@/app/lib/syncLock";
import { datesInRange } from "@/app/lib/dashboardBackfill";
import { requireProjectAccessOrInternal } from "@/app/lib/auth/requireProjectAccessOrInternal";
import { startSyncRun, finishSyncRunSuccess, finishSyncRunError } from "@/app/lib/syncRuns";
import { runPostSyncInvariantChecks } from "@/app/lib/postSyncInvariantChecks";

function isUuid(v: string) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(v);
}

function isYmd(v: string) {
  return /^\d{4}-\d{2}-\d{2}$/.test(v);
}

/** Google Ads customer id: digits optionally with hyphen (e.g. 1234567890 or 123-456-7890). */
function isGoogleCustomerId(v: string) {
  return /^\d+(-?\d*)$/.test(String(v).trim());
}

class GoogleAdsApiRequestError extends Error {
  readonly httpStatus: number;
  readonly googleStatus?: string;

  constructor(message: string, httpStatus: number, googleStatus?: string) {
    super(message);
    this.name = "GoogleAdsApiRequestError";
    this.httpStatus = httpStatus;
    this.googleStatus = googleStatus;
  }
}

function isGoogleAdsAuthFailure(e: unknown): boolean {
  if (e instanceof GoogleAdsApiRequestError) {
    if (e.httpStatus === 401) return true;
    const s = String(e.googleStatus ?? "").toUpperCase();
    if (s === "UNAUTHENTICATED") return true;
    const m = e.message.toUpperCase();
    return (
      m.includes("UNAUTHENTICATED") ||
      m.includes("INVALID_GRANT") ||
      (m.includes("OAUTH") && m.includes("TOKEN"))
    );
  }
  return false;
}

function isGoogleAdsTransientFailure(e: unknown): boolean {
  if (e instanceof GoogleAdsApiRequestError) {
    if (e.httpStatus === 429 || (e.httpStatus >= 500 && e.httpStatus <= 599) || e.httpStatus === 408) return true;
    const s = String(e.googleStatus ?? "").toUpperCase();
    return ["RESOURCE_EXHAUSTED", "UNAVAILABLE", "INTERNAL", "DEADLINE_EXCEEDED"].includes(s);
  }
  return false;
}

async function googleAdsSearch<T>(
  customerId: string,
  accessToken: string,
  developerToken: string,
  query: string
): Promise<T[]> {
  const url = `https://googleads.googleapis.com/v20/customers/${customerId}/googleAds:search`;
  const rows: T[] = [];
  let pageToken: string | undefined;
  do {
    const body: { query: string; pageToken?: string } = { query };
    if (pageToken) body.pageToken = pageToken;
    const res = await fetch(url, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "developer-token": developerToken,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
    });
    const data = (await res.json().catch(() => ({}))) as {
      results?: unknown[];
      nextPageToken?: string;
      error?: { message?: string; status?: string };
    };
    if (!res.ok) {
      const err = data?.error;
      throw new GoogleAdsApiRequestError(
        err?.message ?? `Google Ads API: ${res.status}`,
        res.status,
        err?.status
      );
    }
    if (Array.isArray(data.results)) rows.push(...(data.results as T[]));
    pageToken = data.nextPageToken;
  } while (pageToken);
  return rows;
}

async function googleAdsSearchWithOptionalTokenHeal<T>(
  admin: ReturnType<typeof supabaseAdmin>,
  integrationId: string,
  tokenRef: { access_token: string },
  customerId: string,
  developerToken: string,
  query: string
): Promise<T[]> {
  try {
    return await googleAdsSearch<T>(customerId, tokenRef.access_token, developerToken, query);
  } catch (e) {
    if (!isGoogleAdsAuthFailure(e)) throw e;
    const gr2 = await getGoogleAccessTokenForApi(admin, integrationId, { forceRefresh: true });
    if (!gr2.ok) throw e;
    tokenRef.access_token = gr2.access_token;
    return googleAdsSearch<T>(customerId, tokenRef.access_token, developerToken, query);
  }
}

async function syncRunErrorAndReturn(
  admin: ReturnType<typeof supabaseAdmin>,
  runId: string | null,
  errorMessage: string,
  meta: Record<string, unknown> | null,
  body: object,
  status: number
) {
  await finishSyncRunError(admin, runId, errorMessage, meta);
  return NextResponse.json(body, { status: status as 400 | 404 | 500 | 503 });
}

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const projectIdRaw = searchParams.get("project_id") ?? "";
  const adAccountIdRaw = searchParams.get("ad_account_id") ?? "";
  const dateStartParam = searchParams.get("date_start");
  const dateEndParam = searchParams.get("date_end");

  if (!projectIdRaw || !adAccountIdRaw) {
    console.log("[GOOGLE_SYNC_400_MISSING_PARAMS]", { project_id: projectIdRaw || null, ad_account_id: adAccountIdRaw || null });
    return NextResponse.json(
      { success: false, error: "project_id and ad_account_id are required" },
      { status: 400 }
    );
  }
  if (!isUuid(projectIdRaw)) {
    console.log("[GOOGLE_SYNC_400_INVALID_PROJECT]", { project_id: projectIdRaw });
    return NextResponse.json(
      { success: false, error: "project_id must be a valid UUID" },
      { status: 400 }
    );
  }
  if (!isGoogleCustomerId(adAccountIdRaw)) {
    console.log("[GOOGLE_SYNC_400_INVALID_AD_ACCOUNT]", { ad_account_id: adAccountIdRaw });
    return NextResponse.json(
      { success: false, error: "ad_account_id must be a Google Ads customer id (numeric)" },
      { status: 400 }
    );
  }
  if (dateStartParam && !isYmd(dateStartParam)) {
    console.log("[GOOGLE_SYNC_400_INVALID_DATE_START]", { date_start: dateStartParam });
    return NextResponse.json(
      { success: false, error: "date_start must be YYYY-MM-DD" },
      { status: 400 }
    );
  }
  if (dateEndParam && !isYmd(dateEndParam)) {
    console.log("[GOOGLE_SYNC_400_INVALID_DATE_END]", { date_end: dateEndParam });
    return NextResponse.json(
      { success: false, error: "date_end must be YYYY-MM-DD" },
      { status: 400 }
    );
  }

  const projectId = projectIdRaw;
  const externalAccountId = String(adAccountIdRaw).trim();

  const access = await requireProjectAccessOrInternal(req, projectId, { allowInternalBypass: true });
  if (!access.allowed) {
    console.log("[GOOGLE_SYNC_ACCESS_DENIED]", { projectId, status: access.status });
    return NextResponse.json(access.body, { status: access.status });
  }

  const admin = supabaseAdmin();

  const developerToken = process.env.GOOGLE_ADS_DEVELOPER_TOKEN;
  if (!developerToken) {
    console.log("[GOOGLE_SYNC_500_NO_DEVELOPER_TOKEN]", { projectId, ad_account_id: externalAccountId });
    return NextResponse.json(
      { success: false, error: "GOOGLE_ADS_DEVELOPER_TOKEN not set" },
      { status: 500 }
    );
  }

  const { data: integration, error: intErr } = await admin
    .from("integrations")
    .select("id")
    .eq("project_id", projectId)
    .eq("platform", "google")
    .maybeSingle();

  if (intErr || !integration?.id) {
    console.log("[GOOGLE_SYNC_404_NO_INTEGRATION]", {
      projectId,
      ad_account_id: externalAccountId,
      integration_error: intErr?.message ?? intErr,
      integration_id: integration?.id ?? null,
    });
    return NextResponse.json(
      { success: false, error: "Google integration not found; connect Google OAuth first" },
      { status: 404 }
    );
  }

  const gr = await getGoogleAccessTokenForApi(admin, integration.id);
  const hasValidToken = gr.ok;

  const { data: adAcc, error: adErr } = await admin
    .from("ad_accounts")
    .select("id")
    .eq("integration_id", integration.id)
    .eq("external_account_id", externalAccountId)
    .maybeSingle();

  const resolvedCanonicalId = adAcc?.id ?? null;
  const customerIdValid = /^\d+(-?\d*)$/.test(String(externalAccountId).trim());

  console.log("[GOOGLE_SYNC_RESOLVED]", {
    projectId,
    ad_account_id_external: externalAccountId,
    resolved_integration_id: integration.id,
    resolved_canonical_ad_account_id: resolvedCanonicalId,
    valid_access_token: hasValidToken,
    ad_account_row_exists: !!adAcc?.id,
    customer_id_format_valid: customerIdValid,
  });

  if (!gr.ok) {
    if (gr.kind === "transient") {
      return NextResponse.json(
        {
          success: false,
          error: "Google token refresh temporarily failed; retry shortly",
          retryable: true,
        },
        { status: 503 }
      );
    }
    console.log("[GOOGLE_SYNC_401_NO_TOKEN]", {
      projectId,
      ad_account_id: externalAccountId,
      resolved_integration_id: integration.id,
    });
    return NextResponse.json(
      { success: false, error: "Google auth token not found or expired; reconnect Google OAuth" },
      { status: 401 }
    );
  }

  const tokenRef = { access_token: gr.access_token };

  if (adErr || !adAcc?.id) {
    console.log("[GOOGLE_SYNC_404_NO_AD_ACCOUNT]", {
      projectId,
      ad_account_id: externalAccountId,
      resolved_integration_id: integration.id,
      ad_account_error: adErr?.message ?? adErr,
    });
    return NextResponse.json(
      { success: false, error: "Google ad account not found; run account discovery and selection first" },
      { status: 404 }
    );
  }

  const canonicalAdAccountId = adAcc.id as string;

  const now = new Date();
  const ymd = (d: Date) => d.toISOString().slice(0, 10);
  const defaultStart = new Date(now);
  defaultStart.setDate(1);
  const since = dateStartParam ?? ymd(defaultStart);
  const until = dateEndParam ?? ymd(now);

  if (since > until) {
    console.log("[GOOGLE_SYNC_400_DATE_RANGE]", { projectId, ad_account_id: externalAccountId, since, until });
    return NextResponse.json(
      { success: false, error: "date_start must be <= date_end", period: { since, until } },
      { status: 400 }
    );
  }

  return withSyncLock("google", externalAccountId, since, until, "insights", async () => {
  const { id: syncRunId, alreadyRunning } = await startSyncRun(admin, {
    projectId,
    platform: "google",
    adAccountId: canonicalAdAccountId,
    syncType: "insights",
    dateStart: since,
    dateEnd: until,
    metadata: {},
  });
  if (alreadyRunning) {
    console.log("[GOOGLE_SYNC_SKIP_LOCKED]", {
      platform: "google",
      adAccountId: canonicalAdAccountId,
      since,
      until,
    });
    return NextResponse.json({
      success: true,
      skipped: true,
      reason: "already_running",
    });
  }

  type GoogleRow = {
    segments?: { date?: string };
    metrics?: { costMicros?: string; impressions?: number; clicks?: number };
  };

  const query = `SELECT segments.date, metrics.cost_micros, metrics.impressions, metrics.clicks FROM customer WHERE segments.date BETWEEN '${since}' AND '${until}'`;
  let rows: GoogleRow[];
  try {
    rows = await googleAdsSearchWithOptionalTokenHeal<GoogleRow>(
      admin,
      integration.id,
      tokenRef,
      externalAccountId,
      developerToken,
      query
    );
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    const stack = e instanceof Error ? e.stack : undefined;
    const transient = isGoogleAdsTransientFailure(e);
    console.log(transient ? "[GOOGLE_SYNC_503_ADS_FETCH]" : "[GOOGLE_SYNC_400_ADS_FETCH]", {
      projectId,
      ad_account_id: externalAccountId,
      message: msg,
      stack: stack ?? null,
      period: { since, until },
    });
    const body = {
      success: false,
      step: "google_ads_fetch",
      error: msg,
      period: { since, until },
      ...(transient ? { retryable: true } : {}),
    };
    return syncRunErrorAndReturn(
      admin,
      syncRunId,
      "google_ads_fetch",
      { error: msg, period: { since, until } },
      body,
      transient ? 503 : 400
    );
  }

  const toNum = (v: unknown): number => (v != null && v !== "" ? Number(v) : 0);
  /** Google Ads API may return camelCase or snake_case in JSON; support both. */
  const costMicrosFrom = (m: { costMicros?: unknown; cost_micros?: unknown } | undefined): number =>
    toNum(m?.costMicros ?? (m as { cost_micros?: unknown } | undefined)?.cost_micros ?? 0);
  const impressionsFrom = (m: { impressions?: unknown } | undefined): number => toNum(m?.impressions ?? 0);
  const clicksFrom = (m: { clicks?: unknown } | undefined): number => toNum(m?.clicks ?? 0);

  console.log("[GOOGLE_SYNC_ACCOUNT_QUERY]", {
    query,
    since,
    until,
    customer_id: externalAccountId,
  });
  console.log("[GOOGLE_SYNC_ACCOUNT_RAW]", {
    raw_row_count: rows.length,
    first_row_top_level_keys: rows[0] ? Object.keys(rows[0]) : [],
    sample_first_row: rows[0]
      ? {
          has_segments: !!rows[0].segments,
          segments_date: rows[0].segments?.date ?? null,
          has_metrics: !!rows[0].metrics,
          metrics_keys: rows[0].metrics ? Object.keys(rows[0].metrics) : [],
        }
      : null,
  });

  const metricsRows = rows
    .filter((r) => r?.segments?.date)
    .map((r) => {
      const date = String(r.segments!.date!).slice(0, 10);
      const costMicros = costMicrosFrom(r.metrics);
      return {
        project_id: projectId,
        ad_account_id: canonicalAdAccountId,
        campaign_id: null as string | null,
        date,
        platform: "google" as const,
        spend: costMicros / 1_000_000,
        impressions: toNum(r.metrics?.impressions ?? 0),
        clicks: toNum(r.metrics?.clicks ?? 0),
        reach: 0,
        cpm: 0,
        cpc: 0,
        ctr: 0,
        leads: 0,
        purchases: 0,
        revenue: 0,
        roas: 0,
      };
    });

  console.log("[GOOGLE_SYNC_ACCOUNT_MAPPED]", {
    metrics_rows_length: metricsRows.length,
    dates: [...new Set(metricsRows.map((r) => r.date))].slice(0, 10),
  });

  let accountRowsWritten = 0;
  if (metricsRows.length > 0) {
    const dates = [...new Set(metricsRows.map((r) => r.date))];
    const { error: delErr } = await admin
      .from("daily_ad_metrics")
      .delete()
      .eq("ad_account_id", canonicalAdAccountId)
      .is("campaign_id", null)
      .in("date", dates);

    if (delErr) {
      console.log("[GOOGLE_SYNC_500_DAILY_METRICS_DELETE_ACCOUNT]", {
        projectId,
        canonical_ad_account_id: canonicalAdAccountId,
        error: delErr?.message ?? delErr,
      });
      const body = {
        success: false,
        step: "daily_ad_metrics_delete_account",
        error: delErr?.message ?? delErr,
        period: { since, until },
      };
      return syncRunErrorAndReturn(admin, syncRunId, "daily_ad_metrics_delete_account", { period: { since, until } }, body, 500);
    }

    const { error: insErr } = await admin.from("daily_ad_metrics").insert(metricsRows);
    if (insErr) {
      console.log("[GOOGLE_SYNC_500_DAILY_METRICS_INSERT_ACCOUNT]", {
        projectId,
        canonical_ad_account_id: canonicalAdAccountId,
        error: insErr?.message ?? insErr,
        rows: metricsRows.length,
      });
      const body = {
        success: false,
        step: "daily_ad_metrics_insert_account",
        error: insErr?.message ?? insErr,
        rows: metricsRows.length,
        period: { since, until },
      };
      return syncRunErrorAndReturn(admin, syncRunId, "daily_ad_metrics_insert_account", { rows: metricsRows.length }, body, 500);
    }
    accountRowsWritten = metricsRows.length;
  }

  // Zero-fill: days in [since, until] with no API data → account-level zero rows (coverage, no endless backfill)
  let zeroDaysInserted = 0;
  if (canonicalAdAccountId) {
    const allDates = datesInRange(since, until);
    const datesFromApi = new Set(metricsRows.map((r) => r.date));
    const { data: existingRows } = await admin
      .from("daily_ad_metrics")
      .select("date")
      .eq("ad_account_id", canonicalAdAccountId)
      .is("campaign_id", null)
      .gte("date", since)
      .lte("date", until);
    const existingDates = new Set((existingRows ?? []).map((r: { date: string }) => r.date));
    const zeroDates = allDates.filter((d) => !datesFromApi.has(d) && !existingDates.has(d));
    console.log("[GOOGLE_SYNC_ZERO_FILL]", {
      since,
      until,
      all_dates_count: allDates.length,
      dates_from_api_count: datesFromApi.size,
      existing_dates_count: existingDates.size,
      zero_dates_to_insert: zeroDates.length,
    });
    if (zeroDates.length > 0) {
      const zeroRows = zeroDates.map((date) => ({
        project_id: projectId,
        ad_account_id: canonicalAdAccountId,
        campaign_id: null as string | null,
        date,
        platform: "google" as const,
        spend: 0,
        impressions: 0,
        clicks: 0,
        reach: 0,
        cpm: 0,
        cpc: 0,
        ctr: 0,
        leads: 0,
        purchases: 0,
        revenue: 0,
        roas: 0,
      }));
      const { error: zeroErr } = await admin.from("daily_ad_metrics").insert(zeroRows);
      if (zeroErr) {
        console.log("[GOOGLE_SYNC_500_DAILY_METRICS_INSERT_ZERO_DAYS]", {
          projectId,
          canonical_ad_account_id: canonicalAdAccountId,
          error: zeroErr?.message ?? zeroErr,
          zero_rows: zeroRows.length,
        });
        const body = {
          success: false,
          step: "daily_ad_metrics_insert_zero_days",
          error: zeroErr?.message ?? zeroErr,
          zero_rows: zeroRows.length,
          period: { since, until },
        };
        return syncRunErrorAndReturn(admin, syncRunId, "daily_ad_metrics_insert_zero_days", { zero_rows: zeroRows.length }, body, 500);
      }
      zeroDaysInserted = zeroRows.length;
      console.log("[GOOGLE_INSIGHTS_SYNC]", {
        account_rows_from_api: accountRowsWritten,
        zero_days_inserted: zeroDaysInserted,
        total_account_level: accountRowsWritten + zeroDaysInserted,
        period: { since, until },
        ad_account_id: canonicalAdAccountId,
      });
    }
  }

  let campaignRowsWritten = 0;
  let campaignsSeen = 0;

  type CampaignRow = {
    campaign?: { id?: string | number; name?: string; resourceName?: string };
    segments?: { date?: string };
    metrics?: { costMicros?: string; impressions?: number; clicks?: number };
  };
  const campaignQuery = `SELECT campaign.id, campaign.name, campaign.resource_name, segments.date, metrics.cost_micros, metrics.impressions, metrics.clicks FROM campaign WHERE segments.date BETWEEN '${since}' AND '${until}'`;
  console.log("[GOOGLE_SYNC_CAMPAIGN_QUERY]", {
    query: campaignQuery,
    since,
    until,
    customer_id: externalAccountId,
  });
  let campaignRows: CampaignRow[];
  try {
    campaignRows = await googleAdsSearchWithOptionalTokenHeal<CampaignRow>(
      admin,
      integration.id,
      tokenRef,
      externalAccountId,
      developerToken,
      campaignQuery
    );
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    const stack = e instanceof Error ? e.stack : undefined;
    const transient = isGoogleAdsTransientFailure(e);
    console.log(transient ? "[GOOGLE_SYNC_503_CAMPAIGN_FETCH]" : "[GOOGLE_SYNC_400_CAMPAIGN_FETCH]", {
      projectId,
      ad_account_id: externalAccountId,
      message: msg,
      stack: stack ?? null,
      period: { since, until },
    });
    const body = {
      success: false,
      step: "google_ads_campaign_fetch",
      error: msg,
      period: { since, until },
      ...(transient ? { retryable: true } : {}),
    };
    return syncRunErrorAndReturn(
      admin,
      syncRunId,
      "google_ads_campaign_fetch",
      { error: msg, period: { since, until } },
      body,
      transient ? 503 : 400
    );
  }

  /** Resolve and normalize campaign external id: trim; empty string -> null. One external id -> one canonical internal id. */
  const getCampaignExternalId = (r: CampaignRow): string | null => {
    const c = r?.campaign;
    if (!c) return null;
    let raw: string | null = null;
    const id = c.id;
    if (id != null && id !== "") raw = String(id);
    else {
      const rn = (c as { resourceName?: string }).resourceName;
      if (typeof rn === "string" && rn.includes("/campaigns/")) {
        const part = rn.split("/campaigns/").pop();
        if (part) raw = part.split("/")[0]?.trim() || null;
      }
    }
    const normalized = raw?.trim() || "";
    return normalized === "" ? null : normalized;
  };

  const rawUniqueDates = new Set<string>();
  const rawUniqueCampaignIds = new Set<string>();
  for (const r of campaignRows) {
    const id = getCampaignExternalId(r);
    if (id) rawUniqueCampaignIds.add(id);
    const d = r?.segments?.date ? String(r.segments.date).slice(0, 10) : null;
    if (d) rawUniqueDates.add(d);
  }

  console.log("[GOOGLE_SYNC_CAMPAIGN_RAW]", {
    campaign_raw_row_count: campaignRows.length,
    unique_campaign_ids_from_api: rawUniqueCampaignIds.size,
    unique_dates_from_api: rawUniqueDates.size,
    first_row_top_level_keys: campaignRows[0] ? Object.keys(campaignRows[0]) : [],
    sample_first: campaignRows[0]
      ? {
          campaign_id: getCampaignExternalId(campaignRows[0]),
          campaign_resourceName: (campaignRows[0].campaign as { resourceName?: string })?.resourceName ?? null,
          campaign_name: campaignRows[0].campaign?.name ?? null,
          segments_date: campaignRows[0].segments?.date ?? null,
          has_metrics: !!campaignRows[0].metrics,
        }
      : null,
  });

  const campaignIdToName = new Map<string, string>();
  for (const r of campaignRows) {
    const id = getCampaignExternalId(r);
    if (id != null) campaignIdToName.set(id, r.campaign?.name ?? id);
  }
  campaignsSeen = campaignIdToName.size;
  const normalizedExternalIds = Array.from(campaignIdToName.keys());
  if (campaignRows.length > 0 && campaignIdToName.size === 0) {
    console.log("[GOOGLE_SYNC_CAMPAIGN_NO_IDS]", {
      campaign_raw_count: campaignRows.length,
      reason: "campaign.id/resourceName missing in all rows; check API response structure",
      sample_campaign_keys: campaignRows[0]?.campaign ? Object.keys(campaignRows[0].campaign) : [],
    });
  }

  if (campaignIdToName.size > 0) {
    if (!canonicalAdAccountId) {
      // We have campaigns from Google API but no canonical ad_accounts.id; skip campaigns safely.
      console.warn("[GOOGLE_CAMPAIGN_SKIPPED_NO_ACCOUNT]", {
        campaignIds: Array.from(campaignIdToName.keys()),
      });
      // Do not attempt to upsert into campaigns or write campaign-level metrics when ad_accounts_id would be NULL.
    } else {
    console.log("[GOOGLE_SYNC_CAMPAIGN_PIPELINE]", {
      step: "after_getCampaignExternalId",
      raw_rows: campaignRows.length,
      unique_campaign_ids: campaignIdToName.size,
      unique_dates: rawUniqueDates.size,
      normalized_external_ids: normalizedExternalIds.slice(0, 10),
    });
    const campaignUpsertRows = Array.from(campaignIdToName.entries())
      .map(([extId, name]) => ({
        project_id: projectId,
        ad_accounts_id: canonicalAdAccountId,
        external_campaign_id: extId,
        name: name || extId,
        platform: "google" as const,
      }))
      .filter((row) => {
        if (!row.ad_accounts_id) {
          console.warn("[CAMPAIGN_SKIP_NO_AD_ACCOUNT]", {
            campaignId: row.external_campaign_id,
            platform: "google",
          });
          return false;
        }
        return true;
      });
    const { error: campErr } = await admin
      .from("campaigns")
      .upsert(campaignUpsertRows, { onConflict: "ad_accounts_id,external_campaign_id" });
    if (campErr) {
      console.warn("[GOOGLE_SYNC_CAMPAIGNS_UPSERT_NON_FATAL]", {
        projectId,
        ad_account_id: externalAccountId,
        error: campErr?.message ?? campErr,
        period: { since, until },
        hint: "Ensure migration 20250602000000 (UNIQUE ad_accounts_id, external_campaign_id) is applied.",
      });
      // Non-fatal: account-level + zero-fill already saved; skip campaign-level for this run
    } else {
    const { data: campaignList } = await admin
      .from("campaigns")
      .select("id, external_campaign_id")
      .eq("ad_accounts_id", canonicalAdAccountId)
      .eq("platform", "google");
    const externalToCampaignId = new Map<string, string>();
    const returnedExternalIds: string[] = [];
    const list = (campaignList ?? []) as { id: string; external_campaign_id: string }[];
    list.sort((a, b) => a.id.localeCompare(b.id));
    for (const c of list) {
      const raw = c.external_campaign_id != null ? String(c.external_campaign_id).trim() : "";
      if (raw !== "") {
        if (!externalToCampaignId.has(raw)) externalToCampaignId.set(raw, c.id);
        returnedExternalIds.push(raw);
      }
    }

    console.log("[GOOGLE_SYNC_CAMPAIGN_PIPELINE]", {
      step: "after_upsert_select",
      campaign_list_length: (campaignList ?? []).length,
      external_to_campaign_id_size: externalToCampaignId.size,
      sample_external_ids_returned_from_db: returnedExternalIds.slice(0, 5),
      id_format_match: normalizedExternalIds.length > 0 && returnedExternalIds.length > 0
        ? externalToCampaignId.has(normalizedExternalIds[0])
        : null,
    });

    const rowsWithCampaignId = campaignRows.filter((r) => getCampaignExternalId(r) != null).length;
    const rowsWithDate = campaignRows.filter((r) => r?.segments?.date).length;
    const rowsWithBoth = campaignRows.filter(
      (r) => getCampaignExternalId(r) != null && r?.segments?.date
    ).length;
    const rowsInExternalMap = campaignRows.filter((r) => {
      const id = getCampaignExternalId(r);
      return id != null && externalToCampaignId.has(id);
    }).length;

    console.log("[GOOGLE_SYNC_CAMPAIGN_AFTER_UPSERT]", {
      campaign_list_length: (campaignList ?? []).length,
      external_to_campaign_id_size: externalToCampaignId.size,
      requested_external_ids: Array.from(campaignIdToName.keys()).length,
      rows_with_campaign_id: rowsWithCampaignId,
      rows_with_date: rowsWithDate,
      rows_with_both: rowsWithBoth,
      rows_in_external_map: rowsInExternalMap,
      drop_reason_after_upsert:
        campaignRows.length > 0 && rowsInExternalMap === 0
          ? (externalToCampaignId.size === 0
              ? "no_campaigns_in_db_after_upsert"
              : "api_campaign_ids_not_in_db_check_external_campaign_id_match")
          : null,
    });

    const campMetricsRows = campaignRows
      .filter((r) => {
        const id = getCampaignExternalId(r);
        return id != null && r?.segments?.date && externalToCampaignId.has(id);
      })
      .map((r) => {
        const date = String(r.segments!.date!).slice(0, 10);
        const extId = getCampaignExternalId(r)!;
        const cid = externalToCampaignId.get(extId)!;
        const costMicros = costMicrosFrom(r.metrics);
        return {
          project_id: projectId,
          ad_account_id: canonicalAdAccountId,
          campaign_id: cid,
          date,
          platform: "google" as const,
          spend: costMicros / 1_000_000,
          impressions: impressionsFrom(r.metrics),
          clicks: clicksFrom(r.metrics),
          reach: 0,
          cpm: 0,
          cpc: 0,
          ctr: 0,
          leads: 0,
          purchases: 0,
          revenue: 0,
          roas: 0,
        };
      });

    const mappedUniqueDates = new Set(campMetricsRows.map((r) => r.date));
    const mappedUniqueCampaignIds = new Set(campMetricsRows.map((r) => r.campaign_id));
    console.log("[GOOGLE_SYNC_CAMPAIGN_MAPPED]", {
      camp_metrics_rows_length: campMetricsRows.length,
      campaign_raw_rows: campaignRows.length,
      unique_campaign_ids_mapped: mappedUniqueCampaignIds.size,
      unique_dates_mapped: mappedUniqueDates.size,
      rows_prepared_for_insert: campMetricsRows.length,
      drop_reason:
        campaignRows.length > 0 && campMetricsRows.length === 0
          ? (externalToCampaignId.size === 0
              ? "no_campaigns_in_db_after_upsert"
              : "all_rows_filtered_by_externalToCampaignId_or_missing_date")
          : null,
    });

    if (campMetricsRows.length > 0) {
      const campIds = [...new Set(campMetricsRows.map((r) => r.campaign_id))];
      const dates = [...new Set(campMetricsRows.map((r) => r.date))];
      const minDate = dates.reduce((a, b) => (a < b ? a : b));
      const maxDate = dates.reduce((a, b) => (a > b ? a : b));
      const { error: delCampErr } = await admin
        .from("daily_ad_metrics")
        .delete()
        .eq("ad_account_id", canonicalAdAccountId)
        .in("campaign_id", campIds)
        .gte("date", minDate)
        .lte("date", maxDate);
        if (delCampErr) {
          console.warn("[GOOGLE_SYNC_DAILY_METRICS_DELETE_CAMPAIGN_NON_FATAL]", {
            projectId,
            error: delCampErr?.message ?? delCampErr,
            period: { since, until },
          });
        } else {
        const { error: insCampErr } = await admin.from("daily_ad_metrics").insert(campMetricsRows);
        if (insCampErr) {
          console.warn("[GOOGLE_SYNC_DAILY_METRICS_INSERT_CAMPAIGN_NON_FATAL]", {
            projectId,
            error: insCampErr?.message ?? insCampErr,
            rows_prepared: campMetricsRows.length,
            rows_actually_inserted: 0,
            period: { since, until },
          });
        } else {
          campaignRowsWritten = campMetricsRows.length;
          console.log("[GOOGLE_SYNC_CAMPAIGN_INSERT_OK]", {
            projectId,
            rows_prepared: campMetricsRows.length,
            rows_actually_inserted: campaignRowsWritten,
            unique_dates: mappedUniqueDates.size,
            unique_campaign_ids: mappedUniqueCampaignIds.size,
            period: { since, until },
          });
        }
        }
    }

    const exactDropReason =
      campaignRows.length > 0 && campaignRowsWritten === 0
        ? externalToCampaignId.size === 0
          ? "no_campaigns_in_db_after_upsert"
          : rowsInExternalMap === 0
            ? "api_campaign_ids_not_matched_in_db"
            : campMetricsRows.length === 0
              ? "all_rows_filtered_before_insert"
              : "insert_failed_or_skipped"
        : null;
    console.log("[GOOGLE_SYNC_CAMPAIGN_PIPELINE_END]", {
      projectId,
      period: { since, until },
      raw_rows_from_api: campaignRows.length,
      rows_after_getCampaignExternalId: rowsWithCampaignId,
      rows_in_externalToCampaignId_map: rowsInExternalMap,
      rows_prepared_for_insert: campMetricsRows.length,
      rows_actually_inserted: campaignRowsWritten,
      exact_drop_reason: exactDropReason,
    });
    }
  }
  }

  const totalRows = accountRowsWritten + zeroDaysInserted + campaignRowsWritten;
  const accountRowsInserted = accountRowsWritten + zeroDaysInserted;
  console.log("[GOOGLE_INSIGHTS_SYNC_RESULT]", {
    projectId,
    period: { since, until },
    account_rows_from_api: accountRowsWritten,
    zero_days_inserted: zeroDaysInserted,
    campaign_rows_written: campaignRowsWritten,
    campaigns_seen_from_api: campaignsSeen,
    total_rows: totalRows,
    ad_account_id: externalAccountId,
    note:
      campaignsSeen > 0 && campaignRowsWritten === 0
        ? "API returned campaigns but no campaign-level rows written; check GOOGLE_SYNC_CAMPAIGN_AFTER_UPSERT drop_reason and campaigns upsert."
        : undefined,
  });
  await finishSyncRunSuccess(admin, syncRunId, {
    rowsWritten: totalRows,
    rowsInserted: totalRows,
    campaignRowsInserted: campaignRowsWritten,
    accountRowsInserted,
    rowsDeleted: 0,
    meta: {
      since,
      until,
      account_rows_written: accountRowsInserted,
      campaign_rows_written: campaignRowsWritten,
      campaigns_seen: campaignsSeen,
      ad_account_id_external: externalAccountId,
    },
  });

  await runPostSyncInvariantChecks(admin, {
    projectId,
    adAccountId: canonicalAdAccountId,
    platform: "google",
    dateStart: since,
    dateEnd: until,
  });

  return NextResponse.json({
    success: true,
    saved: totalRows,
    account_rows: accountRowsWritten,
    zero_days_inserted: zeroDaysInserted,
    campaign_rows: campaignRowsWritten,
    campaigns_seen: campaignsSeen,
    period: { since, until },
    ad_account_id: externalAccountId,
    canonical_ad_account_id: canonicalAdAccountId,
  });
});
}
