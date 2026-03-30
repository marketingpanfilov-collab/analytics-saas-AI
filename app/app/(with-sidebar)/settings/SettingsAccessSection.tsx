"use client";

import {
  Suspense,
  useCallback,
  useEffect,
  useMemo,
  useState,
  type CSSProperties,
} from "react";
import { useRouter, useSearchParams } from "next/navigation";
import Link from "next/link";
import type { Project } from "@/app/lib/auth/getCurrentUserContext";
import OrgMembersManager from "@/app/app/components/access/OrgMembersManager";
import ProjectMembersPageClient from "@/app/app/(with-sidebar)/project-members/ProjectMembersPageClient";
import { SETTINGS_WIDE_SECTION_MAX_PX } from "./settingsSectionLayout";

type Tab = "org" | "project";

/** Совпадает с tabButtonStyle / panelStyle на странице настроек («Общая информация»). */
function tabButtonStyle(active: boolean) {
  return {
    padding: "10px 14px",
    borderRadius: 10,
    border: active ? "1px solid rgba(255,255,255,0.18)" : "1px solid transparent",
    background: active ? "rgba(255,255,255,0.08)" : "transparent",
    color: "white",
    fontSize: 13,
    fontWeight: 600 as const,
    cursor: "pointer" as const,
    whiteSpace: "nowrap" as const,
  };
}

function panelStyle(maxWidth: number = SETTINGS_WIDE_SECTION_MAX_PX) {
  return {
    borderRadius: 16,
    border: "1px solid rgba(255,255,255,0.12)",
    background: "rgba(10,10,18,0.96)",
    padding: 20,
    maxWidth,
  };
}

const muted = "rgba(255,255,255,0.72)";
const labelColor = "rgba(255,255,255,0.85)";

function ProjectAccessFallback() {
  return (
    <div style={{ ...panelStyle(SETTINGS_WIDE_SECTION_MAX_PX), padding: 20 }}>
      <div style={{ height: 24, width: "45%", borderRadius: 8, background: "rgba(255,255,255,0.06)" }} />
      <div style={{ marginTop: 16, height: 100, borderRadius: 12, background: "rgba(255,255,255,0.04)" }} />
    </div>
  );
}

function buildSettingsAccessUrl(projectId: string, tab: Tab) {
  const params = new URLSearchParams();
  params.set("project_id", projectId);
  params.set("section", "access");
  params.set("tab", tab);
  return `/app/settings?${params.toString()}`;
}

export default function SettingsAccessSection({
  settingsProjectId,
}: {
  settingsProjectId: string;
}) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const tabParam = searchParams.get("tab");
  const projectIdParam = searchParams.get("project_id")?.trim() ?? "";

  const tab: Tab =
    tabParam === "project" || (tabParam !== "org" && projectIdParam) ? "project" : "org";

  const [projectSelect, setProjectSelect] = useState(
    projectIdParam || settingsProjectId || ""
  );

  const [projects, setProjects] = useState<Project[]>([]);
  const [projectsLoading, setProjectsLoading] = useState(true);
  const [canManageOrganizationAccess, setCanManageOrganizationAccess] = useState(false);

  useEffect(() => {
    let mounted = true;
    (async () => {
      setProjectsLoading(true);
      try {
        const res = await fetch("/api/projects", { cache: "no-store" });
        const json = await res.json();
        if (!mounted || !res.ok || !json?.success || !Array.isArray(json.projects)) return;
        setProjects(json.projects);
        setCanManageOrganizationAccess(!!json.canManageOrganizationAccess);
      } catch {
        if (mounted) setProjects([]);
      } finally {
        if (mounted) setProjectsLoading(false);
      }
    })();
    return () => {
      mounted = false;
    };
  }, []);

  const setQuery = useCallback(
    (next: { tab: Tab; projectId?: string }) => {
      const shell = projectIdParam || settingsProjectId;
      const pid =
        next.tab === "project"
          ? (next.projectId ?? projectSelect) || projects[0]?.id || shell
          : shell;
      router.replace(buildSettingsAccessUrl(pid, next.tab), { scroll: false });
    },
    [router, projectSelect, projects, settingsProjectId, projectIdParam]
  );

  useEffect(() => {
    if (projectIdParam) setProjectSelect(projectIdParam);
  }, [projectIdParam]);

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

  const columnStyle: CSSProperties = {
    width: "100%",
    maxWidth: SETTINGS_WIDE_SECTION_MAX_PX,
    margin: "0 auto",
    display: "grid",
    gap: 16,
  };

  if (projectsLoading) {
    return (
      <div style={columnStyle}>
        <div style={{ ...panelStyle(SETTINGS_WIDE_SECTION_MAX_PX), padding: 20 }}>
          <div style={{ height: 22, width: "55%", borderRadius: 8, background: "rgba(255,255,255,0.06)" }} />
          <div style={{ marginTop: 14, height: 110, borderRadius: 12, background: "rgba(255,255,255,0.04)" }} />
        </div>
      </div>
    );
  }

  if (!canManageOrganizationAccess) {
    return (
      <div style={columnStyle}>
      <section style={panelStyle(SETTINGS_WIDE_SECTION_MAX_PX)}>
        <h2 style={{ fontSize: 16, fontWeight: 700, marginBottom: 8 }}>Управление доступом</h2>
        <p style={{ fontSize: 13, color: muted, margin: 0 }}>
          Настройка участников организации и проектов доступна только владельцу и администраторам организации.
        </p>
      </section>
      </div>
    );
  }

  return (
    <div style={columnStyle}>
      <section style={panelStyle(SETTINGS_WIDE_SECTION_MAX_PX)}>
        <h2 style={{ fontSize: 16, fontWeight: 700, marginBottom: 6 }}>Управление доступом</h2>
        <p style={{ fontSize: 13, color: muted, marginBottom: 16 }}>
          Аккаунт (организация) и отдельные проекты — разные уровни прав
        </p>

        <div
          role="tablist"
          aria-label="Уровень доступа"
          style={{
            display: "flex",
            flexWrap: "wrap",
            gap: 8,
            borderBottom: "1px solid rgba(255,255,255,0.10)",
            paddingBottom: 12,
          }}
        >
          <button
            type="button"
            role="tab"
            aria-selected={tab === "org"}
            onClick={() => onTabChange("org")}
            style={tabButtonStyle(tab === "org")}
          >
            Аккаунт (организация)
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={tab === "project"}
            onClick={() => onTabChange("project")}
            disabled={projects.length === 0}
            style={{
              ...tabButtonStyle(tab === "project"),
              opacity: projects.length === 0 ? 0.4 : 1,
              cursor: projects.length === 0 ? "not-allowed" : "pointer",
            }}
          >
            Проекты
          </button>
        </div>
      </section>

      {tab === "org" ? (
        <OrgMembersManager layout="section" />
      ) : projects.length === 0 ? (
        <section style={panelStyle(SETTINGS_WIDE_SECTION_MAX_PX)}>
          <p style={{ fontSize: 13, color: muted, margin: 0, textAlign: "center" }}>
            Нет проектов.{" "}
            <Link
              href="/app/projects/new"
              style={{ color: "rgba(200,210,255,0.95)", textDecoration: "underline" }}
            >
              Создать проект
            </Link>
          </p>
        </section>
      ) : (
        <div style={{ display: "grid", gap: 16 }}>
          <section style={panelStyle(SETTINGS_WIDE_SECTION_MAX_PX)}>
            <label
              style={{ display: "grid", gap: 6, fontSize: 13, marginBottom: 10 }}
              htmlFor="settings-access-project"
            >
              <span style={{ color: labelColor }}>Проект</span>
              <select
                id="settings-access-project"
                value={projectIdParam || projectSelect || projects[0]?.id || ""}
                onChange={(e) => onProjectChange(e.target.value)}
                className="settings-page-select"
                style={{ cursor: "pointer" }}
              >
                {projectOptions.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.label}
                  </option>
                ))}
              </select>
            </label>
            <p style={{ fontSize: 13, color: muted, margin: 0 }}>
              Участники и приглашения ниже относятся только к выбранному проекту.
            </p>
          </section>

          {projectIdParam ? (
            <Suspense fallback={<ProjectAccessFallback />}>
              <ProjectMembersPageClient key={projectIdParam} variant="embedded" />
            </Suspense>
          ) : (
            <ProjectAccessFallback />
          )}
        </div>
      )}
    </div>
  );
}
