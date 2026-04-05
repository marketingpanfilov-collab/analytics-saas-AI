/**
 * Разрешить только внутренние пути под `/app` (без open-redirect).
 * Используется в proxy, auth callback и редиректах после логина.
 */
export function safeAppNextTarget(raw: string | null, origin: string): string | null {
  if (!raw || !raw.startsWith("/") || raw.startsWith("//")) return null;
  try {
    const base = new URL(origin);
    const resolved = new URL(raw, base);
    if (resolved.origin !== base.origin) return null;
    const p = resolved.pathname;
    if (p !== "/app" && !p.startsWith("/app/")) return null;
    return `${resolved.pathname}${resolved.search}`;
  } catch {
    return null;
  }
}
