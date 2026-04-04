import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/app/lib/supabaseAdmin";
import {
  requireProjectAccessOrInternal,
  getInternalSyncHeaders,
  isInternalSyncRequest,
} from "@/app/lib/auth/requireProjectAccessOrInternal";
import { billingHeavySyncGateBeforeProject } from "@/app/lib/auth/requireBillingAccess";
import { checkRateLimit } from "@/app/lib/security/rateLimit";
import { resolveEnabledAdAccountIdsForProject } from "@/app/lib/dashboardCanonical";
import { dashboardCacheInvalidateProject } from "@/app/lib/dashboardCache";

function isUuid(v: string) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
    v
  );
}

function isYmd(v: string) {
  return /^\d{4}-\d{2}-\d{2}$/.test(v);
}

function sleepMs(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

async function fetchInsightsSyncWithOptionalRetry(
  url: string,
  headers: HeadersInit
): Promise<{ res: Response; json: unknown }> {
  const run = async () => {
    const res = await fetch(url, { method: "GET", headers });
    const json = await res.json().catch(() => ({}));
    return { res, json };
  };
  let { res, json } = await run();
  const retryable = res.status === 503 && (json as { retryable?: boolean })?.retryable === true;
  if (retryable) {
    await sleepMs(650);
    ({ res, json } = await run());
  }
  return { res, json };
}

/**
 * POST /api/dashboard/sync?project_id=...&start=...&end=...&date_origin=...
 *
 * Syncs the given date range for the project: Meta (if connected), all enabled Google accounts,
 * and all enabled TikTok accounts.
 * Used by backfill and by dashboard refresh flow.
 *
 * `date_origin=utc_today` (internal cron only): start/end are UTC calendar days; forwarded to Meta
 * so single-day "today" sync maps to the ad account timezone (matches Ads Manager).
 */
export async function POST(req: Request) {
  const { searchParams } = new URL(req.url);
  const projectId = searchParams.get("project_id") ?? "";
  const start = searchParams.get("start") ?? "";
  const end = searchParams.get("end") ?? "";
  const dateOrigin = (searchParams.get("date_origin") ?? "").trim();
  console.log("[DASHBOARD_SYNC_ENTER]", {
    start,
    end,
    projectId,
    date_origin: dateOrigin || null,
    received_range: { start, end },
  });

  if (!projectId || !start || !end) {
    return NextResponse.json(
      { success: false, error: "project_id, start, end required" },
      { status: 400 }
    );
  }

  if (!isUuid(projectId)) {
    return NextResponse.json(
      { success: false, error: "project_id must be a valid UUID" },
      { status: 400 }
    );
  }

  if (!isYmd(start) || !isYmd(end)) {
    return NextResponse.json(
      { success: false, error: "start and end must be YYYY-MM-DD" },
      { status: 400 }
    );
  }

  if (start > end) {
    return NextResponse.json(
      { success: false, error: "start must be <= end" },
      { status: 400 }
    );
  }

  if (!isInternalSyncRequest(req)) {
    const billingPre = await billingHeavySyncGateBeforeProject(req);
    if (!billingPre.ok) return billingPre.response;
  }

  const access = await requireProjectAccessOrInternal(req, projectId, { allowInternalBypass: true });
  if (!access.allowed) {
    console.log("[DASHBOARD_SYNC_ACCESS_DENIED]", { projectId, status: access.status });
    return NextResponse.json(access.body, { status: access.status });
  }

  // Soft dedup guard: suppress burst duplicate sync dispatches for same project/range.
  const dedupKey = `dashboard-sync-dispatch:${projectId}:${start}:${end}:${dateOrigin}`;
  const dedup = await checkRateLimit(dedupKey, 1, 20_000);
  if (!dedup.ok) {
    return NextResponse.json({ success: true, skipped: true, reason: "dedup_recent_dispatch" });
  }

  const admin = supabaseAdmin();
  const baseUrl = new URL(req.url).origin;
  const warnings: { platform: string; ad_account_id?: string; error: string; status?: number }[] = [];

  // Same rules as canonical dashboard: TikTok/Google/Yandex default-on without ad_account_settings row.
  const enabledAdAccountIds = await resolveEnabledAdAccountIdsForProject(admin, projectId);
  if (enabledAdAccountIds.length === 0) {
    return NextResponse.json(
      { success: false, error: "No enabled ad accounts; connect integrations or enable accounts in Settings" },
      { status: 404 }
    );
  }

  const { data: enabledAccounts, error: adErr } = await admin
    .from("ad_accounts")
    .select("id, external_account_id, provider")
    .in("id", enabledAdAccountIds);

  if (adErr || !enabledAccounts?.length) {
    return NextResponse.json(
      { success: false, error: "Failed to resolve enabled ad accounts" },
      { status: 500 }
    );
  }

  const metaAccounts = (enabledAccounts as { id: string; external_account_id: string; provider: string }[]).filter(
    (a) => a.provider === "meta"
  );
  const googleAccounts = (enabledAccounts as { id: string; external_account_id: string; provider: string }[]).filter(
    (a) => a.provider === "google"
  );
  const tiktokAccounts = (enabledAccounts as { id: string; external_account_id: string; provider: string }[]).filter(
    (a) => a.provider === "tiktok"
  );

  // --- Meta: sync each enabled Meta account with the same start/end (no substitution) ---
  for (const acc of metaAccounts) {
    const externalId = acc.external_account_id;
    if (!externalId) continue;
    const metaSyncUrl = new URL("/api/oauth/meta/insights/sync", req.url);
    metaSyncUrl.searchParams.set("project_id", projectId);
    metaSyncUrl.searchParams.set("ad_account_id", externalId);
    metaSyncUrl.searchParams.set("date_start", start);
    metaSyncUrl.searchParams.set("date_stop", end);
    if (dateOrigin) metaSyncUrl.searchParams.set("date_origin", dateOrigin);
    console.log("[DASHBOARD_SYNC_META]", {
      ad_account_id: externalId,
      date_start: start,
      date_stop: end,
      projectId,
      meta_sync_url: metaSyncUrl.toString(),
    });
    try {
      const syncRes = await fetch(metaSyncUrl.toString(), {
        method: "GET",
        headers: getInternalSyncHeaders(),
      });
      const syncJson = await syncRes.json().catch(() => ({}));
      if (!syncRes.ok || syncJson?.success === false) {
        const errMsg = syncJson?.error ?? syncJson?.meta_error?.message ?? "Meta sync failed";
        warnings.push({ platform: "meta", ad_account_id: externalId, error: errMsg, status: syncRes.status });
      } else {
        try {
          const intentUrl = new URL("/api/oauth/meta/campaign-marketing-intent/sync", req.url);
          intentUrl.searchParams.set("project_id", projectId);
          intentUrl.searchParams.set("ad_account_id", externalId);
          const ir = await fetch(intentUrl.toString(), {
            method: "GET",
            headers: getInternalSyncHeaders(),
          });
          if (!ir.ok) {
            const ij = await ir.json().catch(() => ({}));
            warnings.push({
              platform: "meta",
              ad_account_id: externalId,
              error: `marketing_intent sync: ${ij?.error ?? ir.status}`,
              status: ir.status,
            });
          }
        } catch (e) {
          warnings.push({
            platform: "meta",
            ad_account_id: externalId,
            error: e instanceof Error ? e.message : String(e),
          });
        }
      }
    } catch (e) {
      const errMsg = e instanceof Error ? e.message : String(e);
      warnings.push({ platform: "meta", ad_account_id: externalId, error: errMsg });
    }
  }

  // --- Google: sync each enabled Google account (non-fatal per account) ---
  for (const acc of googleAccounts) {
    const externalId = acc.external_account_id;
    if (!externalId) continue;
    const googleSyncUrl = new URL(`${baseUrl}/api/oauth/google/insights/sync`);
    googleSyncUrl.searchParams.set("project_id", projectId);
    googleSyncUrl.searchParams.set("ad_account_id", externalId);
    googleSyncUrl.searchParams.set("date_start", start);
    googleSyncUrl.searchParams.set("date_end", end);
    console.log("[DASHBOARD_SYNC_GOOGLE]", { projectId, start, end, ad_account_id: externalId });
    try {
      const { res: gRes, json: gJson } = await fetchInsightsSyncWithOptionalRetry(
        googleSyncUrl.toString(),
        getInternalSyncHeaders()
      );
      const gBody = gJson as { success?: boolean; error?: string };
      if (!gRes.ok || gBody.success === false) {
        const errMsg = gBody.error ?? "Google sync failed";
        warnings.push({ platform: "google", ad_account_id: externalId, error: errMsg, status: gRes.status });
      }
    } catch (e) {
      const errMsg = e instanceof Error ? e.message : String(e);
      warnings.push({ platform: "google", ad_account_id: externalId, error: errMsg });
    }
  }

  // --- TikTok: sync each enabled TikTok account (non-fatal per account) ---
  for (const acc of tiktokAccounts) {
    const externalId = acc.external_account_id;
    if (!externalId) continue;
    const tiktokSyncUrl = new URL("/api/oauth/tiktok/insights/sync", req.url);
    tiktokSyncUrl.searchParams.set("project_id", projectId);
    // TikTok route expects "ad_account_id" as the external advertiser/account id from our DB.
    tiktokSyncUrl.searchParams.set("ad_account_id", externalId);
    tiktokSyncUrl.searchParams.set("date_start", start);
    tiktokSyncUrl.searchParams.set("date_end", end);
    console.log("[DASHBOARD_SYNC_TIKTOK]", { projectId, start, end, ad_account_id: externalId });

    try {
      const { res: tRes, json: tJson } = await fetchInsightsSyncWithOptionalRetry(
        tiktokSyncUrl.toString(),
        getInternalSyncHeaders()
      );
      const tBody = tJson as { success?: boolean; error?: string; step?: string };
      if (!tRes.ok || tBody.success === false) {
        const errMsg = tBody.error ?? tBody.step ?? "TikTok sync failed";
        warnings.push({ platform: "tiktok", ad_account_id: externalId, error: errMsg, status: tRes.status });
      }
    } catch (e) {
      const errMsg = e instanceof Error ? e.message : String(e);
      warnings.push({ platform: "tiktok", ad_account_id: externalId, error: errMsg });
    }
  }

  dashboardCacheInvalidateProject(projectId);

  return NextResponse.json({
    success: true,
    ...(warnings.length > 0 && { warnings, partial: true }),
  });
}
