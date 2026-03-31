import { cookies } from "next/headers";
import { createServerSupabase } from "@/app/lib/supabaseServer";

const ORG_ROLES_ALL_PROJECTS = ["owner", "admin"];
const COOKIE_ACTIVE_PROJECT = "active_project_id";

export type Membership = {
  organization_id: string;
  role: string;
};

export type Project = {
  id: string;
  name: string | null;
  organization_id: string | null;
  last_opened_at?: string | null;
};

export type CurrentUserContext = {
  user: { id: string; email?: string } | null;
  memberships: Membership[];
  projects: Project[];
  archivedProjects: Project[];
  activeProject: Project | null;
  roleMap: Record<string, string>;
  organizationName: string | null;
  organizationId: string | null;
  canTransferOwnership: boolean;
};

/**
 * Server-only. Returns current user, org memberships, accessible projects,
 * active project (from cookie or first), and project_id -> role map.
 */
export async function getCurrentUserContext(): Promise<CurrentUserContext> {
  const supabase = await createServerSupabase();
  const { data: { user } } = await supabase.auth.getUser();

  const empty: CurrentUserContext = {
    user: null,
    memberships: [],
    projects: [],
    archivedProjects: [],
    activeProject: null,
    roleMap: {},
    organizationName: null,
    organizationId: null,
    canTransferOwnership: false,
  };

  if (!user) {
    console.log("[getCurrentUserContext] user not found, returning empty");
    return empty;
  }
  console.log("[getCurrentUserContext] user.id:", user.id);

  const { data: memRows } = await supabase
    .from("organization_members")
    .select("organization_id, role")
    .eq("user_id", user.id);

  console.log("[getCurrentUserContext] memRows:", JSON.stringify(memRows));

  const memberships: Membership[] = (memRows ?? []).map((r) => ({
    organization_id: r.organization_id,
    role: r.role ?? "member",
  }));

  console.log("[getCurrentUserContext] memberships:", JSON.stringify(memberships));

  if (memberships.length === 0) {
    console.log("[getCurrentUserContext] memberships empty, returning early");
    return {
      user: { id: user.id, email: user.email ?? undefined },
      memberships: [],
      projects: [],
      archivedProjects: [],
      activeProject: null,
      roleMap: {},
      organizationName: null,
      organizationId: null,
      canTransferOwnership: false,
    };
  }

  const orgRole = memberships[0]!.role;
  const orgId = memberships[0]!.organization_id;
  let projects: Project[] = [];
  let archivedProjects: Project[] = [];
  const roleMap: Record<string, string> = {};
  let organizationName: string | null = null;
  const canTransferOwnership = memberships.some((m) => m.role === "owner");

  const { data: orgRow } = await supabase
    .from("organizations")
    .select("name")
    .eq("id", orgId)
    .maybeSingle();
  if (orgRow?.name) organizationName = orgRow.name;

  if (ORG_ROLES_ALL_PROJECTS.includes(orgRole)) {
    console.log("[getCurrentUserContext] orgRole is owner/admin, querying projects for organization_id:", orgId);
    const { data: projs, error: projsError } = await supabase
      .from("projects")
      .select("id, name, organization_id, last_opened_at")
      .eq("organization_id", orgId)
      .eq("archived", false);
    console.log("[getCurrentUserContext] projs:", JSON.stringify(projs), "error:", projsError?.message ?? null);
    projects = (projs ?? []) as Project[];
    projects.forEach((p) => {
      roleMap[p.id] = orgRole;
    });
    const { data: archived } = await supabase
      .from("projects")
      .select("id, name, organization_id, last_opened_at")
      .eq("organization_id", orgId)
      .eq("archived", true);
    archivedProjects = (archived ?? []) as Project[];
    archivedProjects.forEach((p) => {
      roleMap[p.id] = orgRole;
    });
  } else {
    console.log("[getCurrentUserContext] orgRole is not owner/admin, using project_members for user.id:", user.id);
    const { data: pms } = await supabase
      .from("project_members")
      .select("project_id, role")
      .eq("user_id", user.id);
    const rows = (pms ?? []) as { project_id: string; role: string }[];
    const projectIds = rows.map((r) => r.project_id);
    rows.forEach((r) => {
      roleMap[r.project_id] = r.role ?? "member";
    });
    const { data: projs } = await supabase
      .from("projects")
      .select("id, name, organization_id, last_opened_at")
      .in("id", projectIds)
      .eq("archived", false);
    console.log("[getCurrentUserContext] project_members branch: projectIds:", projectIds, "projs:", JSON.stringify(projs));
    const projMap = new Map(((projs ?? []) as Project[]).map((p) => [p.id, p]));
    projects = projectIds.map((id) => projMap.get(id)).filter(Boolean) as Project[];
  }

  console.log("[getCurrentUserContext] final projects count:", projects.length, "projects:", JSON.stringify(projects.map((p) => ({ id: p.id, name: p.name }))));

  const cookieStore = await cookies();
  const activeId = cookieStore.get(COOKIE_ACTIVE_PROJECT)?.value?.trim();
  const activeProject: Project | null =
    (activeId ? projects.find((p) => p.id === activeId) ?? null : null) ?? projects[0] ?? null;

  return {
    user: { id: user.id, email: user.email ?? undefined },
    memberships,
    projects,
    archivedProjects,
    activeProject,
    roleMap,
    organizationName,
    organizationId: memberships.length > 0 ? memberships[0]!.organization_id : null,
    canTransferOwnership,
  };
}
