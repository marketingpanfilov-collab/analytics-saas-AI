import { NextResponse } from "next/server";
import { createServerSupabase } from "@/app/lib/supabaseServer";
import { supabaseAdmin } from "@/app/lib/supabaseAdmin";

const REAUTH_EXPIRY_SECONDS = 120;

/**
 * POST /api/auth/verify-password
 * Body: { password: string }
 * Returns: { success: true, reauth_token: string } or error.
 * The token is short-lived and must be sent to transfer-ownership to confirm re-auth.
 */
export async function POST(req: Request) {
  const body = await req.json().catch(() => null);
  const password = typeof body?.password === "string" ? body.password : "";
  if (!password) {
    return NextResponse.json(
      { success: false, error: "Password is required" },
      { status: 400 }
    );
  }

  const supabase = await createServerSupabase();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user?.email) {
    return NextResponse.json({ success: false, error: "Unauthorized" }, { status: 401 });
  }

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !anonKey) {
    return NextResponse.json(
      { success: false, error: "Server configuration error" },
      { status: 500 }
    );
  }

  const res = await fetch(`${url}/auth/v1/token?grant_type=password`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      apikey: anonKey,
    },
    body: JSON.stringify({
      email: user.email,
      password,
      grant_type: "password",
    }),
  });

  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    const msg = err?.error_description ?? err?.msg ?? "Invalid password";
    return NextResponse.json(
      { success: false, error: msg },
      { status: 401 }
    );
  }

  const expiresAt = new Date(Date.now() + REAUTH_EXPIRY_SECONDS * 1000).toISOString();
  const admin = supabaseAdmin();
  const { data: row, error } = await admin
    .from("reauth_tokens")
    .insert({ user_id: user.id, expires_at: expiresAt })
    .select("id")
    .single();

  if (error || !row?.id) {
    return NextResponse.json(
      { success: false, error: error?.message ?? "Failed to create reauth token" },
      { status: 500 }
    );
  }

  return NextResponse.json({
    success: true,
    reauth_token: row.id,
    expires_in: REAUTH_EXPIRY_SECONDS,
  });
}
