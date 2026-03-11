"use client";

import { useCallback, useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import Link from "next/link";
import { supabase } from "@/app/lib/supabaseClient";

const ORG_ROLES_ALL_PROJECTS = ["owner", "admin"];
const ORG_ROLES_MANAGE = ["owner", "admin"];
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

export default function ProjectMembersPageClient() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const projectId = searchParams.get("project_id")?.trim() ?? "";

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
  const [actionLoadingId, setActionLoadingId] = useState<string | null>(null);

  const [tab, setTab] = useState<"members" | "invites">("members");
  const [invites, setInvites] = useState<InviteRow[]>([]);
  const [inviteEmail, setInviteEmail] = useState("");
  const [inviteRole, setInviteRole] = useState<string>("marketer");
  const [inviteByEmailModal, setInviteByEmailModal] = useState(false);
  const [inviteByEmailLoading, setInviteByEmailLoading] = useState(false);
  const [inviteByEmailError, setInviteByEmailError] = useState<string | null>(null);
  const [inviteByEmailFallbackUrl, setInviteByEmailFallbackUrl] = useState<string | null>(null);
  const [inviteByLinkModal, setInviteByLinkModal] = useState(false);
  const [inviteByLinkUrl, setInviteByLinkUrl] = useState<string | null>(null);
  const [inviteByLinkLoading, setInviteByLinkLoading] = useState(false);
  const [inviteByLinkRole, setInviteByLinkRole] = useState<string>("marketer");
  const [revokeLoadingId, setRevokeLoadingId] = useState<string | null>(null);

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
      setActionLoadingId(memberId);
      const { error } = await supabase
        .from("project_members")
        .update({ role: newRole })
        .eq("id", memberId);
      setActionLoadingId(null);
      if (!error) await fetchMembers();
    },
    [fetchMembers]
  );

  const handleRemove = useCallback(
    async (row: MemberRow) => {
      if (row.user_id === currentUserId && row.role === "project_admin") return;
      setActionLoadingId(row.id);
      const { error } = await supabase.from("project_members").delete().eq("id", row.id);
      setActionLoadingId(null);
      if (!error) await fetchMembers();
    },
    [currentUserId, fetchMembers]
  );

  const handleAddSubmit = useCallback(
    async (e: React.FormEvent) => {
      e.preventDefault();
      const email = addEmail.trim().toLowerCase();
      if (!email) {
        setAddError("Введите email");
        return;
      }
      setAddError(null);
      setAddLoading(true);

      const res = await fetch(
        `/api/users/by-email?email=${encodeURIComponent(email)}`,
        { cache: "no-store" }
      );
      const json = (await res.json()) as { success?: boolean; user?: { id: string; email: string | null } };

      if (!json?.success || !json?.user?.id) {
        setAddError("Пользователь не найден");
        setAddLoading(false);
        return;
      }

      const userId = json.user.id;
      if (members.some((m) => m.user_id === userId)) {
        setAddError("Пользователь уже добавлен в проект");
        setAddLoading(false);
        return;
      }

      const { error: insertErr } = await supabase.from("project_members").insert({
        project_id: projectId,
        user_id: userId,
        role: addRole,
      });

      setAddLoading(false);
      if (insertErr) {
        setAddError(insertErr.message ?? "Ошибка добавления");
        return;
      }

      setModalOpen(false);
      setAddEmail("");
      setAddRole("marketer");
      setAddError(null);
      await fetchMembers();
    },
    [addEmail, addRole, projectId, members, fetchMembers]
  );

  const handleInviteByEmail = useCallback(
    async (e: React.FormEvent) => {
      e.preventDefault();
      const email = inviteEmail.trim().toLowerCase();
      if (!email) {
        setInviteByEmailError("Введите email");
        return;
      }
      setInviteByEmailError(null);
      setInviteByEmailFallbackUrl(null);
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
        if (json?.invite_url) {
          setInviteByEmailFallbackUrl(json.invite_url);
          await fetchInvites();
        } else {
          setInviteByEmailModal(false);
          setInviteEmail("");
          setInviteRole("marketer");
          setInviteByEmailFallbackUrl(null);
          await fetchInvites();
        }
      } else if (json?.invite_url) {
        setInviteByEmailFallbackUrl(json.invite_url);
        await fetchInvites();
      } else {
        setInviteByEmailError(json?.error ?? "Ошибка создания приглашения");
      }
    },
    [projectId, inviteEmail, inviteRole, fetchInvites]
  );

  const handleInviteByLink = useCallback(async () => {
    setInviteByLinkLoading(true);
    setInviteByLinkUrl(null);
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
    }
  }, [projectId, inviteByLinkRole, fetchInvites]);

  const handleRevokeInvite = useCallback(
    async (inviteId: string) => {
      setRevokeLoadingId(inviteId);
      const res = await fetch("/api/project-invites/revoke", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ invite_id: inviteId }),
      });
      setRevokeLoadingId(null);
      if (res.ok) await fetchInvites();
    },
    [fetchInvites]
  );

  const copyInviteLink = useCallback((url: string) => {
    const full = url.startsWith("http") ? url : `${typeof window !== "undefined" ? window.location.origin : ""}${url}`;
    navigator.clipboard.writeText(full).catch(() => {});
  }, []);

  if (loading || !allowed) {
    return (
      <div className="mx-auto max-w-4xl p-6">
        <div className="h-10 w-64 rounded-2xl bg-white/[0.04]" />
        <div className="mt-6 h-48 rounded-2xl border border-white/10 bg-white/[0.03]" />
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-4xl space-y-8 p-6">
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
            onClick={() => {
              setModalOpen(true);
              setAddError(null);
              setAddEmail("");
              setAddRole("marketer");
            }}
            className="inline-flex h-10 items-center rounded-xl bg-white/10 px-5 text-sm font-medium text-white hover:bg-white/15"
          >
            Добавить участника
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

      {tab === "invites" && (
        <>
          <div className="flex flex-wrap gap-3">
            <button
              type="button"
              onClick={() => {
                setInviteByEmailModal(true);
                setInviteByEmailError(null);
                setInviteByEmailFallbackUrl(null);
                setInviteEmail("");
                setInviteRole("marketer");
              }}
              className="inline-flex h-10 items-center rounded-xl bg-white/10 px-5 text-sm font-medium text-white hover:bg-white/15"
            >
              Пригласить по email
            </button>
            <button
              type="button"
              onClick={() => {
                setInviteByLinkModal(true);
                setInviteByLinkUrl(null);
                setInviteByLinkRole("marketer");
              }}
              className="inline-flex h-10 items-center rounded-xl border border-white/10 px-5 text-sm font-medium text-zinc-300 hover:bg-white/[0.04]"
            >
              Создать ссылку
            </button>
          </div>
          <div className="rounded-2xl border border-white/10 bg-white/[0.03] overflow-hidden">
            {invites.length === 0 ? (
              <div className="py-12 text-center text-sm text-zinc-400">
                Нет активных приглашений. Создайте приглашение по email или ссылке.
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full min-w-[560px]">
                  <thead>
                    <tr className="border-b border-white/10">
                      <th className="px-4 py-3 text-left text-xs font-medium uppercase tracking-wider text-zinc-500">Кому / тип</th>
                      <th className="px-4 py-3 text-left text-xs font-medium uppercase tracking-wider text-zinc-500">Роль</th>
                      <th className="px-4 py-3 text-left text-xs font-medium uppercase tracking-wider text-zinc-500">Создано</th>
                      <th className="px-4 py-3 text-left text-xs font-medium uppercase tracking-wider text-zinc-500">Истекает</th>
                      <th className="px-4 py-3 text-left text-xs font-medium uppercase tracking-wider text-zinc-500">Статус</th>
                      <th className="px-4 py-3 text-right text-xs font-medium uppercase tracking-wider text-zinc-500">Действия</th>
                    </tr>
                  </thead>
                  <tbody>
                    {invites.map((inv) => {
                      const isPending = inv.status === "pending";
                      const busy = revokeLoadingId === inv.id;
                      const inviteUrl = inv.invite_type === "link" && inv.token
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
                              <button
                                type="button"
                                onClick={() => copyInviteLink(inviteUrl)}
                                className="mr-2 rounded-lg border border-white/10 px-2 py-1 text-xs text-zinc-300 hover:bg-white/10"
                              >
                                Копировать ссылку
                              </button>
                            )}
                            {isPending && (
                              <button
                                type="button"
                                onClick={() => handleRevokeInvite(inv.id)}
                                disabled={busy}
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
            )}
          </div>
        </>
      )}

      {tab === "members" && (
      <div className="rounded-2xl border border-white/10 bg-white/[0.03] overflow-hidden">
        {members.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-16 px-6 text-center">
            <p className="text-zinc-400">В проекте пока нет участников</p>
            <button
              type="button"
              onClick={() => {
                setModalOpen(true);
                setAddError(null);
                setAddEmail("");
                setAddRole("marketer");
              }}
              className="mt-4 inline-flex h-10 items-center rounded-xl bg-white/10 px-5 text-sm font-medium text-white hover:bg-white/15"
            >
              Добавить первого участника
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
                          disabled={busy}
                          className="rounded-lg border border-white/10 bg-white/[0.04] px-3 py-2 text-sm text-white focus:border-white/20 focus:outline-none disabled:opacity-50"
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
                          disabled={cannotRemove || busy}
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
        )}
      </div>
      )}

      <div>
        <Link
          href={`/app?project_id=${encodeURIComponent(projectId)}`}
          className="text-sm text-zinc-400 hover:text-white"
        >
          ← Назад к дашборду
        </Link>
      </div>

      {modalOpen && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4"
          onClick={() => !addLoading && setModalOpen(false)}
          role="dialog"
          aria-modal="true"
        >
          <div
            className="w-full max-w-md rounded-2xl border border-white/10 bg-[#0b0b10] p-6 shadow-xl"
            onClick={(e) => e.stopPropagation()}
          >
            <h2 className="text-lg font-semibold text-white">Добавить участника</h2>
            <form onSubmit={handleAddSubmit} className="mt-6 space-y-4">
              <div>
                <label className="block text-sm font-medium text-zinc-300">
                  Email
                </label>
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
                <label className="block text-sm font-medium text-zinc-300">
                  Роль
                </label>
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
              {addError && (
                <p className="text-sm text-red-400">{addError}</p>
              )}
              <div className="flex flex-wrap gap-3 pt-2">
                <button
                  type="submit"
                  disabled={addLoading}
                  className="h-11 rounded-xl bg-white/10 px-6 text-sm font-medium text-white hover:bg-white/15 disabled:opacity-50"
                >
                  {addLoading ? "Добавление…" : "Добавить"}
                </button>
                <button
                  type="button"
                  onClick={() => !addLoading && setModalOpen(false)}
                  className="h-11 rounded-xl border border-white/10 px-6 text-sm text-zinc-300 hover:bg-white/[0.04]"
                >
                  Отмена
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {inviteByEmailModal && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4"
          onClick={() => {
            if (!inviteByEmailLoading) {
              setInviteByEmailModal(false);
              setInviteByEmailFallbackUrl(null);
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
                <p className="text-sm text-zinc-400">
                  Приглашение создано. Скопируйте ссылку и отправьте приглашённому.
                </p>
                <div className="rounded-xl border border-white/10 bg-white/[0.04] px-4 py-3 text-sm text-zinc-300 break-all">
                  {inviteByEmailFallbackUrl}
                </div>
                <button
                  type="button"
                  onClick={() => copyInviteLink(inviteByEmailFallbackUrl)}
                  className="w-full rounded-xl bg-white/10 py-2.5 text-sm font-medium text-white hover:bg-white/15"
                >
                  Копировать ссылку
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setInviteByEmailModal(false);
                    setInviteByEmailFallbackUrl(null);
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
                    disabled={inviteByEmailLoading}
                    className="h-11 rounded-xl bg-white/10 px-6 text-sm font-medium text-white hover:bg-white/15 disabled:opacity-50"
                  >
                    {inviteByEmailLoading ? "Создание…" : "Создать приглашение"}
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      if (!inviteByEmailLoading) {
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
          onClick={() => setInviteByLinkModal(false)}
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
                    onClick={handleInviteByLink}
                    disabled={inviteByLinkLoading}
                    className="h-11 rounded-xl bg-white/10 px-6 text-sm font-medium text-white hover:bg-white/15 disabled:opacity-50"
                  >
                    {inviteByLinkLoading ? "Создание…" : "Создать ссылку"}
                  </button>
                  <button
                    type="button"
                    onClick={() => setInviteByLinkModal(false)}
                    className="h-11 rounded-xl border border-white/10 px-6 text-sm text-zinc-300 hover:bg-white/[0.04]"
                  >
                    Отмена
                  </button>
                </div>
              </div>
            ) : (
              <div className="mt-6 space-y-4">
                <div className="rounded-xl border border-white/10 bg-white/[0.04] px-4 py-3 text-sm text-zinc-300 break-all">
                  {inviteByLinkUrl}
                </div>
                <button
                  type="button"
                  onClick={() => copyInviteLink(inviteByLinkUrl)}
                  className="w-full rounded-xl bg-white/10 py-2.5 text-sm font-medium text-white hover:bg-white/15"
                >
                  Копировать ссылку
                </button>
                <button
                  type="button"
                  onClick={() => setInviteByLinkModal(false)}
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
