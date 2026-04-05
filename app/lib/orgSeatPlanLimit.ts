import type { SupabaseClient } from "@supabase/supabase-js";
import { resolveBillingPlanForUserWithOrg } from "@/app/lib/billingPlan";
import { resolveBillingPlanForOrganization } from "@/app/lib/orgBillingState";
import { getPlanFeatureMatrix } from "@/app/lib/planConfig";

export const ORG_SEAT_PLAN_LIMIT_USER_MESSAGE =
  "Достигнут лимит участников организации для вашего тарифа. Смените тариф, чтобы пригласить больше людей.";

export const ORG_SEAT_PLAN_LIMIT_CODE = "ORG_SEAT_PLAN_LIMIT" as const;

/** Сообщение при accept invite, если новый участник не помещается в лимит мест org. */
export const ORG_SEAT_PLAN_LIMIT_ACCEPT_INVITE_MESSAGE =
  "Лимит участников организации по тарифу достигнут — доступ к проекту сейчас не активируется. После расширения тарифа или освобождения места откройте эту ссылку снова (пока приглашение не истекло).";

/** Нельзя добавить участника: лимит задан и текущее число мест >= лимита. */
export function isAtOrgSeatPlanLimit(maxSeats: number | null, currentBillableSeats: number): boolean {
  if (maxSeats == null) return false;
  return currentBillableSeats >= maxSeats;
}

/** Полный разбор billable seats для аудита и UI (тот же union, что и в лимитах). */
export type BillableSeatsBreakdown = {
  organization_id: string;
  /** user_id из organization_members для этой организации */
  organization_member_user_ids: string[];
  /** Уникальные user_id из project_members по всем projects.organization_id = org */
  project_member_distinct_user_ids: string[];
  /** DISTINCT union (канонический billable seat set) */
  distinct_union_user_ids: string[];
  /**
   * Учитываются в лимите, но нет строки в organization_members —
   * не видны на экране «Участники организации», только в участниках проектов.
   */
  seat_holders_without_org_membership_row: string[];
  /** Для каждого project-only user_id — в каких проектах org есть membership */
  project_only_seat_details: { user_id: string; project_ids: string[] }[];
};

/**
 * Каноническое «место»: уникальный user_id с любым доступом в организации.
 * UNION DISTINCT: organization_members ∪ project_members (по всем проектам org, включая архивные проекты).
 * Pending invites не входят.
 */
export async function getBillableSeatsBreakdownForOrganization(
  admin: SupabaseClient,
  organizationId: string
): Promise<BillableSeatsBreakdown> {
  const orgUserIds = new Set<string>();

  const { data: omRows, error: omErr } = await admin
    .from("organization_members")
    .select("user_id")
    .eq("organization_id", organizationId);
  if (omErr) throw new Error(omErr.message);
  for (const r of omRows ?? []) {
    const uid = r?.user_id != null ? String(r.user_id) : "";
    if (uid) orgUserIds.add(uid);
  }

  const projectMemberUserIds = new Set<string>();
  const distinct = new Set<string>(orgUserIds);

  const { data: projRows, error: pErr } = await admin
    .from("projects")
    .select("id")
    .eq("organization_id", organizationId);
  if (pErr) throw new Error(pErr.message);
  const projectIds = [...new Set((projRows ?? []).map((p: { id: string }) => String(p.id)).filter(Boolean))];

  const userIdToProjectIds = new Map<string, Set<string>>();

  if (projectIds.length > 0) {
    const { data: pmRows, error: pmErr } = await admin
      .from("project_members")
      .select("user_id, project_id")
      .in("project_id", projectIds);
    if (pmErr) throw new Error(pmErr.message);
    for (const r of pmRows ?? []) {
      const uid = r?.user_id != null ? String(r.user_id) : "";
      const pid = r?.project_id != null ? String(r.project_id) : "";
      if (uid) {
        projectMemberUserIds.add(uid);
        distinct.add(uid);
        if (pid) {
          if (!userIdToProjectIds.has(uid)) userIdToProjectIds.set(uid, new Set());
          userIdToProjectIds.get(uid)!.add(pid);
        }
      }
    }
  }

  const sorted = (s: Set<string>) => [...s].sort();
  const unionSorted = sorted(distinct);
  const withoutOrgRow = unionSorted.filter((id) => !orgUserIds.has(id));
  const projectOnlySeatDetails = withoutOrgRow.map((user_id) => ({
    user_id,
    project_ids: sorted(userIdToProjectIds.get(user_id) ?? new Set()),
  }));

  return {
    organization_id: organizationId,
    organization_member_user_ids: sorted(orgUserIds),
    project_member_distinct_user_ids: sorted(projectMemberUserIds),
    distinct_union_user_ids: unionSorted,
    seat_holders_without_org_membership_row: withoutOrgRow,
    project_only_seat_details: projectOnlySeatDetails,
  };
}

export async function countBillableSeatsForOrganization(
  admin: SupabaseClient,
  organizationId: string
): Promise<number> {
  const b = await getBillableSeatsBreakdownForOrganization(admin, organizationId);
  return b.distinct_union_user_ids.length;
}

/** Уже учитывается в billable seats (org или любой проект организации). */
export async function userHasBillableSeatInOrganization(
  admin: SupabaseClient,
  organizationId: string,
  userId: string
): Promise<boolean> {
  const { data: om, error: omErr } = await admin
    .from("organization_members")
    .select("id")
    .eq("organization_id", organizationId)
    .eq("user_id", userId)
    .maybeSingle();
  if (omErr) throw new Error(omErr.message);
  if (om) return true;

  const { data: projRows, error: pErr } = await admin.from("projects").select("id").eq("organization_id", organizationId);
  if (pErr) throw new Error(pErr.message);
  const projectIds = (projRows ?? []).map((p: { id: string }) => String(p.id)).filter(Boolean);
  if (projectIds.length === 0) return false;

  const { data: pm, error: pmErr } = await admin
    .from("project_members")
    .select("id")
    .eq("user_id", userId)
    .in("project_id", projectIds)
    .limit(1);
  if (pmErr) throw new Error(pmErr.message);
  return (pm?.length ?? 0) > 0;
}

/** Только число строк organization_members (без project-only пользователей). Для лимитов используйте countBillableSeatsForOrganization. */
export async function countOrganizationMembers(
  admin: SupabaseClient,
  organizationId: string
): Promise<number> {
  const { count, error } = await admin
    .from("organization_members")
    .select("id", { count: "exact", head: true })
    .eq("organization_id", organizationId);
  if (error) throw new Error(error.message);
  return count ?? 0;
}

export async function getPlanMaxSeatsForUser(
  admin: SupabaseClient,
  userId: string,
  userEmail: string | null,
  organizationId?: string | null
): Promise<number | null> {
  const plan = await resolveBillingPlanForUserWithOrg(admin, userId, userEmail, organizationId ?? null);
  return getPlanFeatureMatrix(plan).max_seats;
}

/** Лимит мест по тарифу организации (org entitlement / Paddle map + dual-read fallback). */
export async function getPlanMaxSeatsForOrganization(
  admin: SupabaseClient,
  organizationId: string
): Promise<number | null> {
  const plan = await resolveBillingPlanForOrganization(admin, organizationId);
  return getPlanFeatureMatrix(plan).max_seats;
}
