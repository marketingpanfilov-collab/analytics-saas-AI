"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useBillingBootstrap } from "@/app/app/components/BillingBootstrapProvider";
import { billingActionAllowed } from "@/app/lib/billingBootstrapClient";
import { ActionId } from "@/app/lib/billingUiContract";
import {
  ORG_SEAT_PLAN_LIMIT_CODE,
  ORG_SEAT_PLAN_LIMIT_USER_MESSAGE,
} from "@/app/lib/orgSeatPlanLimit";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { supabase } from "@/app/lib/supabaseClient";

const ORG_ROLES_ALLOWED = ["owner", "admin"];
const ORG_ROLES_DROPDOWN = [
  { value: "admin", label: "Администратор" },
  { value: "agency", label: "Агентство" },
  { value: "member", label: "Участник" },
] as const;

const ROLE_LABELS: Record<string, string> = {
  owner: "Владелец",
  admin: "Администратор",
  agency: "Агентство",
  member: "Участник",
};

type MemberRow = {
  id: string;
  organization_id: string;
  user_id: string;
  role: string;
  created_at: string;
  email: string | null;
};

type ProjectOnlySeatDetail = {
  user_id: string;
  project_ids: string[];
  projects: { id: string; name: string }[];
  email: string | null;
};

function normalizeProjectOnlySeatDetails(
  raw: unknown
): ProjectOnlySeatDetail[] {
  if (!Array.isArray(raw)) return [];
  return raw.map((item) => {
    const o = item as {
      user_id?: string;
      project_ids?: string[];
      projects?: { id?: string; name?: string }[];
      email?: string | null;
    };
    const user_id = String(o.user_id ?? "");
    const project_ids = Array.isArray(o.project_ids)
      ? o.project_ids.map((id) => String(id))
      : [];
    const projects =
      Array.isArray(o.projects) && o.projects.length > 0
        ? o.projects.map((p) => ({
            id: String(p.id ?? ""),
            name: String(p.name ?? "").trim() || String(p.id ?? ""),
          }))
        : project_ids.map((id) => ({ id, name: id }));
    const email =
      o.email === null || typeof o.email === "string" ? o.email : null;
    return { user_id, project_ids, projects, email };
  });
}

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

export type OrgMembersManagerProps = {
  /** Полная страница `/app/org-members` — заголовок и ссылка «К проектам». Встроенный блок — только таблица и действия. */
  layout?: "page" | "section";
};

export default function OrgMembersManager({ layout = "page" }: OrgMembersManagerProps) {
  const router = useRouter();
  const { resolvedUi, planFeatureMatrix, reloadBootstrap } = useBillingBootstrap();
  const maxSeats = planFeatureMatrix?.max_seats ?? null;
  /** OVER_LIMIT shell даёт manage_project_members (правка ростера), но не sync_refresh — без этого удаление org молча не уходит в API. */
  const canMutateOrgMembers = useMemo(
    () =>
      billingActionAllowed(resolvedUi, ActionId.sync_refresh) ||
      billingActionAllowed(resolvedUi, ActionId.manage_project_members),
    [resolvedUi]
  );
  const [loading, setLoading] = useState(true);
  const [allowed, setAllowed] = useState(false);
  const [members, setMembers] = useState<MemberRow[]>([]);
  const [currentUserId, setCurrentUserId] = useState<string | null>(null);
  const [currentUserRole, setCurrentUserRole] = useState<string | null>(null);
  const [modalOpen, setModalOpen] = useState(false);
  const [addEmail, setAddEmail] = useState("");
  const [addRole, setAddRole] = useState<string>("member");
  const [addError, setAddError] = useState<string | null>(null);
  const [addLoading, setAddLoading] = useState(false);
  const [actionLoadingId, setActionLoadingId] = useState<string | null>(null);
  const [billableSeatCount, setBillableSeatCount] = useState<number | null>(null);
  const [projectOnlyBillableUserCount, setProjectOnlyBillableUserCount] = useState(0);
  const [projectOnlySeatDetails, setProjectOnlySeatDetails] = useState<ProjectOnlySeatDetail[]>([]);
  const [projectOnlyRemoveLoadingId, setProjectOnlyRemoveLoadingId] = useState<string | null>(null);
  const [memberActionError, setMemberActionError] = useState<string | null>(null);

  const addBlockedBySeatLimit = useMemo(() => {
    if (maxSeats == null) return false;
    const n = billableSeatCount ?? members.length;
    return n >= maxSeats;
  }, [maxSeats, billableSeatCount, members.length]);

  const fetchMembers = useCallback(async () => {
    const res = await fetch("/api/org-members/list", { cache: "no-store" });
    const json = (await res.json()) as {
      success?: boolean;
      members?: MemberRow[];
      billable_seat_count?: number;
      seat_visibility?: {
        billable_seat_count?: number;
        project_only_billable_user_count?: number;
        project_only_seat_details?: unknown;
      };
    };
    if (json?.success && Array.isArray(json.members)) {
      setMembers(json.members);
      const vis = json.seat_visibility;
      setBillableSeatCount(
        typeof vis?.billable_seat_count === "number"
          ? vis.billable_seat_count
          : typeof json.billable_seat_count === "number"
            ? json.billable_seat_count
            : json.members.length
      );
      setProjectOnlyBillableUserCount(
        typeof vis?.project_only_billable_user_count === "number" ? vis.project_only_billable_user_count : 0
      );
      setProjectOnlySeatDetails(normalizeProjectOnlySeatDetails(vis?.project_only_seat_details));
    } else {
      setMembers([]);
      setBillableSeatCount(null);
      setProjectOnlyBillableUserCount(0);
      setProjectOnlySeatDetails([]);
    }
  }, []);

  useEffect(() => {
    let mounted = true;

    (async () => {
      const {
        data: { user: u },
      } = await supabase.auth.getUser();
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
        router.replace("/app/projects");
        return;
      }

      const role = (mem.role ?? "member") as string;
      if (!ORG_ROLES_ALLOWED.includes(role)) {
        router.replace("/app/projects");
        return;
      }

      setCurrentUserId(u.id);
      setCurrentUserRole(role);
      setAllowed(true);
      setLoading(false);
      await fetchMembers();
    })();

    return () => {
      mounted = false;
    };
  }, [router, fetchMembers]);

  const handleRoleChange = useCallback(
    async (memberId: string, newRole: string) => {
      if (!canMutateOrgMembers) return;
      setMemberActionError(null);
      setActionLoadingId(memberId);
      const res = await fetch("/api/org-members/role", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ member_id: memberId, role: newRole }),
      });
      setActionLoadingId(null);
      if (res.ok) {
        await fetchMembers();
        await reloadBootstrap();
        return;
      }
      const j = (await res.json().catch(() => ({}))) as { error?: string };
      setMemberActionError(j.error ?? `Не удалось сменить роль (${res.status})`);
    },
    [fetchMembers, canMutateOrgMembers, reloadBootstrap]
  );

  const handleRemove = useCallback(
    async (row: MemberRow) => {
      if (!canMutateOrgMembers) return;
      if (row.role === "owner") return;
      if (row.user_id === currentUserId && currentUserRole === "owner") return;
      setMemberActionError(null);
      setActionLoadingId(row.id);
      const res = await fetch(`/api/org-members/remove?member_id=${encodeURIComponent(row.id)}`, {
        method: "DELETE",
      });
      setActionLoadingId(null);
      if (res.ok) {
        await fetchMembers();
        await reloadBootstrap();
        return;
      }
      const j = (await res.json().catch(() => ({}))) as { error?: string };
      setMemberActionError(j.error ?? `Не удалось удалить участника (${res.status})`);
    },
    [currentUserId, currentUserRole, fetchMembers, canMutateOrgMembers, reloadBootstrap]
  );

  const handleAddSubmit = useCallback(
    async (e: React.FormEvent) => {
      e.preventDefault();
      if (!canMutateOrgMembers) {
        setAddError("Действие недоступно при текущем статусе подписки");
        return;
      }
      if (addBlockedBySeatLimit) {
        setAddError(ORG_SEAT_PLAN_LIMIT_USER_MESSAGE);
        return;
      }
      const email = addEmail.trim().toLowerCase();
      if (!email) {
        setAddError("Введите email");
        return;
      }
      setAddError(null);
      setAddLoading(true);

      const res = await fetch("/api/org-members/add", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, role: addRole }),
      });
      const json = (await res.json()) as { success?: boolean; error?: string };
      setAddLoading(false);

      if (json?.success) {
        setModalOpen(false);
        setAddEmail("");
        setAddRole("member");
        setAddError(null);
        await fetchMembers();
        return;
      }
      const errPayload = json as { error?: string; code?: string };
      if (errPayload?.code === ORG_SEAT_PLAN_LIMIT_CODE) {
        setAddError(ORG_SEAT_PLAN_LIMIT_USER_MESSAGE);
        return;
      }
      setAddError(errPayload?.error ?? "Ошибка добавления");
    },
    [addEmail, addRole, fetchMembers, canMutateOrgMembers, addBlockedBySeatLimit]
  );

  const handleRemoveProjectOnlySeat = useCallback(
    async (targetUserId: string) => {
      if (!canMutateOrgMembers) return;
      setMemberActionError(null);
      setProjectOnlyRemoveLoadingId(targetUserId);
      try {
        const res = await fetch("/api/org-members/remove-project-only-seat", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ user_id: targetUserId }),
        });
        const json = (await res.json().catch(() => ({}))) as { success?: boolean; error?: string };
        if (res.ok && json?.success) {
          await fetchMembers();
          await reloadBootstrap();
          return;
        }
        setMemberActionError(json.error ?? `Не удалось снять доступ к проектам (${res.status})`);
      } finally {
        setProjectOnlyRemoveLoadingId(null);
      }
    },
    [canMutateOrgMembers, fetchMembers, reloadBootstrap]
  );

  if (loading || !allowed) {
    return (
      <div className={layout === "page" ? "mx-auto max-w-4xl p-6" : ""}>
        <div className="h-10 w-64 rounded-2xl bg-white/[0.04]" />
        <div className="mt-6 h-48 rounded-2xl border border-white/10 bg-white/[0.03]" />
      </div>
    );
  }

  const isSection = layout === "section";

  return (
    <div className={isSection ? "space-y-6" : "mx-auto max-w-4xl space-y-8 p-6"}>
      {!isSection && (
        <header className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
          <div>
            <h1 className="text-2xl font-semibold tracking-tight text-white">Участники организации</h1>
            <p className="mt-1 text-sm text-zinc-400">Управляйте доступом к организации</p>
          </div>
          {addBlockedBySeatLimit ? (
            <span className="inline-block max-w-full" title={ORG_SEAT_PLAN_LIMIT_USER_MESSAGE}>
              <button
                type="button"
                disabled
                className="inline-flex h-10 cursor-not-allowed items-center rounded-xl bg-white/10 px-5 text-sm font-medium text-white opacity-50"
              >
                Добавить участника
              </button>
            </span>
          ) : (
            <button
              type="button"
              onClick={() => {
                setModalOpen(true);
                setAddError(null);
                setAddEmail("");
                setAddRole("member");
              }}
              className="inline-flex h-10 items-center rounded-xl bg-white/10 px-5 text-sm font-medium text-white hover:bg-white/15"
            >
              Добавить участника
            </button>
          )}
        </header>
      )}

      {isSection && (
        <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <h2
              className="text-white"
              style={{ fontSize: 16, fontWeight: 700, marginBottom: 4 }}
            >
              Участники организации
            </h2>
            <p style={{ margin: 0, fontSize: 13, color: "rgba(255,255,255,0.72)" }}>
              Роли на уровне аккаунта (вся организация)
            </p>
          </div>
          {addBlockedBySeatLimit ? (
            <span className="inline-block max-w-full shrink-0" title={ORG_SEAT_PLAN_LIMIT_USER_MESSAGE}>
              <button type="button" disabled className="settings-primary-btn shrink-0 cursor-not-allowed opacity-50">
                Добавить участника
              </button>
            </span>
          ) : (
            <button
              type="button"
              onClick={() => {
                setModalOpen(true);
                setAddError(null);
                setAddEmail("");
                setAddRole("member");
              }}
              className="settings-primary-btn shrink-0"
            >
              Добавить участника
            </button>
          )}
        </div>
      )}

      {projectOnlyBillableUserCount > 0 ? (
        <div
          role="status"
          className="rounded-xl border border-amber-500/25 bg-amber-500/10 px-4 py-3 text-sm leading-relaxed text-amber-100/95"
        >
          <p className="m-0">
            В лимит мест входят все участники организации и все участники любых проектов этой организации. Ниже —{" "}
            <strong className="text-amber-50">
              {projectOnlyBillableUserCount}{" "}
              {(() => {
                const n = projectOnlyBillableUserCount;
                const a = Math.abs(n) % 100;
                const c = n % 10;
                const word =
                  a > 10 && a < 20
                    ? "пользователей"
                    : c === 1
                      ? "пользователь"
                      : c >= 2 && c <= 4
                        ? "пользователя"
                        : "пользователей";
                return word;
              })()}
            </strong>{" "}
            без строки в таблице команды организации, но с доступом через проекты.
          </p>
          {projectOnlySeatDetails.length > 0 ? (
            <ul className="mt-3 list-none space-y-4 border-t border-amber-500/20 pt-3 pl-0">
              {projectOnlySeatDetails.map((d) => (
                <li key={d.user_id} className="flex flex-col gap-2">
                  <div className="text-sm text-amber-50">
                    {d.email?.trim() ? (
                      d.email
                    ) : (
                      <span className="font-mono text-xs break-all text-amber-50/90">{d.user_id}</span>
                    )}
                  </div>
                  <p className="m-0 text-xs text-amber-100/85">
                    Пользователь имеет доступ к проектам организации и всё ещё занимает место.
                  </p>
                  {d.projects.length > 0 ? (
                    <ul className="m-0 list-disc space-y-0.5 pl-5 text-xs text-amber-100/90">
                      {d.projects.map((p) => (
                        <li key={p.id}>{p.name}</li>
                      ))}
                    </ul>
                  ) : null}
                  {canMutateOrgMembers ? (
                    <button
                      type="button"
                      disabled={projectOnlyRemoveLoadingId === d.user_id}
                      onClick={() => void handleRemoveProjectOnlySeat(d.user_id)}
                      className="inline-flex w-fit shrink-0 items-center rounded-lg border border-amber-400/40 bg-amber-950/40 px-2.5 py-1 text-xs font-medium text-amber-50 hover:bg-amber-950/60 disabled:opacity-50"
                    >
                      {projectOnlyRemoveLoadingId === d.user_id ? "…" : "Удалить доступ из всех проектов"}
                    </button>
                  ) : null}
                </li>
              ))}
            </ul>
          ) : null}
        </div>
      ) : null}

      {memberActionError ? (
        <div
          role="alert"
          className="rounded-xl border border-red-500/30 bg-red-500/10 px-4 py-3 text-sm text-red-100/95"
        >
          {memberActionError}
        </div>
      ) : null}

      <div className="settings-surface overflow-hidden">
        {members.length === 0 ? (
          <div className="flex flex-col items-center justify-center px-6 py-16 text-center">
            <p className="text-zinc-400">В организации пока нет участников</p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="min-w-[500px] w-full">
              <thead>
                <tr className="border-b border-white/10">
                  <th className="px-4 py-3 text-left text-xs font-medium uppercase tracking-wider text-zinc-500">
                    Пользователь
                  </th>
                  <th className="px-4 py-3 text-left text-xs font-medium uppercase tracking-wider text-zinc-500">Роль</th>
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
                  const isOwner = row.role === "owner";
                  const isSelf = row.user_id === currentUserId;
                  const cannotRemove = isOwner || (isSelf && currentUserRole === "owner");
                  const busy = actionLoadingId === row.id;
                  const removeDisabled = cannotRemove || busy || !canMutateOrgMembers;
                  const removeTitle = !canMutateOrgMembers
                    ? "Действие недоступно при текущем статусе подписки"
                    : isOwner
                      ? "Нельзя удалить владельца организации"
                      : isSelf && currentUserRole === "owner"
                        ? "Владелец не может удалить сам себя"
                        : "Удалить участника из организации";
                  return (
                    <tr key={row.id} className="border-b border-white/5 transition-colors hover:bg-white/[0.04]">
                      <td className="px-4 py-3">
                        <div className="flex items-center gap-3">
                          <div
                            className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-white/10 text-sm font-medium text-zinc-300"
                            aria-hidden
                          >
                            {(row.email ?? row.user_id).slice(0, 1).toUpperCase()}
                          </div>
                          <span className="text-sm text-white">{row.email ?? row.user_id}</span>
                        </div>
                      </td>
                      <td className="px-4 py-3">
                        {isOwner ? (
                          <span className="text-sm text-zinc-300">{ROLE_LABELS[row.role] ?? row.role}</span>
                        ) : (
                          <select
                            value={row.role}
                            onChange={(e) => handleRoleChange(row.id, e.target.value)}
                            disabled={busy || !canMutateOrgMembers}
                            title={
                              !canMutateOrgMembers
                                ? "Действие недоступно при текущем статусе подписки"
                                : undefined
                            }
                            className="settings-page-select settings-page-select-sm min-w-[10rem] disabled:opacity-50"
                          >
                            {ORG_ROLES_DROPDOWN.map((r) => (
                              <option key={r.value} value={r.value}>
                                {r.label}
                              </option>
                            ))}
                          </select>
                        )}
                      </td>
                      <td className="px-4 py-3 text-sm text-zinc-400">{formatJoined(row.created_at)}</td>
                      <td className="px-4 py-3 text-right">
                        <button
                          type="button"
                          onClick={() => void handleRemove(row)}
                          disabled={removeDisabled}
                          title={removeTitle}
                          className="rounded-lg border border-white/10 px-3 py-1.5 text-xs font-medium text-zinc-300 hover:bg-white/10 hover:text-white disabled:cursor-not-allowed disabled:opacity-50"
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

      {!isSection && (
        <div>
          <Link href="/app/projects" className="text-sm text-zinc-400 hover:text-white">
            ← К проектам
          </Link>
        </div>
      )}

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
                <label className="block text-sm font-medium text-zinc-300">Email</label>
                <input
                  type="email"
                  value={addEmail}
                  onChange={(e) => {
                    setAddEmail(e.target.value);
                    if (addError) setAddError(null);
                  }}
                  placeholder="user@example.com"
                  className="settings-page-input mt-2 placeholder:text-zinc-500"
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
                  {ORG_ROLES_DROPDOWN.map((r) => (
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
                  disabled={!canMutateOrgMembers || addLoading || addBlockedBySeatLimit}
                  className="settings-primary-btn"
                >
                  {addLoading ? "Добавление…" : "Добавить"}
                </button>
                <button
                  type="button"
                  onClick={() => !addLoading && setModalOpen(false)}
                  className="settings-secondary-btn"
                >
                  Отмена
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
