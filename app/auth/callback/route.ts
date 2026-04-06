import { NextResponse, type NextRequest } from "next/server";
import { createServerClient } from "@supabase/ssr";
import { safeAppNextTarget } from "@/app/lib/auth/safeAppNextTarget";
import { supabaseAdmin } from "@/app/lib/supabaseAdmin";
import { runFinalizeLoginCheckoutCore } from "@/app/lib/auth/finalizeLoginCheckoutCore";

const DEFAULT_AFTER_CONFIRM = "/app/projects";

/**
 * Email confirmation / OAuth PKCE: Supabase redirects here with ?code=...
 * Обмен кода на сессию, затем при открытом login-checkout intent — серверный finalize ДО редиректа в /app
 * (иначе новая вкладка из письма не видит sessionStorage с org_id и ловит NO_ORG_ACCESS).
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

  const { error: exchangeError } = await supabase.auth.exchangeCodeForSession(code);
  if (exchangeError) {
    const login = new URL("/login", url.origin);
    login.searchParams.set("auth_error", "exchange_failed");
    login.searchParams.set("next", safeNext);
    return NextResponse.redirect(login);
  }

  const {
    data: { user },
  } = await supabase.auth.getUser();

  let redirectPath = safeNext;

  if (user?.email) {
    const emailNorm = user.email.trim().toLowerCase();
    const admin = supabaseAdmin();
    const { data: openIntent } = await admin
      .from("billing_login_checkout_intents")
      .select("organization_id")
      .eq("email_normalized", emailNorm)
      .is("linked_at", null)
      .maybeSingle();

    if (openIntent?.organization_id) {
      const fin = await runFinalizeLoginCheckoutCore(admin, {
        userId: user.id,
        sessionEmailNormalized: emailNorm,
        organizationId: String(openIntent.organization_id),
      });

      if (fin.ok) {
        redirectPath = safeNext;
      } else if (fin.code === "subscription_not_active_yet") {
        const recovery = new URL("/auth/finalize-signup-checkout", url.origin);
        recovery.searchParams.set("next", safeNext);
        redirectPath = `${recovery.pathname}${recovery.search}`;
      } else if (fin.code === "already_finalized") {
        redirectPath = safeNext;
      } else {
        const recovery = new URL("/auth/finalize-signup-checkout", url.origin);
        recovery.searchParams.set("next", safeNext);
        recovery.searchParams.set("finalize_error", fin.code);
        redirectPath = `${recovery.pathname}${recovery.search}`;
      }
    }
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
