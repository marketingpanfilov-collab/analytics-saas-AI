import { Suspense } from "react";
import { redirect } from "next/navigation";
import { getCurrentUserContext } from "@/app/lib/auth/getCurrentUserContext";
import ManageAccessPageClient from "./ManageAccessPageClient";

export const dynamic = "force-dynamic";

const ORG_ROLES_ALLOWED = ["owner", "admin"];

function ManageAccessFallback() {
  return (
    <div className="mx-auto max-w-4xl p-6">
      <div className="h-10 w-64 rounded-2xl bg-white/[0.04]" />
      <div className="mt-6 h-48 rounded-2xl border border-white/10 bg-white/[0.03]" />
    </div>
  );
}

export default async function ManageAccessPage() {
  const context = await getCurrentUserContext();
  if (!context.user) {
    redirect("/login");
  }
  const role = context.memberships[0]?.role;
  if (!role || !ORG_ROLES_ALLOWED.includes(role)) {
    redirect("/app/projects");
  }

  return (
    <Suspense fallback={<ManageAccessFallback />}>
      <ManageAccessPageClient projects={context.projects} />
    </Suspense>
  );
}
