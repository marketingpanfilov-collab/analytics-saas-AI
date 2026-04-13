import { NextResponse } from "next/server";
import type { SupabaseClient } from "@supabase/supabase-js";
import { collectEnabledAdAccountIdsForOrganization } from "@/app/lib/dashboardCanonical";
import type { BillingPlanId } from "@/app/lib/billingPlan";
import { resolveBillingPlanForUserWithOrg } from "@/app/lib/billingPlan";
import { getPlanFeatureMatrix } from "@/app/lib/planConfig";

/** Код ошибки при превышении лимита рекламных аккаунтов (сервер + клиент). */
export const PLAN_LIMIT_AD_ACCOUNTS = "PLAN_LIMIT_AD_ACCOUNTS" as const;

export const FREE_AD_ACCOUNTS_LIMIT_USER_MESSAGE =
  "На бесплатном тарифе доступен только 1 рекламный аккаунт";

export const PAID_PLAN_AD_ACCOUNTS_LIMIT_USER_MESSAGE =
  "Достигнут лимит подключённых рекламных аккаунтов для вашего тарифа. Смените тариф или отключите аккаунты в других проектах.";

/** @deprecated ответ API теперь с PLAN_LIMIT_AD_ACCOUNTS; код оставлен для старых клиентов */
export const AD_ACCOUNT_PLAN_LIMIT_CODE = "AD_ACCOUNT_PLAN_LIMIT" as const;

/** @deprecated см. PAID_PLAN_AD_ACCOUNTS_LIMIT_USER_MESSAGE / FREE_AD_ACCOUNTS_LIMIT_USER_MESSAGE */
export const AD_ACCOUNT_PLAN_LIMIT_USER_MESSAGE = PAID_PLAN_AD_ACCOUNTS_LIMIT_USER_MESSAGE;

/** Показать баннер на дашборде после отказа API (только сценарий Free). */
export const FREE_AD_ACCOUNT_LIMIT_DASHBOARD_NOTICE_SESSION_KEY = "biq_free_ad_account_limit_banner_v1";

export function adAccountPlanLimitMessageForPlan(plan: BillingPlanId, maxAccounts: number): string {
  if (plan === "free") return FREE_AD_ACCOUNTS_LIMIT_USER_MESSAGE;
  return `Превышен лимит рекламных аккаунтов для тарифа (максимум ${maxAccounts}). Смените тариф или отключите лишние аккаунты.`;
}

export function isAdAccountPlanLimitApiCode(code: string | undefined | null): boolean {
  return code === PLAN_LIMIT_AD_ACCOUNTS || code === AD_ACCOUNT_PLAN_LIMIT_CODE;
}

export async function getPlanMaxAdAccountsForUser(
  admin: SupabaseClient,
  userId: string,
  userEmail: string | null,
  organizationId?: string | null
): Promise<number | null> {
  const plan = await resolveBillingPlanForUserWithOrg(admin, userId, userEmail, organizationId ?? null);
  return getPlanFeatureMatrix(plan).max_ad_accounts;
}

export function projectedOrgEnabledAfterIntegrationSelection(params: {
  currentOrgEnabled: Set<string>;
  integrationAccountRows: { id: string; external_account_id: string }[];
  selectedExternalIds: Set<string>;
}): number {
  const next = new Set(params.currentOrgEnabled);
  for (const row of params.integrationAccountRows) {
    next.delete(row.id);
  }
  for (const row of params.integrationAccountRows) {
    const ext = String(row.external_account_id ?? "").trim();
    if (ext && params.selectedExternalIds.has(ext)) {
      next.add(row.id);
    }
  }
  return next.size;
}

export async function assertAdAccountSelectionWithinPlanLimit(params: {
  admin: SupabaseClient;
  organizationId: string;
  userId: string;
  userEmail: string | null;
  integrationAccountRows: { id: string; external_account_id: string }[];
  selectedExternalIds: string[];
}): Promise<{ ok: true } | { ok: false; response: NextResponse }> {
  const plan = await resolveBillingPlanForUserWithOrg(
    params.admin,
    params.userId,
    params.userEmail,
    params.organizationId
  );
  const max = getPlanFeatureMatrix(plan).max_ad_accounts;
  if (max == null) return { ok: true };

  let orgSet: Set<string>;
  try {
    orgSet = await collectEnabledAdAccountIdsForOrganization(params.admin, params.organizationId);
  } catch (e) {
    const msg = e instanceof Error ? e.message : "ad account count failed";
    return { ok: false, response: NextResponse.json({ success: false, error: msg }, { status: 500 }) };
  }

  const sel = new Set(
    params.selectedExternalIds.map((x) => String(x).trim()).filter((x) => x.length > 0)
  );
  const projected = projectedOrgEnabledAfterIntegrationSelection({
    currentOrgEnabled: orgSet,
    integrationAccountRows: params.integrationAccountRows,
    selectedExternalIds: sel,
  });

  if (projected > max) {
    const message = adAccountPlanLimitMessageForPlan(plan, max);
    return {
      ok: false,
      response: NextResponse.json(
        {
          success: false,
          error: message,
          code: PLAN_LIMIT_AD_ACCOUNTS,
        },
        { status: 403 }
      ),
    };
  }

  return { ok: true };
}
