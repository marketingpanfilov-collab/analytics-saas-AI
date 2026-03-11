import { createServerSupabase } from "@/app/lib/supabaseServer";

const ORG_ROLES_ALL_PROJECTS = ["owner", "admin"];

export type ProjectAccessResult = {
  membership: { organization_id: string; role: string };
  project: { id: string; name: string | null; organization_id: string | null };
  role: string;
};

/**
 * Server-only. Checks if user has access to the project.
 * Returns membership + project + role, or null if no access.
 * Does not perform redirects.
 */
export async function requireProjectAccess(
  userId: string,
  projectId: string
): Promise<ProjectAccessResult | null> {
  const supabase = await createServerSupabase();

  const { data: mem } = await supabase
    .from("organization_members")
    .select("organization_id, role")
    .eq("user_id", userId)
    .maybeSingle();

  // User may have no org membership but have access via project_members (e.g. invited to project only)
  if (!mem) {
    const { data: pm } = await supabase
      .from("project_members")
      .select("role")
      .eq("project_id", projectId)
      .eq("user_id", userId)
      .maybeSingle();
    if (!pm) return null;
    const { data: proj } = await supabase
      .from("projects")
      .select("id, name, organization_id")
      .eq("id", projectId)
      .maybeSingle();
    if (!proj) return null;
    return {
      membership: { organization_id: proj.organization_id ?? "", role: "member" },
      project: {
        id: proj.id,
        name: proj.name ?? null,
        organization_id: proj.organization_id ?? null,
      },
      role: (pm.role as string) ?? "member",
    };
  }

  const orgRole = (mem.role ?? "member") as string;
  let allowedIds: string[] = [];

  if (ORG_ROLES_ALL_PROJECTS.includes(orgRole)) {
    const { data: projs } = await supabase
      .from("projects")
      .select("id")
      .eq("organization_id", mem.organization_id);
    allowedIds = (projs ?? []).map((p: { id: string }) => p.id);
  } else {
    const { data: pms } = await supabase
      .from("project_members")
      .select("project_id")
      .eq("user_id", userId);
    allowedIds = (pms ?? []).map((r: { project_id: string }) => r.project_id);
  }

  if (!allowedIds.includes(projectId)) return null;

  const { data: proj } = await supabase
    .from("projects")
    .select("id, name, organization_id")
    .eq("id", projectId)
    .maybeSingle();

  if (!proj) return null;

  let role = orgRole;
  if (!ORG_ROLES_ALL_PROJECTS.includes(orgRole)) {
    const { data: pm } = await supabase
      .from("project_members")
      .select("role")
      .eq("project_id", projectId)
      .eq("user_id", userId)
      .maybeSingle();
    role = (pm?.role as string) ?? "member";
  }

  return {
    membership: { organization_id: mem.organization_id, role: mem.role ?? "member" },
    project: {
      id: proj.id,
      name: proj.name ?? null,
      organization_id: proj.organization_id ?? null,
    },
    role,
  };
}
