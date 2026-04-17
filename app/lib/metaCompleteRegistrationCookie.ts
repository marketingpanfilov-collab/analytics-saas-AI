/**
 * HttpOnly cookie: разрешение на одну отправку Meta CompleteRegistration после save_company онбординга.
 * Выставляется при подтверждении signup из письма (/auth/verify) или PKCE email_flow=signup.
 * Без письма тот же смысл даёт `user_metadata.boardiq_meta_cr_eligible` через `supabase.auth.updateUser` на клиенте после signUp.
 */
export const META_COMPLETE_REGISTRATION_ELIGIBLE_COOKIE = "boardiq_meta_cr_eligible";

export const META_CR_COOKIE_MAX_AGE_SEC = 15 * 60;

export function parseCookieFromRequestHeader(request: Request, name: string): string | null {
  const header = request.headers.get("cookie");
  if (!header) return null;
  for (const part of header.split(";")) {
    const idx = part.indexOf("=");
    if (idx === -1) continue;
    const k = part.slice(0, idx).trim();
    if (k !== name) continue;
    const v = part.slice(idx + 1).trim();
    try {
      return decodeURIComponent(v);
    } catch {
      return v;
    }
  }
  return null;
}

export function clientIpFromRequestForMeta(req: Request): string | null {
  const xf = req.headers.get("x-forwarded-for");
  if (xf) {
    const first = xf.split(",")[0]?.trim();
    if (first) return first;
  }
  const real = req.headers.get("x-real-ip");
  if (real?.trim()) return real.trim();
  return null;
}
