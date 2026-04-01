type CacheEntry<T> = {
  value?: T;
  expiresAtMs: number;
  inFlight?: Promise<T>;
};

const cache = new Map<string, CacheEntry<unknown>>();

type CachedOpts = {
  ttlMs?: number;
  force?: boolean;
};

/**
 * Small in-memory/session-lifetime cache for shared API reads.
 * Intended to reduce duplicate requests across dashboard + sidebar + sibling boards.
 */
export async function getSharedCached<T>(
  key: string,
  fetcher: () => Promise<T>,
  opts?: CachedOpts
): Promise<T> {
  const ttlMs = Math.max(0, opts?.ttlMs ?? 60_000);
  const force = opts?.force === true;
  const now = Date.now();
  const current = cache.get(key) as CacheEntry<T> | undefined;

  if (!force && current?.value !== undefined && current.expiresAtMs > now) {
    return current.value;
  }
  if (!force && current?.inFlight) {
    return current.inFlight;
  }

  const inFlight = fetcher()
    .then((value) => {
      cache.set(key, { value, expiresAtMs: Date.now() + ttlMs });
      return value;
    })
    .catch((err) => {
      const latest = cache.get(key) as CacheEntry<T> | undefined;
      cache.set(key, { value: latest?.value, expiresAtMs: latest?.expiresAtMs ?? 0 });
      throw err;
    });

  cache.set(key, {
    value: current?.value,
    expiresAtMs: current?.expiresAtMs ?? 0,
    inFlight,
  });
  return inFlight;
}

export function invalidateSharedCache(key: string): void {
  cache.delete(key);
}

