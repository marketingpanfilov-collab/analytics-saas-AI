"use client";

import { useEffect } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import AppDashboardClient from "./AppDashboardClient";

/**
 * Dashboard route (/app). Renders dashboard only when project_id is present and valid.
 * If project_id is missing, redirect to project selection immediately without mounting dashboard.
 * Wrapped in Suspense by page.tsx so useSearchParams() is safe during prerender.
 */
export default function AppDashboardPageClient() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const projectId = searchParams.get("project_id")?.trim() ?? "";

  useEffect(() => {
    if (!projectId) {
      router.replace("/app/projects");
    }
  }, [projectId, router]);

  if (!projectId) {
    return null;
  }

  return <AppDashboardClient />;
}
