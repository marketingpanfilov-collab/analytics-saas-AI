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

function normalizeCurrency(raw: string | null | undefined): "USD" | "KZT" | null {
  const v = String(raw ?? "").trim().toUpperCase();
  if (v === "USD" || v === "KZT") return v;
  return null;
}

async function getUsdToKztRate(admin: SupabaseClient): Promise<number | null> {
  const { data, error } = await admin
    .from("exchange_rates")
    .select("rate")
    .eq("base_currency", "USD")
    .eq("quote_currency", "KZT")
    .order("updated_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) return null;
  const rate = Number((data as { rate?: number | null } | null)?.rate ?? 0);
  return Number.isFinite(rate) && rate > 0 ? rate : null;
}

function convertToUsd(
  value: number,
  accountCurrency: "USD" | "KZT" | null,
  provider: string | null | undefined,
  _projectCurrency: "USD" | "KZT",
  usdToKztRate: number | null
): number {
  if (!Number.isFinite(value)) return 0;
  const providerNorm = String(provider ?? "").trim().toLowerCase();
  // Stable fallback for legacy rows without account currency:
  // - TikTok/Yandex are typically stored in KZT
  // - Meta/Google are typically stored in USD
  // This keeps canonical USD independent from current project display currency.
  const fallbackByProvider: "USD" | "KZT" =
    providerNorm === "tiktok" || providerNorm === "yandex" ? "KZT" : "USD";
  const effectiveCurrency = accountCurrency ?? fallbackByProvider;
  if (effectiveCurrency === "KZT" && usdToKztRate && usdToKztRate > 0) {
    return value / usdToKztRate;
  }
  return value;
}

/**
 * Resolve ad_account ids for a project that participate in sync and dashboard.
 * Only accounts with ad_account_settings.is_enabled = true are included.
 * Optionally filtered by sources (platform) and/or specific account IDs.
 * Unified: integrations by project_id and platform in ('meta','google','tiktok').
 */
async function resolveAdAccountIds(
  admin: SupabaseClient,
  projectId: string,
  sources?: string[] | null,
  accountIds?: string[] | null
): Promise<string[]> {
  const { data: settingsRows } = await admin
    .from("ad_account_settings")
    .select("ad_account_id")
    .eq("project_id", projectId)
    .eq("is_enabled", true);

  const enabledIds = (settingsRows ?? []).map((r: { ad_account_id: string }) => r.ad_account_id);
  if (!enabledIds.length) return [];

  const { data: adAccounts, error: adAccountsError } = await admin
    .from("ad_accounts")
    .select("id, provider")
    .in("id", enabledIds);

  if (adAccountsError) {
    console.log("[CANONICAL_RESOLVE_AD_ACCOUNTS_ERROR]", { projectId, error: adAccountsError?.message ?? adAccountsError });
    return [];
  }

  let list = (adAccounts ?? []) as { id: string; provider?: string | null }[];
  const normalizedSources = normalizeSources(sources ?? []);
  if (normalizedSources.length > 0) {
    list = list.filter((a) => normalizedSources.includes((a.provider ?? "").toString().toLowerCase()));
  }
  if (accountIds?.length) {
    const idSet = new Set(accountIds);
    list = list.filter((a: { id: string }) => idSet.has(a.id));
  }
  return list.map((a: { id: string }) => a.id);
}

/**
 * Fetch daily_ad_metrics for a project and date range.
 * Primary source: daily_ad_metrics_campaign (campaign_id IS NOT NULL) for campaign-level detail.
 * For platforms where campaign breakdown is not available yet (currently TikTok), include
 * account-level rows from daily_ad_metrics (campaign_id IS NULL) to avoid losing spend in dashboard/LTV.
 * sources: filter by platform (meta, google, tiktok). Empty = all.
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
    .select("ad_account_id, date, platform, spend, impressions, clicks, leads, purchases, revenue")
    .in("ad_account_id", adAccountIds)
    .in("platform", ["meta", "google", "tiktok"])
    .gte("date", start)
    .lte("date", end);

  if (error) {
    console.log("[CANONICAL_QUERY_ERROR]", { error: String(error?.message ?? error) });
    throw error;
  }

  const campaignRawRows = (data ?? []) as Record<string, unknown>[];
  const campaignRows = campaignRawRows as {
    ad_account_id: string;
    date: string;
    platform: string | null;
    spend: number | null;
    impressions: number | null;
    clicks: number | null;
    leads: number | null;
    purchases: number | null;
    revenue: number | null;
  }[];
  const campaignPlatforms = new Set<string>(
    (campaignRawRows ?? [])
      .map((r) => String((r as { platform?: string }).platform ?? "").trim().toLowerCase())
      .filter(Boolean)
  );

  // TikTok currently syncs account-level rows only (campaign_id = null), so include them.
  // To avoid double-counting, include account-level rows only for platforms that are not present
  // in campaign-level result for the same query.
  const accountLevelPlatforms = ["tiktok", "yandex"].filter((p) => !campaignPlatforms.has(p));
  let accountRows: {
    ad_account_id: string;
    date: string;
    platform: string | null;
    spend: number | null;
    impressions: number | null;
    clicks: number | null;
    leads: number | null;
    purchases: number | null;
    revenue: number | null;
  }[] = [];

  if (accountLevelPlatforms.length > 0) {
    const { data: accountData, error: accountError } = await admin
      .from("daily_ad_metrics")
      .select("ad_account_id, date, platform, spend, impressions, clicks, leads, purchases, revenue")
      .in("ad_account_id", adAccountIds)
      .is("campaign_id", null)
      .in("platform", accountLevelPlatforms)
      .gte("date", start)
      .lte("date", end);
    if (accountError) {
      console.log("[CANONICAL_QUERY_ACCOUNT_LEVEL_ERROR]", { error: String(accountError?.message ?? accountError) });
      throw accountError;
    }
    accountRows = (accountData ?? []) as typeof accountRows;
  }
  const rows = [...campaignRows, ...accountRows];

  const adAccountIdSet = new Set<string>(rows.map((r) => String(r.ad_account_id ?? "")).filter(Boolean));
  const adAccountIdsForCurrency = Array.from(adAccountIdSet);
  const { data: projectRow } = await admin
    .from("projects")
    .select("currency")
    .eq("id", projectId)
    .maybeSingle();
  const projectCurrency = normalizeCurrency((projectRow as { currency?: string | null } | null)?.currency) ?? "USD";
  const accountMeta = new Map<string, { currency: "USD" | "KZT" | null; provider: string | null }>();
  if (adAccountIdsForCurrency.length > 0) {
    const { data: adAccountsData } = await admin
      .from("ad_accounts")
      .select("id, currency, provider")
      .in("id", adAccountIdsForCurrency);
    for (const a of (adAccountsData ?? []) as { id: string; currency: string | null; provider: string | null }[]) {
      accountMeta.set(a.id, {
        currency: normalizeCurrency(a.currency),
        provider: a.provider ?? null,
      });
    }
  }
  const usdToKztRate = await getUsdToKztRate(admin);

  console.log("[CANONICAL_FETCH]", {
    projectId,
    start,
    end,
    sources: options?.sources ?? "all",
    accountIdsCount: options?.accountIds?.length ?? "all",
    adAccountIdsCount: adAccountIds.length,
    rowCount: rows.length,
    campaignRows: campaignRows.length,
    accountRows: accountRows.length,
  });

  // When source-filtered and few campaign-level rows, log account-level count (non-fatal; must not throw)
  if (
    (options?.sources?.length ?? 0) > 0 &&
    rows.length <= 10 &&
    adAccountIds.length > 0
  ) {
    try {
      const { count: accountLevelCount } = await admin
        .from("daily_ad_metrics")
        .select("date", { count: "exact", head: true })
        .in("ad_account_id", adAccountIds)
        .is("campaign_id", null)
        .gte("date", start)
        .lte("date", end);
      const acctCount = typeof accountLevelCount === "number" ? accountLevelCount : 0;
      console.log("[CANONICAL_SOURCE_LEVELS]", {
        projectId,
        start,
        end,
        sources: options?.sources,
        campaign_level_rows: rows.length,
        account_level_rows_in_range: acctCount,
        note: acctCount > 0 && rows.length <= 2 ? "Dashboard uses campaign-level only; Google may have only account-level data." : null,
      });
    } catch (_) {
      // diagnostic only; do not affect main path
    }
  }

  return rows.map((r) => ({
    date: String(r.date).slice(0, 10),
    spend: convertToUsd(
      Number(r.spend ?? 0) || 0,
      accountMeta.get(r.ad_account_id)?.currency ?? null,
      accountMeta.get(r.ad_account_id)?.provider ?? r.platform ?? null,
      projectCurrency,
      usdToKztRate
    ),
    impressions: Number(r.impressions ?? 0) || 0,
    clicks: Number(r.clicks ?? 0) || 0,
    leads: Number(r.leads ?? 0) || 0,
    purchases: Number(r.purchases ?? 0) || 0,
    revenue: convertToUsd(
      Number(r.revenue ?? 0) || 0,
      accountMeta.get(r.ad_account_id)?.currency ?? null,
      accountMeta.get(r.ad_account_id)?.provider ?? r.platform ?? null,
      projectCurrency,
      usdToKztRate
    ),
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
      console.log("[CANONICAL_SUMMARY_AGG]", { branch: "canonical", inputRowCount: 0, spend: 0, impressions: 0, clicks: 0, reason: "no rows" });
      return null;
    }

    const spend = rows.reduce((s, r) => s + r.spend, 0);
    const impressions = rows.reduce((s, r) => s + r.impressions, 0);
    const clicks = rows.reduce((s, r) => s + r.clicks, 0);
    const leads = rows.reduce((s, r) => s + r.leads, 0);
    const purchases = rows.reduce((s, r) => s + r.purchases, 0);
    const revenue = rows.reduce((s, r) => s + r.revenue, 0);
    console.log("[CANONICAL_SUMMARY_AGG]", { branch: "canonical", inputRowCount, spend, impressions, clicks });
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
      console.log("[CANONICAL_TIMESERIES_PATH]", { branch: "canonical", used: "canonical", reason: "no rows", rowCount: 0 });
      return null;
    }

    console.log("[CANONICAL_TIMESERIES_PATH]", { branch: "canonical", used: "canonical", rowCount: rows.length });
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
