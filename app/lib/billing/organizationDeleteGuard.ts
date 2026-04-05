import type { SupabaseClient } from "@supabase/supabase-js";

const ACTIVE_SUBSCRIPTION_STATUSES = new Set(["active", "trialing", "past_due"]);

const BLOCK_MESSAGE =
  "Нельзя удалить организацию с активной подпиской, активным тарифным доступом или незавершённым биллинговым онбордингом.";

function entitlementRowActive(row: {
  status?: string | null;
  starts_at?: string | null;
  ends_at?: string | null;
}): boolean {
  if (String(row.status ?? "").toLowerCase() !== "active") return false;
  const now = Date.now();
  const startsTs = row.starts_at ? Date.parse(String(row.starts_at)) : 0;
  if (Number.isFinite(startsTs) && now < startsTs) return false;
  const endsTs = row.ends_at ? Date.parse(String(row.ends_at)) : null;
  if (endsTs != null && Number.isFinite(endsTs) && now > endsTs) return false;
  return true;
}

function subscriptionRowActive(row: {
  status?: string | null;
  current_period_end?: string | null;
}): boolean {
  const st = String(row.status ?? "").toLowerCase();
  if (!ACTIVE_SUBSCRIPTION_STATUSES.has(st)) return false;
  const endTs = row.current_period_end ? Date.parse(String(row.current_period_end)) : null;
  if (endTs != null && Number.isFinite(endTs) && st !== "canceled" && st !== "inactive" && Date.now() > endTs) {
    return false;
  }
  return true;
}

/**
 * Возвращает текст ошибки для пользователя/админа или null, если удаление организации с точки зрения биллинга допустимо.
 */
export async function getOrganizationBillingDeleteBlockReason(
  admin: SupabaseClient,
  organizationId: string
): Promise<string | null> {
  const { data: entRows } = await admin
    .from("billing_entitlements")
    .select("status, starts_at, ends_at")
    .eq("organization_id", organizationId)
    .eq("status", "active")
    .limit(20);

  for (const row of entRows ?? []) {
    if (entitlementRowActive(row as { status?: string; starts_at?: string; ends_at?: string })) {
      return BLOCK_MESSAGE;
    }
  }

  const { data: subRows } = await admin
    .from("billing_subscriptions")
    .select("status, current_period_end")
    .eq("organization_id", organizationId)
    .limit(50);

  for (const row of subRows ?? []) {
    if (subscriptionRowActive(row as { status?: string; current_period_end?: string })) {
      return BLOCK_MESSAGE;
    }
  }

  const { data: pcRows } = await admin
    .from("user_post_checkout_onboarding")
    .select("user_id")
    .eq("organization_id", organizationId)
    .is("completed_at", null)
    .limit(5);

  if ((pcRows ?? []).length > 0) {
    return BLOCK_MESSAGE;
  }

  return null;
}

export { BLOCK_MESSAGE as ORGANIZATION_DELETE_BILLING_BLOCK_MESSAGE };
