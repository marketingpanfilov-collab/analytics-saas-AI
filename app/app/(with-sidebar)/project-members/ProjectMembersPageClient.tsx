"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useBillingBootstrap } from "@/app/app/components/BillingBootstrapProvider";
import { billingActionAllowed } from "@/app/lib/billingBootstrapClient";
import { ActionId } from "@/app/lib/billingUiContract";
import { useRouter, useSearchParams } from "next/navigation";
import Link from "next/link";
import { supabase } from "@/app/lib/supabaseClient";

const ORG_ROLES_ALL_PROJECTS = ["owner", "admin"];
const ORG_ROLES_MANAGE = ["owner", "admin"];
const MEMBERS_MUTATION_BILLING_MSG =
  "Изменение состава участников недоступно при текущем статусе подписки или режиме доступа.";
const INVITE_SEAT_HINT =
  "Приглашение можно отправить заранее. Доступ к проекту активируется при принятии — по правилам тарифа и лимита мест.";
const ADD_MODAL_INVITE_SUCCESS_HINT =
  "Приглашение создано. Доступ активируется по правилам тарифа, когда человек примет ссылку.";
const PROJECT_ROLES = [
  { value: "project_admin", label: "Админ проекта" },
  { value: "marketer", label: "Маркетолог" },
  { value: "viewer", label: "Наблюдатель" },
] as const;

type MemberRow = {
  id: string;
  project_id: string;
  user_id: string;
  role: string;
  created_at: string;
  email: string | null;
};

type InviteRow = {
  id: string;
  project_id: string;
  email: string | null;
  role: string;
  invite_type: string;
  token: string;
  status: string;
  expires_at: string;
  created_at: string;
};

function formatJoined(iso: string): string {
  try {
    return new Date(iso).toLocaleDateString("ru-RU", {
      day: "numeric",
      month: "short",
      year: "numeric",
    });
  } catch {
    return "—";
  }
}

function formatDateTime(iso: string): string {
  try {
    return new Date(iso).toLocaleString("ru-RU", {
      day: "numeric",
      month: "short",
      hour: "2-digit",
      minute: "2-digit",
    });
  } catch {
    return "—";
  }
}

const COPY_FEEDBACK_ADD_MODAL = "add-modal";
const COPY_FEEDBACK_EMAIL_FALLBACK = "email-fallback";
const COPY_FEEDBACK_LINK_MODAL = "link-modal";

function InviteUrlFlashBox({ url, copied }: { url: string; copied: boolean }) {
  return (
    <div
      className={`rounded-xl px-4 transition-all duration-300 ease-out ${
        copied
          ? "flex min-h-[120px] items-center justify-center border-2 border-emerald-500/70 bg-emerald-500/[0.18] py-6 shadow-[0_0_28px_rgba(16,185,129,0.2)]"
          : "min-h-[108px] border border-white/10 bg-white/[0.04] py-8 text-center"
      }`}
    >
      {copied ? (
        <p className="m-0 text-center text-sm font-semibold text-emerald-200">Ссылка скопирована</p>
      ) : (
        <p className="m-0 text-left text-sm leading-relaxed text-zinc-300 break-all">{url}</p>
      )}
    </div>
  );
}

export type ProjectMembersPageClientProps = {
  /** Встроенный блок (например раздел «Управление доступом» в настройках) — без лишних отступов контейнера */
  variant?: "page" | "embedded";
};

export default function ProjectMembersPageClient({ variant = "page" }: ProjectMembersPageClientProps) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const projectId = searchParams.get("project_id")?.trim() ?? "";
  const isEmbedded = variant === "embedded";
  const { resolvedUi, reloadBootstrap } = useBillingBootstrap();
  const canMutateProjectMembers = useMemo(
    () => billingActionAllowed(resolvedUi, ActionId.manage_project_members),
    [resolvedUi]
  );

  const [loading, setLoading] = useState(true);
  const [allowed, setAllowed] = useState(false);
  const [members, setMembers] = useState<MemberRow[]>([]);
  const [currentUserId, setCurrentUserId] = useState<string | null>(null);
  const [currentUserProjectRole, setCurrentUserProjectRole] = useState<string | null>(null);
  const [modalOpen, setModalOpen] = useState(false);
  const [addEmail, setAddEmail] = useState("");
  const [addRole, setAddRole] = useState<string>("marketer");
  const [addError, setAddError] = useState<string | null>(null);
  const [addLoading, setAddLoading] = useState(false);
  /** После успешного create invite из модалки (бывш. «прямое добавление»). */
  const [addModalInviteUrl, setAddModalInviteUrl] = useState<string | null>(null);
  const [addModalEmailSent, setAddModalEmailSent] = useState(false);
  const [actionLoadingId, setActionLoadingId] = useState<string | null>(null);

  const [tab, setTab] = useState<"members" | "invites">("members");
  const [invites, setInvites] = useState<InviteRow[]>([]);
  const [inviteEmail, setInviteEmail] = useState("");
  const [inviteRole, setInviteRole] = useState<string>("marketer");
  const [inviteByEmailModal, setInviteByEmailModal] = useState(false);
  const [inviteByEmailLoading, setInviteByEmailLoading] = useState(false);
  const [inviteByEmailError, setInviteByEmailError] = useState<string | null>(null);
  const [inviteByEmailFallbackUrl, setInviteByEmailFallbackUrl] = useState<string | null>(null);
  const [inviteByEmailSentToInbox, setInviteByEmailSentToInbox] = useState(false);
  const [inviteByLinkModal, setInviteByLinkModal] = useState(false);
  const [inviteByLinkUrl, setInviteByLinkUrl] = useState<string | null>(null);
  const [inviteByLinkLoading, setInviteByLinkLoading] = useState(false);
  const [inviteByLinkRole, setInviteByLinkRole] = useState<string>("marketer");
  const [revokeLoadingId, setRevokeLoadingId] = useState<string | null>(null);

  const copyFeedbackTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [inviteLinkCopiedKey, setInviteLinkCopiedKey] = useState<string | null>(null);

  const resetInviteCopyFeedback = useCallback(() => {
    if (copyFeedbackTimerRef.current) {
      clearTimeout(copyFeedbackTimerRef.current);
      copyFeedbackTimerRef.current = null;
    }
    setInviteLinkCopiedKey(null);
  }, []);

  useEffect(() => {
    return () => {
      if (copyFeedbackTimerRef.current) clearTimeout(copyFeedbackTimerRef.current);
    };
  }, []);

  const fetchMembers = useCallback(async () => {
    if (!projectId) return;
    const res = await fetch(
      `/api/project-members/list?project_id=${encodeURIComponent(projectId)}`,
      { cache: "no-store" }
    );
    const json = (await res.json()) as { success?: boolean; members?: MemberRow[] };
    if (json?.success && Array.isArray(json.members)) {
      setMembers(json.members);
    } else {
      setMembers([]);
    }
  }, [projectId]);

  const fetchInvites = useCallback(async () => {
    if (!projectId) return;
    const res = await fetch(
      `/api/project-invites/list?project_id=${encodeURIComponent(projectId)}`,
      { cache: "no-store" }
    );
    const json = (await res.json()) as { success?: boolean; invites?: InviteRow[] };
    if (json?.success && Array.isArray(json.invites)) {
      setInvites(json.invites);
    } else {
      setInvites([]);
    }
  }, [projectId]);

  useEffect(() => {
    if (!projectId) {
      router.replace("/app/projects");
      return;
    }
    let mounted = true;

    (async () => {
      const { data: { user: u } } = await supabase.auth.getUser();
      if (!mounted) return;
      if (!u) {
        router.replace("/login");
        return;
      }

      const { data: mem } = await supabase
        .from("organization_members")
        .select("organization_id, role")
        .eq("user_id", u.id)
        .maybeSingle();

      if (!mounted) return;
      if (!mem) {
        router.replace(`/app?project_id=${encodeURIComponent(projectId)}`);
        return;
      }

      const orgRole = (mem.role ?? "member") as string;
      let allowedIds: string[] = [];

      if (ORG_ROLES_ALL_PROJECTS.includes(orgRole)) {
        const { data: projs } = await supabase
          .from("projects")
          .select("id")
          .eq("organization_id", mem.organization_id);
        allowedIds = (projs ?? []).map((p: { id: string }) => p.id);
      } else {
        const { data: pms } = await supabase
          .from("project_members")
          .select("project_id")
          .eq("user_id", u.id);
        allowedIds = (pms ?? []).map((r: { project_id: string }) => r.project_id);
      }

      if (!mounted) return;
      if (!allowedIds.includes(projectId)) {
        router.replace(`/app?project_id=${encodeURIComponent(projectId)}`);
        return;
      }

      const canManage =
        ORG_ROLES_MANAGE.includes(orgRole) ||
        (await (async () => {
          const { data: pm } = await supabase
            .from("project_members")
            .select("role")
            .eq("project_id", projectId)
            .eq("user_id", u.id)
            .maybeSingle();
          return pm?.role === "project_admin";
        })());

      if (!mounted) return;
      if (!canManage) {
        router.replace(`/app?project_id=${encodeURIComponent(projectId)}`);
        return;
      }

      setCurrentUserId(u.id);
      const { data: pm } = await supabase
        .from("project_members")
        .select("role")
        .eq("project_id", projectId)
        .eq("user_id", u.id)
        .maybeSingle();
      if (mounted) setCurrentUserProjectRole(pm?.role ?? null);
      setAllowed(true);
      setLoading(false);
      await fetchMembers();
      await fetchInvites();
    })();

    return () => {
      mounted = false;
    };
  }, [projectId, router, fetchMembers, fetchInvites]);

  const handleRoleChange = useCallback(
    async (memberId: string, newRole: string) => {
      if (!canMutateProjectMembers) return;
      setActionLoadingId(memberId);
      const { error } = await supabase
        .from("project_members")
        .update({ role: newRole })
        .eq("id", memberId);
      setActionLoadingId(null);
      if (!error) {
        await fetchMembers();
        void reloadBootstrap();
      }
    },
    [fetchMembers, canMutateProjectMembers, reloadBootstrap]
  );

  const handleRemove = useCallback(
    async (row: MemberRow) => {
      if (!canMutateProjectMembers) return;
      if (row.user_id === currentUserId && row.role === "project_admin") return;
      setActionLoadingId(row.id);
      const { error } = await supabase.from("project_members").delete().eq("id", row.id);
      setActionLoadingId(null);
      if (!error) {
        await fetchMembers();
        void reloadBootstrap();
      }
    },
    [currentUserId, fetchMembers, canMutateProjectMembers, reloadBootstrap]
  );

  const handleAddSubmit = useCallback(
    async (e: React.FormEvent) => {
      e.preventDefault();
      if (!allowed) return;
      const email = addEmail.trim().toLowerCase();
      if (!email) {
        setAddError("Введите email");
        return;
      }
      setAddError(null);
      setAddLoading(true);

      const lookup = await fetch(`/api/users/by-email?email=${encodeURIComponent(email)}`, {
        cache: "no-store",
      });
      const looked = (await lookup.json()) as { success?: boolean; user?: { id: string; email: string | null } };
      if (looked?.success && looked?.user?.id && members.some((m) => m.user_id === looked.user!.id)) {
        setAddLoading(false);
        setAddError("Пользователь уже добавлен в проект");
        return;
      }

      const res = await fetch("/api/project-invites/create", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          project_id: projectId,
          invite_type: "email",
          email,
          role: addRole,
        }),
      });
      const json = (await res.json()) as {
        success?: boolean;
        error?: string;
        invite_url?: string;
        email_sent?: boolean;
      };

      setAddLoading(false);
      if (!json?.success) {
        setAddError(json?.error ?? "Не удалось создать приглашение");
        return;
      }

      setAddModalEmailSent(json.email_sent === true);
      if (json.invite_url) {
        resetInviteCopyFeedback();
        setAddModalInviteUrl(json.invite_url);
      }
      setAddError(null);
      await fetchInvites();
      void reloadBootstrap();
    },
    [addEmail, addRole, projectId, members, fetchInvites, allowed, reloadBootstrap, resetInviteCopyFeedback]
  );

  const handleInviteByEmail = useCallback(
    async (e: React.FormEvent) => {
      e.preventDefault();
      if (!allowed) return;
      const email = inviteEmail.trim().toLowerCase();
      if (!email) {
        setInviteByEmailError("Введите email");
        return;
      }
      setInviteByEmailError(null);
      setInviteByEmailFallbackUrl(null);
      resetInviteCopyFeedback();
      setInviteByEmailLoading(true);
      const res = await fetch("/api/project-invites/create", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ project_id: projectId, invite_type: "email", email, role: inviteRole }),
      });
      const json = (await res.json()) as {
        success?: boolean;
        error?: string;
        invite_url?: string;
        email_sent?: boolean;
      };
      setInviteByEmailLoading(false);
      if (json?.success) {
        setInviteByEmailSentToInbox(json.email_sent === true);
        if (json?.invite_url) {
          setInviteByEmailFallbackUrl(json.invite_url);
          await fetchInvites();
        } else {
          resetInviteCopyFeedback();
          setInviteByEmailModal(false);
          setInviteEmail("");
          setInviteRole("marketer");
          setInviteByEmailFallbackUrl(null);
          await fetchInvites();
        }
        void reloadBootstrap();
      } else if (json?.invite_url) {
        setInviteByEmailSentToInbox(json.email_sent === true);
        setInviteByEmailFallbackUrl(json.invite_url);
        await fetchInvites();
        void reloadBootstrap();
      } else {
        setInviteByEmailError(json?.error ?? "Ошибка создания приглашения");
      }
    },
    [projectId, inviteEmail, inviteRole, fetchInvites, allowed, reloadBootstrap, resetInviteCopyFeedback]
  );

  const handleInviteByLink = useCallback(async () => {
    if (!allowed) return;
    setInviteByLinkLoading(true);
    setInviteByLinkUrl(null);
    resetInviteCopyFeedback();
    const res = await fetch("/api/project-invites/create", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ project_id: projectId, invite_type: "link", role: inviteByLinkRole }),
    });
    const json = await res.json();
    setInviteByLinkLoading(false);
    if (json?.success && json?.invite_url) {
      setInviteByLinkUrl(json.invite_url);
      await fetchInvites();
      // Не вызываем reloadBootstrap(): он ставит loading=true на весь шелл и при смене fingerprint
      // шлёт broadcast → второй runBootstrap — визуально как «перезагрузка» страницы. Список приглашений уже обновлён.
    }
  }, [projectId, inviteByLinkRole, fetchInvites, allowed, resetInviteCopyFeedback]);

  const handleRevokeInvite = useCallback(
    async (inviteId: string) => {
      if (!allowed) return;
      setRevokeLoadingId(inviteId);
      const res = await fetch("/api/project-invites/revoke", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ invite_id: inviteId }),
      });
      setRevokeLoadingId(null);
      if (res.ok) {
        await fetchInvites();
        void reloadBootstrap();
      }
    },
    [fetchInvites, allowed, reloadBootstrap]
  );

  const copyInviteLink = useCallback(
    (url: string, feedbackKey: string) => {
      const full = url.startsWith("http") ? url : `${typeof window !== "undefined" ? window.location.origin : ""}${url}`;
      void navigator.clipboard.writeText(full).then(
        () => {
          if (copyFeedbackTimerRef.current) clearTimeout(copyFeedbackTimerRef.current);
          setInviteLinkCopiedKey(feedbackKey);
          copyFeedbackTimerRef.current = setTimeout(() => {
            setInviteLinkCopiedKey(null);
            copyFeedbackTimerRef.current = null;
          }, 2200);
        },
        () => {}
      );
    },
    []
  );

  if (loading || !allowed) {
    return (
      <div className={isEmbedded ? "" : "mx-auto max-w-4xl p-6"}>
        <div className="h-10 w-64 rounded-2xl bg-white/[0.04]" />
        <div
          className={
            isEmbedded
              ? "settings-surface mt-6 h-48"
              : "mt-6 h-48 rounded-2xl border border-white/10 bg-white/[0.03]"
          }
        />
      </div>
    );
  }

  const tableFrame = isEmbedded
    ? "settings-surface overflow-hidden"
    : "rounded-2xl border border-white/10 bg-white/[0.03] overflow-hidden";

  const membersBillingBlockedNotice =
    !canMutateProjectMembers ? (
      <div
        className={
          isEmbedded
            ? "rounded-lg border border-amber-500/25 bg-amber-500/10 px-4 py-3 text-sm text-amber-100/90"
            : "rounded-xl border border-amber-500/25 bg-amber-500/10 px-4 py-3 text-sm text-amber-100/90"
        }
        role="status"
      >
        {MEMBERS_MUTATION_BILLING_MSG}
      </div>
    ) : null;

  const openAddMemberModal = () => {
    resetInviteCopyFeedback();
    setModalOpen(true);
    setAddError(null);
    setAddEmail("");
    setAddRole("marketer");
    setAddModalInviteUrl(null);
    setAddModalEmailSent(false);
  };

  const invitesTableInner =
    invites.length === 0 ? (
      <div className="py-12 text-center text-sm text-zinc-400">
        Нет активных приглашений. Создайте приглашение по email или ссылке.
      </div>
    ) : (
      <div className="overflow-x-auto">
        <table className="w-full min-w-[560px]">
          <thead>
            <tr className="border-b border-white/10">
              <th className="px-4 py-3 text-left text-xs font-medium uppercase tracking-wider text-zinc-500">
                Кому / тип
              </th>
              <th className="px-4 py-3 text-left text-xs font-medium uppercase tracking-wider text-zinc-500">
                Роль
              </th>
              <th className="px-4 py-3 text-left text-xs font-medium uppercase tracking-wider text-zinc-500">
                Создано
              </th>
              <th className="px-4 py-3 text-left text-xs font-medium uppercase tracking-wider text-zinc-500">
                Истекает
              </th>
              <th className="px-4 py-3 text-left text-xs font-medium uppercase tracking-wider text-zinc-500">
                Статус
              </th>
              <th className="px-4 py-3 text-right text-xs font-medium uppercase tracking-wider text-zinc-500">
                Действия
              </th>
            </tr>
          </thead>
          <tbody>
            {invites.map((inv) => {
              const isPending = inv.status === "pending";
              const busy = revokeLoadingId === inv.id;
              const inviteUrl =
                inv.invite_type === "link" && inv.token
                  ? `${typeof window !== "undefined" ? window.location.origin : ""}/app/invite/accept?token=${encodeURIComponent(inv.token)}`
                  : null;
              return (
                <tr key={inv.id} className="border-b border-white/5 hover:bg-white/[0.04]">
                  <td className="px-4 py-3 text-sm text-white">
                    {inv.invite_type === "link" ? "Ссылка" : inv.email ?? "—"}
                  </td>
                  <td className="px-4 py-3 text-sm text-zinc-300">
                    {PROJECT_ROLES.find((r) => r.value === inv.role)?.label ?? inv.role}
                  </td>
                  <td className="px-4 py-3 text-sm text-zinc-400">{formatDateTime(inv.created_at)}</td>
                  <td className="px-4 py-3 text-sm text-zinc-400">{formatDateTime(inv.expires_at)}</td>
                  <td className="px-4 py-3 text-sm text-zinc-400">{inv.status}</td>
                  <td className="px-4 py-3 text-right">
                    {inviteUrl && isPending && (
                      inviteLinkCopiedKey === `invite-row:${inv.id}` ? (
                        <span className="mr-2 inline-flex rounded-lg border border-emerald-500/45 bg-emerald-500/15 px-3 py-1.5 text-xs font-medium text-emerald-200">
                          Ссылка скопирована
                        </span>
                      ) : (
                        <button
                          type="button"
                          onClick={() => copyInviteLink(inviteUrl, `invite-row:${inv.id}`)}
                          className="mr-2 rounded-lg border border-white/10 px-2 py-1 text-xs text-zinc-300 hover:bg-white/10"
                        >
                          Копировать ссылку
                        </button>
                      )
                    )}
                    {isPending && (
                      <button
                        type="button"
                        onClick={() => handleRevokeInvite(inv.id)}
                        disabled={busy || !allowed}
                        className="rounded-lg border border-white/10 px-2 py-1 text-xs text-zinc-300 hover:bg-white/10 disabled:opacity-50"
                      >
                        Отозвать
                      </button>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    );

  const membersTableInner =
    members.length === 0 ? (
      <div className="flex flex-col items-center justify-center py-16 px-6 text-center">
        <p className="max-w-md text-zinc-400">
          В этом проекте пока нет участников. Лимит мест считается по всей организации: пользователи в других проектах
          тоже учитываются — см. раздел «Участники организации».
        </p>
        <button
          type="button"
          onClick={openAddMemberModal}
          disabled={!allowed}
          title={!allowed ? undefined : "Создать приглашение по email"}
          className={
            isEmbedded
              ? "settings-primary-btn mt-4 disabled:cursor-not-allowed disabled:opacity-50"
              : "mt-4 inline-flex h-10 items-center rounded-xl bg-white/10 px-5 text-sm font-medium text-white hover:bg-white/15 disabled:cursor-not-allowed disabled:opacity-50"
          }
        >
          Пригласить первого участника
        </button>
      </div>
    ) : (
      <div className="overflow-x-auto">
        <table className="w-full min-w-[500px]">
          <thead>
            <tr className="border-b border-white/10">
              <th className="px-4 py-3 text-left text-xs font-medium uppercase tracking-wider text-zinc-500">
                Пользователь
              </th>
              <th className="px-4 py-3 text-left text-xs font-medium uppercase tracking-wider text-zinc-500">
                Роль
              </th>
              <th className="px-4 py-3 text-left text-xs font-medium uppercase tracking-wider text-zinc-500">
                Добавлен
              </th>
              <th className="px-4 py-3 text-right text-xs font-medium uppercase tracking-wider text-zinc-500">
                Действия
              </th>
            </tr>
          </thead>
          <tbody>
            {members.map((row) => {
              const isSelf = row.user_id === currentUserId;
              const cannotRemove = isSelf && row.role === "project_admin";
              const busy = actionLoadingId === row.id;
              return (
                <tr
                  key={row.id}
                  className="border-b border-white/5 transition-colors hover:bg-white/[0.04]"
                >
                  <td className="px-4 py-3">
                    <div className="flex items-center gap-3">
                      <div
                        className="h-9 w-9 shrink-0 rounded-full bg-white/10 flex items-center justify-center text-sm font-medium text-zinc-300"
                        aria-hidden
                      >
                        {(row.email ?? row.user_id).slice(0, 1).toUpperCase()}
                      </div>
                      <span className="text-sm text-white">
                        {row.email ?? row.user_id}
                      </span>
                    </div>
                  </td>
                  <td className="px-4 py-3">
                    <select
                      value={row.role}
                      onChange={(e) => handleRoleChange(row.id, e.target.value)}
                      disabled={busy || !canMutateProjectMembers}
                      className={
                        isEmbedded
                          ? "settings-page-select settings-page-select-sm min-w-[10rem] disabled:opacity-50"
                          : "rounded-lg border border-white/10 bg-white/[0.04] px-3 py-2 text-sm text-white focus:border-white/20 focus:outline-none disabled:opacity-50"
                      }
                    >
                      {PROJECT_ROLES.map((r) => (
                        <option key={r.value} value={r.value}>
                          {r.label}
                        </option>
                      ))}
                    </select>
                  </td>
                  <td className="px-4 py-3 text-sm text-zinc-400">
                    {formatJoined(row.created_at)}
                  </td>
                  <td className="px-4 py-3 text-right">
                    <button
                      type="button"
                      onClick={() => handleRemove(row)}
                      disabled={cannotRemove || busy || !canMutateProjectMembers}
                      className="rounded-lg border border-white/10 px-3 py-1.5 text-xs font-medium text-zinc-300 hover:bg-white/10 hover:text-white disabled:opacity-50 disabled:cursor-not-allowed"
                    >
                      Удалить
                    </button>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    );

  return (
    <div className={isEmbedded ? "space-y-6" : "mx-auto max-w-4xl space-y-8 p-6"}>
      {isEmbedded ? (
        <section className="settings-surface" style={{ padding: 0 }}>
          <div style={{ padding: "20px 20px 0 20px" }}>
            <h2 style={{ fontSize: 16, fontWeight: 700, color: "#fff", margin: 0 }}>Участники проекта</h2>
            <p style={{ marginTop: 6, fontSize: 13, color: "rgba(255,255,255,0.72)", marginBottom: 16 }}>
              Управляйте доступом к этому проекту
            </p>
            <div
              style={{
                display: "flex",
                flexWrap: "wrap",
                alignItems: "center",
                justifyContent: "space-between",
                gap: 12,
                borderBottom: "1px solid rgba(255,255,255,0.1)",
                paddingBottom: 12,
              }}
            >
              <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
                <button
                  type="button"
                  onClick={() => setTab("members")}
                  data-active={tab === "members" ? "true" : undefined}
                  className="settings-subtab-btn"
                >
                  Участники
                </button>
                <button
                  type="button"
                  onClick={() => setTab("invites")}
                  data-active={tab === "invites" ? "true" : undefined}
                  className="settings-subtab-btn"
                >
                  Приглашения
                </button>
              </div>
              {tab === "members" && (
                <button
                  type="button"
                  onClick={openAddMemberModal}
                  disabled={!allowed}
                  className="settings-primary-btn shrink-0 disabled:cursor-not-allowed disabled:opacity-50"
                >
                  Пригласить
                </button>
              )}
            </div>
          </div>

          {tab === "members" && !canMutateProjectMembers && (
            <div style={{ padding: "0 20px 12px" }}>{membersBillingBlockedNotice}</div>
          )}

          {tab === "invites" && (
            <>
              <div style={{ padding: "16px 20px" }} className="flex flex-col gap-3">
                <div className="flex flex-wrap gap-3">
                  <button
                    type="button"
                    onClick={() => {
                      resetInviteCopyFeedback();
                      setInviteByEmailModal(true);
                      setInviteByEmailError(null);
                      setInviteByEmailFallbackUrl(null);
                      setInviteByEmailSentToInbox(false);
                      setInviteEmail("");
                      setInviteRole("marketer");
                    }}
                    disabled={!allowed}
                    className="settings-primary-btn disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    Пригласить по email
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      resetInviteCopyFeedback();
                      setInviteByLinkModal(true);
                      setInviteByLinkUrl(null);
                      setInviteByLinkRole("marketer");
                    }}
                    disabled={!allowed}
                    className="settings-secondary-btn disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    Создать ссылку
                  </button>
                </div>
                <p style={{ margin: 0, fontSize: 12, color: "rgba(255,255,255,0.55)", maxWidth: 520 }}>
                  {INVITE_SEAT_HINT}
                </p>
              </div>
              <div className="border-t border-white/10 overflow-hidden">{invitesTableInner}</div>
            </>
          )}

          {tab === "members" && (
            <div className="border-t border-white/10 overflow-x-auto">{membersTableInner}</div>
          )}
        </section>
      ) : (
        <>
          <header className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
            <div>
              <h1 className="text-2xl font-semibold tracking-tight text-white">
                Участники проекта
              </h1>
              <p className="mt-1 text-sm text-zinc-400">
                Управляйте доступом к этому проекту
              </p>
            </div>
            {tab === "members" && (
              <button
                type="button"
                onClick={openAddMemberModal}
                disabled={!allowed}
                className="inline-flex h-10 items-center rounded-xl bg-white/10 px-5 text-sm font-medium text-white hover:bg-white/15 disabled:cursor-not-allowed disabled:opacity-50"
              >
                Пригласить
              </button>
            )}
          </header>

          <div className="flex gap-2 border-b border-white/10">
            <button
              type="button"
              onClick={() => setTab("members")}
              className={`px-4 py-2 text-sm font-medium ${tab === "members" ? "text-white border-b-2 border-white/30" : "text-zinc-400 hover:text-white"}`}
            >
              Участники
            </button>
            <button
              type="button"
              onClick={() => setTab("invites")}
              className={`px-4 py-2 text-sm font-medium ${tab === "invites" ? "text-white border-b-2 border-white/30" : "text-zinc-400 hover:text-white"}`}
            >
              Приглашения
            </button>
          </div>

          {tab === "members" && !canMutateProjectMembers && (
            <div className="mt-4">{membersBillingBlockedNotice}</div>
          )}
        </>
      )}

      {!isEmbedded && tab === "invites" && (
        <>
          <div className="flex flex-col gap-2">
            <div className="flex flex-wrap gap-3">
              <button
                type="button"
                onClick={() => {
                  resetInviteCopyFeedback();
                  setInviteByEmailModal(true);
                  setInviteByEmailError(null);
                  setInviteByEmailFallbackUrl(null);
                  setInviteByEmailSentToInbox(false);
                  setInviteEmail("");
                  setInviteRole("marketer");
                }}
                disabled={!allowed}
                className="inline-flex h-10 items-center rounded-xl bg-white/10 px-5 text-sm font-medium text-white hover:bg-white/15 disabled:cursor-not-allowed disabled:opacity-50"
              >
                Пригласить по email
              </button>
              <button
                type="button"
                onClick={() => {
                  resetInviteCopyFeedback();
                  setInviteByLinkModal(true);
                  setInviteByLinkUrl(null);
                  setInviteByLinkRole("marketer");
                }}
                disabled={!allowed}
                className="inline-flex h-10 items-center rounded-xl border border-white/10 px-5 text-sm font-medium text-zinc-300 hover:bg-white/[0.04] disabled:cursor-not-allowed disabled:opacity-50"
              >
                Создать ссылку
              </button>
            </div>
            <p className="text-xs text-zinc-500 max-w-xl">{INVITE_SEAT_HINT}</p>
          </div>
          <div className={tableFrame}>{invitesTableInner}</div>
        </>
      )}

      {!isEmbedded && tab === "members" && (
        <div className="space-y-4">
          {!canMutateProjectMembers && membersBillingBlockedNotice}
          <div className={tableFrame}>{membersTableInner}</div>
        </div>
      )}

      {!isEmbedded && (
        <div>
          <Link
            href={`/app?project_id=${encodeURIComponent(projectId)}`}
            className="text-sm text-zinc-400 hover:text-white"
          >
            ← Назад к дашборду
          </Link>
        </div>
      )}

      {modalOpen && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4"
          onClick={() => {
            if (!addLoading) {
              resetInviteCopyFeedback();
              setModalOpen(false);
            }
          }}
          role="dialog"
          aria-modal="true"
        >
          <div
            className="w-full max-w-md rounded-2xl border border-white/10 bg-[#0b0b10] p-6 shadow-xl"
            onClick={(e) => e.stopPropagation()}
          >
            <h2 className="text-lg font-semibold text-white">Пригласить в проект</h2>
            <p className="mt-1 text-sm text-zinc-500">{INVITE_SEAT_HINT}</p>
            {addModalInviteUrl ? (
              <div className="mt-6 space-y-4">
                {addModalEmailSent ? (
                  <>
                    <p className="text-sm text-emerald-300/95">
                      Письмо отправлено на <span className="font-medium text-white">{addEmail}</span> с кнопкой
                      «Принять приглашение» и данными проекта.
                    </p>
                    <p className="text-xs text-zinc-500">Резервная ссылка ниже, если письма нет (в т.ч. «Спам»).</p>
                  </>
                ) : (
                  <p className="text-sm text-zinc-400">
                    {ADD_MODAL_INVITE_SUCCESS_HINT} Письмо не отправлено — настройте SMTP или отправьте ссылку
                    вручную.
                  </p>
                )}
                <InviteUrlFlashBox
                  url={addModalInviteUrl}
                  copied={inviteLinkCopiedKey === COPY_FEEDBACK_ADD_MODAL}
                />
                <button
                  type="button"
                  onClick={() => addModalInviteUrl && copyInviteLink(addModalInviteUrl, COPY_FEEDBACK_ADD_MODAL)}
                  className="w-full rounded-xl bg-white/10 py-2.5 text-sm font-medium text-white hover:bg-white/15"
                >
                  Копировать ссылку
                </button>
                <button
                  type="button"
                  onClick={() => {
                    resetInviteCopyFeedback();
                    setModalOpen(false);
                    setAddModalInviteUrl(null);
                    setAddModalEmailSent(false);
                    setAddEmail("");
                    setAddRole("marketer");
                  }}
                  className="w-full rounded-xl border border-white/10 py-2.5 text-sm text-zinc-300 hover:bg-white/[0.04]"
                >
                  Закрыть
                </button>
              </div>
            ) : (
              <form onSubmit={handleAddSubmit} className="mt-6 space-y-4">
                <div>
                  <label className="block text-sm font-medium text-zinc-300">Email</label>
                  <input
                    type="email"
                    value={addEmail}
                    onChange={(e) => {
                      setAddEmail(e.target.value);
                      if (addError) setAddError(null);
                    }}
                    placeholder="user@example.com"
                    className="mt-2 w-full rounded-xl border border-white/10 bg-white/[0.04] px-4 py-3 text-sm text-white placeholder-zinc-500 focus:border-white/20 focus:outline-none"
                    autoFocus
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-zinc-300">Роль</label>
                  <select
                    value={addRole}
                    onChange={(e) => setAddRole(e.target.value)}
                    className="mt-2 w-full rounded-xl border border-white/10 bg-white/[0.04] px-4 py-3 text-sm text-white focus:border-white/20 focus:outline-none"
                  >
                    {PROJECT_ROLES.map((r) => (
                      <option key={r.value} value={r.value}>
                        {r.label}
                      </option>
                    ))}
                  </select>
                </div>
                {addError && <p className="text-sm text-red-400">{addError}</p>}
                <div className="flex flex-wrap gap-3 pt-2">
                  <button
                    type="submit"
                    disabled={addLoading || !allowed}
                    className="h-11 rounded-xl bg-white/10 px-6 text-sm font-medium text-white hover:bg-white/15 disabled:opacity-50"
                  >
                    {addLoading ? "Создание…" : "Создать приглашение"}
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      if (!addLoading) {
                        resetInviteCopyFeedback();
                        setModalOpen(false);
                      }
                    }}
                    className="h-11 rounded-xl border border-white/10 px-6 text-sm text-zinc-300 hover:bg-white/[0.04]"
                  >
                    Отмена
                  </button>
                </div>
              </form>
            )}
          </div>
        </div>
      )}

      {inviteByEmailModal && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4"
          onClick={() => {
            if (!inviteByEmailLoading) {
              resetInviteCopyFeedback();
              setInviteByEmailModal(false);
              setInviteByEmailFallbackUrl(null);
              setInviteByEmailSentToInbox(false);
            }
          }}
          role="dialog"
          aria-modal="true"
        >
          <div
            className="w-full max-w-md rounded-2xl border border-white/10 bg-[#0b0b10] p-6 shadow-xl"
            onClick={(e) => e.stopPropagation()}
          >
            <h2 className="text-lg font-semibold text-white">Пригласить по email</h2>
            {inviteByEmailFallbackUrl ? (
              <div className="mt-6 space-y-4">
                {inviteByEmailSentToInbox ? (
                  <>
                    <p className="text-sm text-emerald-300/95">
                      Письмо отправлено на <span className="font-medium text-white">{inviteEmail}</span>. В письме —
                      название проекта, роль и кнопка «Принять приглашение».
                    </p>
                    <p className="text-xs text-zinc-500">
                      Нет во «Входящих»? Проверьте «Спам». Ниже — резервная ссылка.
                    </p>
                  </>
                ) : (
                  <p className="text-sm text-zinc-400">
                    Приглашение создано. Письмо не отправлено (проверьте SMTP в окружении сервера). Отправьте ссылку
                    вручную.
                  </p>
                )}
                <InviteUrlFlashBox
                  url={inviteByEmailFallbackUrl}
                  copied={inviteLinkCopiedKey === COPY_FEEDBACK_EMAIL_FALLBACK}
                />
                <button
                  type="button"
                  onClick={() =>
                    inviteByEmailFallbackUrl &&
                    copyInviteLink(inviteByEmailFallbackUrl, COPY_FEEDBACK_EMAIL_FALLBACK)
                  }
                  className="w-full rounded-xl bg-white/10 py-2.5 text-sm font-medium text-white hover:bg-white/15"
                >
                  Копировать ссылку
                </button>
                <button
                  type="button"
                  onClick={() => {
                    resetInviteCopyFeedback();
                    setInviteByEmailModal(false);
                    setInviteByEmailFallbackUrl(null);
                    setInviteByEmailSentToInbox(false);
                  }}
                  className="w-full rounded-xl border border-white/10 py-2.5 text-sm text-zinc-300 hover:bg-white/[0.04]"
                >
                  Закрыть
                </button>
              </div>
            ) : (
              <form onSubmit={handleInviteByEmail} className="mt-6 space-y-4">
                <div>
                  <label className="block text-sm font-medium text-zinc-300">Email</label>
                  <input
                    type="email"
                    value={inviteEmail}
                    onChange={(e) => {
                      setInviteEmail(e.target.value);
                      if (inviteByEmailError) setInviteByEmailError(null);
                    }}
                    placeholder="user@example.com"
                    className="mt-2 w-full rounded-xl border border-white/10 bg-white/[0.04] px-4 py-3 text-sm text-white placeholder-zinc-500 focus:border-white/20 focus:outline-none"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-zinc-300">Роль</label>
                  <select
                    value={inviteRole}
                    onChange={(e) => setInviteRole(e.target.value)}
                    className="mt-2 w-full rounded-xl border border-white/10 bg-white/[0.04] px-4 py-3 text-sm text-white focus:border-white/20 focus:outline-none"
                  >
                    {PROJECT_ROLES.map((r) => (
                      <option key={r.value} value={r.value}>{r.label}</option>
                    ))}
                  </select>
                </div>
                {inviteByEmailError && <p className="text-sm text-red-400">{inviteByEmailError}</p>}
                <div className="flex gap-3 pt-2">
                  <button
                    type="submit"
                    disabled={inviteByEmailLoading || !allowed}
                    className="h-11 rounded-xl bg-white/10 px-6 text-sm font-medium text-white hover:bg-white/15 disabled:opacity-50"
                  >
                    {inviteByEmailLoading ? "Создание…" : "Создать приглашение"}
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      if (!inviteByEmailLoading) {
                        resetInviteCopyFeedback();
                        setInviteByEmailModal(false);
                        setInviteByEmailFallbackUrl(null);
                      }
                    }}
                    className="h-11 rounded-xl border border-white/10 px-6 text-sm text-zinc-300 hover:bg-white/[0.04]"
                  >
                    Отмена
                  </button>
                </div>
              </form>
            )}
          </div>
        </div>
      )}

      {inviteByLinkModal && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4"
          onClick={() => {
            resetInviteCopyFeedback();
            setInviteByLinkModal(false);
          }}
          role="dialog"
          aria-modal="true"
        >
          <div
            className="w-full max-w-md rounded-2xl border border-white/10 bg-[#0b0b10] p-6 shadow-xl"
            onClick={(e) => e.stopPropagation()}
          >
            <h2 className="text-lg font-semibold text-white">Приглашение по ссылке</h2>
            <p className="mt-1 text-sm text-zinc-400">Ссылка действительна 30 минут.</p>
            {!inviteByLinkUrl ? (
              <div className="mt-6 space-y-4">
                <div>
                  <label className="block text-sm font-medium text-zinc-300">Роль</label>
                  <select
                    value={inviteByLinkRole}
                    onChange={(e) => setInviteByLinkRole(e.target.value)}
                    className="mt-2 w-full rounded-xl border border-white/10 bg-white/[0.04] px-4 py-3 text-sm text-white focus:border-white/20 focus:outline-none"
                  >
                    {PROJECT_ROLES.map((r) => (
                      <option key={r.value} value={r.value}>{r.label}</option>
                    ))}
                  </select>
                </div>
                <div className="flex gap-3">
                  <button
                    type="button"
                    onClick={(e) => {
                      e.preventDefault();
                      void handleInviteByLink();
                    }}
                    disabled={inviteByLinkLoading || !allowed}
                    className="h-11 rounded-xl bg-white/10 px-6 text-sm font-medium text-white hover:bg-white/15 disabled:opacity-50"
                  >
                    {inviteByLinkLoading ? "Создание…" : "Создать ссылку"}
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      resetInviteCopyFeedback();
                      setInviteByLinkModal(false);
                    }}
                    className="h-11 rounded-xl border border-white/10 px-6 text-sm text-zinc-300 hover:bg-white/[0.04]"
                  >
                    Отмена
                  </button>
                </div>
              </div>
            ) : (
              <div className="mt-6 space-y-4">
                <InviteUrlFlashBox
                  url={inviteByLinkUrl}
                  copied={inviteLinkCopiedKey === COPY_FEEDBACK_LINK_MODAL}
                />
                <button
                  type="button"
                  onClick={() => inviteByLinkUrl && copyInviteLink(inviteByLinkUrl, COPY_FEEDBACK_LINK_MODAL)}
                  className="w-full rounded-xl bg-white/10 py-2.5 text-sm font-medium text-white hover:bg-white/15"
                >
                  Копировать ссылку
                </button>
                <button
                  type="button"
                  onClick={() => {
                    resetInviteCopyFeedback();
                    setInviteByLinkModal(false);
                  }}
                  className="w-full rounded-xl border border-white/10 py-2.5 text-sm text-zinc-300 hover:bg-white/[0.04]"
                >
                  Закрыть
                </button>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
