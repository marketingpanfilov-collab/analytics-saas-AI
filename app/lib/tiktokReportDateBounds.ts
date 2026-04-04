/**
 * TikTok insights sync only requests report days through **calendar yesterday UTC**
 * (same rule as `/api/oauth/tiktok/insights/sync`). Coverage and integration freshness
 * must use this ceiling so we do not treat unavailable tail days as missing data.
 */
export function tiktokMaxInclusiveReportDateUtcYmd(now: Date = new Date()): string {
  const y = new Date(now);
  y.setUTCDate(y.getUTCDate() - 1);
  return y.toISOString().slice(0, 10);
}
