import { NextResponse } from "next/server";
import { createServerSupabase } from "@/app/lib/supabaseServer";
import { supabaseAdmin } from "@/app/lib/supabaseAdmin";
import { getPrimaryOwnerOrgId } from "@/app/lib/billingOrganizationContext";

type RpcResult = {
  ok?: boolean;
  organization_id?: string;
  created?: boolean;
  error?: string;
};

/**
 * POST /api/billing/provision-checkout-organization
 * Idempotent: same user always gets the same organization_id across retries.
 * DB: `provision_owner_organization_for_checkout` uses pg_advisory_xact_lock per user to prevent duplicate orgs from concurrent requests.
 */
export async function POST() {
  const supabase = await createServerSupabase();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ success: false, error: "Unauthorized" }, { status: 401 });
  }

  const admin = supabaseAdmin();
  const emailLocal = (user.email ?? "").split("@")[0]?.trim().slice(0, 48) || "user";

  const { data: rpcRaw, error: rpcErr } = await admin.rpc("provision_owner_organization_for_checkout", {
    p_user_id: user.id,
    p_org_label: emailLocal,
  });

  if (!rpcErr && rpcRaw != null && typeof rpcRaw === "object") {
    const rpc = rpcRaw as RpcResult;
    if (rpc.ok === true && rpc.organization_id && /^[0-9a-f-]{36}$/i.test(String(rpc.organization_id))) {
      const organizationId = String(rpc.organization_id);
      return NextResponse.json({
        success: true,
        organization_id: organizationId,
        primary_org_id: organizationId,
        created: rpc.created === true,
      });
    }
    if (rpc.ok === false && typeof rpc.error === "string") {
      return NextResponse.json({ success: false, error: rpc.error }, { status: 500 });
    }
  }

  // Fallback if RPC missing (local DB without migration): best-effort JS path (no cross-request lock).
  const existing = await getPrimaryOwnerOrgId(admin, user.id);
  if (existing) {
    return NextResponse.json({
      success: true,
      organization_id: existing,
      primary_org_id: existing,
      created: false,
    });
  }

  if (rpcErr) {
    console.warn("[provision-checkout-organization] RPC failed, using JS fallback", rpcErr.message);
  }

  const now = new Date().toISOString();
  const name = `Компания (${emailLocal})`;
  const slug = `org-${user.id.replace(/-/g, "").slice(0, 12)}-${Math.random().toString(36).slice(2, 10)}`;

  const { data: orgIns, error: oErr } = await admin
    .from("organizations")
    .insert({
      name,
      slug,
      updated_at: now,
    })
    .select("id")
    .single();

  if (oErr || !orgIns?.id) {
    return NextResponse.json(
      { success: false, error: oErr?.message ?? "Failed to create organization" },
      { status: 500 }
    );
  }

  const organizationId = String(orgIns.id);
  const { error: mErr } = await admin.from("organization_members").insert({
    organization_id: organizationId,
    user_id: user.id,
    role: "owner",
  });

  if (mErr) {
    const again = await getPrimaryOwnerOrgId(admin, user.id);
    if (again) {
      return NextResponse.json({
        success: true,
        organization_id: again,
        primary_org_id: again,
        created: false,
      });
    }
    return NextResponse.json({ success: false, error: mErr.message }, { status: 500 });
  }

  return NextResponse.json({
    success: true,
    organization_id: organizationId,
    primary_org_id: organizationId,
    created: true,
  });
}
