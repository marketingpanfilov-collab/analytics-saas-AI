/**
 * In-memory rate limit for public redirect endpoint: 60 requests per minute per IP.
 * Resets every minute. Returns true if allowed, false if rate limited.
 */
const WINDOW_MS = 60_000;
const MAX_REQUESTS = 60;

const store = new Map<string, { count: number; resetAt: number }>();

function getWindowKey(ip: string): string {
  return ip || "unknown";
}

export function checkRedirectRateLimit(ip: string | null): { allowed: boolean } {
  const key = getWindowKey(ip ?? "unknown");
  const now = Date.now();
  let entry = store.get(key);

  if (!entry) {
    store.set(key, { count: 1, resetAt: now + WINDOW_MS });
    return { allowed: true };
  }

  if (now >= entry.resetAt) {
    entry = { count: 1, resetAt: now + WINDOW_MS };
    store.set(key, entry);
    return { allowed: true };
  }

  if (entry.count >= MAX_REQUESTS) {
    return { allowed: false };
  }

  entry.count += 1;
  return { allowed: true };
}
