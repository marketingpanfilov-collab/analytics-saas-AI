/**
 * Canonical dashboard data from daily_ad_metrics.
 * Used for summary, timeseries, and metrics routes with legacy fallback.
 */
import type { SupabaseClient } from "@supabase/supabase-js";

export type CanonicalSummary = {
  spend: number;
  impressions: number;
  clicks: number;
  leads: number;
  purchases: number;
  revenue: number;
  roas: number;
  min_day: string | null;
  max_day: string | null;
  campaigns_cnt: number | null;
};

export type CanonicalPoint = {
  day: string;
  spend: number;
  clicks: number;
  purchases: number;
  revenue: number;
  roas: number;
};

export type CanonicalMetricsRow = {
  day: string;
  spend: number;
  clicks: number;
  purchases: number;
};

const ALLOWED_PLATFORMS = ["meta", "google", "tiktok", "yandex"] as const;

function normalizeSources(sources: string[] | null | undefined): string[] {
  if (!sources?.length) return [];
  return sources
    .map((s) => s.toLowerCase().trim())
    .filter((s) => ALLOWED_PLATFORMS.includes(s as any));
}

/**
 * Resolve ad_account ids for a project, optionally filtered by sources and/or specific account IDs.
 * Includes Meta (via integrations_meta) and Google (via integrations where platform = 'google').
 */
async function resolveAdAccountIds(
  admin: SupabaseClient,
  projectId: string,
  sources?: string[] | null,
  accountIds?: string[] | null
): Promise<string[]> {
  const metaRows = await admin
    .from("integrations_meta")
    .select("integrations_id")
    .eq("project_id", projectId);
  const metaIds = [...new Set((metaRows.data ?? []).map((r: { integrations_id: string | null }) => r.integrations_id).filter(Boolean))] as string[];

  const googleRows = await admin
    .from("integrations")
    .select("id")
    .eq("project_id", projectId)
    .eq("platform", "google");
  const googleIds = (googleRows.data ?? []).map((r: { id: string }) => r.id);

  let integrationIds: string[] = [...new Set([...metaIds, ...googleIds])];
  if (!integrationIds.length) {
    const allInt = await admin.from("integrations").select("id").eq("project_id", projectId);
    integrationIds = (allInt.data ?? []).map((r: { id: string }) => r.id);
  }
  if (!integrationIds.length) return [];

  const { data: adAccounts } = await admin
    .from("ad_accounts")
    .select("id, provider")
    .in("integration_id", integrationIds);

  let list = adAccounts ?? [];
  const normalizedSources = normalizeSources(sources ?? []);
  if (normalizedSources.length > 0) {
    list = list.filter((a: { provider: string }) => normalizedSources.includes(a.provider));
  }
  if (accountIds?.length) {
    const idSet = new Set(accountIds);
    list = list.filter((a: { id: string }) => idSet.has(a.id));
  }
  return list.map((a: { id: string }) => a.id);
}

/**
 * Fetch daily_ad_metrics for a project and date range.
 * Uses daily_ad_metrics_campaign (campaign_id IS NOT NULL) so account-level rows are excluded
 * and board aggregation does not double-count. Meta and Google campaign-level rows only.
 * sources: filter by platform (meta, google, ...). Empty = all.
 * accountIds: filter by ad_accounts.id. Empty = all (for resolved sources).
 */
async function fetchCanonicalRowsViaJoin(
  admin: SupabaseClient,
  projectId: string,
  start: string,
  end: string,
  options?: { sources?: string[] | null; accountIds?: string[] | null }
): Promise<
  { date: string; spend: number; impressions: number; clicks: number; leads: number; purchases: number; revenue: number }[]
> {
  const adAccountIds = await resolveAdAccountIds(
    admin,
    projectId,
    options?.sources,
    options?.accountIds
  );
  if (!adAccountIds.length) return [];

  const { data, error } = await admin
    .from("daily_ad_metrics_campaign")
    .select("date, spend, impressions, clicks, leads, purchases, revenue")
    .in("ad_account_id", adAccountIds)
    .in("platform", ["meta", "google"])
    .gte("date", start)
    .lte("date", end);

  if (error) {
    console.log("[CANONICAL_QUERY_ERROR]", { error: String(error?.message ?? error) });
    throw error;
  }

  const rawRows = (data ?? []) as Record<string, unknown>[];
  const rows = rawRows as {
    date: string;
    spend: number | null;
    impressions: number | null;
    clicks: number | null;
    leads: number | null;
    purchases: number | null;
    revenue: number | null;
  }[];

  console.log("[CANONICAL_FETCH]", {
    projectId,
    start,
    end,
    sources: options?.sources ?? "all",
    accountIdsCount: options?.accountIds?.length ?? "all",
    adAccountIdsCount: adAccountIds.length,
    rowCount: rows.length,
  });

  return rows.map((r) => ({
    date: String(r.date).slice(0, 10),
    spend: Number(r.spend ?? 0) || 0,
    impressions: Number(r.impressions ?? 0) || 0,
    clicks: Number(r.clicks ?? 0) || 0,
    leads: Number(r.leads ?? 0) || 0,
    purchases: Number(r.purchases ?? 0) || 0,
    revenue: Number(r.revenue ?? 0) || 0,
  }));
}

export type CanonicalFilterOptions = {
  sources?: string[] | null;
  accountIds?: string[] | null;
};

/**
 * Get canonical summary (totals) for a project and date range.
 * options.sources: filter by platform; empty = all. options.accountIds: filter by ad_accounts.id; empty = all.
 */
export async function getCanonicalSummary(
  admin: SupabaseClient,
  projectId: string,
  start: string,
  end: string,
  options?: CanonicalFilterOptions | null
): Promise<{ data: CanonicalSummary; rowCount: number } | null> {
  try {
    const rows = await fetchCanonicalRowsViaJoin(admin, projectId, start, end, options ?? undefined);
    const inputRowCount = rows.length;
    if (inputRowCount === 0) {
      console.log("[CANONICAL_SUMMARY_AGG]", { inputRowCount: 0, spend: 0, impressions: 0, clicks: 0, reason: "no rows" });
      return null;
    }

    const spend = rows.reduce((s, r) => s + r.spend, 0);
    const impressions = rows.reduce((s, r) => s + r.impressions, 0);
    const clicks = rows.reduce((s, r) => s + r.clicks, 0);
    const leads = rows.reduce((s, r) => s + r.leads, 0);
    const purchases = rows.reduce((s, r) => s + r.purchases, 0);
    const revenue = rows.reduce((s, r) => s + r.revenue, 0);
    console.log("[CANONICAL_SUMMARY_AGG]", { inputRowCount, spend, impressions, clicks });
    const dates = rows.map((r) => r.date);
    const minDay = dates.length ? dates.reduce((a, b) => (a < b ? a : b)) : null;
    const maxDay = dates.length ? dates.reduce((a, b) => (a > b ? a : b)) : null;

    return {
      data: {
        spend,
        impressions,
        clicks,
        leads,
        purchases,
        revenue,
        roas: spend > 0 ? revenue / spend : 0,
        min_day: minDay,
        max_day: maxDay,
        campaigns_cnt: null, // not aggregated in daily_ad_metrics
      },
      rowCount: rows.length,
    };
  } catch {
    return null;
  }
}

/**
 * Get canonical timeseries (points per day). options: sources and/or accountIds filter.
 */
export async function getCanonicalTimeseries(
  admin: SupabaseClient,
  projectId: string,
  start: string,
  end: string,
  options?: CanonicalFilterOptions | null
): Promise<CanonicalPoint[] | null> {
  try {
    const rows = await fetchCanonicalRowsViaJoin(admin, projectId, start, end, options ?? undefined);
    if (rows.length === 0) {
      console.log("[CANONICAL_TIMESERIES_PATH]", { used: "rpc", reason: "no rows" });
      return null;
    }

    console.log("[CANONICAL_TIMESERIES_PATH]", { used: "canonical", rowCount: rows.length });
    const byDate = new Map<
      string,
      { spend: number; clicks: number; leads: number; purchases: number; revenue: number }
    >();
    for (const r of rows) {
      const cur = byDate.get(r.date) ?? {
        spend: 0,
        clicks: 0,
        leads: 0,
        purchases: 0,
        revenue: 0,
      };
      cur.spend += r.spend;
      cur.clicks += r.clicks;
      cur.leads += r.leads;
      cur.purchases += r.purchases;
      cur.revenue += r.revenue;
      byDate.set(r.date, cur);
    }

    const points: CanonicalPoint[] = Array.from(byDate.entries())
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([day, agg]) => ({
        day,
        spend: agg.spend,
        clicks: agg.clicks,
        purchases: agg.purchases,
        revenue: agg.revenue,
        roas: agg.spend > 0 ? agg.revenue / agg.spend : 0,
      }));

    return points;
  } catch {
    return null;
  }
}

/**
 * Get canonical metrics (daily rows). options: sources and/or accountIds filter.
 */
export async function getCanonicalMetrics(
  admin: SupabaseClient,
  projectId: string,
  start: string,
  end: string,
  options?: CanonicalFilterOptions | null
): Promise<CanonicalMetricsRow[] | null> {
  try {
    const rows = await fetchCanonicalRowsViaJoin(admin, projectId, start, end, options ?? undefined);
    if (rows.length === 0) return null;

    const byDate = new Map<string, { spend: number; clicks: number; purchases: number }>();
    for (const r of rows) {
      const cur = byDate.get(r.date) ?? { spend: 0, clicks: 0, purchases: 0 };
      cur.spend += r.spend;
      cur.clicks += r.clicks;
      cur.purchases += r.purchases;
      byDate.set(r.date, cur);
    }

    return Array.from(byDate.entries())
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([day, agg]) => ({
        day,
        spend: agg.spend,
        clicks: agg.clicks,
        purchases: agg.purchases,
      }));
  } catch {
    return null;
  }
}
