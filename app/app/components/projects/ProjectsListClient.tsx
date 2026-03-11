"use client";

import { useRouter } from "next/navigation";
import Link from "next/link";
import { setActiveProjectId } from "@/app/lib/activeProjectClient";
import type { Project } from "@/app/lib/auth/getCurrentUserContext";

function roleLabel(role: string): string {
  if (role === "owner") return "Владелец";
  if (role === "admin") return "Администратор";
  if (role === "project_admin") return "Админ проекта";
  if (role === "marketer") return "Маркетолог";
  if (role === "viewer") return "Наблюдатель";
  return "Участник";
}

function shortId(id: string): string {
  if (id.length <= 8) return id;
  return id.slice(0, 8);
}

type Props = {
  projects: Project[];
  activeProjectId: string | null;
  roleMap: Record<string, string>;
  canCreate: boolean;
};

export default function ProjectsListClient({
  projects,
  activeProjectId,
  roleMap,
  canCreate,
}: Props) {
  const router = useRouter();

  const handleOpen = (projectId: string) => {
    setActiveProjectId(projectId);
    router.push(`/app?project_id=${encodeURIComponent(projectId)}`);
  };

  return (
    <div className="mx-auto max-w-6xl space-y-8 p-6">
      <header>
        <h1 className="text-2xl font-semibold tracking-tight text-white">
          Проекты
        </h1>
        <p className="mt-1 text-sm text-zinc-400">
          Выберите проект для работы в дашборде
        </p>
      </header>

      {projects.length === 0 ? (
        <div className="rounded-2xl border border-white/10 bg-white/[0.03] p-10 text-center">
          <h2 className="text-lg font-medium text-white">
            {canCreate ? "Нет проектов" : "Нет назначенных проектов"}
          </h2>
          <p className="mt-2 text-sm text-zinc-500">
            {canCreate
              ? "Создайте первый проект, чтобы начать."
              : "Обратитесь к администратору организации для доступа к проекту."}
          </p>
          {canCreate && (
            <Link
              href="/app/projects/new"
              className="mt-6 inline-flex h-11 items-center rounded-xl bg-white/10 px-6 text-sm font-medium text-white hover:bg-white/15"
            >
              Создать первый проект
            </Link>
          )}
        </div>
      ) : (
        <>
          <div className="flex flex-wrap items-center gap-3">
            {canCreate && (
              <Link
                href="/app/projects/new"
                className="inline-flex h-10 items-center rounded-xl bg-white/10 px-5 text-sm font-medium text-white hover:bg-white/15"
              >
                Создать проект
              </Link>
            )}
          </div>
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {projects.map((project) => {
              const role = roleMap[project.id] ?? "member";
              const isActive = activeProjectId !== null && project.id === activeProjectId;
              return (
                <div
                  key={project.id}
                  className={`rounded-2xl border bg-white/[0.03] p-6 transition-colors hover:border-white/15 hover:bg-white/[0.04] ${
                    isActive ? "border-emerald-500/40 bg-emerald-500/[0.06]" : "border-white/10"
                  }`}
                >
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0 flex-1">
                      <h3 className="truncate text-base font-medium text-white">
                        {project.name || "Без названия"}
                      </h3>
                      <p className="mt-1 text-xs text-zinc-500 font-mono">
                        {shortId(project.id)}
                      </p>
                    </div>
                    <div className="flex shrink-0 items-center gap-2">
                      {isActive && (
                        <span className="rounded-full bg-emerald-500/20 px-2 py-0.5 text-xs text-emerald-400">
                          Активен
                        </span>
                      )}
                      <span className="rounded-full border border-white/10 bg-white/[0.04] px-2.5 py-1 text-xs text-zinc-400">
                        {roleLabel(role)}
                      </span>
                    </div>
                  </div>
                  <button
                    type="button"
                    onClick={() => handleOpen(project.id)}
                    className="mt-4 w-full rounded-xl border border-white/10 bg-white/[0.04] py-2.5 text-sm font-medium text-zinc-200 transition-colors hover:bg-white/[0.06] hover:text-white"
                  >
                    Открыть
                  </button>
                </div>
              );
            })}
          </div>
        </>
      )}
    </div>
  );
}
