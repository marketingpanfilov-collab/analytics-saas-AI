/**
 * Lightweight in-memory cache for dashboard API responses.
 * Key: route + project_id + source + start + end.
 * Only successful responses are cached; errors are not cached.
 */

type CacheEntry = { value: unknown; expiresAt: number };

const store = new Map<string, CacheEntry>();

function now() {
  return Date.now();
}

/** Build cache key. sourcesKey: sorted comma-separated or "all". accountIdsKey: sorted comma-separated or "all". */
export function dashboardCacheKey(
  route: "summary" | "timeseries" | "metrics",
  projectId: string,
  start: string,
  end: string,
  sourcesKey: string = "all",
  accountIdsKey: string = "all"
): string {
  const a = [route, projectId || "", start || "", end || "", sourcesKey, accountIdsKey];
  return a.join(":");
}

/** Get cached value if present and not expired. Returns null on miss or expiry. */
export function dashboardCacheGet(key: string): unknown | null {
  const entry = store.get(key);
  if (!entry) return null;
  if (now() >= entry.expiresAt) {
    store.delete(key);
    return null;
  }
  return entry.value;
}

/** Store value with TTL in milliseconds. Only call for successful responses. */
export function dashboardCacheSet(key: string, value: unknown, ttlMs: number): void {
  store.set(key, {
    value,
    expiresAt: now() + ttlMs,
  });
}

/** TTLs in milliseconds (for reference: summary 30s, metrics 30s, timeseries 60s) */
export const DASHBOARD_CACHE_TTL = {
  summary: 30_000,
  metrics: 30_000,
  timeseries: 60_000,
} as const;
