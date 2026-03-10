// app/api/oauth/meta/insights/sync/route.ts
import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/app/lib/supabaseAdmin";

async function fbGetJson(url: string) {
  const r = await fetch(url, { method: "GET" });
  const txt = await r.text();
  try {
    return JSON.parse(txt);
  } catch {
    return { error: { message: txt } };
  }
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

/** Update a sync_runs row (on success or error). */
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
  const finishedAt = new Date().toISOString();
  const row: Record<string, unknown> = {
    status: updates.status,
    finished_at: finishedAt,
  };
  if (updates.rows_written != null) row.rows_written = updates.rows_written;
  if (updates.error_message != null) row.error_message = updates.error_message;
  if (updates.meta != null) row.meta = updates.meta;
  await admin.from("sync_runs").update(row).eq("id", runId);
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
  await updateSyncRun(admin, runId, { status: "error", error_message: errorMessage, meta });
  return NextResponse.json(body, { status: status as 400 | 404 | 500 });
}

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);

  const projectIdRaw = searchParams.get("project_id") ?? "";
  const adAccountIdRaw = searchParams.get("ad_account_id") ?? "";

  const dateStartParam = searchParams.get("date_start");
  const dateStopParam = searchParams.get("date_stop");

  if (!projectIdRaw || !adAccountIdRaw) {
    return NextResponse.json(
      { success: false, error: "project_id and ad_account_id required" },
      { status: 400 }
    );
  }

  if (!isUuid(projectIdRaw)) {
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

  const admin = supabaseAdmin();

  // ✅ 1) access_token from integrations_meta (БЕЗ single()!)
  // 🔧 Берём oauth_meta и ПРЕДПОЧИТАЕМ account_id=act_..., default, primary
  const { data: tokenCandidates, error: intErr } = await admin
    .from("integrations_meta")
    .select("id, access_token, token_source, created_at, account_id, integrations_id")
    .eq("project_id", projectId)
    .eq("token_source", "oauth_meta")
    .in("account_id", [adAccountId, "default", "primary"])
    .order("created_at", { ascending: false })
    .limit(10);

  if (intErr) {
    return NextResponse.json(
      {
        success: false,
        step: "supabase_select_integration",
        error: intErr?.message || intErr,
      },
      { status: 500 }
    );
  }

  const integration =
    (tokenCandidates || []).find((x: any) => x?.account_id === adAccountId && x?.access_token) ||
    (tokenCandidates || []).find((x: any) => x?.account_id === "default" && x?.access_token) ||
    (tokenCandidates || []).find((x: any) => x?.account_id === "primary" && x?.access_token) ||
    null;

  if (!integration?.access_token) {
    return NextResponse.json(
      {
        success: false,
        error: "No integration found (access_token missing) for oauth_meta",
      },
      { status: 404 }
    );
  }

  const accessToken = integration.access_token;

  // 1b) Canonical: resolve ad_accounts.id for daily_ad_metrics dual-write
  // Lookup by integration_id only (integrations_meta.integrations_id = ad_accounts.integration_id)
  let canonicalAdAccountId: string | null = null;
  const integrationsId = (integration as { integrations_id?: string | null }).integrations_id;
  if (integrationsId) {
    const { data: adAcc } = await admin
      .from("ad_accounts")
      .select("id")
      .eq("integration_id", integrationsId)
      .eq("external_account_id", adAccountId)
      .limit(1)
      .maybeSingle();
    canonicalAdAccountId = adAcc?.id ?? null;
  }

  // Sync run tracking (platform-agnostic)
  let syncRunId: string | null = null;
  const { data: runRow } = await admin
    .from("sync_runs")
    .insert({
      project_id: projectId,
      platform: "meta",
      ad_account_id: canonicalAdAccountId,
      sync_type: "insights",
      status: "running",
    })
    .select("id")
    .single();
  syncRunId = (runRow as { id?: string } | null)?.id ?? null;

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
    return syncRunErrorAndReturn(admin, syncRunId, "meta_timezone_fetch", { meta_error: tzJson.error }, body, 400);
  }

  const accountTz: string = tzJson?.timezone_name || "UTC";

  const now = new Date();
  const since = dateStartParam ?? firstDayOfMonthYmdInTz(now, accountTz);
  const until = dateStopParam ?? formatYmdInTz(now, accountTz);

  console.log("[INSIGHTS_SYNC_PERIOD]", { date_start_param: dateStartParam, date_stop_param: dateStopParam, since, until, tz: accountTz });

  if (since > until) {
    const body = { success: false, error: "date_start must be <= date_stop", tz: accountTz, period: { since, until } };
    return syncRunErrorAndReturn(admin, syncRunId, "date_start must be <= date_stop", { since, until }, body, 400);
  }

  // ===========================
  // ✅ A) ACCOUNT-LEVEL SPEND (daily) — чтобы совпадало с Ads Manager totals
  // ===========================
  const accParams = new URLSearchParams({
    level: "account",
    time_increment: "1",
    time_range: JSON.stringify({ since, until }),
    use_account_attribution_setting: "true",
    action_report_time: "impression",
    include_deleted: "true",
    limit: "500",
    fields: "spend,impressions,clicks,date_start,date_stop",
    access_token: accessToken,
  });

  const accUrl = `https://graph.facebook.com/v19.0/${adAccountId}/insights?${accParams.toString()}`;
  const accJson = await fbGetJson(accUrl);

  if (accJson?.error) {
    const body = {
      success: false,
      step: "meta_insights_fetch_account_level",
      meta_error: accJson.error,
      tz: accountTz,
      period: { since, until },
      debug_url_preview: accUrl.slice(0, 250) + "...",
      integration_debug: {
        id: integration?.id,
        token_source: integration?.token_source,
        created_at: integration?.created_at,
        account_id: integration?.account_id,
      },
    };
    return syncRunErrorAndReturn(admin, syncRunId, "meta_insights_fetch_account_level", { meta_error: accJson.error, period: { since, until } }, body, 400);
  }

  const accList = Array.isArray(accJson?.data) ? accJson.data : [];
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
      const body = {
        success: false,
        step: "supabase_upsert_meta_insights_account_level",
        error: upAccErr?.message || upAccErr,
        rows: accRows.length,
        tz: accountTz,
        period: { since, until },
        integration_debug: {
          id: integration?.id,
          token_source: integration?.token_source,
          created_at: integration?.created_at,
          account_id: integration?.account_id,
        },
      };
      return syncRunErrorAndReturn(admin, syncRunId, "supabase_upsert_meta_insights_account_level", { rows: accRows.length }, body, 500);
    }

    // Canonical: dual-write daily_ad_metrics (account-level)
    if (canonicalAdAccountId && accRows.length > 0) {
      type AccRow = (typeof accRows)[number];
      const accMetricsRows = accRows
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
      if (accMetricsRows.length > 0) {
        const dates = [...new Set(accMetricsRows.map((r: { date: string }) => r.date))];
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
            tz: accountTz,
            period: { since, until },
            canonical_ad_account_id: canonicalAdAccountId,
          };
          return syncRunErrorAndReturn(admin, syncRunId, "daily_ad_metrics_delete_account", { period: { since, until } }, body, 500);
        }
        const { error: insErr } = await admin.from("daily_ad_metrics").insert(accMetricsRows);
        if (insErr) {
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
        console.log("[INSIGHTS_SYNC_WRITE]", { account_level_rows_inserted: accMetricsRows.length, dates: accMetricsRows.map((r: { date: string }) => r.date).slice(0, 10), canonicalAdAccountId });
      } else {
        console.log("[INSIGHTS_SYNC_WRITE]", { account_level_rows_inserted: 0, reason: "no canonicalAdAccountId or no accMetricsRows" });
      }
    }
  } else {
    console.log("[INSIGHTS_SYNC_WRITE]", { account_level_rows_inserted: 0, reason: "accList.length === 0 (no account-level data from Meta)" });
  }

  // ===========================
  // ✅ B) CAMPAIGN LOOP — НЕ ЛОМАЕМ (как было)
  // ===========================
  const baseParams = new URLSearchParams({
    level: "campaign",
    time_increment: "1",
    time_range: JSON.stringify({ since, until }),

    use_account_attribution_setting: "true",
    action_report_time: "impression",
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
  let entityIdToCampaignId = new Map<string, string>();
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
      const body = {
        success: false,
        step: "meta_insights_fetch",
        meta_error: json.error,
        tz: accountTz,
        period: { since, until },
        page: pages,
        debug_url_preview: nextUrl.slice(0, 250) + "...",
        integration_debug: {
          id: integration?.id,
          token_source: integration?.token_source,
          created_at: integration?.created_at,
          account_id: integration?.account_id,
        },
      };
      return syncRunErrorAndReturn(admin, syncRunId, "meta_insights_fetch", { page: pages, meta_error: json.error }, body, 400);
    }

    const list = Array.isArray(json?.data) ? json.data : [];
    totalMetaRows += list.length;

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
          const body = {
            success: false,
            step: "supabase_upsert_meta_insights",
            error: upErr?.message || upErr,
            chunk_size: part.length,
            tz: accountTz,
            period: { since, until },
            page: pages,
            integration_debug: {
              id: integration?.id,
              token_source: integration?.token_source,
              created_at: integration?.created_at,
              account_id: integration?.account_id,
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
          if (missingEntityIds.length > 0) {
            const campaignUpsertRows = missingEntityIds.map((eid) => {
              const first = partCamp.find((r) => r.entity_id === eid);
              return {
                project_id: projectId,
                meta_campaign_id: String(eid),
                ad_account_id: adAccountId,
                name: first?.entity_name ?? null,
                status: null as string | null,
                objective: null as string | null,
                platform: "meta" as const,
              };
            });
            const { error: campUpErr } = await admin
              .from("campaigns")
              .upsert(campaignUpsertRows, { onConflict: "project_id,meta_campaign_id" });
            if (campUpErr) {
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
            const campaignIds = [...new Set(campMetricsRows.map((r) => r.campaign_id))];
            const dates = campMetricsRows.map((r) => r.date);
            const chunkStart = dates.reduce((a, b) => (a < b ? a : b));
            const chunkEnd = dates.reduce((a, b) => (a > b ? a : b));
            const { error: delErr } = await admin
              .from("daily_ad_metrics")
              .delete()
              .eq("ad_account_id", canonicalAdAccountId)
              .in("campaign_id", campaignIds)
              .gte("date", chunkStart)
              .lte("date", chunkEnd);
            if (delErr) {
              const body = {
                success: false,
                step: "daily_ad_metrics_delete_campaign",
                error: delErr?.message ?? delErr,
                tz: accountTz,
                period: { since, until },
                page: pages,
              };
              return syncRunErrorAndReturn(admin, syncRunId, "daily_ad_metrics_delete_campaign", { page: pages }, body, 500);
            }
            const { error: insErr } = await admin.from("daily_ad_metrics").insert(campMetricsRows);
            if (insErr) {
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
      const body = {
        success: false,
        step: "paging_guard",
        error: "Too many pages, aborting to avoid infinite loop",
        pages,
        tz: accountTz,
        period: { since, until },
        integration_debug: {
          id: integration?.id,
          token_source: integration?.token_source,
          created_at: integration?.created_at,
          account_id: integration?.account_id,
        },
      };
      return syncRunErrorAndReturn(admin, syncRunId, "paging_guard", { pages }, body, 500);
    }
  }

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
      const dates = [...new Set(accFallbackRows.map((r) => r.date))];
      const { error: delErr } = await admin
        .from("daily_ad_metrics")
        .delete()
        .eq("ad_account_id", canonicalAdAccountId)
        .is("campaign_id", null)
        .in("date", dates);
      if (delErr) {
        const body = {
          success: false,
          step: "daily_ad_metrics_delete_account_fallback",
          error: delErr?.message ?? delErr,
          tz: accountTz,
          period: { since, until },
          canonical_ad_account_id: canonicalAdAccountId,
        };
        return syncRunErrorAndReturn(admin, syncRunId, "daily_ad_metrics_delete_account_fallback", { period: { since, until } }, body, 500);
      }
      const { error: insErr } = await admin.from("daily_ad_metrics").insert(accFallbackRows);
      if (insErr) {
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
    }
  }

  const rowsWritten = totalSaved + accList.length;
  await updateSyncRun(admin, syncRunId, {
    status: "ok",
    rows_written: rowsWritten,
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
    integration_debug: {
      id: integration?.id,
      token_source: integration?.token_source,
      created_at: integration?.created_at,
      account_id: integration?.account_id,
    },
  };
  console.log("[INSIGHTS_SYNC_COUNTS]", { meta_account_rows: accList.length, saved_campaign_rows: totalSaved, meta_campaign_rows: totalMetaRows, period: { since, until } });
  return NextResponse.json(responseBody);
}