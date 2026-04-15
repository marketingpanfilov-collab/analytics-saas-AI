import { NextResponse } from "next/server";
import { createServerSupabase } from "@/app/lib/supabaseServer";
import { resolveEmailCallbackContinuePath } from "@/app/lib/auth/resolveEmailCallbackContinuePath";
import {
  META_COMPLETE_REGISTRATION_ELIGIBLE_COOKIE,
  META_CR_COOKIE_MAX_AGE_SEC,
} from "@/app/lib/metaCompleteRegistrationCookie";
import { setMetaCompleteRegistrationEligibleForUser } from "@/app/lib/metaCompleteRegistrationEligible";

/**
 * После implicit/hash или PKCE на клиенте сессия в cookies — сервер решает редирект (в т.ч. finalize login-checkout).
 */
export async function POST(req: Request) {
  const supabase = await createServerSupabase();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
  }

  let body: { next?: string | null; email_flow?: string } = {};
  try {
    body = (await req.json()) as { next?: string | null; email_flow?: string };
  } catch {
    body = {};
  }

  const url = new URL(req.url);
  const redirectPath = await resolveEmailCallbackContinuePath(url.origin, body.next ?? null, {
    id: user.id,
    email: user.email ?? undefined,
  });

  const res = NextResponse.json({ ok: true, redirect: redirectPath });
  if (body.email_flow === "signup") {
    res.cookies.set(META_COMPLETE_REGISTRATION_ELIGIBLE_COOKIE, "1", {
      httpOnly: true,
      path: "/",
      maxAge: META_CR_COOKIE_MAX_AGE_SEC,
      sameSite: "lax",
      secure: process.env.NODE_ENV === "production",
    });
    await setMetaCompleteRegistrationEligibleForUser(user.id);
  }
  return res;
}
