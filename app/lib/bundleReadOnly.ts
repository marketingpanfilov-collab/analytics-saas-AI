/**
 * When true, GET /api/dashboard/bundle uses ensureBackfill in read-only mode:
 * coverage/TTL decisions run, but no POST /api/dashboard/sync from the bundle path.
 * Toggle via env only — no client code change required.
 */
export function isBundleReadOnlyMode(): boolean {
  const v = process.env.BUNDLE_READ_ONLY_MODE;
  return v === "1" || v === "true" || v === "yes";
}
