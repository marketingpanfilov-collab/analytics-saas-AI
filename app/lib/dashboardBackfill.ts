/**
 * Dashboard backfill: trigger sync when campaign-level data is missing or stale.
 * Only enabled ad_accounts (ad_account_settings.is_enabled = true) participate.
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

export type Platform = "meta" | "google" | "tiktok";

/** Number of "fresh" days we refresh when range is fully covered (today, yesterday, last 3 days). */
const FRESH_TAIL_DAYS = 3;

/** Get ad_account ids that are enabled for this project (same contract as sync/dashboard). */
async function getEnabledAdAccountIds(
  admin: SupabaseClient,
  projectId: string
): Promise<string[]> {
  const { data: settingsRows } = await admin
    .from("ad_account_settings")
    .select("ad_account_id")
    .eq("project_id", projectId)
    .eq("is_enabled", true);
  return (settingsRows ?? []).map((r: { ad_account_id: string }) => r.ad_account_id);
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
  /** Whether this account has data (campaign- or account-level, including zero-activity) for every day in [start, end]. */
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
  /** Distinct dates that are covered by ALL enabled accounts (intersection). */
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
 * Full coverage = EVERY enabled account has at least one row (any level) for EVERY day in [start, end].
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

  const perAccountCoverage: PerAccountCoverage[] = [];
  const uncoveredAccountIds: string[] = [];
  for (const id of ids) {
    const accountDates = datesByAccount.get(id) ?? new Set();
    const covered = allDates.every((d) => accountDates.has(d));
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

  // Dates covered by ALL accounts (intersection)
  const coveredByAll = new Set<string>();
  for (const d of allDates) {
    if (ids.every((id) => datesByAccount.get(id)?.has(d))) {
      coveredByAll.add(d);
    }
  }
  const coveredDates = [...coveredByAll].sort();
  const missingIntervalsRaw = getMissingIntervals(start, end, coveredByAll);
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
      perAccount: perAccountCoverage.map((p) => ({ id: p.ad_account_id.slice(0, 8), covered: p.covered, min: p.min_date, max: p.max_date, date_count: p.date_count })),
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
async function getLastSyncFinishedAt(
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
 * If the requested range has missing days (incomplete coverage), trigger historical sync for missing intervals only.
 * If the range is fully covered, optionally trigger fresh tail sync (last FRESH_TAIL_DAYS) when TTL expired.
 * Does NOT await sync; returns immediately.
 * Returns { triggered: boolean, reason: 'historical' | 'fresh' | null } for logging/UI.
 */
export type EnsureBackfillResult = {
  triggered: boolean;
  /** 'historical' = sync for missing date intervals; 'fresh' = TTL-based tail refresh */
  reason: "historical" | "fresh" | null;
  /** When reason === 'historical': range was partially covered; sync started for missing intervals. */
  rangePartiallyCovered?: boolean;
  /** When reason === 'historical': missing intervals that were submitted for sync. */
  historicalSyncIntervals?: { start: string; end: string }[];
};

export async function ensureBackfill(
  admin: SupabaseClient,
  projectId: string,
  start: string,
  end: string,
  requestUrl: string
): Promise<EnsureBackfillResult> {
  const enabledIds = await getEnabledAdAccountIds(admin, projectId);
  if (!enabledIds.length) {
    return { triggered: false, reason: null };
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
    for (const iv of validIntervals) {
      if (iv.end < iv.start) {
        console.warn("[BACKFILL_SKIP_INVALID_INTERVAL]", { projectId, interval: iv, reason: "end < start" });
        continue;
      }
      const key = `${projectId}:${iv.start}:${iv.end}`;
      triggerSync(requestUrl, projectId, iv.start, iv.end, key, "historical");
    }
    return {
      triggered: true,
      reason: "historical",
      rangePartiallyCovered: true,
      historicalSyncIntervals: validIntervals,
    };
  }

  // --- B. Today-specific freshness: even if fully covered, today must be periodically resynced ---
  const today = new Date().toISOString().slice(0, 10);
  const lastSyncAt = await getLastSyncFinishedAt(admin, projectId, enabledIds);
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
      const key = `${projectId}:${start}:${end}`;
      const triggered = triggerSync(requestUrl, projectId, start, end, key, "fresh");
      if (triggered) {
        console.log("[TODAY_SYNC_TRIGGER]", {
          projectId,
          start,
          end,
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
    return { triggered: false, reason: null };
  }

  // --- C. Fresh tail: range fully covered; refresh last N days if TTL expired ---
  const tailStart = new Date();
  tailStart.setDate(tailStart.getDate() - FRESH_TAIL_DAYS);
  const freshStart = tailStart.toISOString().slice(0, 10);
  const freshEnd = today;
  const rangeIncludesTail = end >= freshStart && start <= freshEnd;
  if (!rangeIncludesTail) {
    return { triggered: false, reason: null };
  }

  const ttlMs = getSyncTtlMs(freshStart, freshEnd);
  const now = Date.now();
  const lastSyncMs = lastSyncAt ? lastSyncAt.getTime() : 0;
  if (lastSyncMs > 0 && now - lastSyncMs < ttlMs) {
    return { triggered: false, reason: null };
  }

  const key = `${projectId}:${freshStart}:${freshEnd}`;
  const triggered = triggerSync(requestUrl, projectId, freshStart, freshEnd, key, "fresh");
  return {
    triggered,
    reason: triggered ? "fresh" : null,
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
  } else {
    delete (next as Record<string, unknown>).backfill;
  }
  return next;
}
