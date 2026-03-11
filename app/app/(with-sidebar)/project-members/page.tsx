import { Suspense } from "react";
import ProjectMembersPageClient from "./ProjectMembersPageClient";

function ProjectMembersFallback() {
  return (
    <div className="mx-auto max-w-4xl p-6">
      <div className="h-10 w-64 rounded-2xl bg-white/[0.04]" />
      <div className="mt-6 h-48 rounded-2xl border border-white/10 bg-white/[0.03]" />
    </div>
  );
}

export default function ProjectMembersPage() {
  return (
    <Suspense fallback={<ProjectMembersFallback />}>
      <ProjectMembersPageClient />
    </Suspense>
  );
}
