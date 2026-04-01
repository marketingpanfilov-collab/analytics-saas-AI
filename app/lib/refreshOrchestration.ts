/**
 * Shared client-side refresh orchestration guards.
 * Server freshness remains source of truth; these keys are anti-burst helpers.
 */
export const REFRESH_BASELINE_SESSION_KEY = "dashboard_refresh_baseline_ok_ms";
export const POST_REFRESH_GUARD_MS = 45_000;
export const FRESHNESS_MIN_CHECK_INTERVAL_MS = 45_000;
