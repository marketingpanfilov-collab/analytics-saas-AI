import { NextResponse } from "next/server";
import { requireSystemRole } from "@/app/lib/auth/requireSystemRole";
import { supabaseAdmin } from "@/app/lib/supabaseAdmin";
import { checkRateLimit, getRequestIp } from "@/app/lib/security/rateLimit";

const ROLES = new Set(["service_admin", "support", "ops_manager"]);

export async function POST(req: Request) {
  const auth = await requireSystemRole(["service_admin"]);
  if (!auth.ok) return NextResponse.json({ success: false, error: auth.error }, { status: auth.status });
  const ip = getRequestIp(req);
  const rl = await checkRateLimit(`internal:create-user:${auth.userId}:${ip}`, 15, 60_000);
  if (!rl.ok) {
    return NextResponse.json(
      { success: false, error: `Rate limit exceeded. Retry in ${rl.retryAfterSec}s` },
      { status: 429 }
    );
  }

  const body = (await req.json().catch(() => null)) as { email?: string; password?: string; role?: string } | null;
  const email = String(body?.email ?? "").trim().toLowerCase();
  const password = String(body?.password ?? "");
  const role = String(body?.role ?? "").toLowerCase();
  if (!email || !password || !ROLES.has(role)) {
    return NextResponse.json({ success: false, error: "email, password, role required" }, { status: 400 });
  }
  if (password.length < 8) {
    return NextResponse.json({ success: false, error: "password must be at least 8 chars" }, { status: 400 });
  }

  const admin = supabaseAdmin();
  const created = await admin.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
  });
  if (created.error || !created.data.user?.id) {
    return NextResponse.json({ success: false, error: created.error?.message ?? "failed to create user" }, { status: 500 });
  }

  const userId = created.data.user.id;
  const { error: roleErr } = await admin.from("system_user_roles").insert({
    user_id: userId,
    role,
    assigned_by: auth.userId,
    created_at: new Date().toISOString(),
  });
  if (roleErr) {
    // Rollback auth user to avoid orphaned internal accounts without expected role.
    await admin.auth.admin.deleteUser(userId).catch(() => null);
    return NextResponse.json({ success: false, error: roleErr.message }, { status: 500 });
  }

  await admin.from("system_role_audit_log").insert({
    actor_user_id: auth.userId,
    target_user_id: userId,
    role,
    action: "create_user",
    meta: { email },
    created_at: new Date().toISOString(),
  });

  return NextResponse.json({ success: true, user_id: userId });
}

