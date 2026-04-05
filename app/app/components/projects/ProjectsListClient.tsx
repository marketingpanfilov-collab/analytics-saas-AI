"use client";

import { useRouter } from "next/navigation";
import Link from "next/link";
import { useRef, useEffect, useState, useMemo, type ReactNode } from "react";
import { useBillingBootstrap } from "@/app/app/components/BillingBootstrapProvider";
import { billingActionAllowed } from "@/app/lib/billingBootstrapClient";
import { ActionId } from "@/app/lib/billingUiContract";
import { setActiveProjectId } from "@/app/lib/activeProjectClient";
import type { Project } from "@/app/lib/auth/getCurrentUserContext";
import {
  canRenameProject,
  canArchiveProject,
} from "@/app/lib/auth/projectPermissions";
import { PROJECT_PLAN_LIMIT_USER_MESSAGE } from "@/app/lib/projectPlanLimit";
import PortalTooltip from "@/app/app/components/PortalTooltip";

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

const NAME_MAX_LENGTH = 256;

type Props = {
  projects: Project[];
  archivedProjects: Project[];
  activeProjectId: string | null;
  roleMap: Record<string, string>;
  canCreate: boolean;
  /** Владелец и администратор организации — управление доступом (организация + проекты) */
  canManageAccess?: boolean;
  currentUserId?: string | null;
  canTransferOwnership?: boolean;
  organizationId?: string | null;
  organizationName?: string | null;
  /** null = без лимита по тарифу (сервер: getPlanMaxProjectsForUser) */
  planMaxProjects?: number | null;
};

function CreateProjectLinkControl({
  canTryCreate,
  billingAllows,
  atPlanLimit,
  linkClassName,
  disabledClassName,
  children,
}: {
  canTryCreate: boolean;
  billingAllows: boolean;
  atPlanLimit: boolean;
  linkClassName: string;
  disabledClassName: string;
  children: ReactNode;
}) {
  if (!canTryCreate) return null;
  // Лимит проектов — отдельно от биллинга: при resolvedUi === null create_project «запрещён»,
  // но объяснение лимита должно показываться всегда (см. billingActionAllowed(null) → false).
  if (atPlanLimit) {
    return (
      <PortalTooltip
        content={PROJECT_PLAN_LIMIT_USER_MESSAGE}
        ariaDisabled
        className={`${disabledClassName} max-w-full select-none outline-none focus-visible:ring-2 focus-visible:ring-white/30 focus-visible:ring-offset-2 focus-visible:ring-offset-[#0b0b10]`}
      >
        {children}
      </PortalTooltip>
    );
  }
  if (billingAllows) {
    return (
      <Link href="/app/projects/new" className={linkClassName}>
        {children}
      </Link>
    );
  }
  return (
    <span className={disabledClassName} aria-disabled="true">
      {children}
    </span>
  );
}

type TabKind = "active" | "archived";

export default function ProjectsListClient({
  projects,
  archivedProjects = [],
  activeProjectId,
  roleMap,
  canCreate,
  canManageAccess = false,
  currentUserId = null,
  canTransferOwnership = false,
  organizationId = null,
  organizationName = null,
  planMaxProjects = null,
}: Props) {
  const router = useRouter();
  const { resolvedUi, showPostCheckoutModal, loading: billingBootstrapLoading } = useBillingBootstrap();

  useEffect(() => {
    if (billingBootstrapLoading) return;
    if (showPostCheckoutModal) {
      router.replace("/app/onboarding");
    }
  }, [billingBootstrapLoading, showPostCheckoutModal, router]);
  const canSyncProjectMutations = useMemo(
    () => billingActionAllowed(resolvedUi, ActionId.sync_refresh),
    [resolvedUi]
  );
  const canBillingManage = useMemo(
    () => billingActionAllowed(resolvedUi, ActionId.billing_manage),
    [resolvedUi]
  );
  const canNavigateApp = useMemo(
    () => billingActionAllowed(resolvedUi, ActionId.navigate_app),
    [resolvedUi]
  );
  const canCreateProjectAction = useMemo(
    () => billingActionAllowed(resolvedUi, ActionId.create_project),
    [resolvedUi]
  );
  const atProjectPlanLimit = useMemo(
    () => planMaxProjects != null && projects.length >= planMaxProjects,
    [planMaxProjects, projects.length]
  );
  const menuAnchorRef = useRef<HTMLDivElement>(null);
  const [menuOpenId, setMenuOpenId] = useState<string | null>(null);
  const [tab, setTab] = useState<TabKind>("active");

  const [renameProject, setRenameProject] = useState<Project | null>(null);
  const [renameName, setRenameName] = useState("");
  const [renameLoading, setRenameLoading] = useState(false);
  const [renameError, setRenameError] = useState<string | null>(null);

  const [archiveProject, setArchiveProject] = useState<Project | null>(null);
  const [archiveLoading, setArchiveLoading] = useState(false);
  const [archiveError, setArchiveError] = useState<string | null>(null);

  const [transferModalOpen, setTransferModalOpen] = useState(false);
  const [transferStep, setTransferStep] = useState<1 | 2>(1);
  const [transferRecipientEmail, setTransferRecipientEmail] = useState("");
  const [transferPassword, setTransferPassword] = useState("");
  const [transferConfirmChecked, setTransferConfirmChecked] = useState(false);
  const [transferLoading, setTransferLoading] = useState(false);
  const [transferError, setTransferError] = useState<string | null>(null);
  const [transferSuccess, setTransferSuccess] = useState(false);
  const [transferSentToEmail, setTransferSentToEmail] = useState<string | null>(null);

  /** Пока идёт переход в дашборд — «Открыть» показывает «Подождите…» до конца навигации или ошибки */
  const [openingProjectId, setOpeningProjectId] = useState<string | null>(null);
  const [openError, setOpenError] = useState<string | null>(null);

  const displayProjects = tab === "active" ? projects : archivedProjects;
  const isArchivedTab = tab === "archived";

  useEffect(() => {
    if (!menuOpenId) return;
    const handle = (e: MouseEvent) => {
      if (menuAnchorRef.current?.contains(e.target as Node)) return;
      setMenuOpenId(null);
    };
    document.addEventListener("click", handle);
    return () => document.removeEventListener("click", handle);
  }, [menuOpenId]);

  const handleOpen = async (projectId: string) => {
    if (isArchivedTab) return;
    if (openingProjectId) return;
    setOpenError(null);
    setOpeningProjectId(projectId);
    setActiveProjectId(projectId);
    try {
      if (canNavigateApp) {
        await fetch(`/api/projects/${encodeURIComponent(projectId)}/touch`, { method: "POST" }).catch(() => null);
      }
      // Промис завершается, когда навигация (включая загрузку сегментов) завершена.
      // Состояние не сбрасываем при успехе — страница размонтируется; иначе «Подождите…» мигало бы «Открыть».
      await router.push(`/app?project_id=${encodeURIComponent(projectId)}`);
    } catch (err) {
      setOpeningProjectId(null);
      setOpenError(
        err instanceof Error ? err.message : "Не удалось открыть проект. Попробуйте снова."
      );
    }
  };

  const openRename = (project: Project) => {
    setMenuOpenId(null);
    setRenameProject(project);
    setRenameName(project.name ?? "");
    setRenameError(null);
  };

  const openArchive = (project: Project) => {
    setMenuOpenId(null);
    setArchiveProject(project);
    setArchiveError(null);
  };

  const openTransferModal = () => {
    setTransferModalOpen(true);
    setTransferStep(1);
    setTransferRecipientEmail("");
    setTransferPassword("");
    setTransferConfirmChecked(false);
    setTransferError(null);
    setTransferSuccess(false);
    setTransferSentToEmail(null);
  };

  const submitRename = async () => {
    if (!renameProject || renameLoading) return;
    if (!canSyncProjectMutations) {
      setRenameError("Действие недоступно при текущем статусе подписки");
      return;
    }
    const name = renameName.trim();
    if (!name) {
      setRenameError("Введите название проекта");
      return;
    }
    if (name.length > NAME_MAX_LENGTH) {
      setRenameError(`Максимум ${NAME_MAX_LENGTH} символов`);
      return;
    }
    setRenameError(null);
    setRenameLoading(true);
    try {
      const res = await fetch(`/api/projects/${renameProject.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name }),
      });
      const json = await res.json();
      if (!res.ok) {
        setRenameError(json.error ?? "Ошибка сохранения");
        setRenameLoading(false);
        return;
      }
      await router.refresh();
      setRenameProject(null);
      setRenameLoading(false);
    } catch {
      setRenameError("Не удалось сохранить. Попробуйте ещё раз.");
      setRenameLoading(false);
    }
  };

  const submitArchive = async () => {
    if (!archiveProject || archiveLoading) return;
    setArchiveError(null);
    setArchiveLoading(true);
    try {
      const res = await fetch(`/api/projects/${archiveProject.id}/archive`, { method: "PATCH" });
      const json = await res.json();
      if (!res.ok) {
        setArchiveError(json.error ?? "Ошибка архивирования");
        setArchiveLoading(false);
        return;
      }
      await router.refresh();
      setArchiveProject(null);
      setArchiveLoading(false);
    } catch {
      setArchiveError("Не удалось архивировать. Попробуйте ещё раз.");
      setArchiveLoading(false);
    }
  };

  const submitTransfer = async () => {
    if (transferStep === 1) {
      const em = transferRecipientEmail.trim().toLowerCase();
      if (!em || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(em)) {
        setTransferError("Введите корректный email получателя");
        return;
      }
      setTransferError(null);
      setTransferStep(2);
      return;
    }
    if (transferLoading) return;
    const password = transferPassword.trim();
    if (!password) {
      setTransferError("Введите текущий пароль");
      return;
    }
    if (!transferConfirmChecked) {
      setTransferError("Подтвердите, что понимаете последствия передачи");
      return;
    }
    const toEmail = transferRecipientEmail.trim().toLowerCase();
    if (!toEmail || !organizationId) return;
    if (!canBillingManage) {
      setTransferError("Действие недоступно при текущем статусе подписки");
      return;
    }
    setTransferError(null);
    setTransferLoading(true);
    try {
      const verifyRes = await fetch("/api/auth/verify-password", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ password }),
      });
      const verifyJson = await verifyRes.json();
      if (!verifyRes.ok || !verifyJson.success || !verifyJson.reauth_token) {
        setTransferError(verifyJson.error ?? "Неверный пароль");
        setTransferLoading(false);
        return;
      }
      const transferRes = await fetch("/api/org/transfer-request/initiate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          organization_id: organizationId,
          to_email: toEmail,
          reauth_token: verifyJson.reauth_token,
        }),
      });
      const transferJson = await transferRes.json();
      if (!transferRes.ok) {
        setTransferError(transferJson.error ?? "Не удалось отправить приглашение");
        setTransferLoading(false);
        return;
      }
      setTransferSentToEmail(typeof transferJson.to_email === "string" ? transferJson.to_email : toEmail);
      setTransferSuccess(true);
      setTransferLoading(false);
      setTimeout(() => {
        setTransferModalOpen(false);
        router.refresh();
      }, 2800);
    } catch {
      setTransferError("Не удалось выполнить запрос. Попробуйте ещё раз.");
      setTransferLoading(false);
    }
  };

  const showEmpty = displayProjects.length === 0;
  const emptyForTab = isArchivedTab
    ? "Нет архивных проектов"
    : canCreate
      ? "Нет проектов"
      : "Нет назначенных проектов";

  return (
    <div className="mx-auto max-w-6xl space-y-8 p-6">
      <header className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight text-white">
            Проекты
          </h1>
          <p className="mt-1 text-sm text-zinc-400">
            Выберите проект для работы в дашборде
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-3">
          {canManageAccess && (
            <Link
              href={
                activeProjectId
                  ? `/app/settings?project_id=${encodeURIComponent(activeProjectId)}&section=access`
                  : projects[0]?.id
                    ? `/app/settings?project_id=${encodeURIComponent(projects[0].id)}&section=access`
                    : "/app/projects"
              }
              className="inline-flex h-10 cursor-pointer items-center rounded-xl border border-white/15 bg-white/[0.06] px-4 text-sm font-medium text-white hover:bg-white/10"
            >
              Управлять доступом
            </Link>
          )}
          {canTransferOwnership && (
            <button
              type="button"
              onClick={openTransferModal}
              disabled={!canBillingManage}
              className="inline-flex h-10 cursor-pointer items-center rounded-xl border border-amber-500/40 bg-amber-500/10 px-4 text-sm font-medium text-amber-200 hover:bg-amber-500/20 disabled:cursor-not-allowed disabled:opacity-50"
            >
              Передать управление организацией
            </button>
          )}
          <CreateProjectLinkControl
            canTryCreate={canCreate}
            billingAllows={canCreateProjectAction}
            atPlanLimit={atProjectPlanLimit}
            linkClassName="inline-flex h-10 cursor-pointer items-center rounded-xl bg-white/10 px-5 text-sm font-medium text-white hover:bg-white/15"
            disabledClassName="inline-flex h-10 cursor-not-allowed items-center rounded-xl bg-white/[0.05] px-5 text-sm font-medium text-white/35"
          >
            Создать проект
          </CreateProjectLinkControl>
        </div>
      </header>

      {openError && (
        <div
          className="rounded-xl border border-red-500/40 bg-red-500/10 px-4 py-3 text-sm text-red-200"
          role="alert"
        >
          {openError}
        </div>
      )}

      {/* Tabs: Active / Archived */}
      <div className="flex gap-1 rounded-xl bg-white/[0.04] p-1 ring-1 ring-white/10">
        <button
          type="button"
          onClick={() => setTab("active")}
          className={`rounded-lg px-4 py-2 text-sm font-medium transition-colors ${
            tab === "active"
              ? "bg-white/10 text-white"
              : "text-zinc-400 hover:text-zinc-200"
          }`}
        >
          Active
        </button>
        <button
          type="button"
          onClick={() => setTab("archived")}
          className={`rounded-lg px-4 py-2 text-sm font-medium transition-colors ${
            tab === "archived"
              ? "bg-white/10 text-white"
              : "text-zinc-400 hover:text-zinc-200"
          }`}
        >
          Archived
        </button>
      </div>

      {showEmpty ? (
        <div className="rounded-2xl border border-white/10 bg-white/[0.03] p-10 text-center">
          <h2 className="text-lg font-medium text-white">{emptyForTab}</h2>
          <p className="mt-2 text-sm text-zinc-500">
            {isArchivedTab
              ? "Архивированные проекты появятся здесь."
              : canCreate
                ? "Создайте первый проект, чтобы начать."
                : "Обратитесь к администратору организации для доступа к проекту."}
          </p>
          {canCreate && !isArchivedTab && (
            <div className="mt-6">
              <CreateProjectLinkControl
                canTryCreate
                billingAllows={canCreateProjectAction}
                atPlanLimit={atProjectPlanLimit}
                linkClassName="inline-flex h-11 cursor-pointer items-center rounded-xl bg-white/10 px-6 text-sm font-medium text-white hover:bg-white/15"
                disabledClassName="inline-flex h-11 cursor-not-allowed items-center rounded-xl bg-white/[0.05] px-6 text-sm font-medium text-white/35"
              >
                Создать первый проект
              </CreateProjectLinkControl>
            </div>
          )}
        </div>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {displayProjects.map((project) => {
            const role = roleMap[project.id] ?? "member";
            const isActive = !isArchivedTab && activeProjectId !== null && project.id === activeProjectId;
            const lastOpenedAt = typeof project.last_opened_at === "string" ? Date.parse(project.last_opened_at) : NaN;
            const isInactiveBy7Days =
              Number.isFinite(lastOpenedAt) && Date.now() - lastOpenedAt >= 7 * 24 * 60 * 60 * 1000;
            const showMenu =
              canRenameProject(role) || canArchiveProject(role);
            const menuOpen = menuOpenId === project.id;

            return (
              <div
                key={project.id}
                className={`relative rounded-2xl border bg-white/[0.03] p-6 transition-colors hover:border-white/15 hover:bg-white/[0.04] ${
                  isActive ? "border-emerald-500/40 bg-emerald-500/[0.06]" : "border-white/10"
                }`}
              >
                {/* Row 1: title + action menu */}
                <div className="flex items-start justify-between gap-2">
                  <h3 className="min-w-0 flex-1 truncate text-base font-medium text-white">
                    {project.name || "Без названия"}
                  </h3>
                  {showMenu && (
                    <div className="relative shrink-0" ref={menuOpen ? menuAnchorRef : undefined}>
                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation();
                          setMenuOpenId(menuOpen ? null : project.id);
                        }}
                        className="flex h-8 w-8 items-center justify-center rounded-lg text-zinc-400 hover:bg-white/10 hover:text-white"
                        aria-label="Действия"
                        aria-expanded={menuOpen}
                        aria-haspopup="true"
                      >
                        <span className="text-lg leading-none">⋯</span>
                      </button>
                      {menuOpen && (
                        <div
                          className="absolute right-0 top-full z-10 mt-1 min-w-[200px] rounded-xl border border-white/10 bg-zinc-900 py-1 shadow-xl"
                          role="menu"
                        >
                          {canRenameProject(role) && (
                            <button
                              type="button"
                              role="menuitem"
                              className="w-full px-4 py-2 text-left text-sm text-zinc-200 hover:bg-white/10"
                              onClick={() => openRename(project)}
                            >
                              Rename project
                            </button>
                          )}
                          {canArchiveProject(role) && !isArchivedTab && (
                            <button
                              type="button"
                              role="menuitem"
                              className="w-full px-4 py-2 text-left text-sm text-zinc-200 hover:bg-white/10"
                              onClick={() => openArchive(project)}
                            >
                              Archive project
                            </button>
                          )}
                        </div>
                      )}
                    </div>
                  )}
                </div>
                {/* Row 2: short id + badges */}
                <div className="mt-2 flex items-center justify-between gap-2">
                  <p className="text-xs text-zinc-500 font-mono">
                    {shortId(project.id)}
                  </p>
                  <div className="flex shrink-0 items-center gap-2">
                    {!isArchivedTab && (
                      <span
                        className={
                          isInactiveBy7Days
                            ? "rounded-full bg-amber-500/20 px-2 py-0.5 text-xs text-amber-300"
                            : "rounded-full bg-emerald-500/20 px-2 py-0.5 text-xs text-emerald-400"
                        }
                      >
                        {isInactiveBy7Days ? "Бездействует" : "Активен"}
                      </span>
                    )}
                    {isArchivedTab && (
                      <span className="rounded-full bg-zinc-600/30 px-2 py-0.5 text-xs text-zinc-400">
                        Архив
                      </span>
                    )}
                    <span className="rounded-full border border-white/10 bg-white/[0.04] px-2.5 py-1 text-xs text-zinc-400">
                      {roleLabel(role)}
                    </span>
                  </div>
                </div>
                <button
                  type="button"
                  onClick={() => void handleOpen(project.id)}
                  disabled={isArchivedTab || openingProjectId !== null}
                  aria-busy={openingProjectId === project.id}
                  className="mt-4 w-full cursor-pointer rounded-xl border border-white/10 bg-white/[0.04] py-2.5 text-sm font-medium text-zinc-200 transition-colors hover:bg-white/[0.06] hover:text-white disabled:pointer-events-none disabled:cursor-not-allowed disabled:opacity-60"
                >
                  {openingProjectId === project.id
                    ? "Подождите…"
                    : isArchivedTab
                      ? "Архив"
                      : "Открыть"}
                </button>
              </div>
            );
          })}
        </div>
      )}

      {/* Rename modal */}
      {renameProject && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4">
          <div
            className="w-full max-w-md rounded-2xl border border-white/10 bg-zinc-900 p-6 shadow-xl"
            role="dialog"
            aria-modal="true"
            aria-labelledby="rename-title"
          >
            <h2 id="rename-title" className="text-lg font-semibold text-white">
              Rename project
            </h2>
            <div className="mt-4">
              <label htmlFor="rename-input" className="block text-sm font-medium text-zinc-400">
                Название
              </label>
              <input
                id="rename-input"
                type="text"
                value={renameName}
                onChange={(e) => {
                  setRenameName(e.target.value);
                  if (renameError) setRenameError(null);
                }}
                maxLength={NAME_MAX_LENGTH}
                className="mt-2 w-full rounded-xl border border-white/10 bg-white/[0.04] px-4 py-3 text-sm text-white placeholder-zinc-500 focus:border-white/20 focus:outline-none"
                placeholder="Название проекта"
                autoFocus
              />
            </div>
            {renameError && (
              <p className="mt-2 text-sm text-red-400">{renameError}</p>
            )}
            <div className="mt-6 flex justify-end gap-3">
              <button
                type="button"
                onClick={() => setRenameProject(null)}
                className="rounded-xl border border-white/10 px-4 py-2 text-sm font-medium text-zinc-300 hover:bg-white/10"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={submitRename}
                disabled={!canSyncProjectMutations || renameLoading}
                aria-busy={renameLoading}
                className="rounded-xl bg-white/10 px-4 py-2 text-sm font-medium text-white hover:bg-white/15 disabled:pointer-events-none disabled:cursor-not-allowed disabled:opacity-50"
              >
                {renameLoading ? "Подождите…" : "Save"}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Archive modal */}
      {archiveProject && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4">
          <div
            className="w-full max-w-md rounded-2xl border border-amber-500/30 bg-zinc-900 p-6 shadow-xl"
            role="dialog"
            aria-modal="true"
            aria-labelledby="archive-title"
          >
            <h2 id="archive-title" className="text-lg font-semibold text-white">
              Archive project
            </h2>
            <p className="mt-3 text-sm text-zinc-400">
              This project will be archived and hidden from active workspaces.
              You can restore it later if needed.
            </p>
            {archiveError && (
              <p className="mt-2 text-sm text-red-400">{archiveError}</p>
            )}
            <div className="mt-6 flex justify-end gap-3">
              <button
                type="button"
                onClick={() => setArchiveProject(null)}
                className="rounded-xl border border-white/10 px-4 py-2 text-sm font-medium text-zinc-300 hover:bg-white/10"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={submitArchive}
                disabled={archiveLoading}
                aria-busy={archiveLoading}
                className="rounded-xl bg-amber-600 px-4 py-2 text-sm font-medium text-white hover:bg-amber-500 disabled:pointer-events-none disabled:cursor-not-allowed disabled:opacity-50"
              >
                {archiveLoading ? "Подождите…" : "Archive"}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Transfer ownership modal (global) */}
      {transferModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4">
          <div
            className="w-full max-w-md rounded-2xl border border-red-500/30 bg-zinc-900 p-6 shadow-xl"
            role="dialog"
            aria-modal="true"
            aria-labelledby="transfer-title"
          >
            <h2 id="transfer-title" className="text-lg font-semibold text-white">
              {transferStep === 1
                ? "Передать управление организацией"
                : "Подтверждение передачи"}
            </h2>

            {transferSuccess ? (
              <div className="mt-4 space-y-2 text-sm text-emerald-400">
                <p>Ссылка отправлена на {transferSentToEmail ?? transferRecipientEmail.trim()}.</p>
                <p className="text-zinc-400">
                  Получатель откроет письмо и нажмёт «Получить доступ». После подтверждения вы станете администратором
                  организации и сохраните доступ к проектам.
                </p>
              </div>
            ) : (
              <>
                {transferStep === 1 ? (
                  <>
                    <div className="mt-4 rounded-lg border border-amber-500/40 bg-amber-500/10 p-3 text-sm text-amber-200">
                      Вы собираетесь передать управление всей организацией.
                      Новый владелец получит полный контроль над организацией, проектами и доступами.
                      Это действие влияет на всю организацию, а не только на один проект.
                    </div>
                    <p className="mt-2 text-xs text-amber-200/90">
                      Мы отправим письмо на email получателя — аккаунт BoardIQ не обязан уже существовать.
                    </p>
                    <div className="mt-4">
                      <label htmlFor="transfer-recipient-email" className="block text-sm font-medium text-zinc-400">
                        Email нового владельца
                      </label>
                      <input
                        id="transfer-recipient-email"
                        type="email"
                        value={transferRecipientEmail}
                        onChange={(e) => {
                          setTransferRecipientEmail(e.target.value);
                          if (transferError) setTransferError(null);
                        }}
                        placeholder="name@company.com"
                        className="mt-2 w-full rounded-xl border border-white/10 bg-white/[0.04] px-4 py-3 text-sm text-white placeholder-zinc-500 focus:border-white/20 focus:outline-none"
                        autoComplete="off"
                      />
                    </div>
                    {organizationName ? (
                      <p className="mt-3 text-sm text-zinc-400">Организация: {organizationName}</p>
                    ) : null}
                  </>
                ) : (
                  <div className="mt-4 space-y-4">
                    <div>
                      <label htmlFor="transfer-password" className="block text-sm font-medium text-zinc-400">
                        Текущий пароль
                      </label>
                      <input
                        id="transfer-password"
                        type="password"
                        value={transferPassword}
                        onChange={(e) => {
                          setTransferPassword(e.target.value);
                          if (transferError) setTransferError(null);
                        }}
                        className="mt-2 w-full rounded-xl border border-white/10 bg-white/[0.04] px-4 py-3 text-sm text-white placeholder-zinc-500 focus:border-white/20 focus:outline-none"
                        placeholder="Введите пароль"
                        autoComplete="current-password"
                        autoFocus
                      />
                    </div>
                    <label className="flex cursor-pointer items-start gap-3">
                      <input
                        type="checkbox"
                        checked={transferConfirmChecked}
                        onChange={(e) => {
                          setTransferConfirmChecked(e.target.checked);
                          if (transferError) setTransferError(null);
                        }}
                        className="mt-1 h-4 w-4 rounded border-white/20 bg-white/[0.04] text-amber-500 focus:ring-amber-500/50"
                      />
                      <span className="text-sm text-zinc-300">
                        Я понимаю, что передаю управление всей организацией другому пользователю.
                      </span>
                    </label>
                  </div>
                )}
                {transferError && (
                  <p className="mt-2 text-sm text-red-400">{transferError}</p>
                )}
                <div className="mt-6 flex justify-end gap-3">
                  {transferStep === 2 ? (
                    <button
                      type="button"
                      onClick={() => setTransferStep(1)}
                      className="rounded-xl border border-white/10 px-4 py-2 text-sm font-medium text-zinc-300 hover:bg-white/10"
                    >
                      Назад
                    </button>
                  ) : (
                    <button
                      type="button"
                      onClick={() => setTransferModalOpen(false)}
                      className="rounded-xl border border-white/10 px-4 py-2 text-sm font-medium text-zinc-300 hover:bg-white/10"
                    >
                      Отмена
                    </button>
                  )}
                  <button
                    type="button"
                    onClick={submitTransfer}
                    disabled={
                      transferLoading ||
                      !canBillingManage ||
                      (transferStep === 1 && !transferRecipientEmail.trim())
                    }
                    aria-busy={transferLoading}
                    className="rounded-xl bg-red-600 px-4 py-2 text-sm font-medium text-white hover:bg-red-500 disabled:pointer-events-none disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    {transferLoading
                      ? "Подождите…"
                      : transferStep === 1
                        ? "Продолжить"
                        : "Отправить ссылку"}
                  </button>
                </div>
              </>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
