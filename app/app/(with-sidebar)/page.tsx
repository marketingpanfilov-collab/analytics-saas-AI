import { redirect } from "next/navigation";
import { Suspense } from "react";
import { getCurrentUserContext } from "@/app/lib/auth/getCurrentUserContext";
import { getPostLoginRedirect } from "@/app/lib/auth/getPostLoginRedirect";
import { requireProjectAccess } from "@/app/lib/auth/requireProjectAccess";
import AppDashboardPageClient from "../AppDashboardPageClient";

export const dynamic = "force-dynamic";

function AppDashboardFallback() {
  return (
    <div
      className="flex min-h-[60vh] items-center justify-center bg-[#0b0b10]"
      style={{ gridColumn: "2 / -1" }}
    >
      <div className="h-10 w-48 rounded-xl bg-white/[0.06]" />
    </div>
  );
}

type PageProps = {
  searchParams: Promise<{ [key: string]: string | string[] | undefined }>;
};

/**
 * /app entry: server-side auth and project resolution.
 * - No user → redirect /login
 * - No project_id in URL → getPostLoginRedirect → redirect
 * - project_id in URL → requireProjectAccess; no access → /app/projects; else render dashboard
 */
export default async function AppDashboardPage({ searchParams }: PageProps) {
  const params = await searchParams;
  const projectId = (typeof params.project_id === "string" ? params.project_id : params.project_id?.[0])?.trim();

  const context = await getCurrentUserContext();

  if (!context.user) {
    redirect("/login");
  }

  if (!projectId) {
    redirect(getPostLoginRedirect(context));
  }

  const access = await requireProjectAccess(context.user.id, projectId);
  if (!access) {
    redirect("/app/projects");
  }

  return (
    <Suspense fallback={<AppDashboardFallback />}>
      <AppDashboardPageClient />
    </Suspense>
  );
}
