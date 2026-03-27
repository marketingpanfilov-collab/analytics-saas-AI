import { redirect } from "next/navigation";
import { getCurrentSystemRoleCheck } from "@/app/lib/auth/systemRoles";
import InternalUsersPageClient from "./usersClient";

export const dynamic = "force-dynamic";

export default async function InternalUsersPage() {
  const auth = await getCurrentSystemRoleCheck(["service_admin"]);
  if (!auth.isAuthenticated) redirect("/login");
  if (!auth.hasAnyAllowedRole) redirect("/app/internal-admin/support");
  return <InternalUsersPageClient />;
}

