import { NextResponse } from "next/server";
import { createServerSupabase } from "@/app/lib/supabaseServer";
import { resolveEmailCallbackContinuePath } from "@/app/lib/auth/resolveEmailCallbackContinuePath";

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

  let body: { next?: string | null } = {};
  try {
    body = (await req.json()) as { next?: string | null };
  } catch {
    body = {};
  }

  const url = new URL(req.url);
  const redirectPath = await resolveEmailCallbackContinuePath(url.origin, body.next ?? null, {
    id: user.id,
    email: user.email ?? undefined,
  });

  return NextResponse.json({ ok: true, redirect: redirectPath });
}
