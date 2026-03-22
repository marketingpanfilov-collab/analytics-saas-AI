import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/app/lib/supabaseAdmin";
import { requireProjectAccessOrInternal, getInternalSyncHeaders } from "@/app/lib/auth/requireProjectAccessOrInternal";

function isUuid(v: string) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
    v
  );
}

function isYmd(v: string) {
  return /^\d{4}-\d{2}-\d{2}$/.test(v);
}

/**
 * POST /api/dashboard/sync?project_id=...&start=...&end=...
 *
 * Syncs the given date range for the project: Meta (if connected) and all enabled Google accounts.
 * Used by backfill and by dashboard refresh flow.
 */
export async function POST(req: Request) {
  const { searchParams } = new URL(req.url);
  const projectId = searchParams.get("project_id") ?? "";
  const start = searchParams.get("start") ?? "";
  const end = searchParams.get("end") ?? "";
  console.log("[DASHBOARD_SYNC_ENTER]", {
    start,
    end,
    projectId,
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

  const access = await requireProjectAccessOrInternal(req, projectId, { allowInternalBypass: true });
  if (!access.allowed) {
    console.log("[DASHBOARD_SYNC_ACCESS_DENIED]", { projectId, status: access.status });
    return NextResponse.json(access.body, { status: access.status });
  }

  const admin = supabaseAdmin();
  const baseUrl = new URL(req.url).origin;
  const warnings: { platform: string; ad_account_id?: string; error: string; status?: number }[] = [];

  // --- Unified: only sync accounts with ad_account_settings.is_enabled = true ---
  const { data: settingsRows } = await admin
    .from("ad_account_settings")
    .select("ad_account_id")
    .eq("project_id", projectId)
    .eq("is_enabled", true);

  const enabledAdAccountIds = (settingsRows ?? []).map((r: { ad_account_id: string }) => r.ad_account_id);
  if (enabledAdAccountIds.length === 0) {
    return NextResponse.json(
      { success: false, error: "No enabled ad accounts; enable accounts in Settings or Accounts" },
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

  // --- Meta: sync each enabled Meta account with the same start/end (no substitution) ---
  for (const acc of metaAccounts) {
    const externalId = acc.external_account_id;
    if (!externalId) continue;
    const metaSyncUrl = new URL("/api/oauth/meta/insights/sync", req.url);
    metaSyncUrl.searchParams.set("project_id", projectId);
    metaSyncUrl.searchParams.set("ad_account_id", externalId);
    metaSyncUrl.searchParams.set("date_start", start);
    metaSyncUrl.searchParams.set("date_stop", end);
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
      const gRes = await fetch(googleSyncUrl.toString(), {
        method: "GET",
        headers: getInternalSyncHeaders(),
      });
      const gJson = await gRes.json().catch(() => ({}));
      if (!gRes.ok || gJson?.success === false) {
        const errMsg = gJson?.error ?? "Google sync failed";
        warnings.push({ platform: "google", ad_account_id: externalId, error: errMsg, status: gRes.status });
      }
    } catch (e) {
      const errMsg = e instanceof Error ? e.message : String(e);
      warnings.push({ platform: "google", ad_account_id: externalId, error: errMsg });
    }
  }

  return NextResponse.json({
    success: true,
    ...(warnings.length > 0 && { warnings, partial: true }),
  });
}
