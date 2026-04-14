import { redirect } from "next/navigation";

type DashboardAliasPageProps = {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

export default async function DashboardAliasPage({ searchParams }: DashboardAliasPageProps) {
  const params = await searchParams;
  const projectId = typeof params.project_id === "string" ? params.project_id : null;
  if (projectId) {
    redirect(`/app?project_id=${encodeURIComponent(projectId)}`);
  }
  redirect("/app");
}
