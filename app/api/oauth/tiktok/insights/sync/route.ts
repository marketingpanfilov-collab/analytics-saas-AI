import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/app/lib/supabaseAdmin";
import { getValidTikTokAccessToken } from "@/app/lib/tiktokAdsAuth";
import { requireProjectAccessOrInternal } from "@/app/lib/auth/requireProjectAccessOrInternal";
import { withSyncLock } from "@/app/lib/syncLock";
import { startSyncRun, finishSyncRunSuccess, finishSyncRunError } from "@/app/lib/syncRuns";

function isUuid(v: string) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(v);
}
function isYmd(v: string) {
  return /^\d{4}-\d{2}-\d{2}$/.test(v);
}

type TikTokReportRow = {
  stat_time_day?: string;
  spend?: string;
  cost?: string;
  impressions?: string;
  clicks?: string;
  dimensions?: {
    stat_time_day?: string;
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
  };
};

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

  const token = await getValidTikTokAccessToken(admin, integration.id);
  if (!token) {
    return NextResponse.json({ success: false, error: "TikTok auth token not found or expired; reconnect TikTok OAuth" }, { status: 401 });
  }

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
      const params = new URLSearchParams({
        advertiser_id: adAccountId,
        service_type: "AUCTION",
        data_level: "AUCTION_ADVERTISER",
        report_type: "BASIC",
        dimensions: JSON.stringify(["stat_time_day"]),
        metrics: JSON.stringify(["spend", "impressions", "clicks"]),
        start_date: since,
        end_date: until,
        page: "1",
        page_size: "1000",
      });

      const reportRes = await fetch(
        `https://business-api.tiktok.com/open_api/v1.3/report/integrated/get/?${params.toString()}`,
        {
          method: "GET",
          headers: {
            "Access-Token": token.access_token,
            "Content-Type": "application/json",
          },
        }
      );
      const reportJson = (await reportRes.json().catch(() => ({}))) as TikTokReportResponse;
      if (!reportRes.ok || Number(reportJson.code ?? 0) !== 0) {
        const message = reportJson.message || `TikTok report API error: ${reportRes.status}`;
        await finishSyncRunError(admin, syncRunId, "tiktok_report_fetch", { message, since, until });
        return NextResponse.json({ success: false, step: "tiktok_report_fetch", error: message, period: { since, until } }, { status: 400 });
      }

      const toNum = (v: unknown): number => {
        const n = Number(v ?? 0);
        return Number.isFinite(n) ? n : 0;
      };

      const getDate = (r: TikTokReportRow): string => {
        return String(
          r.stat_time_day ??
          r.dimensions?.stat_time_day ??
          ""
        ).slice(0, 10);
      };

      const getSpend = (r: TikTokReportRow): number => {
        return toNum(
          r.spend ??
          r.cost ??
          r.metrics?.spend ??
          r.metrics?.cost ??
          0
        );
      };

      const getImpressions = (r: TikTokReportRow): number => {
        return toNum(r.impressions ?? r.metrics?.impressions ?? 0);
      };

      const getClicks = (r: TikTokReportRow): number => {
        return toNum(r.clicks ?? r.metrics?.clicks ?? 0);
      };

      const rawRows = reportJson.data?.list ?? [];
      const rows = rawRows.map((r) => ({
        project_id: projectId,
        ad_account_id: canonicalAdAccountId,
        campaign_id: null as string | null,
        date: getDate(r),
        platform: "tiktok" as const,
        spend: getSpend(r),
        impressions: getImpressions(r),
        clicks: getClicks(r),
        reach: 0,
        cpm: 0,
        cpc: 0,
        ctr: 0,
        leads: 0,
        purchases: 0,
        revenue: 0,
        roas: 0,
      })).filter((r) => isYmd(r.date));

      const dates = [...new Set(rows.map((r) => r.date))];
      if (dates.length > 0) {
        await admin
          .from("daily_ad_metrics")
          .delete()
          .eq("ad_account_id", canonicalAdAccountId)
          .is("campaign_id", null)
          .in("date", dates);
        await admin.from("daily_ad_metrics").insert(rows);
      }

      await finishSyncRunSuccess(admin, syncRunId, {
        rowsWritten: rows.length,
        rowsInserted: rows.length,
        campaignRowsInserted: 0,
        accountRowsInserted: rows.length,
        rowsDeleted: 0,
        meta: {
          since,
          until,
          ad_account_id_external: adAccountId,
          raw_rows: rawRows.length,
          mapped_rows: rows.length,
        },
      });

      return NextResponse.json({
        success: true,
        saved: rows.length,
        account_rows: rows.length,
        campaign_rows: 0,
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
