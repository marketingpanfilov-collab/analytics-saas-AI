"use client";

import { Suspense, useCallback, useEffect, useMemo, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import Link from "next/link";
import type { Project } from "@/app/lib/auth/getCurrentUserContext";
import OrgMembersManager from "@/app/app/components/access/OrgMembersManager";
import ProjectMembersPageClient from "../project-members/ProjectMembersPageClient";

type Tab = "org" | "project";

function ProjectAccessFallback() {
  return (
    <div className="rounded-2xl border border-white/10 bg-white/[0.03] p-8">
      <div className="h-8 w-48 rounded-lg bg-white/[0.06]" />
      <div className="mt-6 h-40 rounded-xl bg-white/[0.04]" />
    </div>
  );
}

export default function ManageAccessPageClient({ projects }: { projects: Project[] }) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const tabParam = searchParams.get("tab");
  const projectIdParam = searchParams.get("project_id")?.trim() ?? "";

  const tab: Tab =
    tabParam === "project" || (tabParam !== "org" && projectIdParam) ? "project" : "org";

  const [projectSelect, setProjectSelect] = useState(
    projectIdParam || projects[0]?.id || ""
  );

  const setQuery = useCallback(
    (next: { tab: Tab; projectId?: string }) => {
      const params = new URLSearchParams();
      params.set("tab", next.tab);
      if (next.tab === "project" && next.projectId) {
        params.set("project_id", next.projectId);
      }
      router.replace(`/app/manage-access?${params.toString()}`);
    },
    [router]
  );

  useEffect(() => {
    if (projectIdParam) setProjectSelect(projectIdParam);
  }, [projectIdParam]);

  // ProjectMembersPageClient читает project_id только из URL — дописываем при tab=project без id
  useEffect(() => {
    if (tab !== "project" || projects.length === 0) return;
    if (!projectIdParam) {
      const pid = projects[0]!.id;
      setProjectSelect(pid);
      setQuery({ tab: "project", projectId: pid });
    }
  }, [tab, projectIdParam, projects, setQuery]);

  const onTabChange = (next: Tab) => {
    if (next === "org") {
      setQuery({ tab: "org" });
      return;
    }
    const pid = projectSelect || projects[0]?.id || "";
    if (pid) {
      setProjectSelect(pid);
      setQuery({ tab: "project", projectId: pid });
    }
  };

  const onProjectChange = (pid: string) => {
    setProjectSelect(pid);
    setQuery({ tab: "project", projectId: pid });
  };

  const projectOptions = useMemo(
    () =>
      projects.map((p) => ({
        id: p.id,
        label: p.name?.trim() || "Без названия",
      })),
    [projects]
  );

  return (
    <div className="mx-auto max-w-4xl space-y-8 p-6">
      <header>
        <h1 className="text-2xl font-semibold tracking-tight text-white">Управление доступом</h1>
        <p className="mt-1 text-sm text-zinc-400">
          Аккаунт (организация) и отдельные проекты — разные уровни прав
        </p>
      </header>

      <div className="flex gap-1 rounded-xl bg-white/[0.04] p-1 ring-1 ring-white/10">
        <button
          type="button"
          onClick={() => onTabChange("org")}
          className={`rounded-lg px-4 py-2 text-sm font-medium transition-colors ${
            tab === "org" ? "bg-white/10 text-white" : "text-zinc-400 hover:text-zinc-200"
          }`}
        >
          Аккаунт (организация)
        </button>
        <button
          type="button"
          onClick={() => onTabChange("project")}
          disabled={projects.length === 0}
          className={`rounded-lg px-4 py-2 text-sm font-medium transition-colors ${
            tab === "project" ? "bg-white/10 text-white" : "text-zinc-400 hover:text-zinc-200"
          } disabled:cursor-not-allowed disabled:opacity-40`}
        >
          Проекты
        </button>
      </div>

      {tab === "org" ? (
        <OrgMembersManager layout="section" />
      ) : projects.length === 0 ? (
        <div className="rounded-2xl border border-white/10 bg-white/[0.03] px-6 py-12 text-center text-sm text-zinc-400">
          Нет проектов.{" "}
          <Link href="/app/projects/new" className="text-white underline hover:no-underline">
            Создать проект
          </Link>
        </div>
      ) : (
        <div className="space-y-6">
          <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
            <label className="text-sm font-medium text-zinc-300" htmlFor="manage-access-project">
              Проект
            </label>
            <select
              id="manage-access-project"
              value={projectIdParam || projectSelect || projects[0]?.id || ""}
              onChange={(e) => onProjectChange(e.target.value)}
              className="w-full max-w-md rounded-xl border border-white/10 bg-white/[0.04] px-4 py-2.5 text-sm text-white focus:border-white/20 focus:outline-none sm:w-auto"
            >
              {projectOptions.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.label}
                </option>
              ))}
            </select>
          </div>
          <p className="text-sm text-zinc-500">
            Участники и приглашения ниже относятся только к выбранному проекту.
          </p>
          {projectIdParam ? (
            <Suspense fallback={<ProjectAccessFallback />}>
              <ProjectMembersPageClient key={projectIdParam} variant="embedded" />
            </Suspense>
          ) : (
            <ProjectAccessFallback />
          )}
        </div>
      )}

      <div>
        <Link href="/app/projects" className="text-sm text-zinc-400 hover:text-white">
          ← К списку проектов
        </Link>
      </div>
    </div>
  );
}
