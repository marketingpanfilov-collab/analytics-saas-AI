import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/app/lib/supabaseAdmin";
import { authUserExistsByEmail } from "@/app/lib/authUserExistsByEmail";
import { checkRateLimit, getRequestIp } from "@/app/lib/security/rateLimit";

export const runtime = "nodejs";

const MIN_PASSWORD = 8;

/**
 * POST /api/org/transfer-request/register
 * Create auth user for pending transfer (email on the request).
 */
export async function POST(req: Request) {
  const body = await req.json().catch(() => ({}));
  const token = typeof body.token === "string" ? body.token.trim() : "";
  const password = typeof body.password === "string" ? body.password : "";

  if (!token) {
    return NextResponse.json({ success: false, error: "token required" }, { status: 400 });
  }
  if (password.length < MIN_PASSWORD) {
    return NextResponse.json(
      { success: false, error: `Пароль не короче ${MIN_PASSWORD} символов` },
      { status: 400 }
    );
  }

  const ip = getRequestIp(req);
  const rl = await checkRateLimit(`org-transfer-register:${ip}`, 12, 60_000);
  if (!rl.ok) {
    return NextResponse.json(
      { success: false, error: `Слишком много попыток. Повторите через ${rl.retryAfterSec} с` },
      { status: 429 }
    );
  }

  const admin = supabaseAdmin();
  const now = new Date().toISOString();

  const { data: tr, error: trErr } = await admin
    .from("organization_transfer_requests")
    .select("id, organization_id, to_email, status, expires_at")
    .eq("token", token)
    .maybeSingle();

  if (trErr || !tr) {
    return NextResponse.json({ success: false, error: "invalid", reason: "not_found" }, { status: 404 });
  }
  if (tr.status !== "pending") {
    return NextResponse.json(
      {
        success: false,
        error: "invalid",
        reason: tr.status === "completed" ? "completed" : "cancelled",
      },
      { status: 400 }
    );
  }
  if (tr.expires_at <= now) {
    return NextResponse.json({ success: false, error: "expired", reason: "expired" }, { status: 400 });
  }

  const email = String(tr.to_email).trim().toLowerCase();
  if (!email) {
    return NextResponse.json({ success: false, error: "invalid transfer" }, { status: 400 });
  }

  try {
    const exists = await authUserExistsByEmail(admin, email);
    if (exists) {
      return NextResponse.json(
        {
          success: false,
          error: "Аккаунт с этим email уже есть. Войдите и примите передачу.",
          code: "USER_ALREADY_EXISTS",
        },
        { status: 409 }
      );
    }
  } catch (e) {
    const msg = e instanceof Error ? e.message : "lookup_failed";
    return NextResponse.json({ success: false, error: msg }, { status: 500 });
  }

  const { error: createErr } = await admin.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
  });

  if (createErr) {
    if (createErr.message?.includes("already been registered") || createErr.status === 422) {
      return NextResponse.json(
        {
          success: false,
          error: "Аккаунт с этим email уже есть. Войдите и примите передачу.",
          code: "USER_ALREADY_EXISTS",
        },
        { status: 409 }
      );
    }
    return NextResponse.json(
      { success: false, error: createErr.message ?? "create_user_failed" },
      { status: 500 }
    );
  }

  return NextResponse.json({ success: true, email });
}
