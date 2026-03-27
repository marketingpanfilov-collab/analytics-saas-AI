import { redirect } from "next/navigation";
import { getCurrentSystemRoleCheck } from "@/app/lib/auth/systemRoles";
import InternalBillingPageClient from "./billingClient";

export const dynamic = "force-dynamic";

export default async function InternalBillingPage() {
  const auth = await getCurrentSystemRoleCheck(["service_admin"]);
  if (!auth.isAuthenticated) redirect("/login");
  if (!auth.hasAnyAllowedRole) redirect("/app/internal-admin/support");
  return <InternalBillingPageClient />;
}

