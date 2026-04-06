/**
 * Server-side billing snapshot for /api/billing/current-plan and access gates.
 */
import { randomUUID } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import { detectPlanFromPaddleSnapshot } from "@/app/lib/billingPlanPriceDetect";
import { pickTopPaddleSubscriptionRow } from "@/app/lib/billingSubscriptionPick";
import type { BillingPlanId } from "@/app/lib/billingPlanPriceDetect";
import {
  getAccessibleProjectIds,
  getBillingPayerUserForOrganization,
  resolveBillingOrganizationId,
} from "@/app/lib/billingOrganizationContext";
import {
  collectPaddleCustomerIdsForBillingContext,
  resolveActiveEntitlementForBillingContext,
} from "@/app/lib/orgBillingState";
import {
  type AccessState,
  type EffectivePlan,
  resolveAccessState,
  resolveEffectivePlan,
} from "@/app/lib/accessState";
import { resolveBillingShell, type InvitePendingShell } from "@/app/lib/billingShellResolver";
import { isCompleteResolvedUiStateV1, type ResolvedUiStateV1 } from "@/app/lib/billingUiContract";
import {
  getPlanFeatureMatrix,
  normalizeMaxSeatsForEnforcement,
  type PlanFeatureMatrix,
} from "@/app/lib/planConfig";
import { subscriptionRowCountsAsPaidForLoginCheckout } from "@/app/lib/billing/loginCheckoutPaidStatuses";
import { countEnabledAdAccountsForOrganization } from "@/app/lib/dashboardCanonical";
import { getBillableSeatsBreakdownForOrganization } from "@/app/lib/orgSeatPlanLimit";

export {
  getAccessibleProjectIds,
  getBillingPayerUserForOrganization,
  getPrimaryOwnerOrgId,
  resolveBillingOrganizationId,
} from "@/app/lib/billingOrganizationContext";

const ACTIVE_STATUSES = new Set(["active", "trialing", "past_due"]);

export type CurrentPlanSubscription = {
  provider: "paddle" | "entitlement";
  plan: string;
  billing_period: string;
  status: string;
  provider_subscription_id: string | null;
  current_period_start: string | null;
  current_period_end: string | null;
  canceled_at: string | null;
  currency_code: string | null;
  last_event_type: string | null;
  last_event_at: string | null;
  grace_until?: string | null;
};

/** @deprecated use ResolvedUiStateV1 from billingUiContract */
export type ResolvedUiState = ResolvedUiStateV1;

export type OnboardingProgress = {
  flow: "post_checkout";
  step: 1 | 2 | 3;
};

export type BillingCurrentPlanPayload = {
  success: true;
  /** Correlation id for this response (§14.10); mirrors resolved_ui_state.request_id */
  request_id: string;
  primary_org_id: string | null;
  subscription: CurrentPlanSubscription | null;
  access_state: AccessState;
  effective_plan: EffectivePlan;
  requires_post_checkout_onboarding: boolean;
  post_checkout_onboarding_step: number;
  company_profile_completed: boolean;
  onboarding_state: string;
  has_any_accessible_project: boolean;
  has_org_membership: boolean;
  onboarding_progress: OnboardingProgress | null;
  plan_feature_matrix: PlanFeatureMatrix;
  /** Сколько рекламных аккаунтов включено в организации (каноническая семантика дашборда). */
  org_enabled_ad_accounts: number | null;
  feature_flags: BillingFeatureFlagsPayload;
  resolved_ui_state: ResolvedUiStateV1;
};

export type BillingCurrentPlanError = { success: false; error: string };

export type LoadBillingCurrentPlanOptions = {
  requestId?: string;
  /** Открытый проект: биллинг организации этого проекта (invited / project-only). */
  projectId?: string | null;
};

async function fetchPendingPlanChangeForCustomers(
  admin: SupabaseClient,
  customerIds: string[]
): Promise<boolean> {
  if (!customerIds.length) return false;
  const { data } = await admin
    .from("billing_customer_map")
    .select("pending_plan_change")
    .eq("provider", "paddle")
    .in("provider_customer_id", customerIds);
  return (data ?? []).some((r) => r.pending_plan_change === true);
}

async function hasOrgMembership(admin: SupabaseClient, userId: string): Promise<boolean> {
  const { count, error } = await admin
    .from("organization_members")
    .select("id", { count: "exact", head: true })
    .eq("user_id", userId);
  if (error) return false;
  return (count ?? 0) > 0;
}

type SubRow = {
  provider_subscription_id: string;
  provider_customer_id: string | null;
  provider_price_id: string | null;
  provider_product_id: string | null;
  status: string | null;
  currency_code: string | null;
  current_period_start: string | null;
  current_period_end: string | null;
  canceled_at: string | null;
  last_event_type: string | null;
  last_event_at: string | null;
  updated_at: string | null;
  grace_until?: string | null;
};

function pickTopSubscription(list: SubRow[]): SubRow | null {
  return pickTopPaddleSubscriptionRow(list);
}

export async function isCompanyProfileCompleteForOrg(
  admin: SupabaseClient,
  organizationId: string
): Promise<boolean> {
  const { data: org } = await admin.from("organizations").select("name").eq("id", organizationId).maybeSingle();
  const name = String(org?.name ?? "").trim();
  if (!name) return false;
  const { data: crm } = await admin
    .from("organization_crm_profiles")
    .select("owner_full_name, company_size, company_sphere")
    .eq("organization_id", organizationId)
    .maybeSingle();
  const ownerName = String(crm?.owner_full_name ?? "").trim();
  if (!ownerName) return false;
  if (!crm?.company_size || !String(crm.company_size).trim()) return false;
  if (!crm?.company_sphere || !String(crm.company_sphere).trim()) return false;
  return true;
}

async function ensurePostCheckoutRowForNewPayer(
  admin: SupabaseClient,
  userId: string,
  paddleActive: boolean
): Promise<void> {
  if (!paddleActive) return;
  const { data: row } = await admin
    .from("user_post_checkout_onboarding")
    .select("user_id, completed_at")
    .eq("user_id", userId)
    .maybeSingle();
  if (row?.completed_at) return;
  if (row && !row.completed_at) return;
  const now = new Date().toISOString();
  const { error } = await admin.from("user_post_checkout_onboarding").insert({
    user_id: userId,
    current_step: 1,
    updated_at: now,
  });
  if (error && (error as { code?: string }).code !== "23505") {
    console.warn("[POST_CHECKOUT_ONBOARDING_INSERT]", error.message);
  }
}

function demoModeFromEnv(): boolean {
  return process.env.NEXT_PUBLIC_BILLING_DEMO_MODE === "true";
}

export type BillingFeatureFlagsPayload = {
  resolved_ui_shell: boolean;
  over_limit_ui: boolean;
  pending_plan_banner: boolean;
  client_gating: boolean;
};

export function getBillingFeatureFlagsPayload(): BillingFeatureFlagsPayload {
  return {
    resolved_ui_shell: process.env.NEXT_PUBLIC_BILLING_BOOTSTRAP_V2 !== "false",
    over_limit_ui: process.env.NEXT_PUBLIC_BILLING_OVER_LIMIT_UI !== "false",
    pending_plan_banner: process.env.NEXT_PUBLIC_BILLING_PENDING_PLAN_BANNER !== "false",
    client_gating: process.env.NEXT_PUBLIC_BILLING_CLIENT_GATING !== "false",
  };
}

function accessStateAllowsOverLimitCheck(a: AccessState): boolean {
  return (
    a === "active" ||
    a === "trialing" ||
    a === "canceled_until_end" ||
    a === "past_due" ||
    a === "grace_past_due" ||
    a === "paused"
  );
}

const INVITE_SHELL_TIMEOUT_MS = 7000;

async function computeInvitePendingState(
  admin: SupabaseClient,
  userId: string,
  email: string | null,
  hasAnyAccessibleProject: boolean
): Promise<InvitePendingShell> {
  const em = (email ?? "").trim().toLowerCase();
  if (!em) return "none";
  // Уже есть проект — не блокировать шеллом из‑за старых pending invites на тот же email.
  if (hasAnyAccessibleProject) return "none";
  const nowIso = new Date().toISOString();
  const { data: invites } = await admin
    .from("project_invites")
    .select("id,project_id,email,created_at")
    .eq("status", "pending")
    .gt("expires_at", nowIso)
    .ilike("email", em);
  let hasFreshWait = false;
  for (const inv of invites ?? []) {
    if (String(inv.email ?? "").trim().toLowerCase() !== em) continue;
    const { data: pm } = await admin
      .from("project_members")
      .select("id")
      .eq("project_id", inv.project_id)
      .eq("user_id", userId)
      .maybeSingle();
    if (pm) continue;
    const createdTs = inv.created_at ? Date.parse(String(inv.created_at)) : NaN;
    if (Number.isFinite(createdTs) && Date.now() - createdTs >= INVITE_SHELL_TIMEOUT_MS) {
      return "timeout";
    }
    hasFreshWait = true;
  }
  return hasFreshWait ? "waiting" : "none";
}

async function computeOverLimitViolations(
  admin: SupabaseClient,
  organizationId: string,
  matrix: PlanFeatureMatrix
): Promise<NonNullable<ResolvedUiStateV1["over_limit_details"]>> {
  const out: NonNullable<ResolvedUiStateV1["over_limit_details"]> = [];
  if (matrix.max_projects != null) {
    const { count } = await admin
      .from("projects")
      .select("id", { count: "exact", head: true })
      .eq("organization_id", organizationId)
      .eq("archived", false);
    const c = count ?? 0;
    if (c > matrix.max_projects) out.push({ type: "projects", current: c, limit: matrix.max_projects });
  }
  const seatLimit = normalizeMaxSeatsForEnforcement(matrix.max_seats);
  if (seatLimit != null) {
    try {
      const breakdown = await getBillableSeatsBreakdownForOrganization(admin, organizationId);
      const c = breakdown.distinct_union_user_ids.length;
      if (c > seatLimit) {
        if (process.env.NODE_ENV === "development") {
          console.log("[billing][seats_over_limit]", {
            organizationId,
            limit: seatLimit,
            current: c,
            organization_member_user_ids: breakdown.organization_member_user_ids,
            project_member_distinct_user_ids: breakdown.project_member_distinct_user_ids,
            seat_holders_without_org_row: breakdown.seat_holders_without_org_membership_row,
            project_only_seat_details: breakdown.project_only_seat_details,
          });
        }
        out.push({ type: "seats", current: c, limit: seatLimit });
      }
    } catch {
      /* совпадает с прежним поведением при ошибке count: не добавлять seats violation */
    }
  }
  if (matrix.max_ad_accounts != null) {
    const n = await countEnabledAdAccountsForOrganization(admin, organizationId);
    if (n > matrix.max_ad_accounts) out.push({ type: "ad_accounts", current: n, limit: matrix.max_ad_accounts });
  }
  return out;
}

async function buildShellEnrichment(
  admin: SupabaseClient,
  userId: string,
  email: string | null,
  orgId: string | null,
  access_state: AccessState,
  effective_plan: EffectivePlan,
  hasAnyAccessibleProject: boolean
): Promise<{
  invite_pending: InvitePendingShell;
  over_limit_violations: NonNullable<ResolvedUiStateV1["over_limit_details"]>;
}> {
  const invite_pending = await computeInvitePendingState(
    admin,
    userId,
    email,
    hasAnyAccessibleProject
  );
  const matrixPlan: BillingPlanId =
    effective_plan === "starter" || effective_plan === "growth" || effective_plan === "scale"
      ? effective_plan
      : "unknown";
  const matrix = getPlanFeatureMatrix(matrixPlan);
  let over_limit_violations: NonNullable<ResolvedUiStateV1["over_limit_details"]> = [];
  if (orgId && accessStateAllowsOverLimitCheck(access_state)) {
    over_limit_violations = await computeOverLimitViolations(admin, orgId, matrix);
  }
  return { invite_pending, over_limit_violations };
}

function assembleBillingPayload(
  input: {
    subscription: CurrentPlanSubscription | null;
    access_state: AccessState;
    effective_plan: EffectivePlan;
    requires_post_checkout_onboarding: boolean;
    post_checkout_onboarding_step: number;
    company_profile_completed: boolean;
    onboarding_state: string;
    has_any_accessible_project: boolean;
    has_org_membership: boolean;
    pending_plan_change_db: boolean;
    primary_org_id: string | null;
    org_enabled_ad_accounts: number | null;
    invite_pending: InvitePendingShell;
    over_limit_violations: NonNullable<ResolvedUiStateV1["over_limit_details"]>;
  },
  requestId: string
): BillingCurrentPlanPayload | BillingCurrentPlanError {
  const resolved = resolveBillingShell({
    access_state: input.access_state,
    requires_post_checkout_onboarding: input.requires_post_checkout_onboarding,
    invite_pending: input.invite_pending,
    has_org_membership: input.has_org_membership,
    has_any_accessible_project: input.has_any_accessible_project,
    pending_plan_change_db: input.pending_plan_change_db,
    over_limit_violations: input.over_limit_violations,
    demo_mode: demoModeFromEnv(),
    request_id: requestId,
  });

  const resolvedWithRid = { ...resolved, request_id: requestId };
  if (!isCompleteResolvedUiStateV1(resolvedWithRid)) {
    return { success: false, error: "resolved_ui_state contract violation" };
  }

  const matrixPlan: BillingPlanId =
    input.effective_plan === "starter" ||
    input.effective_plan === "growth" ||
    input.effective_plan === "scale"
      ? input.effective_plan
      : "unknown";
  const plan_feature_matrix = getPlanFeatureMatrix(matrixPlan);

  const step = Math.min(3, Math.max(1, input.post_checkout_onboarding_step)) as 1 | 2 | 3;
  const onboarding_progress: OnboardingProgress | null = input.requires_post_checkout_onboarding
    ? { flow: "post_checkout", step }
    : null;

  return {
    success: true,
    request_id: requestId,
    primary_org_id: input.primary_org_id,
    subscription: input.subscription,
    access_state: input.access_state,
    effective_plan: input.effective_plan,
    requires_post_checkout_onboarding: input.requires_post_checkout_onboarding,
    post_checkout_onboarding_step: input.post_checkout_onboarding_step,
    company_profile_completed: input.company_profile_completed,
    onboarding_state: input.onboarding_state,
    has_any_accessible_project: input.has_any_accessible_project,
    has_org_membership: input.has_org_membership,
    plan_feature_matrix,
    org_enabled_ad_accounts: input.org_enabled_ad_accounts,
    onboarding_progress,
    feature_flags: getBillingFeatureFlagsPayload(),
    resolved_ui_state: resolvedWithRid,
  };
}

export async function loadBillingCurrentPlan(
  admin: SupabaseClient,
  userId: string,
  email: string | null,
  options?: LoadBillingCurrentPlanOptions
): Promise<BillingCurrentPlanPayload | BillingCurrentPlanError> {
  const requestId = options?.requestId ?? randomUUID();
  const nowIso = new Date().toISOString();

  const has_org_membership = await hasOrgMembership(admin, userId);
  const projectIds = await getAccessibleProjectIds(admin, userId);
  const has_any_accessible_project = projectIds.size > 0;
  let billingOrgId = await resolveBillingOrganizationId(
    admin,
    userId,
    options?.projectId ?? null,
    projectIds
  );
  const em = (email ?? "").trim().toLowerCase();
  if (!billingOrgId && em) {
    const { data: mapOrg } = await admin
      .from("billing_customer_map")
      .select("organization_id")
      .eq("provider", "paddle")
      .eq("email", em)
      .not("organization_id", "is", null)
      .order("updated_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (mapOrg?.organization_id) billingOrgId = String(mapOrg.organization_id);
  }
  const company_profile_completed = billingOrgId
    ? await isCompanyProfileCompleteForOrg(admin, billingOrgId)
    : false;
  let org_enabled_ad_accounts: number | null = null;
  if (billingOrgId) {
    try {
      org_enabled_ad_accounts = await countEnabledAdAccountsForOrganization(admin, billingOrgId);
    } catch {
      org_enabled_ad_accounts = null;
    }
  }

  const payer = billingOrgId ? await getBillingPayerUserForOrganization(admin, billingOrgId) : null;
  const billingUserId = payer?.userId ?? userId;
  const billingEmail = payer?.email ?? email;

  const activeEntitlement = await resolveActiveEntitlementForBillingContext(admin, nowIso, billingOrgId);

  if (activeEntitlement?.plan_override) {
    const plan = String(activeEntitlement.plan_override).toLowerCase();
    const normalizedPlan =
      plan === "agency"
        ? "scale"
        : plan === "starter" || plan === "growth" || plan === "scale"
          ? plan
          : "unknown";
    const subscription: CurrentPlanSubscription = {
      provider: "entitlement",
      plan: normalizedPlan,
      billing_period: "unknown",
      status: "active",
      provider_subscription_id: null,
      current_period_start: activeEntitlement.starts_at ?? null,
      current_period_end: activeEntitlement.ends_at ?? null,
      canceled_at: null,
      currency_code: null,
      last_event_type: "entitlement.active",
      last_event_at: activeEntitlement.updated_at ?? null,
    };
    const access_state = resolveAccessState(
      { ...subscription, plan: subscription.plan },
      { isEntitlement: true }
    );
    const effective_plan = resolveEffectivePlan(normalizedPlan);
    const requires_post_checkout_onboarding = false;
    let onboarding_state = "ok";
    if (!has_any_accessible_project) onboarding_state = "paid_but_no_project";
    const shell = await buildShellEnrichment(
      admin,
      userId,
      email,
      billingOrgId,
      access_state,
      effective_plan,
      has_any_accessible_project
    );
    return assembleBillingPayload(
      {
        subscription,
        access_state,
        effective_plan,
        requires_post_checkout_onboarding,
        post_checkout_onboarding_step: 3,
        company_profile_completed,
        onboarding_state,
        has_any_accessible_project,
        has_org_membership,
        pending_plan_change_db: false,
        primary_org_id: billingOrgId,
        org_enabled_ad_accounts,
        invite_pending: shell.invite_pending,
        over_limit_violations: shell.over_limit_violations,
      },
      requestId
    );
  }

  const customerIds = await collectPaddleCustomerIdsForBillingContext(admin, billingOrgId);
  const pending_plan_change_db = await fetchPendingPlanChangeForCustomers(admin, customerIds);

  if (customerIds.length === 0) {
    const access_state: AccessState = "no_subscription";
    const shell = await buildShellEnrichment(
      admin,
      userId,
      email,
      billingOrgId,
      access_state,
      null,
      has_any_accessible_project
    );
    return assembleBillingPayload(
      {
        subscription: null,
        access_state,
        effective_plan: null,
        requires_post_checkout_onboarding: false,
        post_checkout_onboarding_step: 1,
        company_profile_completed,
        onboarding_state: "no_subscription",
        has_any_accessible_project,
        has_org_membership,
        pending_plan_change_db: false,
        primary_org_id: billingOrgId,
        org_enabled_ad_accounts,
        invite_pending: shell.invite_pending,
        over_limit_violations: shell.over_limit_violations,
      },
      requestId
    );
  }

  const { data: subs, error: subsErr } = await admin
    .from("billing_subscriptions")
    .select(
      "provider_subscription_id, provider_customer_id, provider_price_id, provider_product_id, status, currency_code, current_period_start, current_period_end, canceled_at, last_event_type, last_event_at, updated_at, grace_until"
    )
    .eq("provider", "paddle")
    .in("provider_customer_id", customerIds)
    .order("updated_at", { ascending: false })
    .limit(20);

  if (subsErr) {
    return { success: false, error: subsErr.message };
  }

  const list = (subs ?? []) as SubRow[];
  if (!list.length) {
    const access_state: AccessState = "no_subscription";
    const shell = await buildShellEnrichment(
      admin,
      userId,
      email,
      billingOrgId,
      access_state,
      null,
      has_any_accessible_project
    );
    return assembleBillingPayload(
      {
        subscription: null,
        access_state,
        effective_plan: null,
        requires_post_checkout_onboarding: false,
        post_checkout_onboarding_step: 1,
        company_profile_completed,
        onboarding_state: "no_subscription",
        has_any_accessible_project,
        has_org_membership,
        pending_plan_change_db: false,
        primary_org_id: billingOrgId,
        org_enabled_ad_accounts,
        invite_pending: shell.invite_pending,
        over_limit_violations: shell.over_limit_violations,
      },
      requestId
    );
  }

  const top = pickTopSubscription(list);
  if (!top) {
    return { success: false, error: "No subscription row" };
  }

  const topStatusRaw = String(top.status ?? "unknown").toLowerCase();
  const topPeriodEndTs = Date.parse(String(top.current_period_end ?? ""));
  const isExpiredByDate =
    Number.isFinite(topPeriodEndTs) && topStatusRaw !== "canceled" && topStatusRaw !== "inactive"
      ? Date.now() > topPeriodEndTs
      : false;
  const displayStatus = isExpiredByDate ? "expired" : topStatusRaw;
  const planMeta = detectPlanFromPaddleSnapshot(
    top.provider_price_id ?? null,
    top.provider_product_id ?? null
  );

  const subscription: CurrentPlanSubscription = {
    provider: "paddle",
    plan: planMeta.plan,
    billing_period: planMeta.billing,
    status: displayStatus,
    provider_subscription_id: top.provider_subscription_id,
    current_period_start: top.current_period_start,
    current_period_end: top.current_period_end,
    canceled_at: top.canceled_at,
    currency_code: top.currency_code,
    last_event_type: top.last_event_type,
    last_event_at: top.last_event_at,
    grace_until: top.grace_until ?? null,
  };

  const access_state = resolveAccessState(
    {
      status: displayStatus,
      plan: subscription.plan,
      canceled_at: subscription.canceled_at,
      current_period_end: subscription.current_period_end,
      last_event_type: subscription.last_event_type,
      grace_until: subscription.grace_until,
    },
    { isExpiredByPeriodEnd: isExpiredByDate }
  );

  const effective_plan = resolveEffectivePlan(planMeta.plan === "unknown" ? null : planMeta.plan);

  const paddlePaid =
    !isExpiredByDate && subscriptionRowCountsAsPaidForLoginCheckout(displayStatus);
  await ensurePostCheckoutRowForNewPayer(
    admin,
    userId,
    paddlePaid && billingUserId === userId
  );

  const { data: pcRow } = await admin
    .from("user_post_checkout_onboarding")
    .select("current_step, completed_at")
    .eq("user_id", userId)
    .maybeSingle();

  const requires_post_checkout_onboarding = Boolean(
    paddlePaid && pcRow && !pcRow.completed_at
  );
  const post_checkout_onboarding_step = Math.min(
    3,
    Math.max(1, Number(pcRow?.current_step ?? 1) || 1)
  );

  let onboarding_state = "ok";
  if (requires_post_checkout_onboarding) onboarding_state = "post_checkout_required_onboarding";
  else if (paddlePaid && !has_any_accessible_project) onboarding_state = "paid_but_no_project";
  else if (!paddlePaid && access_state === "no_subscription") onboarding_state = "no_subscription";

  const shell = await buildShellEnrichment(
    admin,
    userId,
    email,
    billingOrgId,
    access_state,
    effective_plan,
    has_any_accessible_project
  );
  return assembleBillingPayload(
    {
      subscription,
      access_state,
      effective_plan,
      requires_post_checkout_onboarding,
      post_checkout_onboarding_step,
      company_profile_completed,
      onboarding_state,
      has_any_accessible_project,
      has_org_membership,
      pending_plan_change_db,
      primary_org_id: billingOrgId,
      org_enabled_ad_accounts,
      invite_pending: shell.invite_pending,
      over_limit_violations: shell.over_limit_violations,
    },
    requestId
  );
}

export async function resolveBillingGateContext(
  admin: SupabaseClient,
  userId: string,
  email: string | null,
  opts?: { projectId?: string | null }
): Promise<{ access_state: AccessState; effective_plan: EffectivePlan }> {
  const r = await loadBillingCurrentPlan(admin, userId, email, {
    requestId: `gate-${randomUUID()}`,
    projectId: opts?.projectId ?? null,
  });
  if (!r.success) return { access_state: "no_subscription", effective_plan: null };
  return { access_state: r.access_state, effective_plan: r.effective_plan };
}
