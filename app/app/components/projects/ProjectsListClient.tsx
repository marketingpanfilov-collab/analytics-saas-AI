"use client";

import { useRouter } from "next/navigation";
import Link from "next/link";
import { useRef, useEffect, useState, useMemo, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { acquireBodyScrollLock } from "@/app/lib/bodyScrollLock";
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
import { MobileBottomSheet, mobileSheetActionRowClassName } from "@/app/app/components/mobile/MobileBottomSheet";

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

/** Мобилка: статус и роль в одном ряду 50/50; на sm+ — чипы по ширине текста. */
const PROJECT_CARD_BADGE_PAIR_ITEM =
  "inline-flex h-8 min-w-0 items-center justify-center rounded-full px-2.5 text-xs max-sm:flex-1 max-sm:basis-0 max-sm:overflow-hidden max-sm:text-ellipsis max-sm:whitespace-nowrap sm:inline-block sm:h-auto sm:w-auto sm:max-w-none sm:overflow-visible sm:whitespace-normal sm:py-1";

/** Выше листовых mobile sheet (200), чтобы диалоги были поверх оболочки. */
const APP_PROJECT_MODAL_Z = 280;

function CenteredModalPortal({
  open,
  portalReady,
  onBackdropClose,
  children,
}: {
  open: boolean;
  portalReady: boolean;
  onBackdropClose: () => void;
  children: React.ReactNode;
}) {
  if (!open || !portalReady || typeof document === "undefined") return null;
  return createPortal(
    <div
      className="fixed inset-0 overflow-y-auto overscroll-contain bg-black/60"
      style={{ zIndex: APP_PROJECT_MODAL_Z }}
      role="presentation"
      onClick={onBackdropClose}
    >
      <div
        className="flex min-h-[100dvh] w-full items-center justify-center px-4 py-[max(1rem,env(safe-area-inset-top))] pb-[max(1.25rem,env(safe-area-inset-bottom))] sm:px-6 sm:py-8"
        onClick={onBackdropClose}
      >
        {children}
      </div>
    </div>,
    document.body
  );
}

const projectModalActionBtnClass =
  "w-full min-h-11 rounded-xl px-4 py-2.5 text-sm font-medium sm:min-h-0 sm:w-auto sm:py-2";

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
  onLinkActivate,
}: {
  canTryCreate: boolean;
  billingAllows: boolean;
  atPlanLimit: boolean;
  linkClassName: string;
  disabledClassName: string;
  children: ReactNode;
  /** Вызывается при клике по рабочей ссылке (например закрыть mobile sheet) */
  onLinkActivate?: () => void;
}) {
  if (!canTryCreate) return null;
  // Лимит проектов — отдельно от биллинга: при resolvedUi === null create_project «запрещён»,
  // но объяснение лимита должно показываться всегда (см. billingActionAllowed(null) → false).
  if (atPlanLimit) {
    return (
      <PortalTooltip
        content={PROJECT_PLAN_LIMIT_USER_MESSAGE}
        ariaDisabled
        className={`${disabledClassName} w-full max-w-full min-h-11 select-none outline-none focus-visible:ring-2 focus-visible:ring-white/30 focus-visible:ring-offset-2 focus-visible:ring-offset-[#0b0b10] sm:h-10 sm:min-h-0 sm:w-auto`}
      >
        {children}
      </PortalTooltip>
    );
  }
  if (billingAllows) {
    return (
      <Link
        href="/app/projects/new"
        className={linkClassName}
        onClick={() => onLinkActivate?.()}
      >
        {children}
      </Link>
    );
  }
  return (
    <span className={`${disabledClassName} w-full min-h-11 sm:h-10 sm:min-h-0 sm:w-auto`} aria-disabled="true">
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
  const { resolvedUi } = useBillingBootstrap();

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
  /** Первый проект: не блокировать кнопку до прихода bootstrap (resolvedUi === null). */
  const billingAllowsCreateProject = useMemo(
    () =>
      canCreateProjectAction ||
      (canCreate && !atProjectPlanLimit && projects.length === 0),
    [canCreateProjectAction, canCreate, atProjectPlanLimit, projects.length]
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
  const [mobileProjectsMenuOpen, setMobileProjectsMenuOpen] = useState(false);
  const [portalReady, setPortalReady] = useState(false);

  useEffect(() => {
    setPortalReady(true);
  }, []);

  useEffect(() => {
    if (!portalReady) return;
    if (renameProject == null && archiveProject == null && !transferModalOpen) return;
    return acquireBodyScrollLock();
  }, [portalReady, renameProject, archiveProject, transferModalOpen]);

  const showMobileOverflow =
    Boolean(canCreate) || Boolean(canManageAccess) || Boolean(canTransferOwnership);

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

  useEffect(() => {
    if (!mobileProjectsMenuOpen) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setMobileProjectsMenuOpen(false);
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [mobileProjectsMenuOpen]);

  useEffect(() => {
    if (typeof window === "undefined" || !mobileProjectsMenuOpen) return;
    const mq = window.matchMedia("(min-width: 640px)");
    const sync = () => {
      if (mq.matches) setMobileProjectsMenuOpen(false);
    };
    sync();
    mq.addEventListener("change", sync);
    return () => mq.removeEventListener("change", sync);
  }, [mobileProjectsMenuOpen]);

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
      ? "Создайте первый проект"
      : "Нет назначенных проектов";

  return (
    <div className="relative z-[1] mx-auto w-full min-w-0 max-w-6xl space-y-5 py-4 pl-[max(1rem,env(safe-area-inset-left))] pr-[max(1rem,env(safe-area-inset-right))] sm:space-y-8 sm:p-6 sm:pl-6 sm:pr-6">
      <header className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between sm:gap-4">
        <div className="min-w-0 flex-1">
          <div className="flex items-center justify-between gap-2 sm:justify-start sm:gap-0">
            <h1 className="min-w-0 flex-1 text-lg font-semibold tracking-tight text-white sm:flex-none sm:text-2xl">
              Проекты
            </h1>
            {showMobileOverflow ? (
              <button
                type="button"
                className="grid h-9 w-9 shrink-0 place-items-center rounded-lg text-zinc-400 transition-colors hover:bg-white/[0.06] hover:text-white sm:hidden"
                aria-label="Действия с проектами"
                aria-haspopup="dialog"
                aria-expanded={mobileProjectsMenuOpen}
                onClick={() => setMobileProjectsMenuOpen(true)}
              >
                <span className="text-xl leading-none">⋯</span>
              </button>
            ) : null}
          </div>
          <p className="mt-0.5 text-xs leading-snug text-zinc-400 sm:mt-1 sm:text-sm sm:leading-normal">
            Выберите проект для работы в дашборде
          </p>
        </div>
        <div className="hidden w-full min-w-0 flex-col gap-2 sm:flex sm:w-auto sm:flex-row sm:flex-wrap sm:items-center sm:justify-end sm:gap-3">
          {canManageAccess && (
            <div className="w-full sm:w-auto">
              <Link
                href={
                  activeProjectId
                    ? `/app/settings?project_id=${encodeURIComponent(activeProjectId)}&section=access`
                    : projects[0]?.id
                      ? `/app/settings?project_id=${encodeURIComponent(projects[0].id)}&section=access`
                      : "/app/projects"
                }
                className="inline-flex min-h-11 w-full cursor-pointer items-center justify-center rounded-xl border border-white/15 bg-white/[0.06] px-4 text-sm font-medium text-white hover:bg-white/10 sm:h-10 sm:min-h-0 sm:w-auto"
              >
                Управлять доступом
              </Link>
            </div>
          )}
          {canTransferOwnership && (
            <div className="w-full sm:w-auto">
              <button
                type="button"
                onClick={openTransferModal}
                disabled={!canBillingManage}
                className="inline-flex min-h-11 w-full cursor-pointer items-center justify-center rounded-xl border border-amber-500/40 bg-amber-500/10 px-3 py-2.5 text-center text-xs font-medium leading-snug text-amber-200 hover:bg-amber-500/20 disabled:cursor-not-allowed disabled:opacity-50 sm:min-h-10 sm:w-auto sm:px-4 sm:py-2 sm:text-sm sm:leading-normal"
              >
                Передать управление организацией
              </button>
            </div>
          )}
          {canCreate ? (
            <div className="w-full sm:w-auto">
              <CreateProjectLinkControl
                canTryCreate={canCreate}
                billingAllows={billingAllowsCreateProject}
                atPlanLimit={atProjectPlanLimit}
                linkClassName="inline-flex min-h-11 w-full cursor-pointer items-center justify-center rounded-xl bg-white/10 px-5 text-sm font-semibold text-white shadow-sm ring-1 ring-white/10 hover:bg-white/15 sm:h-10 sm:min-h-0 sm:w-auto sm:font-medium sm:shadow-none sm:ring-0"
                disabledClassName="inline-flex min-h-11 w-full cursor-not-allowed items-center justify-center rounded-xl bg-white/[0.05] px-5 text-sm font-medium text-white/35 sm:h-10 sm:min-h-0 sm:w-auto"
              >
                Создать проект
              </CreateProjectLinkControl>
            </div>
          ) : null}
        </div>
      </header>

      <MobileBottomSheet
        open={mobileProjectsMenuOpen}
        onOpenChange={setMobileProjectsMenuOpen}
        title="Управление проектами"
        titleId="projects-overflow-title"
        visibleBelow="sm"
        contentClassName="px-1 pb-1"
        panelMaxClassName="max-h-[min(72dvh,520px)]"
        titleBottomPaddingExtraPx={6}
      >
        <nav className="flex flex-col gap-0.5" aria-label="Действия">
          {canCreate ? (
            <CreateProjectLinkControl
              canTryCreate={canCreate}
              billingAllows={billingAllowsCreateProject}
              atPlanLimit={atProjectPlanLimit}
              onLinkActivate={() => setMobileProjectsMenuOpen(false)}
              linkClassName={mobileSheetActionRowClassName}
              disabledClassName={`${mobileSheetActionRowClassName} cursor-not-allowed text-white/35`}
            >
              Создать проект
            </CreateProjectLinkControl>
          ) : null}
          {canManageAccess ? (
            <Link
              href={
                activeProjectId
                  ? `/app/settings?project_id=${encodeURIComponent(activeProjectId)}&section=access`
                  : projects[0]?.id
                    ? `/app/settings?project_id=${encodeURIComponent(projects[0].id)}&section=access`
                    : "/app/projects"
              }
              className={`${mobileSheetActionRowClassName} text-white no-underline`}
              onClick={() => setMobileProjectsMenuOpen(false)}
            >
              Управлять доступом
            </Link>
          ) : null}
          {canTransferOwnership ? (
            <button
              type="button"
              disabled={!canBillingManage}
              className={`${mobileSheetActionRowClassName} text-amber-200/95 hover:bg-amber-500/[0.08] disabled:cursor-not-allowed disabled:opacity-45`}
              onClick={() => {
                setMobileProjectsMenuOpen(false);
                openTransferModal();
              }}
            >
              Передать управление организацией
            </button>
          ) : null}
        </nav>
      </MobileBottomSheet>

      {openError && (
        <div
          className="rounded-xl border border-red-500/40 bg-red-500/10 px-4 py-3 text-sm text-red-200"
          role="alert"
        >
          {openError}
        </div>
      )}

      {/* Tabs: Active / Archived — непрозрачный фон, чтобы контент при скролле не проступал (LEVEL 1 / flow) */}
      <div className="flex w-full min-w-0 gap-1 rounded-xl border border-white/10 bg-[#0b0b10] p-1">
        <button
          type="button"
          onClick={() => setTab("active")}
          className={`min-h-11 flex-1 rounded-lg px-3 py-2.5 text-center text-sm font-medium transition-colors active:bg-white/[0.08] sm:min-h-0 sm:flex-none sm:px-4 sm:py-2 sm:active:bg-transparent ${
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
          className={`min-h-11 flex-1 rounded-lg px-3 py-2.5 text-center text-sm font-medium transition-colors active:bg-white/[0.08] sm:min-h-0 sm:flex-none sm:px-4 sm:py-2 sm:active:bg-transparent ${
            tab === "archived"
              ? "bg-white/10 text-white"
              : "text-zinc-400 hover:text-zinc-200"
          }`}
        >
          Archived
        </button>
      </div>

      {showEmpty ? (
        <div className="rounded-2xl border border-white/10 bg-white/[0.03] px-4 py-6 text-center sm:p-10">
          <h2 className="text-base font-medium text-white sm:text-lg">{emptyForTab}</h2>
          <p className="mx-auto mt-2 max-w-md text-sm leading-relaxed text-zinc-500 sm:max-w-none">
            {isArchivedTab
              ? "Архивированные проекты появятся здесь."
              : canCreate
                ? "Создайте первый проект, чтобы начать."
                : "Обратитесь к администратору организации для доступа к проекту."}
          </p>
          {canCreate && !isArchivedTab && (
            <div className="mt-5 flex w-full justify-center px-0 sm:mt-6 sm:px-1">
              <CreateProjectLinkControl
                canTryCreate
                billingAllows={billingAllowsCreateProject}
                atPlanLimit={atProjectPlanLimit}
                linkClassName="inline-flex min-h-11 w-full max-w-sm cursor-pointer items-center justify-center rounded-xl bg-white/10 px-6 text-sm font-semibold text-white shadow-sm ring-1 ring-white/10 hover:bg-white/15 max-sm:bg-emerald-500/[0.18] max-sm:ring-emerald-400/25 sm:inline-flex sm:h-11 sm:min-h-0 sm:max-w-xs sm:font-medium sm:shadow-none sm:ring-0"
                disabledClassName="inline-flex min-h-11 w-full max-w-sm cursor-not-allowed items-center justify-center rounded-xl bg-white/[0.05] px-6 text-sm font-medium text-white/35 sm:inline-flex sm:h-11 sm:min-h-0 sm:max-w-xs"
              >
                Создать первый проект
              </CreateProjectLinkControl>
            </div>
          )}
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-3 sm:gap-4 sm:grid-cols-2 lg:grid-cols-3">
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
                className={`relative rounded-2xl border bg-white/[0.03] p-4 transition-colors hover:border-white/15 hover:bg-white/[0.04] sm:p-6 ${
                  isActive ? "border-emerald-500/40 bg-emerald-500/[0.06]" : "border-white/10"
                }`}
              >
                {/* Row 1: название + id под ним, справа — кнопка «⋯» */}
                <div className="flex items-center justify-between gap-3">
                  <div className="min-w-0 flex-1">
                    <h3 className="break-words text-base font-medium leading-snug text-white sm:truncate sm:leading-normal">
                      {project.name || "Без названия"}
                    </h3>
                    <p className="mt-1 min-w-0 break-all text-xs font-mono text-zinc-500 sm:break-normal sm:truncate">
                      {shortId(project.id)}
                    </p>
                  </div>
                  {showMenu && (
                    <div className="relative shrink-0" ref={menuOpen ? menuAnchorRef : undefined}>
                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation();
                          setMenuOpenId(menuOpen ? null : project.id);
                        }}
                        className="flex min-h-11 min-w-11 items-center justify-center rounded-lg text-zinc-400 hover:bg-white/10 hover:text-white sm:h-8 sm:min-h-0 sm:min-w-0 sm:w-8"
                        aria-label="Действия"
                        aria-expanded={menuOpen}
                        aria-haspopup="true"
                      >
                        <span className="text-lg leading-none">⋯</span>
                      </button>
                      {menuOpen && (
                        <div
                          className="absolute right-0 top-full z-20 mt-1 w-max min-w-[min(240px,calc(100vw-1.5rem))] max-w-[calc(100vw-1.5rem)] rounded-xl border border-white/10 bg-zinc-900 py-1 shadow-xl sm:min-w-[200px]"
                          role="menu"
                        >
                          {canRenameProject(role) && (
                            <button
                              type="button"
                              role="menuitem"
                              className="block w-full whitespace-nowrap px-4 py-2.5 text-left text-sm leading-snug text-zinc-200 hover:bg-white/10 sm:py-2"
                              onClick={() => openRename(project)}
                            >
                              Rename project
                            </button>
                          )}
                          {canArchiveProject(role) && !isArchivedTab && (
                            <button
                              type="button"
                              role="menuitem"
                              className="block w-full whitespace-nowrap px-4 py-2.5 text-left text-sm leading-snug text-zinc-200 hover:bg-white/10 sm:py-2"
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
                {/* Row 2: бейджи */}
                <div className="mt-3 flex min-w-0 items-stretch gap-1.5 max-sm:flex-nowrap sm:mt-2 sm:flex-wrap sm:items-center sm:gap-2">
                  {!isArchivedTab && (
                    <span
                      className={
                        isInactiveBy7Days
                          ? `border border-amber-400/40 bg-amber-500/20 text-amber-300 ${PROJECT_CARD_BADGE_PAIR_ITEM}`
                          : `border border-emerald-400/40 bg-emerald-500/20 text-emerald-400 ${PROJECT_CARD_BADGE_PAIR_ITEM}`
                      }
                    >
                      {isInactiveBy7Days ? "Бездействует" : "Активен"}
                    </span>
                  )}
                  {isArchivedTab && (
                    <span
                      className={`border border-white/15 bg-zinc-600/30 text-zinc-400 ${PROJECT_CARD_BADGE_PAIR_ITEM}`}
                    >
                      Архив
                    </span>
                  )}
                  <span
                    title={roleLabel(role)}
                    className={`border border-white/10 bg-white/[0.04] text-zinc-400 ${PROJECT_CARD_BADGE_PAIR_ITEM}`}
                  >
                    {roleLabel(role)}
                  </span>
                </div>
                <button
                  type="button"
                  onClick={() => void handleOpen(project.id)}
                  disabled={isArchivedTab || openingProjectId !== null}
                  aria-busy={openingProjectId === project.id}
                  className="mt-4 w-full min-h-11 cursor-pointer rounded-xl border border-white/10 bg-white/[0.04] px-3 py-2.5 text-sm font-medium text-zinc-200 transition-colors hover:bg-white/[0.06] hover:text-white disabled:pointer-events-none disabled:cursor-not-allowed disabled:opacity-60 sm:min-h-0"
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

      {/* Rename modal (portal + centered: fixed внутри scroll-оболочки ломал позиционирование на мобилке) */}
      <CenteredModalPortal
        open={renameProject != null}
        portalReady={portalReady}
        onBackdropClose={() => {
          if (!renameLoading) setRenameProject(null);
        }}
      >
        {renameProject ? (
          <div
            className="w-full max-w-md max-h-[min(90dvh,90vh)] shrink-0 overflow-y-auto rounded-2xl border border-white/10 bg-zinc-900 p-5 shadow-xl sm:p-6"
            role="dialog"
            aria-modal="true"
            aria-labelledby="rename-title"
            onClick={(e) => e.stopPropagation()}
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
                className="mt-2 w-full rounded-xl border border-white/10 bg-white/[0.04] px-4 py-3 text-base text-white placeholder-zinc-500 focus:border-white/20 focus:outline-none sm:text-sm"
                placeholder="Название проекта"
                autoFocus
              />
            </div>
            {renameError && (
              <p className="mt-2 text-sm text-red-400">{renameError}</p>
            )}
            <div className="mt-6 flex flex-col-reverse gap-2.5 sm:flex-row sm:justify-end sm:gap-3">
              <button
                type="button"
                onClick={() => setRenameProject(null)}
                disabled={renameLoading}
                className={`${projectModalActionBtnClass} border border-white/10 text-zinc-300 hover:bg-white/10 disabled:pointer-events-none disabled:opacity-50`}
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={submitRename}
                disabled={!canSyncProjectMutations || renameLoading}
                aria-busy={renameLoading}
                className={`${projectModalActionBtnClass} bg-white/10 text-white hover:bg-white/15 disabled:pointer-events-none disabled:cursor-not-allowed disabled:opacity-50`}
              >
                {renameLoading ? "Подождите…" : "Save"}
              </button>
            </div>
          </div>
        ) : null}
      </CenteredModalPortal>

      {/* Archive modal */}
      <CenteredModalPortal
        open={archiveProject != null}
        portalReady={portalReady}
        onBackdropClose={() => {
          if (!archiveLoading) setArchiveProject(null);
        }}
      >
        {archiveProject ? (
          <div
            className="w-full max-w-md max-h-[min(90dvh,90vh)] shrink-0 overflow-y-auto rounded-2xl border border-amber-500/30 bg-zinc-900 p-5 shadow-xl sm:p-6"
            role="dialog"
            aria-modal="true"
            aria-labelledby="archive-title"
            onClick={(e) => e.stopPropagation()}
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
            <div className="mt-6 flex flex-col-reverse gap-2.5 sm:flex-row sm:justify-end sm:gap-3">
              <button
                type="button"
                onClick={() => setArchiveProject(null)}
                disabled={archiveLoading}
                className={`${projectModalActionBtnClass} border border-white/10 text-zinc-300 hover:bg-white/10 disabled:pointer-events-none disabled:opacity-50`}
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={submitArchive}
                disabled={archiveLoading}
                aria-busy={archiveLoading}
                className={`${projectModalActionBtnClass} bg-amber-600 text-white hover:bg-amber-500 disabled:pointer-events-none disabled:cursor-not-allowed disabled:opacity-50`}
              >
                {archiveLoading ? "Подождите…" : "Archive"}
              </button>
            </div>
          </div>
        ) : null}
      </CenteredModalPortal>

      {/* Transfer ownership modal (global) */}
      <CenteredModalPortal
        open={transferModalOpen}
        portalReady={portalReady}
        onBackdropClose={() => {
          if (!transferLoading) setTransferModalOpen(false);
        }}
      >
        {transferModalOpen ? (
          <div
            className="w-full max-w-md max-h-[min(90dvh,90vh)] shrink-0 overflow-y-auto rounded-2xl border border-red-500/30 bg-zinc-900 p-5 shadow-xl sm:p-6"
            role="dialog"
            aria-modal="true"
            aria-labelledby="transfer-title"
            onClick={(e) => e.stopPropagation()}
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
                <div className="mt-6 flex flex-col-reverse gap-2.5 sm:flex-row sm:justify-end sm:gap-3">
                  {transferStep === 2 ? (
                    <button
                      type="button"
                      onClick={() => setTransferStep(1)}
                      disabled={transferLoading}
                      className={`${projectModalActionBtnClass} border border-white/10 text-zinc-300 hover:bg-white/10 disabled:pointer-events-none disabled:opacity-50`}
                    >
                      Назад
                    </button>
                  ) : (
                    <button
                      type="button"
                      onClick={() => setTransferModalOpen(false)}
                      disabled={transferLoading}
                      className={`${projectModalActionBtnClass} border border-white/10 text-zinc-300 hover:bg-white/10 disabled:pointer-events-none disabled:opacity-50`}
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
                    className={`${projectModalActionBtnClass} bg-red-600 text-white hover:bg-red-500 disabled:pointer-events-none disabled:cursor-not-allowed disabled:opacity-50`}
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
        ) : null}
      </CenteredModalPortal>
    </div>
  );
}
