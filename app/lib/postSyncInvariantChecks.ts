/**
 * Post-sync invariant checks. Run after successful sync; never throw; write results to data_invariant_checks.
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import { recordInvariantCheck } from "./syncRuns";

type Admin = SupabaseClient;

export type RunPostSyncInvariantChecksParams = {
  projectId: string;
  adAccountId: string;
  platform: string;
  dateStart: string;
  dateEnd: string;
};

function baseDetails(p: RunPostSyncInvariantChecksParams): Record<string, unknown> {
  return {
    ad_account_id: p.adAccountId,
    platform: p.platform,
    date_start: p.dateStart,
    date_end: p.dateEnd,
  };
}

/**
 * Run all invariant checks for the given sync context. Errors are logged only; sync is never broken.
 */
export async function runPostSyncInvariantChecks(
  admin: Admin,
  params: RunPostSyncInvariantChecksParams
): Promise<void> {
  const { projectId, adAccountId, dateStart, dateEnd } = params;
  const details = baseDetails(params);

  try {
    // 1. duplicate_campaign_level_metrics (critical)
    await checkDuplicateCampaignLevel(admin, params, details);
  } catch (e) {
    console.warn("[POST_SYNC_INVARIANT] duplicate_campaign_level_metrics check error:", e);
    await recordInvariantCheck(admin, {
      projectId,
      checkCode: "duplicate_campaign_level_metrics",
      severity: "critical",
      status: "failed",
      details: { ...details, error: String(e) },
    });
  }

  try {
    // 2. duplicate_account_level_metrics (critical)
    await checkDuplicateAccountLevel(admin, params, details);
  } catch (e) {
    console.warn("[POST_SYNC_INVARIANT] duplicate_account_level_metrics check error:", e);
    await recordInvariantCheck(admin, {
      projectId,
      checkCode: "duplicate_account_level_metrics",
      severity: "critical",
      status: "failed",
      details: { ...details, error: String(e) },
    });
  }

  try {
    // 3. orphan_campaign_metrics (critical)
    await checkOrphanCampaignMetrics(admin, params, details);
  } catch (e) {
    console.warn("[POST_SYNC_INVARIANT] orphan_campaign_metrics check error:", e);
    await recordInvariantCheck(admin, {
      projectId,
      checkCode: "orphan_campaign_metrics",
      severity: "critical",
      status: "failed",
      details: { ...details, error: String(e) },
    });
  }

  try {
    // 4. orphan_ad_account_metrics (critical)
    await checkOrphanAdAccountMetrics(admin, params, details);
  } catch (e) {
    console.warn("[POST_SYNC_INVARIANT] orphan_ad_account_metrics check error:", e);
    await recordInvariantCheck(admin, {
      projectId,
      checkCode: "orphan_ad_account_metrics",
      severity: "critical",
      status: "failed",
      details: { ...details, error: String(e) },
    });
  }

  try {
    // 5. zero_rows_after_sync (warning)
    await checkZeroRowsAfterSync(admin, params, details);
  } catch (e) {
    console.warn("[POST_SYNC_INVARIANT] zero_rows_after_sync check error:", e);
    await recordInvariantCheck(admin, {
      projectId,
      checkCode: "zero_rows_after_sync",
      severity: "warning",
      status: "failed",
      details: { ...details, error: String(e) },
    });
  }
}

async function checkDuplicateCampaignLevel(
  admin: Admin,
  params: RunPostSyncInvariantChecksParams,
  details: Record<string, unknown>
): Promise<void> {
  const { projectId, adAccountId, dateStart, dateEnd } = params;
  const { data: rows, error } = await admin
    .from("daily_ad_metrics")
    .select("campaign_id, date")
    .eq("ad_account_id", adAccountId)
    .not("campaign_id", "is", null)
    .gte("date", dateStart)
    .lte("date", dateEnd);

  if (error) {
    await recordInvariantCheck(admin, {
      projectId,
      checkCode: "duplicate_campaign_level_metrics",
      severity: "critical",
      status: "failed",
      details: { ...details, error: error.message },
    });
    return;
  }

  const key = (r: { campaign_id: string; date: string }) => `${r.campaign_id}:${r.date}`;
  const counts: Record<string, number> = {};
  for (const r of rows ?? []) {
    const k = key(r);
    counts[k] = (counts[k] ?? 0) + 1;
  }
  const duplicateGroups = Object.entries(counts).filter(([, c]) => c > 1);
  const failed = duplicateGroups.length > 0;
  const duplicateCount = duplicateGroups.reduce((s, [, c]) => s + c, 0);

  await recordInvariantCheck(admin, {
    projectId,
    checkCode: "duplicate_campaign_level_metrics",
    severity: "critical",
    status: failed ? "failed" : "ok",
    details: {
      ...details,
      count: rows?.length ?? 0,
      duplicate_groups: duplicateGroups.length,
      duplicate_rows: duplicateCount,
    },
  });
}

async function checkDuplicateAccountLevel(
  admin: Admin,
  params: RunPostSyncInvariantChecksParams,
  details: Record<string, unknown>
): Promise<void> {
  const { projectId, adAccountId, dateStart, dateEnd } = params;
  const { data: rows, error } = await admin
    .from("daily_ad_metrics")
    .select("date")
    .eq("ad_account_id", adAccountId)
    .is("campaign_id", null)
    .gte("date", dateStart)
    .lte("date", dateEnd);

  if (error) {
    await recordInvariantCheck(admin, {
      projectId,
      checkCode: "duplicate_account_level_metrics",
      severity: "critical",
      status: "failed",
      details: { ...details, error: error.message },
    });
    return;
  }

  const counts: Record<string, number> = {};
  for (const r of rows ?? []) {
    const d = r.date as string;
    counts[d] = (counts[d] ?? 0) + 1;
  }
  const duplicateDates = Object.entries(counts).filter(([, c]) => c > 1);
  const failed = duplicateDates.length > 0;
  const duplicateCount = duplicateDates.reduce((s, [, c]) => s + c, 0);

  await recordInvariantCheck(admin, {
    projectId,
    checkCode: "duplicate_account_level_metrics",
    severity: "critical",
    status: failed ? "failed" : "ok",
    details: {
      ...details,
      count: rows?.length ?? 0,
      duplicate_dates: duplicateDates.length,
      duplicate_rows: duplicateCount,
    },
  });
}

async function checkOrphanCampaignMetrics(
  admin: Admin,
  params: RunPostSyncInvariantChecksParams,
  details: Record<string, unknown>
): Promise<void> {
  const { projectId, adAccountId, dateStart, dateEnd } = params;
  const { data: metricsRows, error: metricsError } = await admin
    .from("daily_ad_metrics")
    .select("campaign_id")
    .eq("ad_account_id", adAccountId)
    .not("campaign_id", "is", null)
    .gte("date", dateStart)
    .lte("date", dateEnd);

  if (metricsError) {
    await recordInvariantCheck(admin, {
      projectId,
      checkCode: "orphan_campaign_metrics",
      severity: "critical",
      status: "failed",
      details: { ...details, error: metricsError.message },
    });
    return;
  }

  const campaignIds = [...new Set((metricsRows ?? []).map((r) => r.campaign_id))];
  if (campaignIds.length === 0) {
    await recordInvariantCheck(admin, {
      projectId,
      checkCode: "orphan_campaign_metrics",
      severity: "critical",
      status: "ok",
      details: { ...details, count: 0 },
    });
    return;
  }

  const { data: campaigns, error: campError } = await admin
    .from("campaigns")
    .select("id")
    .in("id", campaignIds);

  if (campError) {
    await recordInvariantCheck(admin, {
      projectId,
      checkCode: "orphan_campaign_metrics",
      severity: "critical",
      status: "failed",
      details: { ...details, error: campError.message },
    });
    return;
  }

  const existingSet = new Set((campaigns ?? []).map((c) => c.id));
  const orphanRows = (metricsRows ?? []).filter((r) => !existingSet.has(r.campaign_id));
  const failed = orphanRows.length > 0;

  await recordInvariantCheck(admin, {
    projectId,
    checkCode: "orphan_campaign_metrics",
    severity: "critical",
    status: failed ? "failed" : "ok",
    details: {
      ...details,
      metrics_rows: metricsRows?.length ?? 0,
      orphan_rows: orphanRows.length,
    },
  });
}

async function checkOrphanAdAccountMetrics(
  admin: Admin,
  params: RunPostSyncInvariantChecksParams,
  details: Record<string, unknown>
): Promise<void> {
  const { projectId, adAccountId } = params;
  const { data: account, error } = await admin
    .from("ad_accounts")
    .select("id")
    .eq("id", adAccountId)
    .maybeSingle();

  if (error) {
    await recordInvariantCheck(admin, {
      projectId,
      checkCode: "orphan_ad_account_metrics",
      severity: "critical",
      status: "failed",
      details: { ...details, error: error.message },
    });
    return;
  }

  const failed = account == null;

  await recordInvariantCheck(admin, {
    projectId,
    checkCode: "orphan_ad_account_metrics",
    severity: "critical",
    status: failed ? "failed" : "ok",
    details: { ...details, ad_account_exists: !failed },
  });
}

async function checkZeroRowsAfterSync(
  admin: Admin,
  params: RunPostSyncInvariantChecksParams,
  details: Record<string, unknown>
): Promise<void> {
  const { projectId, adAccountId, dateStart, dateEnd } = params;
  const { count, error } = await admin
    .from("daily_ad_metrics")
    .select("id", { count: "exact", head: true })
    .eq("ad_account_id", adAccountId)
    .gte("date", dateStart)
    .lte("date", dateEnd);

  if (error) {
    await recordInvariantCheck(admin, {
      projectId,
      checkCode: "zero_rows_after_sync",
      severity: "warning",
      status: "failed",
      details: { ...details, error: error.message },
    });
    return;
  }

  const failed = (count ?? 0) === 0;

  await recordInvariantCheck(admin, {
    projectId,
    checkCode: "zero_rows_after_sync",
    severity: "warning",
    status: failed ? "failed" : "ok",
    details: { ...details, row_count: count ?? 0 },
  });
}
