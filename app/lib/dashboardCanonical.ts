/**
 * Canonical dashboard data from daily_ad_metrics.
 * Used for summary, timeseries, and metrics routes with legacy fallback.
 *
 * Phase B (optional): SUM/GROUP BY in Postgres via RPC would reduce rows over the wire; requires
 * parity checks against this path and currency conversion order (see dashboard speed plan).
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import {
  convertMoneyStrict,
  createCurrencyDiagnostics,
  getLatestUsdToKztRate,
  getUsdToKztRateMapForDays,
  normalizeCurrencyCode,
  pushCurrencyReason,
  resolveUsdToKztRateForDay,
} from "@/app/lib/currencyNormalization";
import { fetchAllPages } from "@/app/lib/supabasePagination";

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

function convertToUsd(
  value: number,
  accountCurrency: "USD" | "KZT" | null,
  provider: string | null | undefined,
  day: string,
  usdToKztRateByDay: Map<string, number>,
  latestUsdToKztRate: number | null,
  diagnostics?: ReturnType<typeof createCurrencyDiagnostics>
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
  if (accountCurrency == null) {
    pushCurrencyReason(
      diagnostics,
      "currency_missing",
      `ad_accounts.currency missing; provider fallback '${fallbackByProvider}' used.`
    );
  }
  const rateForDay = resolveUsdToKztRateForDay(day, usdToKztRateByDay, latestUsdToKztRate, diagnostics);
  return convertMoneyStrict(value, effectiveCurrency, "USD", rateForDay, diagnostics);
}

/**
 * Resolve ad_account ids for canonical dashboard/reports spend.
 * Семантика как у списка источников на дашборде:
 * - есть строка ad_account_settings → используем is_enabled;
 * - нет строки + Meta → meta_ad_accounts.is_enabled по external id;
 * - нет строки + Google/TikTok/Yandex → считаем включённым (подключённый аккаунт после OAuth).
 * Иначе TikTok виден в фильтрах, но расход в summary/timeseries был 0.
 */
export async function resolveEnabledAdAccountIdsForProject(
  admin: SupabaseClient,
  projectId: string,
  sources?: string[] | null,
  accountIds?: string[] | null
): Promise<string[]> {
  const { data: integrationsMetaRows } = await admin
    .from("integrations_meta")
    .select("integrations_id")
    .eq("project_id", projectId);
  const metaIntegrationIds = (integrationsMetaRows ?? [])
    .map((r: { integrations_id: string | null }) => r.integrations_id)
    .filter(Boolean) as string[];

  const { data: platformIntRows } = await admin
    .from("integrations")
    .select("id")
    .eq("project_id", projectId)
    .in("platform", ["meta", "google", "tiktok", "yandex"]);

  const platformIds = (platformIntRows ?? []).map((r: { id: string }) => r.id);
  const integrationIds = [...new Set([...metaIntegrationIds, ...platformIds])];

  if (integrationIds.length === 0) return [];

  const { data: adAccounts, error: adAccountsError } = await admin
    .from("ad_accounts")
    .select("id, provider, external_account_id")
    .in("integration_id", integrationIds);

  if (adAccountsError) {
    console.log("[CANONICAL_RESOLVE_AD_ACCOUNTS_ERROR]", { projectId, error: adAccountsError?.message ?? adAccountsError });
    return [];
  }

  const accounts = (adAccounts ?? []) as { id: string; provider?: string | null; external_account_id?: string | null }[];
  if (accounts.length === 0) return [];

  const accountIdsList = accounts.map((a) => a.id);

  const explicitOn = new Set<string>();
  const explicitOff = new Set<string>();
  const { data: settingsRows } = await admin
    .from("ad_account_settings")
    .select("ad_account_id, is_enabled")
    .eq("project_id", projectId)
    .in("ad_account_id", accountIdsList);

  for (const r of (settingsRows ?? []) as { ad_account_id: string; is_enabled: boolean | null }[]) {
    if (r.is_enabled === true) explicitOn.add(r.ad_account_id);
    else if (r.is_enabled === false) explicitOff.add(r.ad_account_id);
  }

  const { data: metaEnabledRows } = await admin
    .from("meta_ad_accounts")
    .select("ad_account_id")
    .eq("project_id", projectId)
    .eq("is_enabled", true);
  const metaEnabledExternalIds = new Set(
    (metaEnabledRows ?? []).map((r: { ad_account_id: string }) => r.ad_account_id)
  );

  let list = accounts.filter((a) => {
    if (explicitOff.has(a.id)) return false;
    if (explicitOn.has(a.id)) return true;
    const prov = (a.provider ?? "").toString().toLowerCase();
    if (prov === "meta") {
      const ext = a.external_account_id != null ? String(a.external_account_id).trim() : "";
      return ext !== "" && metaEnabledExternalIds.has(ext);
    }
    return true;
  });

  const normalizedSources = normalizeSources(sources ?? []);
  if (normalizedSources.length > 0) {
    list = list.filter((a) => normalizedSources.includes((a.provider ?? "").toString().toLowerCase()));
  }
  if (accountIds?.length) {
    const idSet = new Set(accountIds);
    list = list.filter((a) => idSet.has(a.id));
  }
  return list.map((a) => a.id);
}

/** Enabled canonical ad_accounts.id по всем неархивным проектам организации (как дашборд / accounts). */
export async function collectEnabledAdAccountIdsForOrganization(
  admin: SupabaseClient,
  organizationId: string
): Promise<Set<string>> {
  const { data: projects } = await admin
    .from("projects")
    .select("id")
    .eq("organization_id", organizationId)
    .eq("archived", false);
  const pids = (projects ?? []).map((p: { id: string }) => String(p.id));
  const enabled = new Set<string>();
  for (const pid of pids) {
    const acc = await resolveEnabledAdAccountIdsForProject(admin, pid);
    for (const a of acc) enabled.add(a);
  }
  return enabled;
}

export async function countEnabledAdAccountsForOrganization(
  admin: SupabaseClient,
  organizationId: string
): Promise<number> {
  const s = await collectEnabledAdAccountIdsForOrganization(admin, organizationId);
  return s.size;
}

type RawMetricRow = {
  ad_account_id: string;
  date: string;
  platform: string | null;
  spend: number | null;
  impressions: number | null;
  clicks: number | null;
  leads: number | null;
  purchases: number | null;
  revenue: number | null;
};

export type CanonicalMetricRow = {
  date: string;
  platform: string;
  spend: number;
  impressions: number;
  clicks: number;
  leads: number;
  purchases: number;
  revenue: number;
};

export type CanonicalFilterOptions = {
  sources?: string[] | null;
  accountIds?: string[] | null;
};

async function convertRawMetricRowsToUsd(
  admin: SupabaseClient,
  rows: RawMetricRow[]
): Promise<CanonicalMetricRow[]> {
  if (rows.length === 0) return [];

  const adAccountIdSet = new Set<string>(rows.map((r) => String(r.ad_account_id ?? "")).filter(Boolean));
  const adAccountIdsForCurrency = Array.from(adAccountIdSet);
  const accountMeta = new Map<string, { currency: "USD" | "KZT" | null; provider: string | null }>();
  if (adAccountIdsForCurrency.length > 0) {
    const { data: adAccountsData } = await admin
      .from("ad_accounts")
      .select("id, currency, provider")
      .in("id", adAccountIdsForCurrency);
    for (const a of (adAccountsData ?? []) as { id: string; currency: string | null; provider: string | null }[]) {
      accountMeta.set(a.id, {
        currency: normalizeCurrencyCode(a.currency),
        provider: a.provider ?? null,
      });
    }
  }
  const daysInRange = rows.map((r) => String(r.date ?? "").slice(0, 10));
  const [usdToKztRateByDay, latestUsdToKztRate] = await Promise.all([
    getUsdToKztRateMapForDays(admin, daysInRange),
    getLatestUsdToKztRate(admin),
  ]);
  const currencyDiagnostics = createCurrencyDiagnostics();

  return rows.map((r) => ({
    date: String(r.date).slice(0, 10),
    platform: String(r.platform ?? "unknown").toLowerCase(),
    spend: convertToUsd(
      Number(r.spend ?? 0) || 0,
      accountMeta.get(r.ad_account_id)?.currency ?? null,
      accountMeta.get(r.ad_account_id)?.provider ?? r.platform ?? null,
      String(r.date ?? "").slice(0, 10),
      usdToKztRateByDay,
      latestUsdToKztRate,
      currencyDiagnostics
    ),
    impressions: Number(r.impressions ?? 0) || 0,
    clicks: Number(r.clicks ?? 0) || 0,
    leads: Number(r.leads ?? 0) || 0,
    purchases: Number(r.purchases ?? 0) || 0,
    revenue: convertToUsd(
      Number(r.revenue ?? 0) || 0,
      accountMeta.get(r.ad_account_id)?.currency ?? null,
      accountMeta.get(r.ad_account_id)?.provider ?? r.platform ?? null,
      String(r.date ?? "").slice(0, 10),
      usdToKztRateByDay,
      latestUsdToKztRate,
      currencyDiagnostics
    ),
  }));
}

/**
 * Campaign-level daily rows (all platforms), USD-normalized — for reports / campaign tables only.
 * Not for account totals (Meta/Google totals use account-level rows elsewhere).
 */
export async function fetchCampaignLevelMetricRowsForProject(
  admin: SupabaseClient,
  projectId: string,
  start: string,
  end: string,
  options?: CanonicalFilterOptions | null
): Promise<
  {
    campaign_id: string;
    ad_account_id: string;
    date: string;
    platform: string;
    spend: number;
    impressions: number;
    clicks: number;
    purchases: number;
    revenue: number;
  }[]
> {
  const adAccountIds = await resolveEnabledAdAccountIdsForProject(
    admin,
    projectId,
    options?.sources,
    options?.accountIds
  );
  if (!adAccountIds.length) return [];

  try {
    const { rows } = await fetchAllPages(async (from, to) =>
      admin
        .from("daily_ad_metrics")
        .select("campaign_id, ad_account_id, date, platform, spend, impressions, clicks, leads, purchases, revenue")
        .in("ad_account_id", adAccountIds)
        .not("campaign_id", "is", null)
        .gte("date", start)
        .lte("date", end)
        .order("date", { ascending: true })
        .order("id", { ascending: true })
        .range(from, to)
    );
    const raw = (rows ?? []) as (RawMetricRow & { campaign_id: string })[];
    const converted = await convertRawMetricRowsToUsd(admin, raw);
    return converted.map((c, i) => ({
      campaign_id: String(raw[i]?.campaign_id ?? ""),
      ad_account_id: String(raw[i]?.ad_account_id ?? ""),
      date: c.date,
      platform: c.platform,
      spend: c.spend,
      impressions: c.impressions,
      clicks: c.clicks,
      purchases: c.purchases,
      revenue: c.revenue,
    })).filter((r) => r.campaign_id.length > 0);
  } catch (e: unknown) {
    const msg = e && typeof e === "object" && "message" in e ? String((e as { message?: string }).message) : String(e);
    console.log("[CAMPAIGN_LEVEL_METRICS_ERROR]", { projectId, error: msg });
    return [];
  }
}

/**
 * Fetch daily_ad_metrics for a project and date range.
 * Meta & Google: account-level rows only (campaign_id IS NULL) — same totals as Ads / Google Ads account reports.
 * TikTok: account-level rows (`campaign_id` NULL) plus campaign-level rows from insights sync (`AUCTION_CAMPAIGN` report).
 * Account-level totals remain the source for dashboard spend when campaign-level is missing or filtered.
 * Yandex: account-level only.
 */
async function fetchCanonicalRowsViaJoinUncached(
  admin: SupabaseClient,
  projectId: string,
  start: string,
  end: string,
  options?: { sources?: string[] | null; accountIds?: string[] | null }
): Promise<CanonicalMetricRow[]> {
  const adAccountIds = await resolveEnabledAdAccountIdsForProject(
    admin,
    projectId,
    options?.sources,
    options?.accountIds
  );
  if (!adAccountIds.length) return [];

  const normalizedSources = normalizeSources(options?.sources ?? []);
  const wantsMeta = normalizedSources.length === 0 || normalizedSources.includes("meta");
  const wantsGoogle = normalizedSources.length === 0 || normalizedSources.includes("google");

  const metaGooglePlatforms: ("meta" | "google")[] = [];
  if (wantsMeta) metaGooglePlatforms.push("meta");
  if (wantsGoogle) metaGooglePlatforms.push("google");

  let metaGoogleAccountRows: RawMetricRow[] = [];
  let metaGooglePagesFetched = 0;
  if (metaGooglePlatforms.length > 0) {
    try {
      const { rows, pagesFetched } = await fetchAllPages(async (from, to) =>
        admin
          .from("daily_ad_metrics")
          .select("ad_account_id, date, platform, spend, impressions, clicks, leads, purchases, revenue")
          .in("ad_account_id", adAccountIds)
          .is("campaign_id", null)
          .in("platform", metaGooglePlatforms)
          .gte("date", start)
          .lte("date", end)
          .order("date", { ascending: true })
          .order("id", { ascending: true })
          .range(from, to)
      );
      metaGooglePagesFetched = pagesFetched;
      metaGoogleAccountRows = rows as RawMetricRow[];
    } catch (e: unknown) {
      const msg = e && typeof e === "object" && "message" in e ? String((e as { message?: string }).message) : String(e);
      console.log("[CANONICAL_QUERY_META_GOOGLE_ACCOUNT_ERROR]", { error: msg });
      throw e;
    }
  }

  const campaignRows: RawMetricRow[] = [];
  const campaignPagesFetched = 0;

  const accountLevelPlatforms = ["tiktok", "yandex"];
  let accountRows: RawMetricRow[] = [];

  let accountPagesFetched = 0;
  if (accountLevelPlatforms.length > 0) {
    try {
      const { rows, pagesFetched } = await fetchAllPages(async (from, to) =>
        admin
          .from("daily_ad_metrics")
          .select("ad_account_id, date, platform, spend, impressions, clicks, leads, purchases, revenue")
          .in("ad_account_id", adAccountIds)
          .is("campaign_id", null)
          .in("platform", accountLevelPlatforms)
          .gte("date", start)
          .lte("date", end)
          .order("date", { ascending: true })
          .order("id", { ascending: true })
          .range(from, to)
      );
      accountPagesFetched = pagesFetched;
      accountRows = rows as RawMetricRow[];
    } catch (e: unknown) {
      const msg = e && typeof e === "object" && "message" in e ? String((e as { message?: string }).message) : String(e);
      console.log("[CANONICAL_QUERY_ACCOUNT_LEVEL_ERROR]", { error: msg });
      throw e;
    }
  }
  const rows = [...metaGoogleAccountRows, ...campaignRows, ...accountRows];

  console.log("[CANONICAL_FETCH]", {
    projectId,
    start,
    end,
    sources: options?.sources ?? "all",
    accountIdsCount: options?.accountIds?.length ?? "all",
    adAccountIdsCount: adAccountIds.length,
    rowCount: rows.length,
    meta_google_account_rows: metaGoogleAccountRows.length,
    campaign_rows: campaignRows.length,
    account_rows_tiktok_yandex: accountRows.length,
    metaGooglePagesFetched,
    campaignPagesFetched,
    accountPagesFetched,
  });
  if (metaGooglePagesFetched > 1 || campaignPagesFetched > 1 || accountPagesFetched > 1) {
    console.log("[CANONICAL_ROWCAP]", {
      projectId,
      start,
      end,
      note: "H1: more than one PostgREST page was required; pre-fix totals would have been truncated at 1000 rows per query.",
      metaGooglePagesFetched,
      campaignPagesFetched,
      accountPagesFetched,
      totalRows: rows.length,
    });
  }

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
        note:
          acctCount > 0 && rows.length <= 2
            ? "Meta/Google/TikTok/Yandex canonical spend uses account-level daily_ad_metrics (campaign_id IS NULL)."
            : null,
      });
    } catch (_) {
      // diagnostic only; do not affect main path
    }
  }

  return convertRawMetricRowsToUsd(admin, rows);
}

const canonicalRowsInflight = new Map<string, Promise<CanonicalMetricRow[]>>();
const canonicalRowsTtlStore = new Map<string, { rows: CanonicalMetricRow[]; exp: number }>();

/** Stable key for in-process canonical row reuse (singleflight + optional TTL). See plan §4. */
export function canonicalMetricRowsServerCacheKey(
  projectId: string,
  start: string,
  end: string,
  options?: CanonicalFilterOptions | null
): string {
  const normSources = normalizeSources(options?.sources ?? null);
  const sourcesPart = normSources.length ? [...normSources].sort().join(",") : "all";
  const rawIds = (options?.accountIds ?? []).map((id) => String(id).trim()).filter(Boolean);
  const accountPart = rawIds.length ? [...new Set(rawIds)].sort().join(",") : "all";
  return `cr:${projectId}:${start}:${end}:${sourcesPart}:${accountPart}`;
}

/** Stage 2.5: cross-endpoint TTL is intended for 1–10s; cap prevents accidental multi-minute cache. */
const CANONICAL_ROWS_TTL_MS_HARD_CAP = 10_000;

function canonicalRowsTtlMsFromEnv(): number {
  const raw = process.env.CANONICAL_ROWS_CACHE_TTL_MS;
  if (raw == null || raw === "") return 0;
  const n = Number(raw);
  return Number.isFinite(n) && n > 0 ? Math.min(n, CANONICAL_ROWS_TTL_MS_HARD_CAP) : 0;
}

/** If > 0, do not store rows in TTL when length exceeds this (memory guard for large reports). 0 = no limit. */
function canonicalRowsTtlMaxRowCountFromEnv(): number {
  const raw = process.env.CANONICAL_ROWS_CACHE_MAX_ROWS;
  if (raw == null || raw === "") return 0;
  const n = Number(raw);
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : 0;
}

/** Drop in-process canonical row entries for a project (call after sync writes). */
export function invalidateCanonicalRowsServerCache(projectId: string): void {
  if (!projectId) return;
  const prefix = `cr:${projectId}:`;
  for (const k of [...canonicalRowsTtlStore.keys()]) {
    if (k.startsWith(prefix)) canonicalRowsTtlStore.delete(k);
  }
  for (const k of [...canonicalRowsInflight.keys()]) {
    if (k.startsWith(prefix)) canonicalRowsInflight.delete(k);
  }
}

/**
 * Account-level canonical rows: single in-process entry (singleflight + optional TTL).
 * All routes/helpers must use `fetchCanonicalMetricRowsForProject` or `getCanonical*` — do not call
 * `fetchCanonicalRowsViaJoinUncached` directly. `[CANONICAL_FETCH]` logs only from the uncached path.
 */
function fetchCanonicalRowsViaJoin(
  admin: SupabaseClient,
  projectId: string,
  start: string,
  end: string,
  options?: { sources?: string[] | null; accountIds?: string[] | null }
): Promise<CanonicalMetricRow[]> {
  const key = canonicalMetricRowsServerCacheKey(projectId, start, end, options ?? undefined);
  const ttlMs = canonicalRowsTtlMsFromEnv();
  const debugReuse = process.env.CANONICAL_ROWS_CACHE_DEBUG === "1";
  if (ttlMs > 0) {
    const hit = canonicalRowsTtlStore.get(key);
    if (hit && Date.now() < hit.exp) {
      if (debugReuse) {
        console.log("[CANONICAL_ROWS_TTL_HIT]", {
          projectId,
          start,
          end,
          rowCount: hit.rows.length,
        });
        console.log("[CANONICAL_ROWS_REUSE_HIT]", { layer: "ttl", projectId, start, end });
      }
      return Promise.resolve(hit.rows);
    }
  }
  let inflight = canonicalRowsInflight.get(key);
  if (!inflight) {
    inflight = fetchCanonicalRowsViaJoinUncached(admin, projectId, start, end, options)
      .then((rows) => {
        if (ttlMs > 0) {
          const maxRows = canonicalRowsTtlMaxRowCountFromEnv();
          if (maxRows > 0 && rows.length > maxRows) {
            if (debugReuse) {
              console.log("[CANONICAL_ROWS_TTL_SKIP_LARGE]", {
                projectId,
                start,
                end,
                rowCount: rows.length,
                maxRows,
              });
            }
          } else {
            canonicalRowsTtlStore.set(key, { rows, exp: Date.now() + ttlMs });
          }
        }
        return rows;
      })
      .finally(() => {
        canonicalRowsInflight.delete(key);
      });
    canonicalRowsInflight.set(key, inflight);
  } else if (debugReuse) {
    console.log("[CANONICAL_ROWS_SINGLEFLIGHT_HIT]", { projectId, start, end, keySuffix: key.slice(-48) });
    console.log("[CANONICAL_ROWS_REUSE_HIT]", { layer: "singleflight", projectId, start, end });
  }
  return inflight;
}

/** Account-level canonical rows (Meta, Google, TikTok, Yandex) — same totals as main dashboard. */
export async function fetchCanonicalMetricRowsForProject(
  admin: SupabaseClient,
  projectId: string,
  start: string,
  end: string,
  options?: CanonicalFilterOptions | null
): Promise<CanonicalMetricRow[]> {
  return fetchCanonicalRowsViaJoin(admin, projectId, start, end, options ?? undefined);
}

/** Pure: summary totals from pre-fetched canonical rows (same math as legacy getCanonicalSummary). */
export function aggregateCanonicalMetricRowsToSummaryResult(
  rows: CanonicalMetricRow[]
): { data: CanonicalSummary; rowCount: number } | null {
  const inputRowCount = rows.length;
  if (inputRowCount === 0) {
    console.log("[CANONICAL_SUMMARY_AGG]", {
      branch: "canonical",
      inputRowCount: 0,
      spend: 0,
      impressions: 0,
      clicks: 0,
      reason: "no rows",
    });
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
      campaigns_cnt: null,
    },
    rowCount: rows.length,
  };
}

/** Pure: daily points from pre-fetched canonical rows. */
export function aggregateCanonicalMetricRowsToTimeseriesPoints(rows: CanonicalMetricRow[]): CanonicalPoint[] | null {
  if (rows.length === 0) {
    console.log("[CANONICAL_TIMESERIES_PATH]", {
      branch: "canonical",
      used: "canonical",
      reason: "no rows",
      rowCount: 0,
    });
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

  return Array.from(byDate.entries())
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([day, agg]) => ({
      day,
      spend: agg.spend,
      clicks: agg.clicks,
      purchases: agg.purchases,
      revenue: agg.revenue,
      roas: agg.spend > 0 ? agg.revenue / agg.spend : 0,
    }));
}

/** Pure: metrics chart rows from pre-fetched canonical rows. */
export function aggregateCanonicalMetricRowsToMetricsRows(rows: CanonicalMetricRow[]): CanonicalMetricsRow[] | null {
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
}

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
    const rows = await fetchCanonicalMetricRowsForProject(admin, projectId, start, end, options);
    return aggregateCanonicalMetricRowsToSummaryResult(rows);
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
    const rows = await fetchCanonicalMetricRowsForProject(admin, projectId, start, end, options);
    return aggregateCanonicalMetricRowsToTimeseriesPoints(rows);
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
    const rows = await fetchCanonicalMetricRowsForProject(admin, projectId, start, end, options);
    return aggregateCanonicalMetricRowsToMetricsRows(rows);
  } catch {
    return null;
  }
}
