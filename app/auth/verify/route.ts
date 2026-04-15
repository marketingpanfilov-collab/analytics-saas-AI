import { NextResponse, type NextRequest } from "next/server";
import { createServerClient } from "@supabase/ssr";
import { safeAppNextTarget } from "@/app/lib/auth/safeAppNextTarget";
import { resolveEmailCallbackContinuePath } from "@/app/lib/auth/resolveEmailCallbackContinuePath";

const DEFAULT_NEXT = "/app/projects";

/** `emailRedirectTo` из signUp — часто полный URL /auth/callback?next=… */
function nextFromEmailRedirectTo(redirectTo: string | null): string | null {
  if (!redirectTo) return null;
  try {
    const u = new URL(redirectTo);
    if (u.pathname.endsWith("/auth/callback")) {
      return u.searchParams.get("next");
    }
    if (u.pathname === "/app" || u.pathname.startsWith("/app/")) {
      return `${u.pathname}${u.search}`;
    }
  } catch {
    return null;
  }
  return null;
}

const VERIFY_TYPES = [
  "signup",
  "invite",
  "magiclink",
  "recovery",
  "email_change",
  "email",
] as const;

type VerifyEmailType = (typeof VERIFY_TYPES)[number];

function isVerifyType(t: string): t is VerifyEmailType {
  return (VERIFY_TYPES as readonly string[]).includes(t);
}

/**
 * Подтверждение email / сброс пароля по token_hash из письма (без PKCE code_verifier).
 * В шаблоне Supabase замените href кнопки с {{ .ConfirmationURL }} на URL этого route — см. supabase/templates/*.html
 */
export async function GET(request: NextRequest) {
  const url = request.nextUrl.clone();
  const tokenHash = url.searchParams.get("token_hash");
  const typeRaw = url.searchParams.get("type") ?? "";
  const nextRaw =
    url.searchParams.get("next") ?? nextFromEmailRedirectTo(url.searchParams.get("redirect_to"));

  const loginBase = new URL("/login", url.origin);
  const safeNext = safeAppNextTarget(nextRaw, url.origin) ?? DEFAULT_NEXT;
  loginBase.searchParams.set("next", safeNext);

  if (!tokenHash || !isVerifyType(typeRaw)) {
    loginBase.searchParams.set("auth_error", "invalid_verify_link");
    return NextResponse.redirect(loginBase);
  }

  const pendingCookies: { name: string; value: string; options?: object }[] = [];

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll();
        },
        setAll(cookiesToSet) {
          cookiesToSet.forEach(({ name, value, options }) => {
            pendingCookies.push({ name, value, options });
          });
        },
      },
    }
  );

  const { error } = await supabase.auth.verifyOtp({
    token_hash: tokenHash,
    type: typeRaw,
  });

  if (error) {
    loginBase.searchParams.set("auth_error", "exchange_failed");
    return NextResponse.redirect(loginBase);
  }

  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user?.id) {
    loginBase.searchParams.set("auth_hint", "missing_code");
    return NextResponse.redirect(loginBase);
  }

  let redirectPath: string;
  if (typeRaw === "recovery") {
    redirectPath = "/reset";
  } else {
    redirectPath = await resolveEmailCallbackContinuePath(url.origin, nextRaw, {
      id: user.id,
      email: user.email ?? undefined,
    });
  }

  const redirectUrl = new URL(redirectPath, url.origin);
  const response = NextResponse.redirect(redirectUrl);
  pendingCookies.forEach(({ name, value, options }) => {
    if (options && typeof options === "object") {
      response.cookies.set(name, value, options as Parameters<typeof response.cookies.set>[2]);
    } else {
      response.cookies.set(name, value);
    }
  });

  return response;
}
