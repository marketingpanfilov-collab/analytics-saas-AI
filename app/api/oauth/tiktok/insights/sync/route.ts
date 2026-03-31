/**
 * TikTok insights sync: account-level + campaign-level into daily_ad_metrics (canonical).
 * Campaign rows use campaigns.external_campaign_id + ad_accounts_id (same pattern as Google).
 * After sync, scans ad/get for campaign_intent=retention markers → campaigns.marketing_intent.
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/app/lib/supabaseAdmin";
import { getTikTokAccessTokenForApi } from "@/app/lib/tiktokAdsAuth";
import { requireProjectAccessOrInternal } from "@/app/lib/auth/requireProjectAccessOrInternal";
import { withSyncLock } from "@/app/lib/syncLock";
import { startSyncRun, finishSyncRunSuccess, finishSyncRunError } from "@/app/lib/syncRuns";
import { runPostSyncInvariantChecks } from "@/app/lib/postSyncInvariantChecks";
import { applyTiktokMarketingIntentFromAdsApi } from "@/app/lib/campaignMarketingIntent";
import { upsertDailyMetricsAccountCompat, upsertDailyMetricsCampaignCompat } from "@/app/lib/dailyMetricsUpsert";

function isUuid(v: string) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(v);
}
function isYmd(v: string) {
  return /^\d{4}-\d{2}-\d{2}$/.test(v);
}

type TikTokReportRow = {
  stat_time_day?: string;
  campaign_id?: string;
  campaign_name?: string;
  spend?: string;
  cost?: string;
  impressions?: string;
  clicks?: string;
  dimensions?: {
    stat_time_day?: string;
    campaign_id?: string;
    campaign_name?: string;
    [key: string]: string | undefined;
  };
  metrics?: {
    spend?: string;
    cost?: string;
    impressions?: string;
    clicks?: string;
    [key: string]: string | undefined;
  };
};

type TikTokReportResponse = {
  code?: number;
  message?: string;
  data?: {
    list?: TikTokReportRow[];
    page_info?: { page?: number; page_size?: number; total_page?: number; total_number?: number };
  };
};

const TIKTOK_REPORT_BASE = "https://business-api.tiktok.com/open_api/v1.3/report/integrated/get/";
const TIKTOK_CAMPAIGN_GET = "https://business-api.tiktok.com/open_api/v1.3/campaign/get/";

type TikTokCampaignGetResponse = {
  code?: number;
  message?: string;
  data?: {
    list?: { campaign_id?: string | number; campaign_name?: string }[];
    page_info?: { page?: number; total_page?: number };
  };
};

/**
 * Human-readable names: integrated/report does not reliably expose campaign_name as a dimension.
 * Use Campaign Management API (paginated) and map campaign_id → campaign_name.
 */
async function fetchTiktokCampaignNameMap(accessToken: string, advertiserId: string): Promise<Map<string, string>> {
  const out = new Map<string, string>();
  let page = 1;
  for (;;) {
    const params = new URLSearchParams({
      advertiser_id: advertiserId,
      page: String(page),
      page_size: "1000",
    });
    const res = await fetch(`${TIKTOK_CAMPAIGN_GET}?${params.toString()}`, {
      method: "GET",
      headers: {
        "Access-Token": accessToken,
        "Content-Type": "application/json",
      },
    });
    const json = (await res.json().catch(() => ({}))) as TikTokCampaignGetResponse;
    if (!res.ok || Number(json.code ?? 0) !== 0) {
      if (out.size > 0) break;
      console.warn("[TIKTOK_CAMPAIGN_GET_NAMES]", {
        advertiserId,
        page,
        http: res.status,
        code: json.code,
        message: json.message,
      });
      return out;
    }
    const list = json.data?.list ?? [];
    for (const row of list) {
      const id = row?.campaign_id != null ? String(row.campaign_id).trim() : "";
      const name = row?.campaign_name != null ? String(row.campaign_name).trim() : "";
      if (id !== "" && name !== "") out.set(id, name);
    }
    const tp = json.data?.page_info?.total_page;
    if (typeof tp === "number" && tp > 0) {
      if (page >= tp) break;
    } else if (list.length === 0 || list.length < 1000) {
      break;
    }
    page += 1;
    if (page > 200) break;
  }
  return out;
}

function mergeTiktokReportNamesWithCampaignApi(
  apiNames: Map<string, string>,
  nameByExt: Map<string, string>
): void {
  for (const extId of nameByExt.keys()) {
    const n = apiNames.get(extId);
    if (n) nameByExt.set(extId, n);
  }
}

/** After upserts, align `campaigns.name` with TikTok for all rows under this ad account (incl. zero-spend in period). */
async function persistTiktokCampaignNamesToDatabase(
  admin: SupabaseClient,
  apiNames: Map<string, string>,
  canonicalAdAccountId: string
): Promise<void> {
  if (apiNames.size === 0) return;

  const { data: dbCamps, error: selErr } = await admin
    .from("campaigns")
    .select("id, external_campaign_id, name")
    .eq("ad_accounts_id", canonicalAdAccountId)
    .eq("platform", "tiktok");
  if (selErr) {
    console.warn("[TIKTOK_CAMPAIGN_NAME_REFRESH_SELECT]", selErr);
    return;
  }
  for (const c of (dbCamps ?? []) as { id: string; external_campaign_id: string | null; name: string | null }[]) {
    const ext = c.external_campaign_id != null ? String(c.external_campaign_id).trim() : "";
    if (!ext) continue;
    const resolved = apiNames.get(ext);
    if (!resolved || resolved === (c.name ?? "")) continue;
    const { error: upErr } = await admin.from("campaigns").update({ name: resolved }).eq("id", c.id);
    if (upErr) {
      console.warn("[TIKTOK_CAMPAIGN_NAME_REFRESH_UPDATE]", { id: c.id, error: upErr.message ?? upErr });
    }
  }
}

function toNum(v: unknown): number {
  const n = Number(v ?? 0);
  return Number.isFinite(n) ? n : 0;
}

function getDate(r: TikTokReportRow): string {
  const raw = r.stat_time_day ?? r.dimensions?.stat_time_day ?? (r.dimensions as { stat_time?: string } | undefined)?.stat_time;
  const s = String(raw ?? "").trim();
  if (/^\d{4}-\d{2}-\d{2}/.test(s)) return s.slice(0, 10);
  if (/^\d{8}/.test(s)) return `${s.slice(0, 4)}-${s.slice(4, 6)}-${s.slice(6, 8)}`;
  return s.slice(0, 10);
}

function getSpend(r: TikTokReportRow): number {
  return toNum(r.spend ?? r.cost ?? r.metrics?.spend ?? r.metrics?.cost ?? 0);
}

function getImpressions(r: TikTokReportRow): number {
  return toNum(r.impressions ?? r.metrics?.impressions ?? 0);
}

function getClicks(r: TikTokReportRow): number {
  return toNum(r.clicks ?? r.metrics?.clicks ?? 0);
}

function getCampaignExternalId(r: TikTokReportRow): string | null {
  const raw = r.dimensions?.campaign_id ?? r.campaign_id;
  const s = raw != null ? String(raw).trim() : "";
  return s === "" ? null : s;
}

function getCampaignName(r: TikTokReportRow, extId: string): string {
  const dim = r.dimensions as { campaign_name?: string } | undefined;
  const flat = r as { campaign_name?: string };
  const n = dim?.campaign_name ?? flat.campaign_name;
  const s = n != null ? String(n).trim() : "";
  return s === "" ? extId : s;
}

type TikTokReportFetchResult = {
  rows: TikTokReportRow[];
  errorMessage: string | null;
  errorCode?: number;
  errorHttp?: number;
};

function isTikTokAuthReportError(code: number | undefined, message: string, httpStatus: number): boolean {
  if (httpStatus === 401) return true;
  if (typeof code === "number" && code >= 40000 && code < 41000) return true;
  const m = message.toLowerCase();
  return (
    m.includes("access_token") ||
    m.includes("access token") ||
    m.includes("invalid credential") ||
    m.includes("authentication") ||
    m.includes("not authorized")
  );
}

function isTikTokTransientReportError(code: number | undefined, message: string, httpStatus: number): boolean {
  if (httpStatus === 429 || (httpStatus >= 500 && httpStatus <= 599)) return true;
  if (typeof code === "number" && code >= 50000) return true;
  const m = message.toLowerCase();
  return m.includes("rate limit") || m.includes("too many") || m.includes("throttle") || m.includes("internal error");
}

async function fetchTikTokIntegratedReportAllPages(
  accessToken: string,
  baseParams: Record<string, string>
): Promise<TikTokReportFetchResult> {
  const all: TikTokReportRow[] = [];
  let page = 1;
  for (;;) {
    const params = new URLSearchParams({ ...baseParams, page: String(page), page_size: "1000" });
    const reportRes = await fetch(`${TIKTOK_REPORT_BASE}?${params.toString()}`, {
      method: "GET",
      headers: {
        "Access-Token": accessToken,
        "Content-Type": "application/json",
      },
    });
    const reportJson = (await reportRes.json().catch(() => ({}))) as TikTokReportResponse;
    if (!reportRes.ok || Number(reportJson.code ?? 0) !== 0) {
      // Не теряем уже загруженные страницы: иначе при ошибке page 2+ весь синк падает с пустым ответом.
      if (all.length > 0) {
        console.warn("[TIKTOK_REPORT_PAGE_ERROR_USE_PARTIAL]", {
          page,
          message: reportJson.message,
          code: reportJson.code,
          http: reportRes.status,
          keptRows: all.length,
        });
        break;
      }
      return {
        rows: [],
        errorMessage: reportJson.message || `TikTok report API error: ${reportRes.status}`,
        errorCode: typeof reportJson.code === "number" ? reportJson.code : undefined,
        errorHttp: reportRes.status,
      };
    }
    const list = reportJson.data?.list ?? [];
    all.push(...list);
    const tp = reportJson.data?.page_info?.total_page;
    if (typeof tp === "number" && tp > 0) {
      if (page >= tp) break;
    } else if (list.length === 0 || list.length < 1000) {
      break;
    }
    page += 1;
    if (page > 500) break;
  }
  return { rows: all, errorMessage: null };
}

async function fetchTikTokReportWithOptionalTokenHeal(
  admin: SupabaseClient,
  integrationId: string,
  tokenRef: { access_token: string },
  baseParams: Record<string, string>
): Promise<TikTokReportFetchResult> {
  const r = await fetchTikTokIntegratedReportAllPages(tokenRef.access_token, baseParams);
  if (!r.errorMessage) return r;
  const http = r.errorHttp ?? 0;
  if (!isTikTokAuthReportError(r.errorCode, r.errorMessage, http)) return r;
  const tr2 = await getTikTokAccessTokenForApi(admin, integrationId, { forceRefresh: true });
  if (!tr2.ok) return r;
  tokenRef.access_token = tr2.access_token;
  return fetchTikTokIntegratedReportAllPages(tr2.access_token, baseParams);
}

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const projectId = searchParams.get("project_id") ?? "";
  const adAccountId = searchParams.get("ad_account_id") ?? "";
  const dateStartParam = searchParams.get("date_start");
  const dateEndParam = searchParams.get("date_end");

  if (!projectId || !adAccountId) {
    return NextResponse.json({ success: false, error: "project_id and ad_account_id are required" }, { status: 400 });
  }
  if (!isUuid(projectId)) {
    return NextResponse.json({ success: false, error: "project_id must be a valid UUID" }, { status: 400 });
  }
  if (dateStartParam && !isYmd(dateStartParam)) {
    return NextResponse.json({ success: false, error: "date_start must be YYYY-MM-DD" }, { status: 400 });
  }
  if (dateEndParam && !isYmd(dateEndParam)) {
    return NextResponse.json({ success: false, error: "date_end must be YYYY-MM-DD" }, { status: 400 });
  }

  const access = await requireProjectAccessOrInternal(req, projectId, { allowInternalBypass: true });
  if (!access.allowed) return NextResponse.json(access.body, { status: access.status });

  const admin = supabaseAdmin();
  const { data: integration } = await admin
    .from("integrations")
    .select("id")
    .eq("project_id", projectId)
    .eq("platform", "tiktok")
    .maybeSingle();
  if (!integration?.id) {
    return NextResponse.json({ success: false, error: "TikTok integration not found; connect TikTok OAuth first" }, { status: 404 });
  }

  const tr = await getTikTokAccessTokenForApi(admin, integration.id);
  if (!tr.ok) {
    if (tr.kind === "transient") {
      return NextResponse.json(
        {
          success: false,
          error: "TikTok token refresh temporarily failed; retry shortly",
          retryable: true,
        },
        { status: 503 }
      );
    }
    return NextResponse.json(
      { success: false, error: "TikTok auth token not found or expired; reconnect TikTok OAuth" },
      { status: 401 }
    );
  }
  const tokenRef = { access_token: tr.access_token };

  const { data: adAcc } = await admin
    .from("ad_accounts")
    .select("id")
    .eq("integration_id", integration.id)
    .eq("external_account_id", adAccountId)
    .maybeSingle();
  if (!adAcc?.id) {
    return NextResponse.json({ success: false, error: "TikTok ad account not found; discover accounts and save selection first" }, { status: 404 });
  }
  const canonicalAdAccountId = adAcc.id as string;

  const now = new Date();
  const ymd = (d: Date) => d.toISOString().slice(0, 10);
  const defaultStart = new Date(now);
  defaultStart.setDate(1);
  const since = dateStartParam ?? ymd(defaultStart);
  const until = dateEndParam ?? ymd(now);
  if (since > until) {
    return NextResponse.json({ success: false, error: "date_start must be <= date_end", period: { since, until } }, { status: 400 });
  }

  return withSyncLock("tiktok", adAccountId, since, until, "insights", async () => {
    const { id: syncRunId, alreadyRunning } = await startSyncRun(admin, {
      projectId,
      platform: "tiktok",
      adAccountId: canonicalAdAccountId,
      syncType: "insights",
      dateStart: since,
      dateEnd: until,
      metadata: {},
    });

    if (alreadyRunning) {
      return NextResponse.json({ success: true, skipped: true, reason: "already_running" });
    }

    try {
      const accountBase = {
        advertiser_id: adAccountId,
        service_type: "AUCTION",
        data_level: "AUCTION_ADVERTISER",
        report_type: "BASIC",
        dimensions: JSON.stringify(["stat_time_day"]),
        metrics: JSON.stringify(["spend", "impressions", "clicks"]),
        start_date: since,
        end_date: until,
      };

      const { rows: accountRawRows, errorMessage: accountErr, errorCode: accountErrCode, errorHttp: accountErrHttp } =
        await fetchTikTokReportWithOptionalTokenHeal(admin, integration.id, tokenRef, accountBase);
      if (accountErr) {
        await finishSyncRunError(admin, syncRunId, "tiktok_report_fetch_account", { message: accountErr, since, until });
        const transient = isTikTokTransientReportError(accountErrCode, accountErr, accountErrHttp ?? 0);
        const status = transient ? 503 : 400;
        return NextResponse.json(
          {
            success: false,
            step: "tiktok_report_fetch_account",
            error: accountErr,
            period: { since, until },
            ...(transient ? { retryable: true } : {}),
          },
          { status }
        );
      }

      const accountByDate = new Map<string, { spend: number; impressions: number; clicks: number }>();
      for (const r of accountRawRows) {
        const date = getDate(r);
        if (!isYmd(date)) continue;
        const prev = accountByDate.get(date) ?? { spend: 0, impressions: 0, clicks: 0 };
        prev.spend += getSpend(r);
        prev.impressions += getImpressions(r);
        prev.clicks += getClicks(r);
        accountByDate.set(date, prev);
      }
      const accountRows = Array.from(accountByDate.entries()).map(([date, m]) => ({
        project_id: projectId,
        ad_account_id: canonicalAdAccountId,
        campaign_id: null as string | null,
        date,
        platform: "tiktok" as const,
        spend: m.spend,
        impressions: m.impressions,
        clicks: m.clicks,
        reach: 0,
        cpm: 0,
        cpc: 0,
        ctr: 0,
        leads: 0,
        purchases: 0,
        revenue: 0,
        roas: 0,
      }));

      if (accountRows.length > 0) {
        const { error: insAccErr } = await upsertDailyMetricsAccountCompat(admin, accountRows);
        if (insAccErr) {
          const msg = insAccErr.message ?? String(insAccErr);
          await finishSyncRunError(admin, syncRunId, "tiktok_daily_metrics_insert_account", { message: msg, since, until });
          return NextResponse.json(
            { success: false, step: "tiktok_daily_metrics_insert_account", error: msg, period: { since, until } },
            { status: 500 }
          );
        }
      } else if (accountRawRows.length > 0) {
        console.warn("[TIKTOK_SYNC_ACCOUNT_ROWS_ALL_DROPPED_BAD_DATES]", {
          projectId,
          rawRows: accountRawRows.length,
          sample: accountRawRows[0],
        });
      }

      let campaignRowsInserted = 0;
      /** Valid dimensions for integrated report; names come from campaign/get (see applyTiktokCampaignNamesFromApi). */
      const campaignReportDimensions = JSON.stringify(["stat_time_day", "campaign_id"]);
      const campaignAuctionBase = {
        advertiser_id: adAccountId,
        service_type: "AUCTION",
        data_level: "AUCTION_CAMPAIGN",
        report_type: "BASIC",
        dimensions: campaignReportDimensions,
        metrics: JSON.stringify(["spend", "impressions", "clicks"]),
        start_date: since,
        end_date: until,
      };
      const campaignReservationBase = {
        advertiser_id: adAccountId,
        service_type: "RESERVATION",
        data_level: "RESERVATION_CAMPAIGN",
        report_type: "BASIC",
        dimensions: campaignReportDimensions,
        metrics: JSON.stringify(["spend", "impressions", "clicks"]),
        start_date: since,
        end_date: until,
      };

      const { rows: campAuctionRows, errorMessage: campAuctionErr } = await fetchTikTokReportWithOptionalTokenHeal(
        admin,
        integration.id,
        tokenRef,
        campaignAuctionBase
      );
      const { rows: campReservationRows, errorMessage: campReservationErr } = await fetchTikTokReportWithOptionalTokenHeal(
        admin,
        integration.id,
        tokenRef,
        campaignReservationBase
      );
      const campRawRows = [...campAuctionRows, ...campReservationRows];

      if (campRawRows.length === 0) {
        console.warn("[TIKTOK_SYNC_CAMPAIGN_REPORT_EMPTY]", {
          auction_error: campAuctionErr ?? null,
          reservation_error: campReservationErr ?? null,
          since,
          until,
        });
      } else {
        console.log("[TIKTOK_SYNC_CAMPAIGN_REPORT]", {
          auction_rows: campAuctionRows.length,
          reservation_rows: campReservationRows.length,
          merged_rows: campRawRows.length,
        });
      }

      const tiktokCampaignApiNames = await fetchTiktokCampaignNameMap(tokenRef.access_token, adAccountId);
      if (tiktokCampaignApiNames.size > 0) {
        console.log("[TIKTOK_CAMPAIGN_NAMES_RESOLVED]", {
          advertiser_id: adAccountId,
          campaigns_in_api: tiktokCampaignApiNames.size,
        });
      }

      {
        type Agg = { date: string; extId: string; spend: number; impressions: number; clicks: number };
        const aggMap = new Map<string, Agg>();
        const nameByExt = new Map<string, string>();

        for (const r of campRawRows) {
          const date = getDate(r);
          const extId = getCampaignExternalId(r);
          if (!date || !extId || !isYmd(date)) continue;
          const k = `${extId}\t${date}`;
          const prev = aggMap.get(k) ?? { date, extId, spend: 0, impressions: 0, clicks: 0 };
          prev.spend += getSpend(r);
          prev.impressions += getImpressions(r);
          prev.clicks += getClicks(r);
          aggMap.set(k, prev);
          const nm = getCampaignName(r, extId);
          const prevName = nameByExt.get(extId);
          const best =
            nm !== extId ? nm : prevName != null && prevName !== extId ? prevName : extId;
          nameByExt.set(extId, best);
        }

        mergeTiktokReportNamesWithCampaignApi(tiktokCampaignApiNames, nameByExt);

        if (nameByExt.size > 0) {
          const campaignUpsertRows = Array.from(nameByExt.entries()).map(([extId, name]) => ({
            project_id: projectId,
            ad_accounts_id: canonicalAdAccountId,
            external_campaign_id: extId,
            name: name || extId,
            platform: "tiktok" as const,
          }));

          const { error: campUpsertErr } = await admin
            .from("campaigns")
            .upsert(campaignUpsertRows, { onConflict: "ad_accounts_id,external_campaign_id" });

          if (campUpsertErr) {
            console.warn("[TIKTOK_SYNC_CAMPAIGNS_UPSERT_NON_FATAL]", {
              error: campUpsertErr.message ?? campUpsertErr,
              projectId,
            });
          } else {
            const { data: campaignList } = await admin
              .from("campaigns")
              .select("id, external_campaign_id")
              .eq("ad_accounts_id", canonicalAdAccountId)
              .eq("platform", "tiktok");

            const externalToCampaignId = new Map<string, string>();
            const list = (campaignList ?? []) as { id: string; external_campaign_id: string | null }[];
            list.sort((a, b) => a.id.localeCompare(b.id));
            for (const c of list) {
              const raw = c.external_campaign_id != null ? String(c.external_campaign_id).trim() : "";
              if (raw !== "" && !externalToCampaignId.has(raw)) externalToCampaignId.set(raw, c.id);
            }

            const campMetricsRows = [...aggMap.values()]
              .filter((a) => externalToCampaignId.has(a.extId))
              .map((a) => ({
                project_id: projectId,
                ad_account_id: canonicalAdAccountId,
                campaign_id: externalToCampaignId.get(a.extId)!,
                date: a.date,
                platform: "tiktok" as const,
                spend: a.spend,
                impressions: a.impressions,
                clicks: a.clicks,
                reach: 0,
                cpm: 0,
                cpc: 0,
                ctr: 0,
                leads: 0,
                purchases: 0,
                revenue: 0,
                roas: 0,
              }));

            if (campMetricsRows.length > 0) {
              const campIds = [...new Set(campMetricsRows.map((r) => r.campaign_id))];
              const { error: insCampErr } = await upsertDailyMetricsCampaignCompat(admin, campMetricsRows);
              if (insCampErr) {
                console.warn("[TIKTOK_SYNC_DAILY_METRICS_UPSERT_CAMPAIGN_NON_FATAL]", insCampErr);
              } else {
                campaignRowsInserted = campMetricsRows.length;
                console.log("[TIKTOK_SYNC_CAMPAIGN_METRICS_WRITTEN]", {
                  rows: campMetricsRows.length,
                  campaigns: campIds.length,
                });
              }
            }
          }
        }

        await persistTiktokCampaignNamesToDatabase(admin, tiktokCampaignApiNames, canonicalAdAccountId);
      }

      let intentResult: Awaited<ReturnType<typeof applyTiktokMarketingIntentFromAdsApi>> = {
        updatedRetention: 0,
        updatedAcquisition: 0,
        adsScanned: 0,
      };
      try {
        intentResult = await applyTiktokMarketingIntentFromAdsApi(admin, {
          projectId,
          canonicalAdAccountId,
          externalAdvertiserId: adAccountId,
          accessToken: tokenRef.access_token,
        });
      } catch (intentEx) {
        console.warn("[TIKTOK_MARKETING_INTENT_SYNC_EXCEPTION]", intentEx);
      }

      await finishSyncRunSuccess(admin, syncRunId, {
        rowsWritten: accountRows.length + campaignRowsInserted,
        rowsInserted: accountRows.length + campaignRowsInserted,
        campaignRowsInserted,
        accountRowsInserted: accountRows.length,
        rowsDeleted: 0,
        meta: {
          since,
          until,
          ad_account_id_external: adAccountId,
          account_raw_rows: accountRawRows.length,
          campaign_rows_inserted: campaignRowsInserted,
          marketing_intent: intentResult,
        },
      });

      await runPostSyncInvariantChecks(admin, {
        projectId,
        adAccountId: canonicalAdAccountId,
        platform: "tiktok",
        dateStart: since,
        dateEnd: until,
      });

      return NextResponse.json({
        success: true,
        saved: accountRows.length + campaignRowsInserted,
        account_rows: accountRows.length,
        campaign_rows: campaignRowsInserted,
        marketing_intent: intentResult,
        period: { since, until },
        ad_account_id: adAccountId,
        canonical_ad_account_id: canonicalAdAccountId,
      });
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      await finishSyncRunError(admin, syncRunId, "tiktok_sync_exception", { message, since, until });
      return NextResponse.json(
        { success: false, step: "tiktok_sync_exception", error: message, period: { since, until } },
        { status: 500 }
      );
    }
  });
}
