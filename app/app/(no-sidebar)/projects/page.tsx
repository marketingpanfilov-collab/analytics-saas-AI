import { redirect } from "next/navigation";
import { getCurrentUserContext } from "@/app/lib/auth/getCurrentUserContext";
import { loadBillingCurrentPlan } from "@/app/lib/billingCurrentPlan";
import { supabaseAdmin } from "@/app/lib/supabaseAdmin";
import { getPlanMaxProjectsForUser } from "@/app/lib/projectPlanLimit";
import ProjectsListClient from "../../components/projects/ProjectsListClient";

export const dynamic = "force-dynamic";

const ORG_ROLES_CAN_CREATE = ["owner", "admin"];

export default async function ProjectsPage() {
  const context = await getCurrentUserContext();

  if (!context.user) {
    redirect("/login");
  }

  const admin = supabaseAdmin();

  const billing = await loadBillingCurrentPlan(
    admin,
    context.user.id,
    context.user.email ?? null
  );
  if (billing.success && billing.requires_post_checkout_onboarding) {
    redirect("/app/projects/onboarding");
  }

  /** Новый пользователь без орг и без проектов — создаёт орг на /app/projects/new, затем первый проект. */
  const eligibleFirstWorkspace =
    context.memberships.length === 0 &&
    context.projects.length === 0 &&
    context.archivedProjects.length === 0;

  const canCreate =
    eligibleFirstWorkspace ||
    (context.memberships.length > 0 &&
      ORG_ROLES_CAN_CREATE.includes(context.memberships[0]!.role));

  const canManageAccess =
    context.memberships.length > 0 &&
    ORG_ROLES_CAN_CREATE.includes(context.memberships[0]!.role);

  let planMaxProjects: number | null = null;
  if (context.organizationId) {
    planMaxProjects = await getPlanMaxProjectsForUser(
      admin,
      context.user.id,
      context.user.email ?? null,
      context.organizationId
    );
  }

  return (
    <ProjectsListClient
      projects={context.projects}
      archivedProjects={context.archivedProjects}
      activeProjectId={context.activeProject?.id ?? null}
      roleMap={context.roleMap}
      canCreate={canCreate}
      canManageAccess={canManageAccess}
      currentUserId={context.user?.id ?? null}
      canTransferOwnership={context.canTransferOwnership}
      organizationId={context.organizationId}
      organizationName={context.organizationName}
      planMaxProjects={planMaxProjects}
    />
  );
}
