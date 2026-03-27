import { NextResponse } from "next/server";
import { requireSystemRole } from "@/app/lib/auth/requireSystemRole";
import { supabaseAdmin } from "@/app/lib/supabaseAdmin";
import { checkRateLimit, getRequestIp } from "@/app/lib/security/rateLimit";

const PLANS = new Set(["starter", "growth", "agency"]);

export async function GET(req: Request) {
  const auth = await requireSystemRole(["service_admin"]);
  if (!auth.ok) return NextResponse.json({ success: false, error: auth.error }, { status: auth.status });

  const url = new URL(req.url);
  const userId = url.searchParams.get("user_id")?.trim() ?? "";
  if (!/^[0-9a-f-]{36}$/i.test(userId)) {
    return NextResponse.json({ success: false, error: "invalid user_id" }, { status: 400 });
  }
  const admin = supabaseAdmin();
  const { data, error } = await admin
    .from("billing_entitlements")
    .select("id, plan_override, status, starts_at, ends_at, reason, source, granted_by, created_at, updated_at")
    .eq("user_id", userId)
    .order("created_at", { ascending: false })
    .limit(50);
  if (error) return NextResponse.json({ success: false, error: error.message }, { status: 500 });
  return NextResponse.json({ success: true, entitlements: data ?? [] });
}

export async function POST(req: Request) {
  const auth = await requireSystemRole(["service_admin"]);
  if (!auth.ok) return NextResponse.json({ success: false, error: auth.error }, { status: auth.status });
  const ip = getRequestIp(req);
  const rl = await checkRateLimit(`internal:entitlement-grant:${auth.userId}:${ip}`, 20, 60_000);
  if (!rl.ok) {
    return NextResponse.json(
      { success: false, error: `Rate limit exceeded. Retry in ${rl.retryAfterSec}s` },
      { status: 429 }
    );
  }

  const body = (await req.json().catch(() => null)) as
    | { user_id?: string; plan_override?: string; days?: number; reason?: string }
    | null;
  const userId = String(body?.user_id ?? "").trim();
  const plan = String(body?.plan_override ?? "").toLowerCase();
  const days = Number(body?.days ?? 30);
  const reason = String(body?.reason ?? "").trim() || null;
  if (!/^[0-9a-f-]{36}$/i.test(userId)) {
    return NextResponse.json({ success: false, error: "invalid user_id" }, { status: 400 });
  }
  if (!PLANS.has(plan)) {
    return NextResponse.json({ success: false, error: "invalid plan_override" }, { status: 400 });
  }
  if (!Number.isFinite(days) || days <= 0 || days > 3650) {
    return NextResponse.json({ success: false, error: "invalid days" }, { status: 400 });
  }

  const now = new Date();
  const endsAt = new Date(now.getTime() + days * 24 * 60 * 60 * 1000);
  const admin = supabaseAdmin();

  // Revoke currently active admin grants to keep single active override.
  await admin
    .from("billing_entitlements")
    .update({
      status: "revoked",
      updated_at: now.toISOString(),
    })
    .eq("user_id", userId)
    .eq("status", "active");

  const { data: inserted, error } = await admin
    .from("billing_entitlements")
    .insert({
      user_id: userId,
      plan_override: plan,
      status: "active",
      starts_at: now.toISOString(),
      ends_at: endsAt.toISOString(),
      reason,
      source: "admin_grant",
      granted_by: auth.userId,
      updated_at: now.toISOString(),
    })
    .select("id")
    .single();
  if (error || !inserted?.id) {
    return NextResponse.json({ success: false, error: error?.message ?? "failed to grant" }, { status: 500 });
  }

  await admin.from("billing_entitlement_audit_log").insert({
    actor_user_id: auth.userId,
    entitlement_id: inserted.id,
    target_user_id: userId,
    action: "grant",
    meta: { plan_override: plan, ends_at: endsAt.toISOString(), reason },
    created_at: now.toISOString(),
  });

  return NextResponse.json({ success: true, entitlement_id: inserted.id });
}

export async function PATCH(req: Request) {
  const auth = await requireSystemRole(["service_admin"]);
  if (!auth.ok) return NextResponse.json({ success: false, error: auth.error }, { status: auth.status });
  const ip = getRequestIp(req);
  const rl = await checkRateLimit(`internal:entitlement-edit:${auth.userId}:${ip}`, 30, 60_000);
  if (!rl.ok) {
    return NextResponse.json(
      { success: false, error: `Rate limit exceeded. Retry in ${rl.retryAfterSec}s` },
      { status: 429 }
    );
  }

  const body = (await req.json().catch(() => null)) as
    | { entitlement_id?: string; action?: "revoke" | "update"; plan_override?: string; ends_at?: string; reason?: string }
    | null;
  const entitlementId = String(body?.entitlement_id ?? "").trim();
  const action = body?.action ?? "revoke";
  if (!/^[0-9a-f-]{36}$/i.test(entitlementId)) {
    return NextResponse.json({ success: false, error: "invalid entitlement_id" }, { status: 400 });
  }

  const admin = supabaseAdmin();
  if (action === "revoke") {
    const nowIso = new Date().toISOString();
    const { data: row, error } = await admin
      .from("billing_entitlements")
      .update({ status: "revoked", updated_at: nowIso })
      .eq("id", entitlementId)
      .select("id, user_id")
      .maybeSingle();
    if (error) return NextResponse.json({ success: false, error: error.message }, { status: 500 });
    if (!row?.id) return NextResponse.json({ success: false, error: "entitlement not found" }, { status: 404 });
    await admin.from("billing_entitlement_audit_log").insert({
      actor_user_id: auth.userId,
      entitlement_id: row.id,
      target_user_id: row.user_id,
      action: "revoke",
      meta: { reason: body?.reason ?? null },
      created_at: nowIso,
    });
    return NextResponse.json({ success: true });
  }

  const patch: Record<string, unknown> = { updated_at: new Date().toISOString() };
  if (body?.plan_override) {
    const plan = String(body.plan_override).toLowerCase();
    if (!PLANS.has(plan)) return NextResponse.json({ success: false, error: "invalid plan_override" }, { status: 400 });
    patch.plan_override = plan;
  }
  if (body?.ends_at) {
    const ts = Date.parse(String(body.ends_at));
    if (!Number.isFinite(ts)) return NextResponse.json({ success: false, error: "invalid ends_at" }, { status: 400 });
    patch.ends_at = new Date(ts).toISOString();
  }
  if (body?.reason !== undefined) {
    patch.reason = String(body.reason).trim() || null;
  }

  const { data: row, error } = await admin
    .from("billing_entitlements")
    .update(patch)
    .eq("id", entitlementId)
    .select("id, user_id")
    .maybeSingle();
  if (error) return NextResponse.json({ success: false, error: error.message }, { status: 500 });
  if (!row?.id) return NextResponse.json({ success: false, error: "entitlement not found" }, { status: 404 });
  await admin.from("billing_entitlement_audit_log").insert({
    actor_user_id: auth.userId,
    entitlement_id: row.id,
    target_user_id: row.user_id,
    action: "update",
    meta: { plan_override: patch.plan_override ?? null, ends_at: patch.ends_at ?? null, reason: patch.reason ?? null },
    created_at: new Date().toISOString(),
  });
  return NextResponse.json({ success: true });
}

