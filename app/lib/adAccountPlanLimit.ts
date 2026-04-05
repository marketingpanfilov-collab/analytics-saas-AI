import { NextResponse } from "next/server";
import type { SupabaseClient } from "@supabase/supabase-js";
import { collectEnabledAdAccountIdsForOrganization } from "@/app/lib/dashboardCanonical";
import { resolveBillingPlanForUserWithOrg } from "@/app/lib/billingPlan";
import { getPlanFeatureMatrix } from "@/app/lib/planConfig";

export const AD_ACCOUNT_PLAN_LIMIT_USER_MESSAGE =
  "Достигнут лимит подключённых рекламных аккаунтов для вашего тарифа. Смените тариф или отключите аккаунты в других проектах.";

export const AD_ACCOUNT_PLAN_LIMIT_CODE = "AD_ACCOUNT_PLAN_LIMIT" as const;

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
  const max = await getPlanMaxAdAccountsForUser(
    params.admin,
    params.userId,
    params.userEmail,
    params.organizationId
  );
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
    return {
      ok: false,
      response: NextResponse.json(
        {
          success: false,
          error: AD_ACCOUNT_PLAN_LIMIT_USER_MESSAGE,
          code: AD_ACCOUNT_PLAN_LIMIT_CODE,
        },
        { status: 403 }
      ),
    };
  }

  return { ok: true };
}
