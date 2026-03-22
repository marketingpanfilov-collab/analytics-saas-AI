import { redirect } from "next/navigation";
import { getCurrentUserContext } from "@/app/lib/auth/getCurrentUserContext";
import ProjectsListClient from "../../components/projects/ProjectsListClient";

export const dynamic = "force-dynamic";

const ORG_ROLES_CAN_CREATE = ["owner", "admin"];

export default async function ProjectsPage() {
  const context = await getCurrentUserContext();

  if (!context.user) {
    redirect("/login");
  }

  const canCreate =
    context.memberships.length > 0 &&
    ORG_ROLES_CAN_CREATE.includes(context.memberships[0]!.role);

  return (
    <ProjectsListClient
      projects={context.projects}
      archivedProjects={context.archivedProjects}
      activeProjectId={context.activeProject?.id ?? null}
      roleMap={context.roleMap}
      canCreate={canCreate}
      currentUserId={context.user?.id ?? null}
      canTransferOwnership={context.canTransferOwnership}
      organizationId={context.organizationId}
      organizationName={context.organizationName}
    />
  );
}
