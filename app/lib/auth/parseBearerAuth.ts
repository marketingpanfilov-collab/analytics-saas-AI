/**
 * Parse `Authorization: Bearer <token>` (single space after Bearer).
 * Used for Vercel Cron and manual curl; must match real whitespace, not literal `\s` in a broken regex.
 */
export function parseBearerToken(authHeader: string | null): string | null {
  if (!authHeader) return null;
  const m = authHeader.match(/^Bearer\s+(.+)$/i);
  return m?.[1]?.trim() ?? null;
}
