import { NextResponse } from "next/server";
import { getCurrentUserContext } from "@/app/lib/auth/getCurrentUserContext";

const ORG_ROLES_EDIT_PLAN = ["owner", "admin"];

/**
 * GET /api/projects — list projects for current user (for sidebar switcher).
 * canEditPlan: true if current user is owner/admin (can edit monthly sales plan for active project).
 */
export async function GET() {
  const context = await getCurrentUserContext();
  if (!context.user) {
    return NextResponse.json({ success: false, error: "Unauthorized" }, { status: 401 });
  }
  const activeId = context.activeProject?.id ?? null;
  const canEditPlan =
    !!activeId && ORG_ROLES_EDIT_PLAN.includes(context.roleMap[activeId] ?? "");
  return NextResponse.json({
    success: true,
    projects: context.projects,
    activeProjectId: activeId,
    canEditPlan,
  });
}
