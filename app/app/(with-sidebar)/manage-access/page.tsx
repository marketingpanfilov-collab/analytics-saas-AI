import { redirect } from "next/navigation";
import { getCurrentUserContext } from "@/app/lib/auth/getCurrentUserContext";

export const dynamic = "force-dynamic";

const ORG_ROLES_ALLOWED = ["owner", "admin"];

type SearchParams = { tab?: string | string[]; project_id?: string | string[] };

export default async function ManageAccessPage({
  searchParams,
}: {
  searchParams: Promise<SearchParams>;
}) {
  const context = await getCurrentUserContext();
  if (!context.user) {
    redirect("/login");
  }
  const role = context.memberships[0]?.role;
  if (!role || !ORG_ROLES_ALLOWED.includes(role)) {
    redirect("/app/projects");
  }

  const sp = await searchParams;
  const tabRaw = sp.tab;
  const tab = Array.isArray(tabRaw) ? tabRaw[0] : tabRaw;
  const pidRaw = sp.project_id;
  const pidFromQuery = Array.isArray(pidRaw) ? pidRaw[0] : pidRaw;
  const pid =
    typeof pidFromQuery === "string" && pidFromQuery.trim()
      ? pidFromQuery.trim()
      : context.activeProject?.id ?? context.projects[0]?.id ?? "";

  const params = new URLSearchParams();
  if (pid) params.set("project_id", pid);
  params.set("section", "access");
  if (tab === "org" || tab === "project") params.set("tab", tab);

  redirect(`/app/settings?${params.toString()}`);
}
