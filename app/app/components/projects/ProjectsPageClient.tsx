"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { supabase } from "@/app/lib/supabaseClient";

type OrgRole = "owner" | "admin" | "agency" | "member";

type Organization = { id: string; name: string };
type Membership = { organization_id: string; role: string };
type Project = { id: string; name: string | null; created_at: string };
type ProjectMemberRow = { project_id: string; role: string };

const ORG_ROLES_ALL_PROJECTS: OrgRole[] = ["owner", "admin"];

function canCreateProject(role: string): boolean {
  return role === "owner" || role === "admin";
}

function effectiveRoleLabel(orgRole: string, projectRole: string | undefined): string {
  if (orgRole === "owner") return "Владелец";
  if (orgRole === "admin") return "Администратор";
  if (projectRole === "project_admin") return "Админ проекта";
  if (projectRole === "marketer") return "Маркетолог";
  if (projectRole === "viewer") return "Наблюдатель";
  return "—";
}

function formatDate(createdAt: string): string {
  try {
    return new Date(createdAt).toLocaleDateString("ru-RU", {
      month: "short",
      day: "numeric",
      year: "numeric",
    });
  } catch {
    return "—";
  }
}

function ProjectCard({
  project,
  effectiveRole,
  statusLabel,
  onOpen,
}: {
  project: Project;
  effectiveRole: string;
  statusLabel: string;
  onOpen: () => void;
}) {
  return (
    <div className="rounded-2xl border border-white/10 bg-white/[0.03] p-6 transition-colors hover:border-white/15 hover:bg-white/[0.04]">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <h3 className="truncate text-base font-medium text-white">
            {project.name || "Без названия"}
          </h3>
          <p className="mt-1 text-xs text-zinc-500">{formatDate(project.created_at)}</p>
        </div>
        <span className="shrink-0 rounded-full border border-white/10 bg-white/[0.04] px-2.5 py-1 text-xs text-zinc-400">
          {effectiveRole}
        </span>
      </div>
      <p className="mt-3 text-xs text-zinc-500">{statusLabel}</p>
      <button
        type="button"
        onClick={onOpen}
        className="mt-4 w-full rounded-xl border border-white/10 bg-white/[0.04] py-2.5 text-sm font-medium text-zinc-200 transition-colors hover:bg-white/[0.06] hover:text-white"
      >
        Открыть проект
      </button>
    </div>
  );
}

function slugify(name: string): string {
  let s = name
    .toLowerCase()
    .trim()
    .replace(/[\s_]+/g, "-")
    .replace(/[^a-z0-9-]/g, "")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "");
  return s || "organization";
}

async function findUniqueSlug(baseSlug: string): Promise<string> {
  let candidate = baseSlug;
  let n = 1;
  for (;;) {
    const { data } = await supabase
      .from("organizations")
      .select("id")
      .eq("slug", candidate)
      .maybeSingle();
    if (!data) return candidate;
    candidate = `${baseSlug}-${++n}`;
  }
}

async function bootstrapFirstUser(userId: string): Promise<{ organization_id: string; role: string } | null> {
  const name = "Моя организация";
  const baseSlug = slugify(name);
  const slug = await findUniqueSlug(baseSlug);

  const { data: org, error: orgErr } = await supabase
    .from("organizations")
    .insert({
      name,
      slug,
      owner_user_id: userId,
    })
    .select("id")
    .single();

  if (orgErr || !org) return null;

  const { error: memErr } = await supabase.from("organization_members").insert({
    organization_id: org.id,
    user_id: userId,
    role: "owner",
  });
  if (memErr) return null;

  const { data: proj, error: projErr } = await supabase
    .from("projects")
    .insert({
      organization_id: org.id,
      owner_id: userId,
      name: "Первый проект",
    })
    .select("id")
    .single();
  if (projErr || !proj) return null;

  await supabase.from("project_members").insert({
    project_id: proj.id,
    user_id: userId,
    role: "project_admin",
  });

  return { organization_id: org.id, role: "owner" };
}

export default function ProjectsPageClient() {
  const router = useRouter();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [user, setUser] = useState<{ id: string; email?: string } | null>(null);
  const [org, setOrg] = useState<Organization | null>(null);
  const [membership, setMembership] = useState<Membership | null>(null);
  const [projects, setProjects] = useState<Project[]>([]);
  const [projectRoleMap, setProjectRoleMap] = useState<Record<string, string>>({});

  useEffect(() => {
    let mounted = true;

    (async () => {
      try {
        const { data: { user: u }, error: authErr } = await supabase.auth.getUser();
        if (!mounted) return;
        if (authErr) {
          setError(authErr.message ?? "Ошибка авторизации");
          return;
        }
        if (!u) {
          setLoading(false);
          router.replace("/login");
          return;
        }

        setUser({ id: u.id, email: u.email ?? undefined });

        const { data: memData, error: memErr } = await supabase
          .from("organization_members")
          .select("organization_id, role")
          .eq("user_id", u.id)
          .maybeSingle();

        if (!mounted) return;
        if (memErr) {
          setError(memErr.message ?? "Ошибка загрузки членства");
          return;
        }

        let memRow: { organization_id: string; role: string } | null = null;
        if (memData) {
          memRow = { organization_id: memData.organization_id, role: memData.role ?? "member" };
        } else {
          const boot = await bootstrapFirstUser(u.id);
          if (mounted && boot) memRow = boot;
        }

        if (!memRow) {
          setLoading(false);
          router.replace("/app/projects");
          return;
        }

        setMembership(memRow);

        const { data: orgRow, error: orgErr } = await supabase
          .from("organizations")
          .select("id, name")
          .eq("id", memRow.organization_id)
          .single();

        if (!mounted) return;
        if (orgErr) {
          setError(orgErr.message ?? "Ошибка загрузки организации");
          return;
        }
        if (orgRow) setOrg({ id: orgRow.id, name: orgRow.name ?? "Организация" });

        const orgRole = (memRow.role ?? "member") as OrgRole;

        if (ORG_ROLES_ALL_PROJECTS.includes(orgRole)) {
          const { data: projRows, error: projErr } = await supabase
            .from("projects")
            .select("id, name, created_at")
            .eq("organization_id", memRow.organization_id);
          if (!mounted) return;
          if (projErr) {
            setError(projErr.message ?? "Ошибка загрузки проектов");
            return;
          }
          setProjects((projRows ?? []) as Project[]);
        } else {
          const { data: pmRows, error: pmErr } = await supabase
            .from("project_members")
            .select("project_id, role")
            .eq("user_id", u.id);
          if (!mounted) return;
          if (pmErr) {
            setError(pmErr.message ?? "Ошибка загрузки доступа к проектам");
            return;
          }
          const pids = (pmRows ?? []).map((r: ProjectMemberRow) => r.project_id).filter(Boolean);
          const roleMap: Record<string, string> = {};
          (pmRows ?? []).forEach((r: ProjectMemberRow) => {
            roleMap[r.project_id] = r.role;
          });
          setProjectRoleMap(roleMap);
          if (pids.length === 0) {
            setProjects([]);
          } else {
            const { data: projRows2, error: projErr2 } = await supabase
              .from("projects")
              .select("id, name, created_at")
              .in("id", pids);
            if (!mounted) return;
            if (projErr2) {
              setError(projErr2.message ?? "Ошибка загрузки проектов");
              return;
            }
            setProjects((projRows2 ?? []) as Project[]);
          }
        }
      } catch (e) {
        const message = e instanceof Error ? e.message : String(e);
        setError(message || "Неизвестная ошибка");
      } finally {
        if (mounted) setLoading(false);
      }
    })();

    return () => {
      mounted = false;
    };
  }, [router]);

  if (error) {
    return (
      <div className="mx-auto max-w-6xl space-y-6 p-6">
        <div className="rounded-2xl border border-red-500/20 bg-red-500/5 p-6">
          <h2 className="text-lg font-medium text-red-400">Ошибка загрузки</h2>
          <p className="mt-2 text-sm text-zinc-400">{error}</p>
          <button
            type="button"
            onClick={() => window.location.reload()}
            className="mt-4 rounded-xl border border-white/10 bg-white/10 px-4 py-2 text-sm font-medium text-white hover:bg-white/15"
          >
            Обновить страницу
          </button>
        </div>
      </div>
    );
  }

  if (loading || !user || !membership) {
    return (
      <div className="mx-auto max-w-6xl space-y-6 p-6">
        <div className="h-10 w-64 rounded-2xl bg-white/[0.04]" />
        <div className="h-5 w-96 max-w-full rounded-xl bg-white/[0.03]" />
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {[1, 2, 3].map((i) => (
            <div key={i} className="h-48 rounded-2xl border border-white/10 bg-white/[0.03]" />
          ))}
        </div>
      </div>
    );
  }

  const orgRole = membership.role as OrgRole;
  const showCreateButton = canCreateProject(orgRole);

  return (
    <div className="mx-auto max-w-6xl space-y-8 p-6">
      <header className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <div>
          {org && <p className="text-sm text-zinc-500">{org.name}</p>}
          <h1 className="mt-1 text-2xl font-semibold tracking-tight text-white">
            Выберите проект
          </h1>
          <p className="mt-1 text-sm text-zinc-400">
            {projects.length}{" "}
            {projects.length === 1 ? "проект" : projects.length < 5 ? "проекта" : "проектов"}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-3">
          {showCreateButton && (
            <Link
              href="/app/projects/new"
              className="inline-flex h-10 items-center rounded-xl bg-white/10 px-5 text-sm font-medium text-white hover:bg-white/15"
            >
              Создать проект
            </Link>
          )}
          <span className="rounded-full border border-white/10 bg-white/[0.04] px-2.5 py-1 text-xs text-zinc-400">
            {effectiveRoleLabel(orgRole, undefined)}
          </span>
          <span className="rounded-full border border-white/10 bg-white/[0.04] px-3 py-1.5 text-xs text-zinc-400">
            {user.email ?? "Вы вошли"}
          </span>
        </div>
      </header>

      {projects.length === 0 ? (
        <div className="rounded-2xl border border-white/10 bg-white/[0.03] p-10 text-center">
          <h2 className="text-lg font-medium text-white">
            {showCreateButton ? "Нет проектов" : "Нет назначенных проектов"}
          </h2>
          <p className="mt-2 text-sm text-zinc-500">
            {showCreateButton
              ? "Создайте первый проект, чтобы начать."
              : "Обратитесь к администратору организации для доступа к проекту."}
          </p>
          {showCreateButton && (
            <Link
              href="/app/projects/new"
              className="mt-6 inline-flex h-11 items-center rounded-xl bg-white/10 px-6 text-sm font-medium text-white hover:bg-white/15"
            >
              Создать первый проект
            </Link>
          )}
        </div>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {projects.map((project) => {
            const projectRole = projectRoleMap[project.id];
            const effectiveRole = effectiveRoleLabel(orgRole, projectRole);
            const statusLabel = "Активен";
            return (
              <ProjectCard
                key={project.id}
                project={project}
                effectiveRole={effectiveRole}
                statusLabel={statusLabel}
                onOpen={() => router.push(`/app?project_id=${encodeURIComponent(project.id)}`)}
              />
            );
          })}
        </div>
      )}
    </div>
  );
}
