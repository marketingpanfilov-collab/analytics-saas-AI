import { NextResponse } from "next/server";
import { getCurrentUserContext } from "@/app/lib/auth/getCurrentUserContext";
import { billingHeavySyncGateBeforeProject } from "@/app/lib/auth/requireBillingAccess";
import { supabaseAdmin } from "@/app/lib/supabaseAdmin";
import {
  countActiveProjectsForOrganization,
  getPlanMaxProjectsForUser,
  isAtProjectPlanLimit,
  PROJECT_PLAN_LIMIT_USER_MESSAGE,
} from "@/app/lib/projectPlanLimit";

const ORG_ROLES_EDIT_PLAN = ["owner", "admin"];
const ORG_ROLES_MANAGE_ACCESS = ["owner", "admin"];
const ORG_ROLES_CAN_CREATE_PROJECT = ["owner", "admin"];
const NAME_MAX_LENGTH = 256;

/**
 * GET /api/projects — list projects for current user (for sidebar switcher).
 * canEditPlan: true if current user is owner/admin (can edit monthly sales plan for active project).
 * canManageOrganizationAccess: owner/admin — раздел «Управление доступом» в настройках.
 * plan_max_projects: лимит по тарифу (null = без лимита).
 */
export async function GET() {
  const context = await getCurrentUserContext();
  if (!context.user) {
    return NextResponse.json({ success: false, error: "Unauthorized" }, { status: 401 });
  }
  const activeId = context.activeProject?.id ?? null;
  const canEditPlan =
    !!activeId && ORG_ROLES_EDIT_PLAN.includes(context.roleMap[activeId] ?? "");
  const organizationRole = context.memberships[0]?.role ?? null;
  const canManageOrganizationAccess =
    !!organizationRole && ORG_ROLES_MANAGE_ACCESS.includes(organizationRole);

  let plan_max_projects: number | null = null;
  if (context.organizationId) {
    const admin = supabaseAdmin();
    plan_max_projects = await getPlanMaxProjectsForUser(
      admin,
      context.user.id,
      context.user.email ?? null,
      context.organizationId
    );
  }

  return NextResponse.json({
    success: true,
    projects: context.projects,
    activeProjectId: activeId,
    canEditPlan,
    organizationRole,
    canManageOrganizationAccess,
    plan_max_projects,
  });
}

/**
 * POST /api/projects — создать проект в организации пользователя (owner/admin).
 * Проверка лимита тарифа обязательна; обход только через прямой доступ к БД.
 */
export async function POST(req: Request) {
  const billingPre = await billingHeavySyncGateBeforeProject(req);
  if (!billingPre.ok) return billingPre.response;

  const body = await req.json().catch(() => null);
  const { userId, email } = billingPre;
  const name = typeof body?.name === "string" ? body.name.trim() : "";
  if (!name) {
    return NextResponse.json({ success: false, error: "Введите название проекта" }, { status: 400 });
  }
  if (name.length > NAME_MAX_LENGTH) {
    return NextResponse.json(
      { success: false, error: `Название не длиннее ${NAME_MAX_LENGTH} символов` },
      { status: 400 }
    );
  }

  const admin = supabaseAdmin();
  const { data: memRows, error: memErr } = await admin
    .from("organization_members")
    .select("organization_id, role")
    .eq("user_id", userId)
    .limit(1);
  if (memErr) {
    return NextResponse.json({ success: false, error: memErr.message }, { status: 500 });
  }
  const mem = memRows?.[0];
  if (!mem?.organization_id) {
    return NextResponse.json({ success: false, error: "Нет доступа к организации" }, { status: 403 });
  }
  if (!ORG_ROLES_CAN_CREATE_PROJECT.includes(String(mem.role ?? ""))) {
    return NextResponse.json(
      { success: false, error: "Недостаточно прав для создания проекта" },
      { status: 403 }
    );
  }

  const orgId = String(mem.organization_id);
  const maxProjects = await getPlanMaxProjectsForUser(admin, userId, email, orgId);
  const currentCount = await countActiveProjectsForOrganization(admin, orgId);
  if (isAtProjectPlanLimit(maxProjects, currentCount)) {
    return NextResponse.json(
      {
        success: false,
        error: PROJECT_PLAN_LIMIT_USER_MESSAGE,
        code: "PROJECT_PLAN_LIMIT",
      },
      { status: 403 }
    );
  }

  const { data: proj, error: insErr } = await admin
    .from("projects")
    .insert({
      organization_id: orgId,
      owner_id: userId,
      name,
    })
    .select("id")
    .single();

  if (insErr || !proj?.id) {
    return NextResponse.json(
      { success: false, error: insErr?.message ?? "Не удалось создать проект" },
      { status: 500 }
    );
  }

  const { error: pmErr } = await admin.from("project_members").insert({
    project_id: proj.id,
    user_id: userId,
    role: "project_admin",
  });

  if (pmErr) {
    await admin.from("projects").delete().eq("id", proj.id);
    return NextResponse.json(
      { success: false, error: pmErr.message ?? "Ошибка добавления в проект" },
      { status: 500 }
    );
  }

  return NextResponse.json({ success: true, project_id: proj.id });
}
