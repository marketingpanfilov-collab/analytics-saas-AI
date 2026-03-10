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
 */
import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/app/lib/supabaseAdmin";

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
      error?: { message?: string };
    };
    if (!res.ok) throw new Error(data?.error?.message ?? `Google Ads API: ${res.status}`);
    if (Array.isArray(data.results)) rows.push(...(data.results as T[]));
    pageToken = data.nextPageToken;
  } while (pageToken);
  return rows;
}

async function updateSyncRun(
  admin: ReturnType<typeof supabaseAdmin>,
  runId: string | null,
  updates: {
    status: "ok" | "error";
    rows_written?: number;
    error_message?: string | null;
    meta?: Record<string, unknown> | null;
  }
) {
  if (!runId) return;
  const row: Record<string, unknown> = {
    status: updates.status,
    finished_at: new Date().toISOString(),
  };
  if (updates.rows_written != null) row.rows_written = updates.rows_written;
  if (updates.error_message != null) row.error_message = updates.error_message;
  if (updates.meta != null) row.meta = updates.meta;
  await admin.from("sync_runs").update(row).eq("id", runId);
}

function syncRunErrorAndReturn(
  admin: ReturnType<typeof supabaseAdmin>,
  runId: string | null,
  errorMessage: string,
  meta: Record<string, unknown> | null,
  body: object,
  status: number
) {
  updateSyncRun(admin, runId, { status: "error", error_message: errorMessage, meta });
  return NextResponse.json(body, { status: status as 400 | 404 | 500 });
}

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const projectIdRaw = searchParams.get("project_id") ?? "";
  const adAccountIdRaw = searchParams.get("ad_account_id") ?? "";
  const dateStartParam = searchParams.get("date_start");
  const dateEndParam = searchParams.get("date_end");

  if (!projectIdRaw || !adAccountIdRaw) {
    return NextResponse.json(
      { success: false, error: "project_id and ad_account_id are required" },
      { status: 400 }
    );
  }
  if (!isUuid(projectIdRaw)) {
    return NextResponse.json(
      { success: false, error: "project_id must be a valid UUID" },
      { status: 400 }
    );
  }
  if (!isGoogleCustomerId(adAccountIdRaw)) {
    return NextResponse.json(
      { success: false, error: "ad_account_id must be a Google Ads customer id (numeric)" },
      { status: 400 }
    );
  }
  if (dateStartParam && !isYmd(dateStartParam)) {
    return NextResponse.json(
      { success: false, error: "date_start must be YYYY-MM-DD" },
      { status: 400 }
    );
  }
  if (dateEndParam && !isYmd(dateEndParam)) {
    return NextResponse.json(
      { success: false, error: "date_end must be YYYY-MM-DD" },
      { status: 400 }
    );
  }

  const projectId = projectIdRaw;
  const externalAccountId = String(adAccountIdRaw).trim();
  const admin = supabaseAdmin();

  const developerToken = process.env.GOOGLE_ADS_DEVELOPER_TOKEN;
  if (!developerToken) {
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
    return NextResponse.json(
      { success: false, error: "Google integration not found; connect Google OAuth first" },
      { status: 404 }
    );
  }

  const { data: auth, error: authErr } = await admin
    .from("integrations_auth")
    .select("access_token")
    .eq("integration_id", integration.id)
    .maybeSingle();

  if (authErr || !auth?.access_token) {
    return NextResponse.json(
      { success: false, error: "Google auth token not found; reconnect Google OAuth" },
      { status: 401 }
    );
  }

  const { data: adAcc, error: adErr } = await admin
    .from("ad_accounts")
    .select("id")
    .eq("integration_id", integration.id)
    .eq("external_account_id", externalAccountId)
    .maybeSingle();

  if (adErr || !adAcc?.id) {
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
    return NextResponse.json(
      { success: false, error: "date_start must be <= date_end", period: { since, until } },
      { status: 400 }
    );
  }

  let syncRunId: string | null = null;
  const { data: runRow } = await admin
    .from("sync_runs")
    .insert({
      project_id: projectId,
      platform: "google",
      ad_account_id: canonicalAdAccountId,
      sync_type: "insights",
      status: "running",
    })
    .select("id")
    .single();
  syncRunId = (runRow as { id?: string } | null)?.id ?? null;

  type GoogleRow = {
    segments?: { date?: string };
    metrics?: { costMicros?: string; impressions?: number; clicks?: number };
  };

  const query = `SELECT segments.date, metrics.cost_micros, metrics.impressions, metrics.clicks FROM customer WHERE segments.date BETWEEN '${since}' AND '${until}'`;
  let rows: GoogleRow[];
  try {
    rows = await googleAdsSearch<GoogleRow>(externalAccountId, auth.access_token, developerToken, query);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    const body = {
      success: false,
      step: "google_ads_fetch",
      error: msg,
      period: { since, until },
    };
    return syncRunErrorAndReturn(admin, syncRunId, "google_ads_fetch", { error: msg, period: { since, until } }, body, 400);
  }

  const toNum = (v: unknown): number => (v != null && v !== "" ? Number(v) : 0);
  const metricsRows = rows
    .filter((r) => r?.segments?.date)
    .map((r) => {
      const date = String(r.segments!.date!).slice(0, 10);
      const costMicros = toNum(r.metrics?.costMicros ?? 0);
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

  if (metricsRows.length > 0) {
    const dates = [...new Set(metricsRows.map((r) => r.date))];
    const { error: delErr } = await admin
      .from("daily_ad_metrics")
      .delete()
      .eq("ad_account_id", canonicalAdAccountId)
      .is("campaign_id", null)
      .in("date", dates);

    if (delErr) {
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
      const body = {
        success: false,
        step: "daily_ad_metrics_insert_account",
        error: insErr?.message ?? insErr,
        rows: metricsRows.length,
        period: { since, until },
      };
      return syncRunErrorAndReturn(admin, syncRunId, "daily_ad_metrics_insert_account", { rows: metricsRows.length }, body, 500);
    }
  }

  let campaignRowsWritten = 0;
  let campaignsSeen = 0;

  type CampaignRow = {
    campaign?: { id?: string; name?: string };
    segments?: { date?: string };
    metrics?: { costMicros?: string; impressions?: number; clicks?: number };
  };
  const campaignQuery = `SELECT campaign.id, campaign.name, segments.date, metrics.cost_micros, metrics.impressions, metrics.clicks FROM campaign WHERE segments.date BETWEEN '${since}' AND '${until}'`;
  let campaignRows: CampaignRow[];
  try {
    campaignRows = await googleAdsSearch<CampaignRow>(externalAccountId, auth.access_token, developerToken, campaignQuery);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    const body = {
      success: false,
      step: "google_ads_campaign_fetch",
      error: msg,
      period: { since, until },
    };
    return syncRunErrorAndReturn(admin, syncRunId, "google_ads_campaign_fetch", { error: msg, period: { since, until } }, body, 400);
  }

  const campaignIdToName = new Map<string, string>();
  for (const r of campaignRows) {
    const id = r?.campaign?.id != null ? String(r.campaign.id) : null;
    if (id) campaignIdToName.set(id, r.campaign?.name ?? id);
  }
  campaignsSeen = campaignIdToName.size;

  if (campaignIdToName.size > 0) {
    const campaignUpsertRows = Array.from(campaignIdToName.entries()).map(([extId, name]) => ({
      project_id: projectId,
      ad_account_id: externalAccountId,
      external_campaign_id: extId,
      name: name || extId,
      platform: "google" as const,
    }));
    const { error: campErr } = await admin
      .from("campaigns")
      .upsert(campaignUpsertRows, { onConflict: "ad_account_id,external_campaign_id" });
    if (campErr) {
      const body = {
        success: false,
        step: "campaigns_upsert_google",
        error: campErr?.message ?? campErr,
        period: { since, until },
      };
      return syncRunErrorAndReturn(admin, syncRunId, "campaigns_upsert_google", { period: { since, until } }, body, 500);
    }

    const { data: campaignList } = await admin
      .from("campaigns")
      .select("id, external_campaign_id")
      .eq("ad_account_id", externalAccountId)
      .eq("platform", "google")
      .in("external_campaign_id", Array.from(campaignIdToName.keys()));
    const externalToCampaignId = new Map<string, string>();
    for (const c of (campaignList ?? []) as { id: string; external_campaign_id: string }[]) {
      if (c.external_campaign_id) externalToCampaignId.set(String(c.external_campaign_id), c.id);
    }

    const campMetricsRows = campaignRows
      .filter((r) => r?.campaign?.id && r?.segments?.date && externalToCampaignId.has(String(r.campaign.id)))
      .map((r) => {
        const date = String(r.segments!.date!).slice(0, 10);
        const cid = externalToCampaignId.get(String(r.campaign!.id!))!;
        const costMicros = toNum(r.metrics?.costMicros ?? 0);
        return {
          project_id: projectId,
          ad_account_id: canonicalAdAccountId,
          campaign_id: cid,
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
        const body = {
          success: false,
          step: "daily_ad_metrics_delete_campaign",
          error: delCampErr?.message ?? delCampErr,
          period: { since, until },
        };
        return syncRunErrorAndReturn(admin, syncRunId, "daily_ad_metrics_delete_campaign", { period: { since, until } }, body, 500);
      }
      const { error: insCampErr } = await admin.from("daily_ad_metrics").insert(campMetricsRows);
      if (insCampErr) {
        const body = {
          success: false,
          step: "daily_ad_metrics_insert_campaign",
          error: insCampErr?.message ?? insCampErr,
          rows: campMetricsRows.length,
          period: { since, until },
        };
        return syncRunErrorAndReturn(admin, syncRunId, "daily_ad_metrics_insert_campaign", { rows: campMetricsRows.length }, body, 500);
      }
      campaignRowsWritten = campMetricsRows.length;
    }
  }

  const totalRows = metricsRows.length + campaignRowsWritten;
  await updateSyncRun(admin, syncRunId, {
    status: "ok",
    rows_written: totalRows,
    meta: {
      since,
      until,
      account_rows_written: metricsRows.length,
      campaign_rows_written: campaignRowsWritten,
      campaigns_seen: campaignsSeen,
      ad_account_id_external: externalAccountId,
    },
  });

  return NextResponse.json({
    success: true,
    saved: totalRows,
    account_rows: metricsRows.length,
    campaign_rows: campaignRowsWritten,
    campaigns_seen: campaignsSeen,
    period: { since, until },
    ad_account_id: externalAccountId,
    canonical_ad_account_id: canonicalAdAccountId,
  });
}
