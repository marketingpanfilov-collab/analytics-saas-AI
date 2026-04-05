import { NextResponse, type NextRequest } from "next/server";
import { createServerClient } from "@supabase/ssr";
import { safeAppNextTarget } from "@/app/lib/auth/safeAppNextTarget";

/** Публичные шаги передачи организации по ссылке из письма (гость без сессии). */
function isOrgTransferPublicPath(pathname: string): boolean {
  if (pathname === "/app/transfer/accept" || pathname.startsWith("/app/transfer/accept/")) return true;
  if (pathname === "/app/transfer/set-password" || pathname.startsWith("/app/transfer/set-password/")) return true;
  return false;
}

export async function proxy(request: NextRequest) {
  const response = NextResponse.next({ request });

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        get(name) {
          return request.cookies.get(name)?.value;
        },
        set(name, value, options) {
          response.cookies.set({ name, value, ...options });
        },
        remove(name, options) {
          response.cookies.set({ name, value: "", ...options, maxAge: 0 });
        },
      },
    }
  );

  const {
    data: { user },
  } = await supabase.auth.getUser();

  const pathname = request.nextUrl.pathname;
  const isProtected = pathname.startsWith("/app");

  // 1) Protect private routes (сохраняем query, иначе теряется ?token= у invite и др.)
  if (isProtected && !user && !isOrgTransferPublicPath(pathname)) {
    const url = request.nextUrl.clone();
    url.pathname = "/login";
    url.search = "";
    const fullReturn = pathname + request.nextUrl.search;
    const nextTarget = safeAppNextTarget(fullReturn, request.nextUrl.origin) ?? pathname;
    url.searchParams.set("next", nextTarget);
    return NextResponse.redirect(url);
  }

  // 2) Уже залогинен на /login — не терять `next` (invite, billing и т.д.)
  if (pathname.startsWith("/login") && user) {
    const rawNext = request.nextUrl.searchParams.get("next");
    const dest = safeAppNextTarget(rawNext, request.nextUrl.origin);
    if (dest) {
      return NextResponse.redirect(new URL(dest, request.nextUrl.origin));
    }
    const url = request.nextUrl.clone();
    url.pathname = "/app/projects";
    url.search = "";
    return NextResponse.redirect(url);
  }

  return response;
}

export const config = {
  matcher: ["/app/:path*", "/login"],
};
