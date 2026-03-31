// app/api/oauth/meta/insights/sync/route.ts
import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/app/lib/supabaseAdmin";
import { withSyncLock } from "@/app/lib/syncLock";
import { datesInRange } from "@/app/lib/dashboardBackfill";
import { requireProjectAccessOrInternal } from "@/app/lib/auth/requireProjectAccessOrInternal";
import { startSyncRun, finishSyncRunSuccess, finishSyncRunError } from "@/app/lib/syncRuns";
import { runPostSyncInvariantChecks } from "@/app/lib/postSyncInvariantChecks";
import { getMetaIntegrationForProject } from "@/app/lib/metaIntegration";
import { fetchMetaGraphGetJsonWithRetry } from "@/app/lib/metaGraphRetry";
import { upsertDailyMetricsAccountCompat, upsertDailyMetricsCampaignCompat } from "@/app/lib/dailyMetricsUpsert";
import { syncMetaMarketingIntentFromAdsApi } from "@/app/lib/metaAdsMarketingIntentSync";

async function fbGetJson(url: string): Promise<any> {
  const res = await fetchMetaGraphGetJsonWithRetry(url);
  if (!res.ok) {
    const body = res.json as { error?: { message?: string; code?: number } };
    if (body && typeof body === "object" && body.error) {
      return body;
    }
    return {
      error: {
        message: `Graph request failed (http ${res.httpStatus})`,
        code: (body as { error?: { code?: number } })?.error?.code,
      },
    };
  }
  return res.json;
}

/** UUID v1-v5 validator */
function isUuid(v: string) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
    v
  );
}

/** Meta ad account id validator: act_123... */
function isMetaActId(v: string) {
  return /^act_\d+$/i.test(v);
}

function isYmd(v: string) {
  return /^\d{4}-\d{2}-\d{2}$/.test(v);
}

function toNum(v: any) {
  if (v === null || v === undefined || v === "") return 0;
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}

function toInt(v: any) {
  if (v === null || v === undefined || v === "") return 0;
  const n = parseInt(String(v), 10);
  return Number.isFinite(n) ? n : 0;
}

/**
 * ✅ вытаскиваем action count из массива actions
 * actions = [{ action_type: "lead", value: "12" }, ...]
 */
function sumAction(actions: any, actionTypes: string[]) {
  if (!Array.isArray(actions)) return 0;
  const set = new Set(actionTypes);
  let total = 0;

  for (const a of actions) {
    const t = String(a?.action_type || "");
    if (set.has(t)) total += toNum(a?.value);
  }
  return total;
}

/**
 * ✅ вытаскиваем money value из массива action_values
 * action_values = [{ action_type: "purchase", value: "123.45" }, ...]
 */
function sumActionValue(actionValues: any, actionTypes: string[]) {
  if (!Array.isArray(actionValues)) return 0;
  const set = new Set(actionTypes);
  let total = 0;

  for (const a of actionValues) {
    const t = String(a?.action_type || "");
    if (set.has(t)) total += toNum(a?.value);
  }
  return total;
}

/**
 * ✅ ROAS часто приходит как purchase_roas: [{ value: "2.31" }]
 */
function extractPurchaseRoas(purchaseRoas: any) {
  if (Array.isArray(purchaseRoas) && purchaseRoas.length) {
    return toNum(purchaseRoas[0]?.value);
  }
  return 0;
}

/**
 * YYYY-MM-DD in a specific IANA timezone (e.g. "Asia/Almaty").
 * Uses Intl so no extra deps.
 */
function formatYmdInTz(d: Date, timeZone: string) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(d);

  const y = parts.find((p) => p.type === "year")?.value;
  const m = parts.find((p) => p.type === "month")?.value;
  const day = parts.find((p) => p.type === "day")?.value;
  return `${y}-${m}-${day}`;
}

function firstDayOfMonthYmdInTz(now: Date, timeZone: string) {
  const today = formatYmdInTz(now, timeZone);
  return today.slice(0, 8) + "01";
}

/** chunk helper to avoid huge upserts */
function chunk<T>(arr: T[], size: number) {
  const out: T[][] = [];
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  return out;
}

/**
 * Meta Graph account-level insights sometimes return more than one row per calendar day.
 * daily_ad_metrics has UNIQUE (ad_account_id, date) WHERE campaign_id IS NULL — duplicates break insert.
 * Last row per date wins (same as re-processing the same window).
 */
function dedupeAccountDailyMetricsByDate<
  T extends { date: string; ad_account_id: string; campaign_id: null; platform: string },
>(rows: T[]): T[] {
  const byDate = new Map<string, T>();
  for (const r of rows) {
    byDate.set(r.date, r);
  }
  return Array.from(byDate.values());
}

/** Update sync_runs to error and return the JSON response. */
async function syncRunErrorAndReturn(
  admin: ReturnType<typeof supabaseAdmin>,
  runId: string | null,
  errorMessage: string,
  meta: Record<string, unknown> | null,
  body: object,
  status: number
) {
  await finishSyncRunError(admin, runId, errorMessage, meta);
  return NextResponse.json(body, { status: status as 400 | 404 | 500 });
}

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);

  const projectIdRaw = searchParams.get("project_id") ?? "";
  const adAccountIdRaw = searchParams.get("ad_account_id") ?? "";

  const dateStartParam = searchParams.get("date_start");
  const dateStopParam = searchParams.get("date_stop");
  /** Set by internal cron only: start/end are UTC calendar days; remap single-day "today" to account TZ. */
  const dateOriginParam = (searchParams.get("date_origin") ?? "").trim();

  if (!projectIdRaw || !adAccountIdRaw) {
    console.log("[META_SYNC_400_MISSING_PARAMS]", { project_id: projectIdRaw || null, ad_account_id: adAccountIdRaw || null });
    return NextResponse.json(
      { success: false, error: "project_id and ad_account_id required" },
      { status: 400 }
    );
  }

  if (!isUuid(projectIdRaw)) {
    console.log("[META_SYNC_400_INVALID_PROJECT]", { project_id: projectIdRaw });
    return NextResponse.json(
      {
        success: false,
        error: "project_id must be a valid UUID",
        project_id: projectIdRaw,
      },
      { status: 400 }
    );
  }

  if (!isMetaActId(adAccountIdRaw)) {
    console.log("[META_SYNC_400_INVALID_AD_ACCOUNT]", { ad_account_id: adAccountIdRaw });
    return NextResponse.json(
      {
        success: false,
        error: "ad_account_id must look like act_123...",
        ad_account_id: adAccountIdRaw,
      },
      { status: 400 }
    );
  }

  if (dateStartParam && !isYmd(dateStartParam)) {
    console.log("[META_SYNC_400_INVALID_DATE_START]", { date_start: dateStartParam });
    return NextResponse.json(
      {
        success: false,
        error: "date_start must be YYYY-MM-DD",
        date_start: dateStartParam,
      },
      { status: 400 }
    );
  }

  if (dateStopParam && !isYmd(dateStopParam)) {
    console.log("[META_SYNC_400_INVALID_DATE_STOP]", { date_stop: dateStopParam });
    return NextResponse.json(
      {
        success: false,
        error: "date_stop must be YYYY-MM-DD",
        date_stop: dateStopParam,
      },
      { status: 400 }
    );
  }

  const projectId = projectIdRaw;
  const adAccountId = adAccountIdRaw;

  const access = await requireProjectAccessOrInternal(req, projectId, { allowInternalBypass: true });
  if (!access.allowed) {
    console.log("[META_SYNC_ACCESS_DENIED]", { projectId, status: access.status });
    return NextResponse.json(access.body, { status: access.status });
  }

  console.log("[META_INSIGHTS_SYNC_ENTER]", {
    ad_account_id: adAccountId,
    date_start: dateStartParam ?? null,
    date_stop: dateStopParam ?? null,
    project_id: projectId,
    access_source: access.source,
  });

  const admin = supabaseAdmin();

  // Resolve canonical integrations (for ad_accounts linkage) and legacy Meta integration (for token).
  const { data: integrationsForProject } = await admin
    .from("integrations")
    .select("id")
    .eq("project_id", projectId)
    .eq("platform", "meta");
  const integrationIdsList = (integrationsForProject ?? []).map((r: { id: string }) => r.id);
  const { data: adAccountRowForProject } = integrationIdsList.length
    ? await admin
        .from("ad_accounts")
        .select("id, integration_id")
        .eq("external_account_id", adAccountId)
        .in("integration_id", integrationIdsList)
        .limit(1)
        .maybeSingle()
    : { data: null };
  const integrationIdFromAdAccount = (adAccountRowForProject as { integration_id?: string } | null)?.integration_id ?? null;

  // 1) Token: use shared resolver (integrations + integrations_auth with fallback to integrations_meta).
  const metaIntegration = await getMetaIntegrationForProject(admin, projectId);

  const integrationsId = integrationIdFromAdAccount ?? null;
  let canonicalAdAccountIdForLog: string | null = adAccountRowForProject?.id ?? null;
  if (!canonicalAdAccountIdForLog && integrationsId) {
    const { data: adAcc } = await admin
      .from("ad_accounts")
      .select("id")
      .eq("integration_id", integrationsId)
      .eq("external_account_id", adAccountId)
      .limit(1)
      .maybeSingle();
    canonicalAdAccountIdForLog = adAcc?.id ?? null;
  }
  console.log("[META_SYNC_RESOLVED]", {
    projectId,
    ad_account_id_external: adAccountId,
    resolved_integration_id: integrationsId,
    resolved_canonical_ad_account_id: canonicalAdAccountIdForLog,
    integration_found: !!metaIntegration?.id,
    integration_has_token: !!(metaIntegration?.access_token),
    integrations_meta_candidates_count: metaIntegration ? 1 : 0,
    ad_accounts_row_exists: !!adAccountRowForProject,
    integrations_auth_exists_for_integration: null,
  });

  if (!metaIntegration?.access_token) {
    console.log("[META_SYNC_404_NO_TOKEN]", {
      projectId,
      ad_account_id: adAccountId,
      token_candidates_count: 0,
      integration_found: !!metaIntegration?.id,
      resolved_integration_id: integrationsId,
      resolved_canonical_ad_account_id: canonicalAdAccountIdForLog,
    });
    return NextResponse.json(
      {
        success: false,
        error: "No integration found (access_token missing) for oauth_meta",
      },
      { status: 404 }
    );
  }

  const accessToken = metaIntegration.access_token!;

  const canonicalAdAccountId: string | null = canonicalAdAccountIdForLog;

  // ✅ 2) account timezone (so days match Ads Manager)
  const tzUrl =
    `https://graph.facebook.com/v19.0/${adAccountId}?` +
    new URLSearchParams({
      fields: "timezone_name,timezone_offset_hours_utc",
      access_token: accessToken,
    }).toString();

  const tzJson = await fbGetJson(tzUrl);
  if (tzJson?.error) {
    const body = { success: false, step: "meta_timezone_fetch", meta_error: tzJson.error };
    return NextResponse.json(body, { status: 400 });
  }

  const accountTz: string = tzJson?.timezone_name || "UTC";

  const now = new Date();
  const utcToday = new Date().toISOString().slice(0, 10);
  const accountLocalToday = formatYmdInTz(now, accountTz);

  let since = dateStartParam ?? firstDayOfMonthYmdInTz(now, accountTz);
  let until = dateStopParam ?? formatYmdInTz(now, accountTz);

  const singleDayExplicit =
    dateStartParam != null && dateStopParam != null && dateStartParam === dateStopParam;
  const utcTodayOriginApplied =
    dateOriginParam === "utc_today" &&
    access.source === "internal" &&
    singleDayExplicit &&
    dateStartParam === utcToday;
  if (utcTodayOriginApplied) {
    since = accountLocalToday;
    until = accountLocalToday;
  }

  console.log("[INSIGHTS_SYNC_PERIOD]", { date_start_param: dateStartParam, date_stop_param: dateStopParam, since, until, tz: accountTz });

  if (since > until) {
    console.log("[META_SYNC_400_DATE_RANGE]", {
      projectId,
      ad_account_id: adAccountId,
      since,
      until,
      tz: accountTz,
    });
    return NextResponse.json(
      { success: false, error: "date_start must be <= date_stop", tz: accountTz, period: { since, until } },
      { status: 400 }
    );
  }

  return withSyncLock("meta", adAccountId, since, until, "insights", async () => {
  const { id: syncRunId, alreadyRunning } = await startSyncRun(admin, {
    projectId,
    platform: "meta",
    adAccountId: canonicalAdAccountId,
    syncType: "insights",
    dateStart: since,
    dateEnd: until,
    metadata: { tz: accountTz },
  });
  if (alreadyRunning) {
    console.log("[META_SYNC_SKIP_LOCKED]", {
      platform: "meta",
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
  let accountRowsInserted = 0;
  console.log("[META_SYNC_RUN_INSERT]", {
    sync_run_id: syncRunId,
    ad_account_id: canonicalAdAccountId,
    since,
    until,
    platform: "meta",
  });

  // ===========================
  // ✅ A) ACCOUNT-LEVEL SPEND (daily) — чтобы совпадало с Ads Manager totals
  // ===========================
  // Align with Ads Manager default attribution: conversion time (not impression). Do not set
  // use_account_attribution_setting together with action_report_time — Graph API rejects the combo.
  const accParams = new URLSearchParams({
    level: "account",
    time_increment: "1",
    time_range: JSON.stringify({ since, until }),
    action_report_time: "conversion",
    include_deleted: "true",
    limit: "500",
    fields: "spend,impressions,clicks,date_start,date_stop",
    access_token: accessToken,
  });

  const accUrl = `https://graph.facebook.com/v19.0/${adAccountId}/insights?${accParams.toString()}`;
  const accJson = await fbGetJson(accUrl);

  if (accJson?.error) {
    console.log("[META_SYNC_400_INSIGHTS_FETCH_ACCOUNT]", {
      projectId,
      ad_account_id: adAccountId,
      meta_error: accJson.error,
      period: { since, until },
    });
    const body = {
      success: false,
      step: "meta_insights_fetch_account_level",
      meta_error: accJson.error,
      tz: accountTz,
      period: { since, until },
      debug_url_preview: accUrl.slice(0, 250) + "...",
      integration_debug: {
        id: null,
        token_source: null,
        created_at: null,
        account_id: null,
      },
    };
    return syncRunErrorAndReturn(admin, syncRunId, "meta_insights_fetch_account_level", { meta_error: accJson.error, period: { since, until } }, body, 400);
  }

  const accList = Array.isArray(accJson?.data) ? accJson.data : [];
  const accSpendTotal = accList.reduce((s: number, i: any) => s + toNum(i?.spend), 0);
  console.log("[META RAW COUNT]", { level: "account", count: accList.length });
  console.log("[META DATE RANGE]", {
    level: "account",
    from: accList[0]?.date_start ?? null,
    to: accList[accList.length - 1]?.date_start ?? null,
    since,
    until,
  });
  console.log("[META RAW SPEND TOTAL]", { level: "account", spend: accSpendTotal, rows: accList.length });

  if (accList.length) {
    const accRows = accList.map((i: any) => ({
      project_id: projectId,
      ad_account_id: adAccountId,
      level: "account",
      entity_id: null,
      entity_name: null,

      date_start: i.date_start ?? null,
      date_stop: i.date_stop ?? null,
      time_increment: 1,

      spend: toNum(i.spend),
      impressions: toInt(i.impressions),
      clicks: toInt(i.clicks),
      reach: 0,
      cpm: 0,
      cpc: 0,
      ctr: 0,
      leads: 0,
      purchases: 0,
      revenue: 0,
      roas: 0,

      actions: null,
      action_values: null,
      purchase_roas: null,
      raw: i,
    }));

    const { error: upAccErr } = await admin.from("meta_insights").upsert(accRows, {
      onConflict: "project_id,ad_account_id,level,entity_id,date_start",
    });

    if (upAccErr) {
      console.log("[META_SYNC_500_UPSERT_META_INSIGHTS_ACCOUNT]", {
        projectId,
        ad_account_id: adAccountId,
        error: upAccErr?.message || upAccErr,
        rows: accRows.length,
      });
      const body = {
        success: false,
        step: "supabase_upsert_meta_insights_account_level",
        error: upAccErr?.message || upAccErr,
        rows: accRows.length,
        tz: accountTz,
        period: { since, until },
        integration_debug: {
          id: null,
          token_source: null,
          created_at: null,
          account_id: null,
        },
      };
      return syncRunErrorAndReturn(admin, syncRunId, "supabase_upsert_meta_insights_account_level", { rows: accRows.length }, body, 500);
    }

    // Canonical: dual-write daily_ad_metrics (account-level)
    if (canonicalAdAccountId && accRows.length > 0) {
      type AccRow = (typeof accRows)[number];
      const accMetricsRowsMapped = accRows
        .filter((r: AccRow) => r.date_start)
        .map((r: AccRow) => ({
          project_id: projectId,
          ad_account_id: canonicalAdAccountId,
          campaign_id: null,
          date: String(r.date_start).slice(0, 10),
          platform: "meta" as const,
          spend: r.spend ?? 0,
          impressions: r.impressions ?? 0,
          clicks: r.clicks ?? 0,
          reach: r.reach ?? 0,
          cpm: r.cpm ?? 0,
          cpc: r.cpc ?? 0,
          ctr: r.ctr ?? 0,
          leads: r.leads ?? 0,
          purchases: r.purchases ?? 0,
          revenue: r.revenue ?? 0,
          roas: r.roas ?? 0,
        }));
      const accMetricsRows = dedupeAccountDailyMetricsByDate(accMetricsRowsMapped);
      if (accMetricsRowsMapped.length > accMetricsRows.length) {
        console.log("[META_SYNC_DEDUPE_ACCOUNT_DAILY_METRICS]", {
          projectId,
          canonical_ad_account_id: canonicalAdAccountId,
          before: accMetricsRowsMapped.length,
          after: accMetricsRows.length,
        });
      }
      if (accMetricsRows.length > 0) {
        const { error: insErr } = await upsertDailyMetricsAccountCompat(admin, accMetricsRows);
        if (insErr) {
          console.log("[META_SYNC_500_DAILY_METRICS_INSERT_ACCOUNT]", {
            projectId,
            canonical_ad_account_id: canonicalAdAccountId,
            error: insErr?.message ?? insErr,
            rows: accMetricsRows.length,
          });
          const body = {
            success: false,
            step: "daily_ad_metrics_insert_account",
            error: insErr?.message ?? insErr,
            rows: accMetricsRows.length,
            tz: accountTz,
            period: { since, until },
            canonical_ad_account_id: canonicalAdAccountId,
          };
          return syncRunErrorAndReturn(admin, syncRunId, "daily_ad_metrics_insert_account", { rows: accMetricsRows.length }, body, 500);
        }
        accountRowsInserted += accMetricsRows.length;
        console.log("[INSIGHTS_SYNC_WRITE]", { account_level_rows_inserted: accMetricsRows.length, dates: accMetricsRows.map((r: { date: string }) => r.date).slice(0, 10), canonicalAdAccountId });
      } else {
        console.log("[INSIGHTS_SYNC_WRITE]", { account_level_rows_inserted: 0, reason: "no canonicalAdAccountId or no accMetricsRows" });
      }
    }

  } else {
    console.log("[INSIGHTS_SYNC_WRITE]", { account_level_rows_inserted: 0, reason: "accList.length === 0 (no account-level data from Meta)" });
  }

  // Zero-fill: days in [since, until] with no API data → account-level zero rows (coverage, no endless backfill)
  if (canonicalAdAccountId) {
    const allDates = datesInRange(since, until);
    const datesFromApi = new Set(
      (accList as { date_start?: string }[]).map((i) => (i.date_start ?? "").slice(0, 10)).filter(Boolean)
    );
    const { data: existingRows } = await admin
      .from("daily_ad_metrics")
      .select("date")
      .eq("ad_account_id", canonicalAdAccountId)
      .is("campaign_id", null)
      .gte("date", since)
      .lte("date", until);
    const existingDates = new Set((existingRows ?? []).map((r: { date: string }) => r.date));
    const zeroDates = allDates.filter((d) => !datesFromApi.has(d) && !existingDates.has(d));
    if (zeroDates.length > 0) {
      const zeroRows = zeroDates.map((date) => ({
        project_id: projectId,
        ad_account_id: canonicalAdAccountId,
        campaign_id: null,
        date,
        platform: "meta" as const,
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
        console.log("[META_SYNC_500_DAILY_METRICS_INSERT_ZERO_DAYS]", {
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
          canonical_ad_account_id: canonicalAdAccountId,
        };
        return syncRunErrorAndReturn(admin, syncRunId, "daily_ad_metrics_insert_zero_days", { zero_rows: zeroRows.length }, body, 500);
      }
      accountRowsInserted += zeroRows.length;
      console.log("[INSIGHTS_SYNC_WRITE]", { zero_days_inserted: zeroRows.length, dates_sample: zeroDates.slice(0, 5), canonicalAdAccountId });
    }
  }

  // ===========================
  // ✅ B) CAMPAIGN LOOP — НЕ ЛОМАЕМ (как было)
  // ===========================
  const baseParams = new URLSearchParams({
    level: "campaign",
    time_increment: "1",
    time_range: JSON.stringify({ since, until }),
    action_report_time: "conversion",
    include_deleted: "true",
    limit: "500",
    fields:
      "campaign_id,campaign_name,spend,impressions,clicks,reach,cpm,cpc,ctr,actions,action_values,purchase_roas,date_start,date_stop",
    access_token: accessToken,
  });

  let nextUrl =
    `https://graph.facebook.com/v19.0/${adAccountId}/insights?` + baseParams.toString();

  let totalSaved = 0;
  let totalMetaRows = 0;
  let pages = 0;

  // Accumulate all campaign rows for fallback canonical write when accRows is empty
  type CampRow = {
    entity_id: string | null;
    entity_name: string | null;
    date_start: string | null;
    date_stop: string | null;
    spend: number;
    impressions: number;
    clicks: number;
    reach: number;
    cpm: number;
    cpc: number;
    ctr: number;
    leads: number;
    purchases: number;
    revenue: number;
    roas: number;
  };
  const allCampaignRows: CampRow[] = [];

  const CHUNK_SIZE = 300;

  // Canonical: map entity_id (meta campaign id) -> campaigns.id for daily_ad_metrics dual-write.
  // Load existing; we will upsert missing campaigns per chunk so every insight row gets a campaign_id.
  const entityIdToCampaignId = new Map<string, string>();
  if (canonicalAdAccountId) {
    const { data: campaigns } = await admin
      .from("campaigns")
      .select("id, meta_campaign_id")
      .eq("project_id", projectId)
      .eq("ad_account_id", adAccountId);
    if (campaigns) {
      for (const c of campaigns) {
        if (c.meta_campaign_id) entityIdToCampaignId.set(String(c.meta_campaign_id), c.id);
      }
    }
  }

  const LEAD_TYPES = [
    "lead",
    "offsite_conversion.fb_pixel_lead",
    "onsite_conversion.lead_grouped",
  ];

  const PURCHASE_TYPES = [
    "purchase",
    "offsite_conversion.fb_pixel_purchase",
    "omni_purchase",
    "onsite_conversion.purchase",
  ];

  while (nextUrl) {
    pages += 1;

    const json = await fbGetJson(nextUrl);

    if (json?.error) {
      console.log("[META_SYNC_400_INSIGHTS_FETCH_PAGE]", {
        projectId,
        ad_account_id: adAccountId,
        page: pages,
        meta_error: json.error,
      });
      const body = {
        success: false,
        step: "meta_insights_fetch",
        meta_error: json.error,
        tz: accountTz,
        period: { since, until },
        page: pages,
        debug_url_preview: nextUrl.slice(0, 250) + "...",
        integration_debug: {
          id: null,
          token_source: null,
          created_at: null,
          account_id: null,
        },
      };
      return syncRunErrorAndReturn(admin, syncRunId, "meta_insights_fetch", { page: pages, meta_error: json.error }, body, 400);
    }

    const list = Array.isArray(json?.data) ? json.data : [];
    totalMetaRows += list.length;

    const pageSpendTotal = list.reduce((s: number, i: any) => s + toNum(i?.spend), 0);
    console.log("[META RAW COUNT]", { level: "campaign", page: pages, count: list.length });
    console.log("[META DATE RANGE]", {
      level: "campaign",
      page: pages,
      from: list[0]?.date_start ?? null,
      to: list[list.length - 1]?.date_start ?? null,
      since,
      until,
    });
    console.log("[META RAW SPEND TOTAL]", { level: "campaign", page: pages, spend: pageSpendTotal, rows: list.length });

    if (list.length) {
      const rows = list.map((i: any) => {
        const spend = toNum(i.spend);

        const leads = sumAction(i.actions, LEAD_TYPES);
        const purchases = sumAction(i.actions, PURCHASE_TYPES);
        const revenue = sumActionValue(i.action_values, PURCHASE_TYPES);

        const roas = extractPurchaseRoas(i.purchase_roas) || (spend > 0 ? revenue / spend : 0);

        return {
          project_id: projectId,
          ad_account_id: adAccountId,
          level: "campaign",

          entity_id: i.campaign_id ?? null,
          entity_name: i.campaign_name ?? null,

          date_start: i.date_start ?? null,
          date_stop: i.date_stop ?? null,

          time_increment: 1,

          spend,
          impressions: toInt(i.impressions),
          clicks: toInt(i.clicks),
          reach: toInt(i.reach),
          cpm: toNum(i.cpm),
          cpc: toNum(i.cpc),
          ctr: toNum(i.ctr),

          leads,
          purchases,
          revenue,
          roas,

          actions: i.actions ?? null,
          action_values: i.action_values ?? null,
          purchase_roas: i.purchase_roas ?? null,

          raw: i,
        };
      });

      for (const part of chunk(rows, CHUNK_SIZE)) {
        const { error: upErr } = await admin.from("meta_insights").upsert(part, {
          onConflict: "project_id,ad_account_id,level,entity_id,date_start",
        });

        if (upErr) {
          console.log("[META_SYNC_500_UPSERT_META_INSIGHTS_CHUNK]", {
            projectId,
            ad_account_id: adAccountId,
            page: pages,
            error: upErr?.message || upErr,
          });
          const body = {
            success: false,
            step: "supabase_upsert_meta_insights",
            error: upErr?.message || upErr,
            chunk_size: part.length,
            tz: accountTz,
            period: { since, until },
            page: pages,
            integration_debug: {
              id: null,
              token_source: null,
              created_at: null,
              account_id: null,
            },
          };
          return syncRunErrorAndReturn(admin, syncRunId, "supabase_upsert_meta_insights", { page: pages, chunk_size: part.length }, body, 500);
        }

        totalSaved += part.length;
        allCampaignRows.push(...(part as CampRow[]));

        // Canonical: ensure campaign rows exist, then dual-write daily_ad_metrics (campaign-level)
        if (canonicalAdAccountId && part.length > 0) {
          const partCamp = part as CampRow[];
          const missingEntityIds = [...new Set(partCamp.map((r) => r.entity_id).filter(Boolean) as string[])].filter(
            (eid) => !entityIdToCampaignId.has(String(eid))
          );
          if (!canonicalAdAccountId) {
            console.warn("[CAMPAIGN_SKIP_NO_AD_ACCOUNT]", {
              campaignIds: missingEntityIds,
              platform: "meta",
            });
          }
          if (missingEntityIds.length > 0) {
            const campaignUpsertRows = missingEntityIds
              .map((eid) => {
                const first = partCamp.find((r) => r.entity_id === eid);
                return {
                  project_id: projectId,
                  meta_campaign_id: String(eid),
                  ad_account_id: adAccountId,
                  ad_accounts_id: canonicalAdAccountId,
                  name: first?.entity_name ?? null,
                  status: null as string | null,
                  objective: null as string | null,
                  platform: "meta" as const,
                };
              })
              .filter((row) => {
                if (!row.ad_accounts_id) {
                  console.warn("[CAMPAIGN_SKIP_NO_AD_ACCOUNT]", {
                    campaignId: row.meta_campaign_id,
                    platform: "meta",
                  });
                  return false;
                }
                return true;
              });
            const { error: campUpErr } = await admin
              .from("campaigns")
              .upsert(campaignUpsertRows, { onConflict: "project_id,meta_campaign_id" });
            if (campUpErr) {
              console.log("[META_SYNC_500_CAMPAIGNS_UPSERT]", {
                projectId,
                ad_account_id: adAccountId,
                page: pages,
                error: campUpErr?.message ?? campUpErr,
              });
              const body = {
                success: false,
                step: "campaigns_upsert_insights_sync",
                error: campUpErr?.message ?? campUpErr,
                tz: accountTz,
                period: { since, until },
                page: pages,
              };
              return syncRunErrorAndReturn(admin, syncRunId, "campaigns_upsert_insights_sync", { page: pages }, body, 500);
            }
            const { data: inserted } = await admin
              .from("campaigns")
              .select("id, meta_campaign_id")
              .eq("project_id", projectId)
              .in("meta_campaign_id", missingEntityIds);
            if (inserted) {
              for (const c of inserted) {
                if (c.meta_campaign_id) entityIdToCampaignId.set(String(c.meta_campaign_id), c.id);
              }
            }
          }

          const campMetricsRows = partCamp
            .filter((r) => r.entity_id && r.date_start && entityIdToCampaignId.has(String(r.entity_id)))
            .map((r) => {
              const campaignId = entityIdToCampaignId.get(String(r.entity_id))!;
              return {
                project_id: projectId,
                ad_account_id: canonicalAdAccountId,
                campaign_id: campaignId,
                date: String(r.date_start).slice(0, 10),
                platform: "meta" as const,
                spend: r.spend ?? 0,
                impressions: r.impressions ?? 0,
                clicks: r.clicks ?? 0,
                reach: r.reach ?? 0,
                cpm: r.cpm ?? 0,
                cpc: r.cpc ?? 0,
                ctr: r.ctr ?? 0,
                leads: r.leads ?? 0,
                purchases: r.purchases ?? 0,
                revenue: r.revenue ?? 0,
                roas: r.roas ?? 0,
              };
            });
          if (campMetricsRows.length > 0) {
            const dates = campMetricsRows.map((r) => r.date);
            const chunkStart = dates.reduce((a, b) => (a < b ? a : b));
            const chunkEnd = dates.reduce((a, b) => (a > b ? a : b));
            const { error: insErr } = await upsertDailyMetricsCampaignCompat(admin, campMetricsRows);
            if (insErr) {
              console.log("[META_SYNC_500_DAILY_METRICS_UPSERT_CAMPAIGN]", {
                projectId,
                page: pages,
                error: insErr?.message ?? insErr,
                chunk_size: campMetricsRows.length,
              });
              const body = {
                success: false,
                step: "daily_ad_metrics_insert_campaign",
                error: insErr?.message ?? insErr,
                chunk_size: campMetricsRows.length,
                tz: accountTz,
                period: { since, until },
                page: pages,
              };
              return syncRunErrorAndReturn(admin, syncRunId, "daily_ad_metrics_insert_campaign", { page: pages, chunk_size: campMetricsRows.length }, body, 500);
            }
            console.log("[INSIGHTS_SYNC_WRITE]", {
              campaign_level_rows_inserted: campMetricsRows.length,
              chunk_dates: [chunkStart, chunkEnd],
              page: pages,
            });
          }
        }
      }
    }

    nextUrl = json?.paging?.next ?? "";
    if (!nextUrl) break;

    if (pages > 300) {
      console.log("[META_SYNC_500_PAGING_GUARD]", { projectId, ad_account_id: adAccountId, pages });
      const body = {
        success: false,
        step: "paging_guard",
        error: "Too many pages, aborting to avoid infinite loop",
        pages,
        tz: accountTz,
        period: { since, until },
        integration_debug: {
          id: null,
          token_source: null,
          created_at: null,
          account_id: null,
        },
      };
      return syncRunErrorAndReturn(admin, syncRunId, "paging_guard", { pages }, body, 500);
    }
  }

  const campaignInsightSpendSumRaw = allCampaignRows.reduce((s, r) => s + (Number(r.spend) || 0), 0);
  console.log("[META_SYNC_CONTROL_PERIOD_RAW]", {
    since,
    until,
    account_level_spend_sum: accSpendTotal,
    campaign_insight_rows_spend_sum: campaignInsightSpendSumRaw,
    campaign_insight_row_count: allCampaignRows.length,
    note: "Full request range (not per chunk). Compare account_level_spend_sum to Ads Manager for same act + dates.",
  });

  // Canonical fallback: when Meta returns no account-level insights (accList empty)
  // but we have campaign-level data, aggregate by date and write account-level rows.
  if (
    canonicalAdAccountId &&
    accList.length === 0 &&
    allCampaignRows.length > 0
  ) {
    const byDate = new Map<
      string,
      { spend: number; impressions: number; clicks: number; reach: number; leads: number; purchases: number; revenue: number }
    >();
    for (const r of allCampaignRows) {
      const d = r.date_start ? String(r.date_start).slice(0, 10) : null;
      if (!d) continue;
      const cur = byDate.get(d) ?? {
        spend: 0,
        impressions: 0,
        clicks: 0,
        reach: 0,
        leads: 0,
        purchases: 0,
        revenue: 0,
      };
      cur.spend += r.spend ?? 0;
      cur.impressions += r.impressions ?? 0;
      cur.clicks += r.clicks ?? 0;
      cur.reach += r.reach ?? 0;
      cur.leads += r.leads ?? 0;
      cur.purchases += r.purchases ?? 0;
      cur.revenue += r.revenue ?? 0;
      byDate.set(d, cur);
    }
    const accFallbackRows = Array.from(byDate.entries()).map(([date, agg]) => ({
      project_id: projectId,
      ad_account_id: canonicalAdAccountId,
      campaign_id: null,
      date,
      platform: "meta" as const,
      spend: agg.spend,
      impressions: agg.impressions,
      clicks: agg.clicks,
      reach: agg.reach,
      cpm: agg.impressions > 0 ? (agg.spend / agg.impressions) * 1000 : 0,
      cpc: agg.clicks > 0 ? agg.spend / agg.clicks : 0,
      ctr: agg.impressions > 0 ? (agg.clicks / agg.impressions) * 100 : 0,
      leads: agg.leads,
      purchases: agg.purchases,
      revenue: agg.revenue,
      roas: agg.spend > 0 ? agg.revenue / agg.spend : 0,
    }));
    if (accFallbackRows.length > 0) {
      const { error: insErr } = await upsertDailyMetricsAccountCompat(admin, accFallbackRows);
      if (insErr) {
        console.log("[META_SYNC_500_DAILY_METRICS_INSERT_ACCOUNT_FALLBACK]", {
          projectId,
          canonical_ad_account_id: canonicalAdAccountId,
          error: insErr?.message ?? insErr,
          rows: accFallbackRows.length,
        });
        const body = {
          success: false,
          step: "daily_ad_metrics_insert_account_fallback",
          error: insErr?.message ?? insErr,
          rows: accFallbackRows.length,
          tz: accountTz,
          period: { since, until },
          canonical_ad_account_id: canonicalAdAccountId,
        };
        return syncRunErrorAndReturn(admin, syncRunId, "daily_ad_metrics_insert_account_fallback", { rows: accFallbackRows.length }, body, 500);
      }
      accountRowsInserted += accFallbackRows.length;
    }
  }

  /** Sum campaign-level daily_ad_metrics for this sync window (paginated; matches dashboard canonical source). */
  let dbCampaignSpendSum: number | null = null;
  if (canonicalAdAccountId) {
    dbCampaignSpendSum = 0;
    let from = 0;
    const pageSize = 1000;
    for (;;) {
      const { data: dam } = await admin
        .from("daily_ad_metrics")
        .select("spend")
        .eq("ad_account_id", canonicalAdAccountId)
        .eq("platform", "meta")
        .not("campaign_id", "is", null)
        .gte("date", since)
        .lte("date", until)
        .range(from, from + pageSize - 1);
      const rows = dam ?? [];
      if (!rows.length) break;
      dbCampaignSpendSum += rows.reduce((s, r) => s + Number(r.spend ?? 0), 0);
      if (rows.length < pageSize) break;
      from += pageSize;
    }
    console.log("[META_SYNC_VERIFICATION_DB]", {
      since,
      until,
      canonical_ad_account_id: canonicalAdAccountId,
      db_campaign_daily_spend_sum: dbCampaignSpendSum,
    });
  }

  const rowsWritten = totalSaved + accList.length;
  const rowsInserted = totalSaved + accountRowsInserted;
  await finishSyncRunSuccess(admin, syncRunId, {
    rowsWritten,
    rowsInserted,
    campaignRowsInserted: totalSaved,
    accountRowsInserted,
    rowsDeleted: 0,
    meta: {
      since,
      until,
      pages,
      meta_account_rows: accList.length,
      saved_campaign_rows: totalSaved,
      meta_campaign_rows: totalMetaRows,
      ad_account_id_external: adAccountId,
    },
  });

  if (canonicalAdAccountId) {
    await runPostSyncInvariantChecks(admin, {
      projectId,
      adAccountId: canonicalAdAccountId,
      platform: "meta",
      dateStart: since,
      dateEnd: until,
    });
  }

  // Ensure intent is refreshed even when sync route is called directly (not via dashboard/sync wrapper).
  try {
    await syncMetaMarketingIntentFromAdsApi(accessToken, adAccountId, admin, projectId);
  } catch (intentEx) {
    console.warn("[META_MARKETING_INTENT_SYNC_EXCEPTION]", intentEx);
  }

  const responseBody = {
    success: true,
    saved: rowsWritten,
    saved_campaign_rows: totalSaved,
    meta_campaign_rows: totalMetaRows,
    meta_account_rows: accList.length,
    meta_rows: totalSaved + accList.length,
    pages,
    tz: accountTz,
    period: { since, until },
    verification: {
      since,
      until,
      raw_account_level_spend_sum: accSpendTotal,
      raw_campaign_insight_rows_spend_sum: campaignInsightSpendSumRaw,
      db_campaign_daily_spend_sum: dbCampaignSpendSum,
      /** Call GET /api/dashboard/summary?project_id&start&end with same dates to compare to BoardIQ UI. */
      dashboard_summary_hint: "GET /api/dashboard/summary with same start=since end=until (and same sources/account filters as UI)",
    },
    integration_debug: {
      id: null,
      token_source: null,
      created_at: null,
      account_id: null,
    },
  };
  console.log("[INSIGHTS_SYNC_COUNTS]", { meta_account_rows: accList.length, saved_campaign_rows: totalSaved, meta_campaign_rows: totalMetaRows, period: { since, until } });
  return NextResponse.json(responseBody);
  });
}