type Bucket = {
  count: number;
  resetAt: number;
};

const buckets = new Map<string, Bucket>();
let redisClient: import("@upstash/redis").Redis | null | undefined;

function getRedisClient(): import("@upstash/redis").Redis | null {
  if (redisClient !== undefined) return redisClient;
  const url = process.env.UPSTASH_REDIS_REST_URL?.trim();
  const token = process.env.UPSTASH_REDIS_REST_TOKEN?.trim();
  if (!url || !token) {
    redisClient = null;
    return redisClient;
  }
  // Lazy require keeps local/dev path working even without Redis env configured.
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { Redis } = require("@upstash/redis") as { Redis: new (args: { url: string; token: string }) => import("@upstash/redis").Redis };
  redisClient = new Redis({ url, token });
  return redisClient;
}

function checkRateLimitMemory(key: string, limit: number, windowMs: number): { ok: boolean; retryAfterSec: number } {
  const now = Date.now();
  const existing = buckets.get(key);
  if (!existing || now >= existing.resetAt) {
    buckets.set(key, { count: 1, resetAt: now + windowMs });
    return { ok: true, retryAfterSec: Math.ceil(windowMs / 1000) };
  }
  if (existing.count >= limit) {
    return { ok: false, retryAfterSec: Math.max(1, Math.ceil((existing.resetAt - now) / 1000)) };
  }
  existing.count += 1;
  buckets.set(key, existing);
  return { ok: true, retryAfterSec: Math.max(1, Math.ceil((existing.resetAt - now) / 1000)) };
}

export async function checkRateLimit(
  key: string,
  limit: number,
  windowMs: number
): Promise<{ ok: boolean; retryAfterSec: number }> {
  const redis = getRedisClient();
  if (!redis) return checkRateLimitMemory(key, limit, windowMs);
  try {
    const count = await redis.incr(key);
    if (count === 1) {
      await redis.pexpire(key, windowMs);
    }
    const ttlMsRaw = await redis.pttl(key);
    const ttlMs = typeof ttlMsRaw === "number" && ttlMsRaw > 0 ? ttlMsRaw : windowMs;
    if (count > limit) {
      return { ok: false, retryAfterSec: Math.max(1, Math.ceil(ttlMs / 1000)) };
    }
    return { ok: true, retryAfterSec: Math.max(1, Math.ceil(ttlMs / 1000)) };
  } catch {
    // Safety fallback: if Redis is unavailable, keep protection enabled in-memory.
    return checkRateLimitMemory(key, limit, windowMs);
  }
}

export function getRequestIp(req: Request): string {
  const xff = req.headers.get("x-forwarded-for");
  if (xff) return xff.split(",")[0]?.trim() ?? "unknown";
  const xrip = req.headers.get("x-real-ip");
  if (xrip) return xrip.trim();
  return "unknown";
}

