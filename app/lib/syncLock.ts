/**
 * In-process lock for sync: prevents parallel sync of the same ad_account and date range.
 * Lock key: platform:ad_account_id:date_start:date_end:sync_type
 */

const locks = new Map<string, Promise<unknown>>();

export function syncLockKey(
  platform: string,
  adAccountId: string,
  dateStart: string,
  dateEnd: string,
  syncType: string
): string {
  return `${platform}:${adAccountId}:${dateStart}:${dateEnd}:${syncType}`;
}

/**
 * Run fn with lock. If the same key is already running, wait for that promise and return its result.
 * Otherwise run fn(), store its promise, and return its result.
 */
export async function withSyncLock<T>(
  platform: string,
  adAccountId: string,
  dateStart: string,
  dateEnd: string,
  syncType: string,
  fn: () => Promise<T>
): Promise<T> {
  const key = syncLockKey(platform, adAccountId, dateStart, dateEnd, syncType);
  const existing = locks.get(key);
  if (existing) {
    return existing as Promise<T>;
  }
  const promise = fn().finally(() => {
    locks.delete(key);
  });
  locks.set(key, promise);
  return promise;
}
