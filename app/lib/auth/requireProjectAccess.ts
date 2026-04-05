import { supabaseAdmin } from "@/app/lib/supabaseAdmin";

/** Роли, при которых видны все проекты организации (см. organization_members_role_check). */
const ORG_ROLES_ALL_PROJECTS = ["owner", "admin", "agency"];

export type ProjectAccessResult = {
  membership: { organization_id: string; role: string };
  project: { id: string; name: string | null; organization_id: string | null };
  role: string;
};

/**
 * Server-only. Checks if user has access to the project.
 * Returns membership + project + role, or null if no access.
 * Does not perform redirects.
 *
 * Использует service role: под пользовательским JWT RLS часто скрывает строки `projects` /
 * `organization_members`, из‑за чего invited user видел проект в списке (admin в getCurrentUserContext),
 * но `requireProjectAccess` возвращал null и /app?project_id=… редиректил на /app/projects.
 */
export async function requireProjectAccess(
  userId: string,
  projectId: string
): Promise<ProjectAccessResult | null> {
  const admin = supabaseAdmin();

  const { data: proj } = await admin
    .from("projects")
    .select("id, name, organization_id")
    .eq("id", projectId)
    .maybeSingle();

  if (!proj) return null;

  const projectOrgId = proj.organization_id ? String(proj.organization_id) : null;

  const { data: orgMemRows } = await admin
    .from("organization_members")
    .select("organization_id, role")
    .eq("user_id", userId);

  const memInProjectOrg =
    projectOrgId != null
      ? (orgMemRows ?? []).find((m) => String(m.organization_id) === projectOrgId)
      : undefined;

  if (memInProjectOrg) {
    const orgRole = String(memInProjectOrg.role ?? "member");
    if (ORG_ROLES_ALL_PROJECTS.includes(orgRole)) {
      return {
        membership: { organization_id: projectOrgId!, role: orgRole },
        project: {
          id: proj.id,
          name: proj.name ?? null,
          organization_id: proj.organization_id ?? null,
        },
        role: orgRole,
      };
    }
    const { data: pm } = await admin
      .from("project_members")
      .select("role")
      .eq("project_id", projectId)
      .eq("user_id", userId)
      .maybeSingle();
    if (!pm) return null;
    return {
      membership: { organization_id: projectOrgId!, role: orgRole },
      project: {
        id: proj.id,
        name: proj.name ?? null,
        organization_id: proj.organization_id ?? null,
      },
      role: (pm.role as string) ?? "member",
    };
  }

  const { data: pmOnly } = await admin
    .from("project_members")
    .select("role")
    .eq("project_id", projectId)
    .eq("user_id", userId)
    .maybeSingle();

  if (!pmOnly) return null;

  return {
    membership: {
      organization_id: projectOrgId ?? "",
      role: "member",
    },
    project: {
      id: proj.id,
      name: proj.name ?? null,
      organization_id: proj.organization_id ?? null,
    },
    role: (pmOnly.role as string) ?? "member",
  };
}
