import { NextResponse } from "next/server";
import { createServerSupabase } from "@/app/lib/supabaseServer";

const ORG_ROLES_MANAGE = ["owner", "admin"];
const ORG_ROLES_ALL_PROJECTS = ["owner", "admin"];

export async function PATCH(req: Request) {
  const body = await req.json().catch(() => ({}));
  const inviteId = typeof body.invite_id === "string" ? body.invite_id.trim() : "";

  if (!inviteId) {
    return NextResponse.json({ success: false, error: "invite_id required" }, { status: 400 });
  }

  const supabase = await createServerSupabase();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ success: false, error: "Unauthorized" }, { status: 401 });
  }

  const { data: invite } = await supabase
    .from("project_invites")
    .select("id, project_id, status")
    .eq("id", inviteId)
    .single();
  if (!invite) {
    return NextResponse.json({ success: false, error: "Invite not found" }, { status: 404 });
  }
  if (invite.status !== "pending") {
    return NextResponse.json({ success: false, error: "Invite cannot be revoked" }, { status: 400 });
  }

  const { data: mem } = await supabase
    .from("organization_members")
    .select("organization_id, role")
    .eq("user_id", user.id)
    .maybeSingle();
  if (!mem) {
    return NextResponse.json({ success: false, error: "No organization membership" }, { status: 403 });
  }

  const orgRole = (mem.role ?? "member") as string;
  let allowedProjectIds: string[] = [];
  if (ORG_ROLES_ALL_PROJECTS.includes(orgRole)) {
    const { data: projs } = await supabase
      .from("projects")
      .select("id")
      .eq("organization_id", mem.organization_id);
    allowedProjectIds = (projs ?? []).map((p: { id: string }) => p.id);
  } else {
    const { data: pms } = await supabase
      .from("project_members")
      .select("project_id")
      .eq("user_id", user.id);
    allowedProjectIds = (pms ?? []).map((r: { project_id: string }) => r.project_id);
  }

  if (!allowedProjectIds.includes(invite.project_id)) {
    return NextResponse.json({ success: false, error: "Project access denied" }, { status: 403 });
  }

  const canManage =
    ORG_ROLES_MANAGE.includes(orgRole) ||
    (await (async () => {
      const { data: pm } = await supabase
        .from("project_members")
        .select("role")
        .eq("project_id", invite.project_id)
        .eq("user_id", user.id)
        .maybeSingle();
      return pm?.role === "project_admin";
    })());

  if (!canManage) {
    return NextResponse.json({ success: false, error: "Cannot revoke invites" }, { status: 403 });
  }

  const { error: updateErr } = await supabase
    .from("project_invites")
    .update({ status: "revoked" })
    .eq("id", inviteId);

  if (updateErr) {
    return NextResponse.json({ success: false, error: updateErr.message }, { status: 500 });
  }

  return NextResponse.json({ success: true });
}
