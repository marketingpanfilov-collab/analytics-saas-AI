/**
 * Dashboard backfill: trigger sync when campaign-level data is missing or stale.
 * Enabled ad accounts use the same rules as canonical dashboard (resolveEnabledAdAccountIdsForProject).
 * Sync is triggered in background (non-blocking); GET handlers do not wait for sync.
 *
 * Two modes:
 * A. Historical coverage sync — when the requested range has missing days (no per-day coverage),
 *    we trigger sync only for the missing interval(s). No TTL skip.
 * B. Fresh tail sync — when the range is fully covered, we may still refresh "tail" (today, yesterday, last 3 days)
 *    if last sync is older than TTL. TTL: today 15m, last 7d 1h, last 30d 6h, older 24h.
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import { getSyncTtlMs } from "./syncTtl";
import { getInternalSyncHeaders } from "./auth/requireProjectAccessOrInternal";
import { fetchAllPages } from "@/app/lib/supabasePagination";
import { resolveEnabledAdAccountIdsForProject } from "@/app/lib/dashboardCanonical";
import { tiktokMaxInclusiveReportDateUtcYmd } from "@/app/lib/tiktokReportDateBounds";

export type Platform = "meta" | "google" | "tiktok";

/** Number of "fresh" days we refresh when range is fully covered (today, yesterday, last 3 days). */
const FRESH_TAIL_DAYS = 3;

/** Get ad_account ids that are enabled for this project (same contract as sync/dashboard). */
async function getEnabledAdAccountIds(
  admin: SupabaseClient,
  projectId: string
): Promise<string[]> {
  return resolveEnabledAdAccountIdsForProject(admin, projectId);
}

/** Previous calendar day in UTC (YYYY-MM-DD). */
function calendarDayBefore(isoDate: string): string {
  const d = new Date(isoDate + "T12:00:00Z");
  d.setUTCDate(d.getUTCDate() - 1);
  return d.toISOString().slice(0, 10);
}

/** Split [intervalStart, intervalEnd] into contiguous chunks of at most `maxCalendarDays` days each. */
export function chunkDateInterval(
  intervalStart: string,
  intervalEnd: string,
  maxCalendarDays: number
): { start: string; end: string }[] {
  const all = datesInRange(intervalStart, intervalEnd);
  if (all.length === 0) return [];
  const chunks: { start: string; end: string }[] = [];
  for (let i = 0; i < all.length; i += maxCalendarDays) {
    const slice = all.slice(i, i + maxCalendarDays);
    chunks.push({ start: slice[0]!, end: slice[slice.length - 1]! });
  }
  return chunks;
}

/** Max of two YYYY-MM-DD strings (lexicographic order matches chronological). */
function maxIsoDate(a: string, b: string): string {
  return a > b ? a : b;
}

/** Dates an ad account must have rows for to satisfy historical coverage for [start,end]. TikTok is capped at UTC yesterday (sync contract). */
function requiredCoverageDatesYmd(providerNorm: string, start: string, end: string): Set<string> {
  const p = providerNorm.trim().toLowerCase();
  if (p === "tiktok") {
    const maxInclusive = tiktokMaxInclusiveReportDateUtcYmd();
    const cappedEnd = end <= maxInclusive ? end : maxInclusive;
    if (cappedEnd < start) return new Set();
    return new Set(datesInRange(start, cappedEnd));
  }
  return new Set(datesInRange(start, end));
}

/** Generate all dates in [start, end] inclusive (YYYY-MM-DD). Exported for sync zero-fill. */
export function datesInRange(start: string, end: string): string[] {
  const out: string[] = [];
  const d = new Date(start + "T12:00:00Z");
  const endDate = new Date(end + "T12:00:00Z");
  while (d <= endDate) {
    out.push(d.toISOString().slice(0, 10));
    d.setUTCDate(d.getUTCDate() + 1);
  }
  return out;
}

/**
 * Build contiguous missing intervals: dates in [start, end] that are NOT in coveredDateSet.
 * Each interval is [gapStart, gapEnd] where gapEnd is the last missing day (valid: gapEnd >= gapStart).
 * When we exit a gap at covered date d, the gap ends at (d - 1 day), not (gapStart - 1 day).
 */
export function getMissingIntervals(
  start: string,
  end: string,
  coveredDateSet: Set<string>
): { start: string; end: string }[] {
  const all = datesInRange(start, end);
  const intervals: { start: string; end: string }[] = [];
  let gapStart: string | null = null;
  for (const d of all) {
    if (coveredDateSet.has(d)) {
      if (gapStart !== null) {
        const lastMissing = new Date(d + "T12:00:00Z");
        lastMissing.setUTCDate(lastMissing.getUTCDate() - 1);
        const gapEnd = lastMissing.toISOString().slice(0, 10);
        intervals.push({ start: gapStart, end: gapEnd });
        gapStart = null;
      }
    } else {
      if (gapStart === null) gapStart = d;
    }
  }
  if (gapStart !== null) {
    intervals.push({ start: gapStart, end });
  }
  return intervals;
}

/** Drop intervals with end < start and return only valid ones. Log invalid ones. */
function filterValidIntervals(
  intervals: { start: string; end: string }[],
  context: { projectId?: string; rangeStart?: string; rangeEnd?: string }
): { start: string; end: string }[] {
  const valid: { start: string; end: string }[] = [];
  for (const iv of intervals) {
    if (iv.end < iv.start) {
      console.warn("[BACKFILL_INVALID_MISSING_INTERVAL]", { ...context, interval: iv, reason: "end < start" });
      continue;
    }
    valid.push(iv);
  }
  return valid;
}

/** Per-account coverage for logging/debug (and future UI). */
export type PerAccountCoverage = {
  ad_account_id: string;
  /** Whether this account has data for every day it is required to cover in the requested range. */
  covered: boolean;
  min_date: string | null;
  max_date: string | null;
  /** Number of distinct dates this account has in range. */
  date_count: number;
};

export type CoverageResult = {
  covered: boolean;
  rowCount: number;
  minDate: string | null;
  maxDate: string | null;
  /** Calendar days in [start,end] that are satisfied for backfill (no missing interval). */
  coveredDates: string[];
  /** Contiguous [start,end] windows where at least one account is missing data. */
  missingIntervals: { start: string; end: string }[];
  /** Account ids that do not have full coverage for the range. */
  uncoveredAccountIds: string[];
  /** Per-account coverage for logging/debug. */
  perAccountCoverage: PerAccountCoverage[];
};

/**
 * Check if enabled ad_accounts fully cover the requested range.
 * A day is covered for an account if there is ANY row in daily_ad_metrics for that (ad_account_id, date):
 * - campaign-level rows (campaign_id IS NOT NULL), or
 * - account-level rows (campaign_id IS NULL), including zero-fill from sync when API returned no data.
 * Full coverage = every enabled account has rows for each day it is required to cover in [start, end].
 * TikTok required days end at UTC yesterday (same cap as TikTok insights sync); other providers require the full [start, end].
 * Do NOT filter by campaign_id here: zero-activity days are covered by account-level zero rows.
 */
export async function isRangeCovered(
  admin: SupabaseClient,
  projectId: string,
  start: string,
  end: string,
  adAccountIds?: string[]
): Promise<CoverageResult> {
  const ids = adAccountIds ?? (await getEnabledAdAccountIds(admin, projectId));
  if (!ids.length) {
    return {
      covered: true,
      rowCount: 0,
      minDate: null,
      maxDate: null,
      coveredDates: [],
      missingIntervals: [],
      uncoveredAccountIds: [],
      perAccountCoverage: [],
    };
  }

  const { data: providerRows } = await admin
    .from("ad_accounts")
    .select("id, provider")
    .in("id", ids);
  const providerById = new Map<string, string>();
  for (const r of (providerRows ?? []) as { id: string; provider?: string | null }[]) {
    providerById.set(r.id, String(r.provider ?? "").trim().toLowerCase());
  }

  // Any row (campaign- or account-level). Must NOT use .not("campaign_id", "is", null).
  // Paginate: PostgREST caps at ~1000 rows; incomplete rows ⇒ false coverage and spurious sync.
  let rows: { ad_account_id: string; date: string }[] = [];
  let coveragePagesFetched = 0;
  try {
    const { rows: paged, pagesFetched } = await fetchAllPages(async (rangeFrom, rangeTo) =>
      admin
        .from("daily_ad_metrics")
        .select("ad_account_id, date")
        .in("ad_account_id", ids)
        .gte("date", start)
        .lte("date", end)
        .order("date", { ascending: true })
        .order("id", { ascending: true })
        .range(rangeFrom, rangeTo)
    );
    rows = paged as { ad_account_id: string; date: string }[];
    coveragePagesFetched = pagesFetched;
  } catch (_error) {
    return {
      covered: false,
      rowCount: 0,
      minDate: null,
      maxDate: null,
      coveredDates: [],
      missingIntervals: getMissingIntervals(start, end, new Set()),
      uncoveredAccountIds: [...ids],
      perAccountCoverage: ids.map((id) => ({ ad_account_id: id, covered: false, min_date: null, max_date: null, date_count: 0 })),
    };
  }

  if (coveragePagesFetched > 1) {
    console.log("[BACKFILL_COVERAGE_ROWCAP]", {
      projectId,
      start,
      end,
      coveragePagesFetched,
      rowCount: rows.length,
      note: "H1: coverage query required multiple PostgREST pages; pre-fix logic was wrong beyond ~1000 rows.",
    });
  }

  const allDates = datesInRange(start, end);
  const requiredDateSet = new Set(allDates);

  // Per-account date sets (any row: campaign or account-level, including zero-fill)
  const datesByAccount = new Map<string, Set<string>>();
  for (const id of ids) {
    datesByAccount.set(id, new Set());
  }
  for (const r of (rows ?? []) as { ad_account_id: string; date: string }[]) {
    const aid = r.ad_account_id;
    const d = String(r.date).slice(0, 10);
    if (datesByAccount.has(aid)) {
      datesByAccount.get(aid)!.add(d);
    }
  }

  const requiredByAccountId = new Map<string, Set<string>>();
  for (const id of ids) {
    const prov = providerById.get(id) ?? "";
    requiredByAccountId.set(id, requiredCoverageDatesYmd(prov, start, end));
  }

  const perAccountCoverage: PerAccountCoverage[] = [];
  const uncoveredAccountIds: string[] = [];
  for (const id of ids) {
    const accountDates = datesByAccount.get(id) ?? new Set();
    const required = requiredByAccountId.get(id) ?? new Set();
    const covered = [...required].every((d) => accountDates.has(d));
    const sorted = [...accountDates].sort();
    const min_date = sorted[0] ?? null;
    const max_date = sorted[sorted.length - 1] ?? null;
    perAccountCoverage.push({
      ad_account_id: id,
      covered,
      min_date,
      max_date,
      date_count: accountDates.size,
    });
    if (!covered) {
      uncoveredAccountIds.push(id);
    }
  }

  // Days that need no backfill: nobody is required to have a row, or every account that is required does.
  const globallyOkDates = new Set<string>();
  for (const d of allDates) {
    const anyRequires = ids.some((id) => (requiredByAccountId.get(id) ?? new Set()).has(d));
    if (!anyRequires) {
      globallyOkDates.add(d);
      continue;
    }
    const allSatisfied = ids.every((id) => {
      const required = requiredByAccountId.get(id) ?? new Set();
      if (!required.has(d)) return true;
      return datesByAccount.get(id)?.has(d) ?? false;
    });
    if (allSatisfied) globallyOkDates.add(d);
  }
  const coveredDates = [...globallyOkDates].sort();
  const missingIntervalsRaw = getMissingIntervals(start, end, globallyOkDates);
  const missingIntervals = filterValidIntervals(missingIntervalsRaw, { projectId, rangeStart: start, rangeEnd: end });
  const covered = missingIntervals.length === 0;
  const rowCount = (rows ?? []).length;
  const minDate = coveredDates[0] ?? null;
  const maxDate = coveredDates[coveredDates.length - 1] ?? null;

  if (uncoveredAccountIds.length > 0) {
    console.log("[BACKFILL_COVERAGE]", {
      projectId,
      start,
      end,
      uncoveredAccountIds,
      uncoveredAccountProviders: uncoveredAccountIds.map((id) => ({
        ad_account_id: id,
        provider: providerById.get(id) ?? null,
      })),
      perAccount: perAccountCoverage.map((pa) => ({
        id: pa.ad_account_id.slice(0, 8),
        provider: providerById.get(pa.ad_account_id) ?? null,
        covered: pa.covered,
        min: pa.min_date,
        max: pa.max_date,
        date_count: pa.date_count,
      })),
    });
  }

  return {
    covered,
    rowCount,
    minDate,
    maxDate,
    coveredDates,
    missingIntervals,
    uncoveredAccountIds,
    perAccountCoverage,
  };
}

/**
 * Get latest sync run finished_at for the given ad_account ids (any platform).
 */
export async function getLastSyncFinishedAtForProject(
  admin: SupabaseClient,
  projectId: string,
  adAccountIds: string[]
): Promise<Date | null> {
  if (!adAccountIds.length) return null;
  const { data: runs } = await admin
    .from("sync_runs")
    .select("finished_at")
    .eq("project_id", projectId)
    .in("ad_account_id", adAccountIds)
    .not("finished_at", "is", null)
    .order("finished_at", { ascending: false })
    .limit(1);
  const finished = (runs ?? [])[0] as { finished_at: string } | undefined;
  if (!finished?.finished_at) return null;
  return new Date(finished.finished_at);
}

const syncPromises = new Map<string, Promise<void>>();

/** Start a single sync in background; key used for dedupe so same interval is not triggered twice (e.g. summary + timeseries in parallel). */
function triggerSync(
  requestUrl: string,
  projectId: string,
  intervalStart: string,
  intervalEnd: string,
  key: string,
  kind: "historical" | "fresh"
): boolean {
  if (syncPromises.has(key)) {
    console.log("[BACKFILL_SYNC_DEDUPE]", { key, kind });
    return true;
  }
  const baseUrl = getBaseUrlForSync(requestUrl);
  const syncUrl = new URL("/api/dashboard/sync", baseUrl);
  syncUrl.searchParams.set("project_id", projectId);
  syncUrl.searchParams.set("start", intervalStart);
  syncUrl.searchParams.set("end", intervalEnd);
  const syncUrlStr = syncUrl.toString();
  console.log("[BACKFILL_SYNC_TRIGGER]", {
    start: intervalStart,
    end: intervalEnd,
    projectId,
    kind,
  });
  console.log("[BACKFILL_SYNC_REQUEST]", syncUrlStr);
  const promise = (async () => {
    try {
      const r = await fetch(syncUrlStr, {
        method: "POST",
        headers: { "Content-Type": "application/json", ...getInternalSyncHeaders() },
      });
      const body = await r.json().catch(() => ({}));
      if (!r.ok || !body?.success) {
        console.error("[BACKFILL_SYNC_FAILED]", {
          projectId,
          start: intervalStart,
          end: intervalEnd,
          kind,
          status: r.status,
          error: body?.error,
          syncUrl: syncUrlStr,
        });
      } else {
        console.log("[BACKFILL_SYNC_STARTED]", { projectId, start: intervalStart, end: intervalEnd, kind });
      }
    } finally {
      syncPromises.delete(key);
    }
  })();
  syncPromises.set(key, promise);
  return true;
}

/** Run historical chunk syncs one after another (does not block callers — schedule with `void`). */
async function runHistoricalChunksSequential(
  requestUrl: string,
  projectId: string,
  chunks: { start: string; end: string }[]
): Promise<void> {
  for (const sub of chunks) {
    const key = `${projectId}:${sub.start}:${sub.end}`;
    if (syncPromises.has(key)) {
      await syncPromises.get(key)!;
      continue;
    }
    triggerSync(requestUrl, projectId, sub.start, sub.end, key, "historical");
    const p = syncPromises.get(key);
    if (p) await p;
  }
}

/** Resolve base URL for sync POST so fetch hits the same app (no wrong host in serverless). */
function getBaseUrlForSync(requestUrl: string): string {
  try {
    const u = new URL(requestUrl);
    if (u.origin && u.origin !== "null") return u.origin;
  } catch {
    // ignore
  }
  if (typeof process !== "undefined" && process.env?.VERCEL_URL) {
    return `https://${process.env.VERCEL_URL}`;
  }
  if (typeof process !== "undefined" && process.env?.NEXT_PUBLIC_APP_URL) {
    return process.env.NEXT_PUBLIC_APP_URL;
  }
  return "http://localhost:3000";
}

/**
 * Branches that enqueue sync (`triggerSync` → POST /api/dashboard/sync):
 * 1. **Historical** — missing days in range → chunked `triggerSync(..., "historical")`.
 * 2. **Today** — `end === today` and sync TTL expired → `triggerSync` on narrowed window, kind `"fresh"`.
 * 3. **Fresh tail** — range overlaps last `FRESH_TAIL_DAYS` and TTL expired → `triggerSync(freshStart..today)`, kind `"fresh"`.
 *
 * With `scope.readOnly` (bundle + `BUNDLE_READ_ONLY_MODE`), none of the above runs; result uses `wouldSync` / `wouldSyncReason` only. See `[ENSURE_BACKFILL_RESULT]` logs.
 */
export type EnsureBackfillResult = {
  triggered: boolean;
  /** 'historical' = sync for missing date intervals; 'fresh' = TTL-based tail refresh */
  reason: "historical" | "fresh" | null;
  /** When reason === 'historical': range was partially covered; sync started for missing intervals. */
  rangePartiallyCovered?: boolean;
  /** When reason === 'historical': missing intervals that were submitted for sync. */
  historicalSyncIntervals?: { start: string; end: string }[];
  /**
   * Same as `triggered` when not in read-only mode.
   * In read-only mode: whether a sync **would** have been enqueued (for logs/UI; no sync runs).
   */
  wouldSync?: boolean;
  wouldSyncReason?: "historical" | "fresh" | null;
};

/** Опционально: те же sources / account_ids, что у каноники дашборда (иначе backfill смотрит на все кабинеты и даёт ложные «дыры»). */
export type EnsureBackfillScope = {
  sources?: string[] | null;
  accountIds?: string[] | null;
  /** When true (bundle + BUNDLE_READ_ONLY_MODE): compute coverage/TTL but never call triggerSync. */
  readOnly?: boolean;
};

export async function ensureBackfill(
  admin: SupabaseClient,
  projectId: string,
  start: string,
  end: string,
  requestUrl: string,
  scope?: EnsureBackfillScope | null
): Promise<EnsureBackfillResult> {
  const readOnly = Boolean(scope?.readOnly);
  const enabledIds = await resolveEnabledAdAccountIdsForProject(
    admin,
    projectId,
    scope?.sources ?? null,
    scope?.accountIds?.length ? scope.accountIds : null
  );
  if (!enabledIds.length) {
    return { triggered: false, reason: null, wouldSync: false, wouldSyncReason: null };
  }

  const coverage = await isRangeCovered(admin, projectId, start, end, enabledIds);

  // --- A. Historical: missing intervals — trigger sync only for valid intervals (end >= start) ---
  const validIntervals = filterValidIntervals(coverage.missingIntervals, { projectId, rangeStart: start, rangeEnd: end });

  if (validIntervals.length > 0) {
    const hasFebInterval = validIntervals.some(
      (iv) => iv.start === "2026-02-01" && (iv.end === "2026-02-28" || iv.end === "2026-02-29")
    );
    console.log("[BACKFILL_BEFORE_SYNC]", {
      projectId,
      requestedRange: { start, end },
      missingIntervalsRaw: coverage.missingIntervals,
      missingIntervalsValid: validIntervals,
      expected_interval_2026_02_present: hasFebInterval,
      coveredByAll: {
        min: coverage.minDate,
        max: coverage.maxDate,
        dateCount: coverage.coveredDates.length,
      },
      uncoveredAccountIds: coverage.uncoveredAccountIds,
    });
    const HISTORICAL_CHUNK_DAYS = 7;
    const submittedIntervals: { start: string; end: string }[] = [];
    for (const iv of validIntervals) {
      if (iv.end < iv.start) {
        console.warn("[BACKFILL_SKIP_INVALID_INTERVAL]", { projectId, interval: iv, reason: "end < start" });
        continue;
      }
      const subIntervals = chunkDateInterval(iv.start, iv.end, HISTORICAL_CHUNK_DAYS);
      for (const sub of subIntervals) {
        submittedIntervals.push(sub);
      }
    }

    if (readOnly) {
      console.log("[ENSURE_BACKFILL_RESULT]", {
        branch: "historical",
        readOnly: true,
        wouldSync: true,
        triggered: false,
        projectId,
        chunkCount: submittedIntervals.length,
      });
      return {
        triggered: false,
        reason: null,
        wouldSync: true,
        wouldSyncReason: "historical",
        rangePartiallyCovered: true,
        historicalSyncIntervals: submittedIntervals,
      };
    }

    void runHistoricalChunksSequential(requestUrl, projectId, submittedIntervals).catch((e) =>
      console.error("[BACKFILL_HISTORICAL_CHUNKS_CHAIN_FAILED]", { projectId, error: e })
    );
    console.log("[BACKFILL_HISTORICAL_CHUNKS]", {
      projectId,
      chunkCount: submittedIntervals.length,
      requestedIntervals: validIntervals.length,
    });
    console.log("[ENSURE_BACKFILL_RESULT]", {
      branch: "historical",
      readOnly: false,
      wouldSync: true,
      triggered: true,
      projectId,
    });

    return {
      triggered: true,
      reason: "historical",
      wouldSync: true,
      wouldSyncReason: "historical",
      rangePartiallyCovered: true,
      historicalSyncIntervals: submittedIntervals,
    };
  }

  // --- B. Today-specific freshness: even if fully covered, today must be periodically resynced ---
  const today = new Date().toISOString().slice(0, 10);
  const lastSyncAt = await getLastSyncFinishedAtForProject(admin, projectId, enabledIds);
  if (end === today) {
    const ttlMs = getSyncTtlMs(start, end);
    const now = Date.now();
    const lastSyncMs = lastSyncAt ? lastSyncAt.getTime() : 0;
    const ageMs = lastSyncMs ? now - lastSyncMs : null;

    console.log("[TODAY_FRESHNESS_CHECK]", {
      projectId,
      start,
      end,
      today,
      last_sync_at: lastSyncAt ? lastSyncAt.toISOString() : null,
      age_ms: ageMs,
      ttl_ms: ttlMs,
    });

    if (!lastSyncAt || now - lastSyncMs >= ttlMs) {
      const yesterday = calendarDayBefore(today);
      const syncStart = maxIsoDate(start, yesterday);
      const syncEnd = today;
      if (readOnly) {
        console.log("[ENSURE_BACKFILL_RESULT]", {
          branch: "today_fresh",
          readOnly: true,
          wouldSync: true,
          triggered: false,
          projectId,
          syncStart,
          syncEnd,
        });
        return {
          triggered: false,
          reason: null,
          wouldSync: true,
          wouldSyncReason: "fresh",
        };
      }
      const key = `${projectId}:${syncStart}:${syncEnd}`;
      const triggered = triggerSync(requestUrl, projectId, syncStart, syncEnd, key, "fresh");
      if (triggered) {
        console.log("[TODAY_SYNC_TRIGGER]", {
          projectId,
          requestedStart: start,
          requestedEnd: end,
          syncStart: syncStart,
          syncEnd: syncEnd,
          today,
          last_sync_at: lastSyncAt ? lastSyncAt.toISOString() : null,
          age_ms: ageMs,
          ttl_ms: ttlMs,
        });
      } else {
        console.log("[TODAY_SYNC_SKIPPED_RECENT]", {
          projectId,
          start,
          end,
          today,
          reason: "dedup_inflight",
          last_sync_at: lastSyncAt ? lastSyncAt.toISOString() : null,
          age_ms: ageMs,
          ttl_ms: ttlMs,
        });
      }
      return {
        triggered,
        reason: triggered ? "fresh" : null,
        wouldSync: triggered,
        wouldSyncReason: triggered ? "fresh" : null,
      };
    }

    console.log("[TODAY_SYNC_SKIPPED_RECENT]", {
      projectId,
      start,
      end,
      today,
      reason: "ttl_not_expired",
      last_sync_at: lastSyncAt ? lastSyncAt.toISOString() : null,
      age_ms: ageMs,
      ttl_ms: ttlMs,
    });
    return { triggered: false, reason: null, wouldSync: false, wouldSyncReason: null };
  }

  // --- C. Fresh tail: range fully covered; refresh last N days if TTL expired ---
  const tailStart = new Date();
  tailStart.setDate(tailStart.getDate() - FRESH_TAIL_DAYS);
  const freshStart = tailStart.toISOString().slice(0, 10);
  const freshEnd = today;
  const rangeIncludesTail = end >= freshStart && start <= freshEnd;
  if (!rangeIncludesTail) {
    return { triggered: false, reason: null, wouldSync: false, wouldSyncReason: null };
  }

  const ttlMs = getSyncTtlMs(freshStart, freshEnd);
  const now = Date.now();
  const lastSyncMs = lastSyncAt ? lastSyncAt.getTime() : 0;
  if (lastSyncMs > 0 && now - lastSyncMs < ttlMs) {
    return { triggered: false, reason: null, wouldSync: false, wouldSyncReason: null };
  }

  if (readOnly) {
    console.log("[ENSURE_BACKFILL_RESULT]", {
      branch: "fresh_tail",
      readOnly: true,
      wouldSync: true,
      triggered: false,
      projectId,
      freshStart,
      freshEnd,
    });
    return {
      triggered: false,
      reason: null,
      wouldSync: true,
      wouldSyncReason: "fresh",
    };
  }

  const key = `${projectId}:${freshStart}:${freshEnd}`;
  const triggered = triggerSync(requestUrl, projectId, freshStart, freshEnd, key, "fresh");
  console.log("[ENSURE_BACKFILL_RESULT]", {
    branch: "fresh_tail",
    readOnly: false,
    wouldSync: triggered,
    triggered,
    projectId,
  });
  return {
    triggered,
    reason: triggered ? "fresh" : null,
    wouldSync: triggered,
    wouldSyncReason: triggered ? "fresh" : null,
  };
}

/**
 * Merge current ensureBackfill() result into a cached or fresh JSON body.
 * Cached responses can still carry stale `backfill` after coverage is complete — strip unless historical gaps remain.
 */
export function applyBackfillMetadata<T extends Record<string, unknown>>(
  payload: T,
  backfillResult: EnsureBackfillResult
): T {
  const next = { ...payload } as T & { backfill?: unknown };
  if (
    backfillResult.triggered &&
    backfillResult.reason === "historical" &&
    Array.isArray(backfillResult.historicalSyncIntervals) &&
    backfillResult.historicalSyncIntervals.length > 0
  ) {
    (next as Record<string, unknown>).backfill = {
      range_partially_covered: true,
      historical_sync_started: true,
      intervals: backfillResult.historicalSyncIntervals,
    };
  } else if (
    !backfillResult.triggered &&
    backfillResult.wouldSync &&
    backfillResult.wouldSyncReason === "historical" &&
    Array.isArray(backfillResult.historicalSyncIntervals) &&
    backfillResult.historicalSyncIntervals.length > 0
  ) {
    (next as Record<string, unknown>).backfill = {
      range_partially_covered: true,
      historical_sync_started: false,
      read_only_no_sync: true,
      intervals: backfillResult.historicalSyncIntervals,
    };
  } else {
    delete (next as Record<string, unknown>).backfill;
  }
  return next;
}
