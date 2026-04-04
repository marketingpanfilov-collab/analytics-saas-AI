import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/app/lib/supabaseAdmin";
import { requireProjectAccessOrInternal } from "@/app/lib/auth/requireProjectAccessOrInternal";
import { billingAnalyticsReadGateFromAccess } from "@/app/lib/auth/requireBillingAccess";
import { resolveEnabledAdAccountIdsForProject } from "@/app/lib/dashboardCanonical";

/**
 * GET /api/dashboard/accounts?project_id=...
 * Returns all connected ad accounts for the project (canonical ad_accounts), all platforms.
 * Used by dashboard Sources + Accounts filters. Each account has id, name, platform_account_id, platform, is_enabled.
 */
export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const projectId = searchParams.get("project_id");
  const selectedOnly = searchParams.get("selected_only") === "1";

  if (!projectId) {
    return NextResponse.json({ success: false, error: "project_id required" }, { status: 400 });
  }

  const access = await requireProjectAccessOrInternal(req, projectId);
  if (!access.allowed) {
    console.log("[ACCOUNTS_ACCESS_DENIED]", { projectId, status: access.status });
    return NextResponse.json(access.body, { status: access.status });
  }

  const billing = await billingAnalyticsReadGateFromAccess(access);
  if (!billing.ok) return billing.response;

  const admin = supabaseAdmin();

  const { data: intRows } = await admin
    .from("integrations")
    .select("id")
    .eq("project_id", projectId)
    .in("platform", ["meta", "google", "tiktok"]);

  const integrationIds = (intRows ?? []).map((r: { id: string }) => r.id);
  if (!integrationIds.length) {
    return NextResponse.json({ success: true, accounts: [] });
  }

  const partialErrors: { type: string; message: string }[] = [];

  const { data: adAccounts, error } = await admin
    .from("ad_accounts")
    .select("id, provider, external_account_id, account_name")
    .in("integration_id", integrationIds)
    .order("provider", { ascending: true })
    .order("account_name", { ascending: true });

  if (error) {
    console.log("[DASHBOARD_ACCOUNTS_FETCH_ERROR]", {
      projectId,
      message: error.message,
    });
    partialErrors.push({ type: "ad_accounts_fetch_error", message: error.message });
  }

  const list = adAccounts ?? [];
  const ids = list.map((a: { id: string }) => a.id);

  const canonicalEnabledIds = new Set(await resolveEnabledAdAccountIdsForProject(admin, projectId));

  const coverageMap: Record<string, { min_date: string; max_date: string; row_count: number }> = {};
  if (ids.length > 0) {
    const twoYearsAgo = new Date();
    twoYearsAgo.setFullYear(twoYearsAgo.getFullYear() - 2);
    const fromDate = twoYearsAgo.toISOString().slice(0, 10);
    const { data: metricsRows } = await admin
      .from("daily_ad_metrics")
      .select("ad_account_id, date")
      .in("ad_account_id", ids)
      .gte("date", fromDate);
    const rows = (metricsRows ?? []) as { ad_account_id: string; date: string }[];
    for (const r of rows) {
      const aid = r.ad_account_id;
      if (!coverageMap[aid]) coverageMap[aid] = { min_date: r.date, max_date: r.date, row_count: 0 };
      const c = coverageMap[aid];
      if (r.date < c.min_date) c.min_date = r.date;
      if (r.date > c.max_date) c.max_date = r.date;
      c.row_count += 1;
    }
  }

  // Latest sync run per ad account (one query, no N+1): platform-agnostic sync_runs (Meta + Google)
  const lastSyncMap: Record<string, { last_sync_at: string; last_sync_status: string }> = {};
  if (ids.length > 0) {
    const { data: syncRows } = await admin
      .from("sync_runs")
      .select("ad_account_id, started_at, status")
      .eq("project_id", projectId)
      .eq("sync_type", "insights")
      .in("ad_account_id", ids)
      .order("started_at", { ascending: false })
      .limit(500);
    const syncList = (syncRows ?? []) as { ad_account_id: string | null; started_at: string; status: string }[];
    for (const row of syncList) {
      const aid = row.ad_account_id;
      if (aid && !(aid in lastSyncMap)) {
        lastSyncMap[aid] = { last_sync_at: row.started_at, last_sync_status: row.status };
      }
    }
  }

  const accounts = list.map((a: { id: string; external_account_id: string; provider: string; account_name: string | null }) => {
    const cov = coverageMap[a.id];
    const has_data = !!cov && cov.row_count > 0;
    const is_enabled = canonicalEnabledIds.has(a.id);
    const lastSync = lastSyncMap[a.id];
    return {
      id: a.id,
      name: a.account_name ?? a.external_account_id ?? "Account",
      platform_account_id: a.external_account_id,
      platform: a.provider,
      is_enabled,
      has_data: has_data,
      min_date: cov?.min_date ?? null,
      max_date: cov?.max_date ?? null,
      row_count: cov?.row_count ?? 0,
      last_sync_at: lastSync?.last_sync_at ?? null,
      last_sync_status: lastSync?.last_sync_status ?? null,
    };
  });

  const responseAccounts = selectedOnly ? accounts.filter((a) => a.is_enabled) : accounts;

  return NextResponse.json({
    success: true,
    accounts: responseAccounts,
    ...(partialErrors.length > 0 && { partial_errors: partialErrors }),
  });
}
