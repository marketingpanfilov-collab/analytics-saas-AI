import { NextResponse } from "next/server";
import { createServerSupabase } from "@/app/lib/supabaseServer";
import { supabaseAdmin } from "@/app/lib/supabaseAdmin";
import { requireProjectAccess } from "@/app/lib/auth/requireProjectAccess";
import { canTransferOrganizationOwnership } from "@/app/lib/auth/projectPermissions";

/**
 * POST /api/org/transfer-ownership
 * Body: { project_id?: string, organization_id?: string, new_owner_user_id: string, reauth_token: string }
 * Either project_id or organization_id. Only org owner can transfer. Requires reauth_token.
 */
export async function POST(req: Request) {
  const body = await req.json().catch(() => null);
  const projectId = typeof body?.project_id === "string" ? body.project_id.trim() : "";
  const organizationIdParam = typeof body?.organization_id === "string" ? body.organization_id.trim() : "";
  const newOwnerUserId = typeof body?.new_owner_user_id === "string" ? body.new_owner_user_id.trim() : "";
  const reauthToken = typeof body?.reauth_token === "string" ? body.reauth_token.trim() : "";

  if ((!projectId && !organizationIdParam) || !newOwnerUserId || !reauthToken) {
    return NextResponse.json(
      { success: false, error: "project_id or organization_id, new_owner_user_id and reauth_token are required" },
      { status: 400 }
    );
  }

  const supabase = await createServerSupabase();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ success: false, error: "Unauthorized" }, { status: 401 });
  }

  let orgId: string;
  if (organizationIdParam) {
    const { data: mem } = await supabase
      .from("organization_members")
      .select("organization_id, role")
      .eq("user_id", user.id)
      .eq("organization_id", organizationIdParam)
      .maybeSingle();
    if (!mem || !canTransferOrganizationOwnership(mem.role ?? "")) {
      return NextResponse.json(
        { success: false, error: "Only the organization owner can transfer ownership" },
        { status: 403 }
      );
    }
    orgId = mem.organization_id;
  } else {
    const access = await requireProjectAccess(user.id, projectId);
    if (!access) {
      return NextResponse.json({ success: false, error: "Project access denied" }, { status: 403 });
    }
    if (!canTransferOrganizationOwnership(access.membership.role)) {
      return NextResponse.json(
        { success: false, error: "Only the organization owner can transfer ownership" },
        { status: 403 }
      );
    }
    orgId = access.membership.organization_id;
  }

  const admin = supabaseAdmin();

  const { data: tokenRow, error: tokenErr } = await admin
    .from("reauth_tokens")
    .select("id, user_id, expires_at")
    .eq("id", reauthToken)
    .eq("user_id", user.id)
    .single();

  if (tokenErr || !tokenRow) {
    return NextResponse.json(
      { success: false, error: "Invalid or expired confirmation. Please re-enter your password." },
      { status: 401 }
    );
  }

  const expiresAt = new Date(tokenRow.expires_at).getTime();
  if (expiresAt < Date.now()) {
    await admin.from("reauth_tokens").delete().eq("id", reauthToken);
    return NextResponse.json(
      { success: false, error: "Confirmation expired. Please re-enter your password." },
      { status: 401 }
    );
  }

  const { data: newOwnerMem } = await admin
    .from("organization_members")
    .select("id, role")
    .eq("organization_id", orgId)
    .eq("user_id", newOwnerUserId)
    .single();

  if (!newOwnerMem) {
    return NextResponse.json(
      { success: false, error: "Selected user is not a member of this organization" },
      { status: 400 }
    );
  }

  if (newOwnerUserId === user.id) {
    return NextResponse.json(
      { success: false, error: "You cannot transfer ownership to yourself" },
      { status: 400 }
    );
  }

  await admin.from("reauth_tokens").delete().eq("id", reauthToken);

  const { error: demoteErr } = await admin
    .from("organization_members")
    .update({ role: "admin" })
    .eq("organization_id", orgId)
    .eq("user_id", user.id);

  if (demoteErr) {
    return NextResponse.json(
      { success: false, error: demoteErr.message },
      { status: 500 }
    );
  }

  const { error: promoteErr } = await admin
    .from("organization_members")
    .update({ role: "owner" })
    .eq("organization_id", orgId)
    .eq("user_id", newOwnerUserId);

  if (promoteErr) {
    await admin
      .from("organization_members")
      .update({ role: "owner" })
      .eq("organization_id", orgId)
      .eq("user_id", user.id);
    return NextResponse.json(
      { success: false, error: promoteErr.message },
      { status: 500 }
    );
  }

  return NextResponse.json({ success: true });
}
