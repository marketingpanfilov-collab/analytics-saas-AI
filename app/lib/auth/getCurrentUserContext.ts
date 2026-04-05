import { cookies } from "next/headers";
import type { SupabaseClient } from "@supabase/supabase-js";
import { createServerSupabase } from "@/app/lib/supabaseServer";
import { supabaseAdmin } from "@/app/lib/supabaseAdmin";

const ORG_ROLES_ALL_PROJECTS = ["owner", "admin", "agency"];
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

type ProjRow = Project & { archived?: boolean | null };

/**
 * Загрузка проектов только по project_members (приглашённый без organization_members).
 * Использует service role: RLS под пользовательским JWT часто отдаёт строки project_members,
 * но не даёт SELECT по projects — список на /app/projects оказывался пустым.
 */
async function loadProjectsForProjectOnlyUser(
  admin: SupabaseClient,
  userId: string
): Promise<{
  projects: Project[];
  archivedProjects: Project[];
  roleMap: Record<string, string>;
  organizationId: string | null;
  organizationName: string | null;
}> {
  const { data: pms } = await admin
    .from("project_members")
    .select("project_id, role")
    .eq("user_id", userId);
  const rows = (pms ?? []) as { project_id: string; role: string }[];
  const projectIds = [...new Set(rows.map((r) => r.project_id).filter(Boolean))];
  const roleMap: Record<string, string> = {};
  for (const r of rows) {
    roleMap[r.project_id] = r.role ?? "member";
  }
  if (projectIds.length === 0) {
    return { projects: [], archivedProjects: [], roleMap: {}, organizationId: null, organizationName: null };
  }

  const { data: raw } = await admin
    .from("projects")
    .select("id, name, organization_id, last_opened_at, archived")
    .in("id", projectIds);
  const byId = new Map<string, ProjRow>();
  for (const p of (raw ?? []) as ProjRow[]) {
    byId.set(String(p.id), p);
  }

  const projects: Project[] = [];
  const archivedProjects: Project[] = [];
  for (const id of projectIds) {
    const p = byId.get(id);
    if (!p) continue;
    const row: Project = {
      id: p.id,
      name: p.name,
      organization_id: p.organization_id,
      last_opened_at: p.last_opened_at,
    };
    if (p.archived) archivedProjects.push(row);
    else projects.push(row);
  }

  const orgIds = [...new Set(projects.map((p) => p.organization_id).filter(Boolean))] as string[];
  let organizationId: string | null = orgIds.length === 1 ? orgIds[0]! : null;
  let organizationName: string | null = null;
  if (orgIds.length === 1 && orgIds[0]) {
    const { data: orgRow } = await admin.from("organizations").select("name").eq("id", orgIds[0]).maybeSingle();
    if (orgRow?.name) organizationName = orgRow.name;
  }

  return { projects, archivedProjects, roleMap, organizationId, organizationName };
}

/**
 * Server-only. Returns current user, org memberships, accessible projects,
 * active project (from cookie or first), and project_id -> role map.
 *
 * Источник истины для списка: organization_members + project_members (как в продукте),
 * строки projects подтягиваются по id из этих членств. Чтение через service role с
 * фильтром по user.id из сессии — чтобы список совпадал с фактическим доступом при RLS на projects.
 */
export async function getCurrentUserContext(): Promise<CurrentUserContext> {
  const authClient = await createServerSupabase();
  const {
    data: { user },
  } = await authClient.auth.getUser();

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
    return empty;
  }

  const admin = supabaseAdmin();

  const { data: memRows } = await admin
    .from("organization_members")
    .select("organization_id, role")
    .eq("user_id", user.id);

  const memberships: Membership[] = (memRows ?? []).map((r) => ({
    organization_id: r.organization_id,
    role: r.role ?? "member",
  }));

  let projects: Project[] = [];
  let archivedProjects: Project[] = [];
  const roleMap: Record<string, string> = {};
  let organizationName: string | null = null;
  let organizationId: string | null = null;
  const canTransferOwnership = memberships.some((m) => m.role === "owner");

  if (memberships.length === 0) {
    const only = await loadProjectsForProjectOnlyUser(admin, user.id);
    projects = only.projects;
    archivedProjects = only.archivedProjects;
    Object.assign(roleMap, only.roleMap);
    organizationName = only.organizationName;
    organizationId = only.organizationId;
  } else {
    const orgRole = memberships[0]!.role;
    organizationId = memberships[0]!.organization_id;

    const { data: orgRow } = await admin
      .from("organizations")
      .select("name")
      .eq("id", organizationId)
      .maybeSingle();
    if (orgRow?.name) organizationName = orgRow.name;

    if (ORG_ROLES_ALL_PROJECTS.includes(orgRole)) {
      const { data: projs } = await admin
        .from("projects")
        .select("id, name, organization_id, last_opened_at")
        .eq("organization_id", organizationId)
        .eq("archived", false);
      projects = (projs ?? []) as Project[];
      projects.forEach((p) => {
        roleMap[p.id] = orgRole;
      });
      const { data: archived } = await admin
        .from("projects")
        .select("id, name, organization_id, last_opened_at")
        .eq("organization_id", organizationId)
        .eq("archived", true);
      archivedProjects = (archived ?? []) as Project[];
      archivedProjects.forEach((p) => {
        roleMap[p.id] = orgRole;
      });
    } else {
      const { data: pms } = await admin
        .from("project_members")
        .select("project_id, role")
        .eq("user_id", user.id);
      const rows = (pms ?? []) as { project_id: string; role: string }[];
      const projectIds = rows.map((r) => r.project_id);
      rows.forEach((r) => {
        roleMap[r.project_id] = r.role ?? "member";
      });
      const { data: projs } = await admin
        .from("projects")
        .select("id, name, organization_id, last_opened_at")
        .in("id", projectIds)
        .eq("archived", false);
      const projMap = new Map(((projs ?? []) as Project[]).map((p) => [p.id, p]));
      projects = projectIds.map((id) => projMap.get(id)).filter(Boolean) as Project[];
    }
  }

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
    organizationId,
    canTransferOwnership,
  };
}
