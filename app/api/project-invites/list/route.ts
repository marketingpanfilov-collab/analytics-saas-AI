import { NextResponse } from "next/server";
import { createServerSupabase } from "@/app/lib/supabaseServer";

const ORG_ROLES_MANAGE = ["owner", "admin"];
const ORG_ROLES_ALL_PROJECTS = ["owner", "admin"];

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const projectId = searchParams.get("project_id")?.trim();

  if (!projectId) {
    return NextResponse.json({ success: false, error: "project_id required" }, { status: 400 });
  }

  const supabase = await createServerSupabase();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ success: false, error: "Unauthorized" }, { status: 401 });
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

  if (!allowedProjectIds.includes(projectId)) {
    return NextResponse.json({ success: false, error: "Project access denied" }, { status: 403 });
  }

  const { data: rows, error } = await supabase
    .from("project_invites")
    .select("id, project_id, email, role, invite_type, token, status, expires_at, created_at")
    .eq("project_id", projectId)
    .order("created_at", { ascending: false });

  if (error) {
    return NextResponse.json({ success: false, error: error.message }, { status: 500 });
  }

  return NextResponse.json({ success: true, invites: rows ?? [] });
}
