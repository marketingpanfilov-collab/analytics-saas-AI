import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/app/lib/supabaseAdmin";

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
  console.log("[DASHBOARD_SYNC_ENTER]", { project_id: projectId, start, end });

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

  const admin = supabaseAdmin();
  const baseUrl = new URL(req.url).origin;
  const warnings: { platform: string; ad_account_id?: string; error: string; status?: number }[] = [];

  // --- Meta: resolve one Meta ad account and sync if present (non-fatal on failure) ---
  const { data: metaIntegrations, error: intErr } = await admin
    .from("integrations")
    .select("id")
    .eq("project_id", projectId)
    .eq("platform", "meta");

  if (intErr) {
    console.error("[DASHBOARD_SYNC_META_ERROR]", { projectId, start, end, error: intErr.message });
    warnings.push({ platform: "meta", error: intErr.message ?? "Failed to resolve integrations" });
  }

  let metaSynced = false;
  if (metaIntegrations?.length) {
    const integrationIds = metaIntegrations.map((i: { id: string }) => i.id);
    const { data: metaAdAccounts, error: adErr } = await admin
      .from("ad_accounts")
      .select("external_account_id")
      .in("integration_id", integrationIds)
      .limit(1);

    if (!adErr && metaAdAccounts?.[0]?.external_account_id) {
      const adAccountId = metaAdAccounts[0].external_account_id as string;
      console.log("[DASHBOARD_SYNC_META]", { projectId, start, end, adAccountId });
      const metaSyncUrl = new URL("/api/oauth/meta/insights/sync", req.url);
      metaSyncUrl.searchParams.set("project_id", projectId);
      metaSyncUrl.searchParams.set("ad_account_id", adAccountId);
      metaSyncUrl.searchParams.set("date_start", start);
      metaSyncUrl.searchParams.set("date_stop", end);
      try {
        const syncRes = await fetch(metaSyncUrl.toString(), { method: "GET" });
        const syncJson = await syncRes.json().catch(() => ({}));
        console.log("[DASHBOARD_SYNC_META_RESPONSE]", { status: syncRes.status, body: syncJson });
        if (syncRes.ok && syncJson?.success !== false) metaSynced = true;
        else {
          const errMsg = syncJson?.error ?? syncJson?.meta_error?.message ?? "Meta sync failed";
          console.error("[DASHBOARD_SYNC_META_FAILED]", { projectId, start, end, ad_account_id: adAccountId, status: syncRes.status, error: errMsg });
          warnings.push({ platform: "meta", ad_account_id: adAccountId, error: errMsg, status: syncRes.status });
        }
      } catch (e) {
        const errMsg = e instanceof Error ? e.message : String(e);
        console.error("[DASHBOARD_SYNC_META_FAILED]", { projectId, start, end, ad_account_id: adAccountId, error: errMsg });
        warnings.push({ platform: "meta", ad_account_id: adAccountId, error: errMsg });
      }
    }
  }

  // --- Google: enabled ad accounts, sync each (non-fatal per account) ---
  const { data: settingsRows } = await admin
    .from("ad_account_settings")
    .select("ad_account_id")
    .eq("project_id", projectId)
    .eq("is_enabled", true);

  const enabledAdAccountIds = (settingsRows ?? []).map((r: { ad_account_id: string }) => r.ad_account_id);
  let googleSyncedCount = 0;
  if (enabledAdAccountIds.length > 0) {
    const { data: googleAccounts } = await admin
      .from("ad_accounts")
      .select("id, external_account_id")
      .in("id", enabledAdAccountIds)
      .eq("provider", "google");

    for (const acc of googleAccounts ?? []) {
      const externalId = (acc as { external_account_id: string | null }).external_account_id;
      if (!externalId) continue;
      const googleSyncUrl = new URL(`${baseUrl}/api/oauth/google/insights/sync`);
      googleSyncUrl.searchParams.set("project_id", projectId);
      googleSyncUrl.searchParams.set("ad_account_id", externalId);
      googleSyncUrl.searchParams.set("date_start", start);
      googleSyncUrl.searchParams.set("date_end", end);
      console.log("[DASHBOARD_SYNC_GOOGLE]", { projectId, start, end, ad_account_id: externalId });
      try {
        const gRes = await fetch(googleSyncUrl.toString(), { method: "GET" });
        const gJson = await gRes.json().catch(() => ({}));
        console.log("[DASHBOARD_SYNC_GOOGLE_RESPONSE]", { status: gRes.status, body: gJson });
        if (gRes.ok && gJson?.success !== false) googleSyncedCount += 1;
        else {
          const errMsg = gJson?.error ?? "Google sync failed";
          console.error("[DASHBOARD_SYNC_GOOGLE_FAILED]", { projectId, start, end, ad_account_id: externalId, status: gRes.status, error: errMsg, body: gJson });
          warnings.push({ platform: "google", ad_account_id: externalId, error: errMsg, status: gRes.status });
        }
      } catch (e) {
        const errMsg = e instanceof Error ? e.message : String(e);
        console.error("[DASHBOARD_SYNC_GOOGLE_FAILED]", { projectId, start, end, ad_account_id: externalId, error: errMsg });
        warnings.push({ platform: "google", ad_account_id: externalId, error: errMsg });
      }
    }
  }

  const hasAnyAccount = (metaIntegrations?.length ?? 0) > 0 || enabledAdAccountIds.length > 0;
  if (!hasAnyAccount) {
    return NextResponse.json(
      { success: false, error: "No Meta or enabled Google account connected" },
      { status: 404 }
    );
  }

  return NextResponse.json({
    success: true,
    ...(warnings.length > 0 && { warnings, partial: true }),
  });
}
