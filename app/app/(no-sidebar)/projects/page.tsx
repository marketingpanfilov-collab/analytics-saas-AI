import { randomUUID } from "node:crypto";
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
  const billingSnap = await loadBillingCurrentPlan(admin, context.user.id, context.user.email ?? null, {
    requestId: randomUUID(),
  });
  if (billingSnap.success && billingSnap.requires_post_checkout_onboarding) {
    redirect("/app/projects/onboarding");
  }

  const canCreate =
    context.memberships.length > 0 &&
    ORG_ROLES_CAN_CREATE.includes(context.memberships[0]!.role);

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
