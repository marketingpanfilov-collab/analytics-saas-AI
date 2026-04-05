import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/app/lib/supabaseAdmin";
import { authUserExistsByEmail } from "@/app/lib/authUserExistsByEmail";
import { checkRateLimit, getRequestIp } from "@/app/lib/security/rateLimit";

export const runtime = "nodejs";

const MIN_PASSWORD = 8;

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
  const rl = await checkRateLimit(`project-invite-register:${ip}`, 12, 60_000);
  if (!rl.ok) {
    return NextResponse.json(
      { success: false, error: `Слишком много попыток. Повторите через ${rl.retryAfterSec} с` },
      { status: 429 }
    );
  }

  const admin = supabaseAdmin();
  const now = new Date().toISOString();

  const { data: invite, error: invErr } = await admin
    .from("project_invites")
    .select("id, project_id, organization_id, role, status, expires_at, email, invite_type")
    .eq("token", token)
    .maybeSingle();

  if (invErr || !invite) {
    return NextResponse.json({ success: false, error: "invalid", reason: "not_found" }, { status: 404 });
  }
  if (invite.status !== "pending") {
    return NextResponse.json(
      {
        success: false,
        error: "invalid",
        reason: invite.status === "accepted" ? "accepted" : invite.status === "revoked" ? "revoked" : "invalid",
      },
      { status: 400 }
    );
  }
  if (invite.expires_at <= now) {
    return NextResponse.json({ success: false, error: "expired", reason: "expired" }, { status: 400 });
  }

  if (invite.invite_type !== "email" || !invite.email || !String(invite.email).trim()) {
    return NextResponse.json(
      { success: false, error: "Регистрация по ссылке доступна только для приглашений на email" },
      { status: 400 }
    );
  }

  const email = String(invite.email).trim().toLowerCase();

  try {
    const exists = await authUserExistsByEmail(admin, email);
    if (exists) {
      return NextResponse.json(
        {
          success: false,
          error: "Аккаунт с этим email уже есть. Войдите и примите приглашение.",
          code: "USER_ALREADY_EXISTS",
        },
        { status: 409 }
      );
    }
  } catch (e) {
    const msg = e instanceof Error ? e.message : "lookup_failed";
    return NextResponse.json({ success: false, error: msg }, { status: 500 });
  }

  const { data: created, error: createErr } = await admin.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
  });

  if (createErr) {
    if (createErr.message?.includes("already been registered") || createErr.status === 422) {
      return NextResponse.json(
        {
          success: false,
          error: "Аккаунт с этим email уже есть. Войдите и примите приглашение.",
          code: "USER_ALREADY_EXISTS",
        },
        { status: 409 }
      );
    }
    return NextResponse.json({ success: false, error: createErr.message }, { status: 400 });
  }

  if (!created?.user?.id) {
    return NextResponse.json({ success: false, error: "Не удалось создать пользователя" }, { status: 500 });
  }

  return NextResponse.json({
    success: true,
    email,
    user_id: created.user.id,
  });
}
