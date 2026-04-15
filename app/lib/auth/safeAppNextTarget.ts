/**
 * Разрешить только безопасные внутренние пути (без open-redirect).
 * — `/app/...` — основное приложение
 * — `/reset`, `/login` — сброс пароля и вход после редиректа из письма
 * — `/auth/finalize-signup-checkout` — финализация оплаты после подтверждения email
 *
 * Используется в proxy, auth callback, письме подтверждения email и редиректах после логина.
 */
export function safeAppNextTarget(raw: string | null, origin: string): string | null {
  if (!raw || !raw.startsWith("/") || raw.startsWith("//")) return null;
  try {
    const base = new URL(origin);
    const resolved = new URL(raw, base);
    if (resolved.origin !== base.origin) return null;
    const p = resolved.pathname;

    if (p === "/reset" || p === "/login") {
      return `${resolved.pathname}${resolved.search}`;
    }
    if (p === "/auth/finalize-signup-checkout" || p.startsWith("/auth/finalize-signup-checkout/")) {
      return `${resolved.pathname}${resolved.search}`;
    }

    if (p !== "/app" && !p.startsWith("/app/")) return null;
    return `${resolved.pathname}${resolved.search}`;
  } catch {
    return null;
  }
}
