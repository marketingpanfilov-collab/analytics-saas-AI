import { NextResponse } from "next/server";
import { createServerSupabase } from "@/app/lib/supabaseServer";
import { supabaseAdmin } from "@/app/lib/supabaseAdmin";

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

  const canManage =
    ORG_ROLES_MANAGE.includes(orgRole) ||
    (await (async () => {
      const { data: pm } = await supabase
        .from("project_members")
        .select("role")
        .eq("project_id", projectId)
        .eq("user_id", user.id)
        .maybeSingle();
      return pm?.role === "project_admin";
    })());

  if (!canManage) {
    return NextResponse.json({ success: false, error: "Cannot manage members" }, { status: 403 });
  }

  const { data: rows, error: listErr } = await supabase
    .from("project_members")
    .select("id, project_id, user_id, role, created_at")
    .eq("project_id", projectId)
    .order("created_at", { ascending: true });

  if (listErr) {
    return NextResponse.json({ success: false, error: listErr.message }, { status: 500 });
  }

  const admin = supabaseAdmin();
  const members = await Promise.all(
    (rows ?? []).map(async (row: { id: string; project_id: string; user_id: string; role: string; created_at: string }) => {
      let email: string | null = null;
      try {
        const { data: u } = await admin.auth.admin.getUserById(row.user_id);
        email = u?.user?.email ?? null;
      } catch {
        // leave email null
      }
      return {
        id: row.id,
        project_id: row.project_id,
        user_id: row.user_id,
        role: row.role,
        created_at: row.created_at,
        email,
      };
    })
  );

  return NextResponse.json({ success: true, members });
}
