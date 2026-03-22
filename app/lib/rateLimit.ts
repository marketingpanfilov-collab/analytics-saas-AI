/**
 * Rate limit helper for POST /api/tracking/conversion.
 * Uses DB table ingest_rate_limits and RPC check_and_increment_ingest_rate.
 */

export type IngestRateLimitResult =
  | { allowed: true }
  | { allowed: false; retryAfterSeconds: number };

const RATE_LIMIT_ERRORS = ["RATE_LIMIT_IP", "RATE_LIMIT_PROJ_MINUTE", "RATE_LIMIT_PROJ_DAY"] as const;

/**
 * Get client IP from request (Vercel/Next: x-forwarded-for, x-real-ip, or fallback).
 */
export function getClientIp(req: Request): string {
  const forwarded = req.headers.get("x-forwarded-for");
  if (forwarded) {
    const first = forwarded.split(",")[0]?.trim();
    if (first) return first;
  }
  const real = req.headers.get("x-real-ip");
  if (real) return real.trim();
  return "0.0.0.0";
}

/**
 * Start of current minute in UTC (for minute bucket).
 */
export function getMinuteWindowStart(): Date {
  const d = new Date();
  d.setUTCSeconds(0, 0);
  return d;
}

/**
 * Start of current day in UTC (for day bucket).
 */
export function getDayWindowStart(): Date {
  const d = new Date();
  d.setUTCHours(0, 0, 0, 0);
  return d;
}

/**
 * Check and increment ingest rate limit. Call after validating ingest key and project_id.
 * Returns { allowed: false, retryAfterSeconds } when limit exceeded (then return 429).
 */
export function parseIngestRateLimitError(error: unknown): IngestRateLimitResult | null {
  const msg = error instanceof Error ? error.message : String(error);
  if (!RATE_LIMIT_ERRORS.some((e) => msg.includes(e))) return null;
  // Retry after: 60s for minute limits, 86400 for day (next day). MVP: use 60.
  return { allowed: false, retryAfterSeconds: 60 };
}
