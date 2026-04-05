/**
 * Лимит проектов по тарифу (источник матрицы — planConfig / resolveBillingPlanForUser).
 * Считаем только неархивные проекты организации.
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import { resolveBillingPlanForUserWithOrg } from "@/app/lib/billingPlan";
import { getPlanFeatureMatrix } from "@/app/lib/planConfig";

export const PROJECT_PLAN_LIMIT_USER_MESSAGE =
  "Вы достигли максимального количества проектов в вашем тарифе. Смените тариф, чтобы создать дополнительные проекты.";

export async function getPlanMaxProjectsForUser(
  admin: SupabaseClient,
  userId: string,
  userEmail: string | null,
  organizationId?: string | null
): Promise<number | null> {
  const plan = await resolveBillingPlanForUserWithOrg(admin, userId, userEmail, organizationId ?? null);
  const matrix = getPlanFeatureMatrix(plan);
  return matrix.max_projects;
}

export async function countActiveProjectsForOrganization(
  admin: SupabaseClient,
  organizationId: string
): Promise<number> {
  const { count, error } = await admin
    .from("projects")
    .select("id", { count: "exact", head: true })
    .eq("organization_id", organizationId)
    .eq("archived", false);
  if (error) throw new Error(error.message);
  return count ?? 0;
}

/** Нельзя создать ещё один проект: лимит задан и текущее число >= лимита. */
export function isAtProjectPlanLimit(maxProjects: number | null, activeProjectCount: number): boolean {
  if (maxProjects == null) return false;
  return activeProjectCount >= maxProjects;
}
