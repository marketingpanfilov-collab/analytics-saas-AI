/**
 * TTL policy for sync: when to consider data stale and trigger backfill.
 * - Today / latest (end >= today - 0) → 15 min
 * - Last 7 days → 1 hour
 * - Last 30 days → 6 hours
 * - Older than 30 days → 24 hours
 */

const MS_15_MIN = 15 * 60 * 1000;
const MS_1_HOUR = 60 * 60 * 1000;
const MS_6_HOURS = 6 * 60 * 60 * 1000;
const MS_24_HOURS = 24 * 60 * 60 * 1000;

function todayYmd(): string {
  return new Date().toISOString().slice(0, 10);
}

function daysAgo(days: number): string {
  const d = new Date();
  d.setDate(d.getDate() - days);
  return d.toISOString().slice(0, 10);
}

/**
 * Returns TTL in ms for the given date range.
 * Used to decide if we should trigger sync (last sync older than this = stale).
 */
export function getSyncTtlMs(start: string, end: string): number {
  const today = todayYmd();
  const endDate = end;
  if (endDate >= today) return MS_15_MIN;
  if (endDate >= daysAgo(7)) return MS_1_HOUR;
  if (endDate >= daysAgo(30)) return MS_6_HOURS;
  return MS_24_HOURS;
}

export const SyncTtl = {
  /** TTL labels for logging */
  labels: {
    [MS_15_MIN]: "15m",
    [MS_1_HOUR]: "1h",
    [MS_6_HOURS]: "6h",
    [MS_24_HOURS]: "24h",
  } as Record<number, string>,
};
