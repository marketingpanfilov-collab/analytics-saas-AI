import { NextResponse, type NextRequest } from "next/server";
import { createServerClient } from "@supabase/ssr";
import { safeAppNextTarget } from "@/app/lib/auth/safeAppNextTarget";

const DEFAULT_AFTER_CONFIRM = "/app/projects";

/**
 * Email confirmation / OAuth PKCE: Supabase redirects here with ?code=...
 * Обмен кода на сессию и безопасный редирект только под /app.
 */
export async function GET(request: NextRequest) {
  const url = request.nextUrl.clone();
  const code = url.searchParams.get("code");
  const nextRaw = url.searchParams.get("next");
  const safeNext = safeAppNextTarget(nextRaw, url.origin) ?? DEFAULT_AFTER_CONFIRM;

  const err = url.searchParams.get("error");
  const errDesc = url.searchParams.get("error_description");
  if (err) {
    const login = new URL("/login", url.origin);
    login.searchParams.set("auth_error", err);
    if (errDesc) login.searchParams.set("auth_error_description", errDesc.slice(0, 400));
    login.searchParams.set("next", safeNext);
    return NextResponse.redirect(login);
  }

  if (!code) {
    const login = new URL("/login", url.origin);
    login.searchParams.set("next", safeNext);
    login.searchParams.set("auth_hint", "missing_code");
    return NextResponse.redirect(login);
  }

  const redirectUrl = new URL(safeNext, url.origin);
  let response = NextResponse.redirect(redirectUrl);

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
            response.cookies.set(name, value, options ?? {});
          });
        },
      },
    }
  );

  const { error: exchangeError } = await supabase.auth.exchangeCodeForSession(code);
  if (exchangeError) {
    const login = new URL("/login", url.origin);
    login.searchParams.set("auth_error", "exchange_failed");
    login.searchParams.set("next", safeNext);
    return NextResponse.redirect(login);
  }

  return response;
}
