import { NextResponse } from "next/server";
import { billingLog } from "@/app/lib/billing/billingObservability";
import { requireSystemRole } from "@/app/lib/auth/requireSystemRole";
import { supabaseAdmin } from "@/app/lib/supabaseAdmin";
import { checkRateLimit, getRequestIp } from "@/app/lib/security/rateLimit";

const PLANS = new Set(["starter", "growth", "scale"]);
const UUID_RE = /^[0-9a-f-]{36}$/i;

const ENTITLEMENT_SELECT =
  "id, organization_id, user_id, plan_override, status, starts_at, ends_at, reason, source, granted_by, created_at, updated_at";

export async function GET(req: Request) {
  const auth = await requireSystemRole(["service_admin"]);
  if (!auth.ok) return NextResponse.json({ success: false, error: auth.error }, { status: auth.status });

  const url = new URL(req.url);
  const organizationId = url.searchParams.get("organization_id")?.trim() ?? "";
  const admin = supabaseAdmin();

  if (UUID_RE.test(organizationId)) {
    const { data, error } = await admin
      .from("billing_entitlements")
      .select(ENTITLEMENT_SELECT)
      .eq("organization_id", organizationId)
      .order("created_at", { ascending: false })
      .limit(50);
    if (error) return NextResponse.json({ success: false, error: error.message }, { status: 500 });
    return NextResponse.json({ success: true, entitlements: data ?? [] });
  }

  return NextResponse.json(
    { success: false, error: "Provide organization_id (UUID) to list entitlements." },
    { status: 400 }
  );
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
    | { organization_id?: string; user_id?: string; plan_override?: string; days?: number; reason?: string }
    | null;
  const organizationId = String(body?.organization_id ?? "").trim();
  const auditUserId = String(body?.user_id ?? "").trim();
  const planRaw = String(body?.plan_override ?? "").toLowerCase();
  const plan = planRaw === "agency" ? "scale" : planRaw;
  const days = Number(body?.days ?? 30);
  const reason = String(body?.reason ?? "").trim() || null;

  if (!UUID_RE.test(organizationId)) {
    return NextResponse.json({ success: false, error: "invalid organization_id" }, { status: 400 });
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

  await admin
    .from("billing_entitlements")
    .update({
      status: "revoked",
      updated_at: now.toISOString(),
    })
    .eq("organization_id", organizationId)
    .eq("status", "active");

  const { count: stillActive, error: countErr } = await admin
    .from("billing_entitlements")
    .select("id", { count: "exact", head: true })
    .eq("organization_id", organizationId)
    .eq("status", "active");

  if (!countErr && (stillActive ?? 0) > 0) {
    billingLog("warn", "entitlement", "ENTITLEMENT_DUPLICATE_PREVENTED", {
      organization_id: organizationId,
      detail: "active row still present after revoke; forcing second revoke",
    });
    await admin
      .from("billing_entitlements")
      .update({ status: "revoked", updated_at: now.toISOString() })
      .eq("organization_id", organizationId)
      .eq("status", "active");
  }

  const optionalUserId = UUID_RE.test(auditUserId) ? auditUserId : null;

  const { data: inserted, error } = await admin
    .from("billing_entitlements")
    .insert({
      organization_id: organizationId,
      user_id: optionalUserId,
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

  if (error) {
    const code = (error as { code?: string }).code;
    if (code === "23505") {
      billingLog("error", "entitlement", "ENTITLEMENT_CONFLICT_UNIQUE_ACTIVE", {
        organization_id: organizationId,
        message: error.message,
      });
      return NextResponse.json(
        {
          success: false,
          error:
            "Для организации уже есть активное entitlement (уникальный индекс). Отзовите его или обновите существующую запись.",
        },
        { status: 409 }
      );
    }
    return NextResponse.json({ success: false, error: error.message }, { status: 500 });
  }
  if (!inserted?.id) {
    return NextResponse.json({ success: false, error: "failed to grant" }, { status: 500 });
  }

  billingLog("info", "entitlement", "ENTITLEMENT_REPLACED", {
    organization_id: organizationId,
    entitlement_id: inserted.id,
  });

  await admin.from("billing_entitlement_audit_log").insert({
    actor_user_id: auth.userId,
    entitlement_id: inserted.id,
    target_user_id: optionalUserId,
    target_organization_id: organizationId,
    action: "grant",
    meta: { plan_override: plan, ends_at: endsAt.toISOString(), reason, organization_id: organizationId },
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
  if (!UUID_RE.test(entitlementId)) {
    return NextResponse.json({ success: false, error: "invalid entitlement_id" }, { status: 400 });
  }

  const admin = supabaseAdmin();
  if (action === "revoke") {
    const nowIso = new Date().toISOString();
    const { data: row, error } = await admin
      .from("billing_entitlements")
      .update({ status: "revoked", updated_at: nowIso })
      .eq("id", entitlementId)
      .select("id, user_id, organization_id")
      .maybeSingle();
    if (error) return NextResponse.json({ success: false, error: error.message }, { status: 500 });
    if (!row?.id) return NextResponse.json({ success: false, error: "entitlement not found" }, { status: 404 });
    await admin.from("billing_entitlement_audit_log").insert({
      actor_user_id: auth.userId,
      entitlement_id: row.id,
      target_user_id: row.user_id,
      target_organization_id: row.organization_id,
      action: "revoke",
      meta: { reason: body?.reason ?? null },
      created_at: nowIso,
    });
    return NextResponse.json({ success: true });
  }

  const patch: Record<string, unknown> = { updated_at: new Date().toISOString() };
  if (body?.plan_override) {
    const planRaw = String(body.plan_override).toLowerCase();
    const plan = planRaw === "agency" ? "scale" : planRaw;
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
    .select("id, user_id, organization_id")
    .maybeSingle();
  if (error) return NextResponse.json({ success: false, error: error.message }, { status: 500 });
  if (!row?.id) return NextResponse.json({ success: false, error: "entitlement not found" }, { status: 404 });
  await admin.from("billing_entitlement_audit_log").insert({
    actor_user_id: auth.userId,
    entitlement_id: row.id,
    target_user_id: row.user_id,
    target_organization_id: row.organization_id,
    action: "update",
    meta: { plan_override: patch.plan_override ?? null, ends_at: patch.ends_at ?? null, reason: patch.reason ?? null },
    created_at: new Date().toISOString(),
  });
  return NextResponse.json({ success: true });
}
