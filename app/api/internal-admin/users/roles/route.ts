import { NextResponse } from "next/server";
import { requireSystemRole } from "@/app/lib/auth/requireSystemRole";
import { supabaseAdmin } from "@/app/lib/supabaseAdmin";
import { checkRateLimit, getRequestIp } from "@/app/lib/security/rateLimit";

const ROLES = new Set(["service_admin", "support", "ops_manager"]);

export async function GET(req: Request) {
  const auth = await requireSystemRole(["service_admin"]);
  if (!auth.ok) return NextResponse.json({ success: false, error: auth.error }, { status: auth.status });
  const url = new URL(req.url);
  const userId = url.searchParams.get("user_id")?.trim() ?? "";
  if (!/^[0-9a-f-]{36}$/i.test(userId)) {
    return NextResponse.json({ success: false, error: "invalid user_id" }, { status: 400 });
  }
  const admin = supabaseAdmin();
  const { data, error } = await admin.from("system_user_roles").select("id, user_id, role, created_at").eq("user_id", userId);
  if (error) return NextResponse.json({ success: false, error: error.message }, { status: 500 });
  return NextResponse.json({ success: true, roles: data ?? [] });
}

export async function POST(req: Request) {
  const auth = await requireSystemRole(["service_admin"]);
  if (!auth.ok) return NextResponse.json({ success: false, error: auth.error }, { status: auth.status });
  const ip = getRequestIp(req);
  const rl = await checkRateLimit(`internal:grant-role:${auth.userId}:${ip}`, 30, 60_000);
  if (!rl.ok) {
    return NextResponse.json(
      { success: false, error: `Rate limit exceeded. Retry in ${rl.retryAfterSec}s` },
      { status: 429 }
    );
  }

  const body = (await req.json().catch(() => null)) as { user_id?: string; role?: string } | null;
  const userId = String(body?.user_id ?? "").trim();
  const role = String(body?.role ?? "").toLowerCase();
  if (!/^[0-9a-f-]{36}$/i.test(userId) || !ROLES.has(role)) {
    return NextResponse.json({ success: false, error: "invalid user_id or role" }, { status: 400 });
  }

  const admin = supabaseAdmin();
  const { error } = await admin.from("system_user_roles").upsert(
    {
      user_id: userId,
      role,
      assigned_by: auth.userId,
      created_at: new Date().toISOString(),
    },
    { onConflict: "user_id,role" }
  );
  if (error) return NextResponse.json({ success: false, error: error.message }, { status: 500 });

  await admin.from("system_role_audit_log").insert({
    actor_user_id: auth.userId,
    target_user_id: userId,
    role,
    action: "grant",
    meta: {},
    created_at: new Date().toISOString(),
  });

  return NextResponse.json({ success: true });
}

export async function DELETE(req: Request) {
  const auth = await requireSystemRole(["service_admin"]);
  if (!auth.ok) return NextResponse.json({ success: false, error: auth.error }, { status: auth.status });
  const ip = getRequestIp(req);
  const rl = await checkRateLimit(`internal:revoke-role:${auth.userId}:${ip}`, 30, 60_000);
  if (!rl.ok) {
    return NextResponse.json(
      { success: false, error: `Rate limit exceeded. Retry in ${rl.retryAfterSec}s` },
      { status: 429 }
    );
  }

  const body = (await req.json().catch(() => null)) as { user_id?: string; role?: string } | null;
  const userId = String(body?.user_id ?? "").trim();
  const role = String(body?.role ?? "").toLowerCase();
  if (!/^[0-9a-f-]{36}$/i.test(userId) || !ROLES.has(role)) {
    return NextResponse.json({ success: false, error: "invalid user_id or role" }, { status: 400 });
  }

  const admin = supabaseAdmin();
  if (role === "service_admin") {
    const { count, error: countErr } = await admin
      .from("system_user_roles")
      .select("id", { count: "exact", head: true })
      .eq("role", "service_admin");
    if (countErr) return NextResponse.json({ success: false, error: countErr.message }, { status: 500 });
    const totalAdmins = Number(count ?? 0);
    const { data: targetRole } = await admin
      .from("system_user_roles")
      .select("id")
      .eq("user_id", userId)
      .eq("role", "service_admin")
      .maybeSingle();
    if (targetRole?.id && totalAdmins <= 1) {
      return NextResponse.json({ success: false, error: "cannot revoke last service_admin" }, { status: 400 });
    }
  }

  const { error } = await admin.from("system_user_roles").delete().eq("user_id", userId).eq("role", role);
  if (error) return NextResponse.json({ success: false, error: error.message }, { status: 500 });

  await admin.from("system_role_audit_log").insert({
    actor_user_id: auth.userId,
    target_user_id: userId,
    role,
    action: "revoke",
    meta: {},
    created_at: new Date().toISOString(),
  });

  return NextResponse.json({ success: true });
}

