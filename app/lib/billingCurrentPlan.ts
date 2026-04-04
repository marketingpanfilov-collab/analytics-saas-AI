/**
 * Server-side billing snapshot for /api/billing/current-plan and access gates.
 */
import { randomUUID } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import { detectPlanFromPriceId } from "@/app/lib/billingPlan";
import type { BillingPlanId } from "@/app/lib/billingPlan";
import {
  type AccessState,
  type EffectivePlan,
  resolveAccessState,
  resolveEffectivePlan,
} from "@/app/lib/accessState";
import { resolveBillingShell, type InvitePendingShell } from "@/app/lib/billingShellResolver";
import { isCompleteResolvedUiStateV1, type ResolvedUiStateV1 } from "@/app/lib/billingUiContract";
import { getPlanFeatureMatrix, type PlanFeatureMatrix } from "@/app/lib/planConfig";

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
  feature_flags: BillingFeatureFlagsPayload;
  resolved_ui_state: ResolvedUiStateV1;
};

export type BillingCurrentPlanError = { success: false; error: string };

export type LoadBillingCurrentPlanOptions = {
  requestId?: string;
};

async function collectPaddleCustomerIds(
  admin: SupabaseClient,
  userId: string,
  email: string | null
): Promise<string[]> {
  const customerIds = new Set<string>();
  const { data: byUser } = await admin
    .from("billing_customer_map")
    .select("provider_customer_id")
    .eq("provider", "paddle")
    .eq("user_id", userId)
    .order("updated_at", { ascending: false })
    .limit(5);
  for (const r of byUser ?? []) {
    if (r.provider_customer_id) customerIds.add(String(r.provider_customer_id));
  }
  const em = (email ?? "").trim().toLowerCase();
  if (customerIds.size === 0 && em) {
    const { data: byEmail } = await admin
      .from("billing_customer_map")
      .select("provider_customer_id")
      .eq("provider", "paddle")
      .eq("email", em)
      .order("updated_at", { ascending: false })
      .limit(5);
    for (const r of byEmail ?? []) {
      if (r.provider_customer_id) customerIds.add(String(r.provider_customer_id));
    }
  }
  return Array.from(customerIds);
}

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
  if (!list.length) return null;
  const activeFirst = [...list].sort((a, b) => {
    const aActive = ACTIVE_STATUSES.has(String(a.status ?? "").toLowerCase()) ? 1 : 0;
    const bActive = ACTIVE_STATUSES.has(String(b.status ?? "").toLowerCase()) ? 1 : 0;
    if (aActive !== bActive) return bActive - aActive;
    const aTs = Date.parse(String(a.current_period_end ?? a.updated_at ?? "")) || 0;
    const bTs = Date.parse(String(b.current_period_end ?? b.updated_at ?? "")) || 0;
    return bTs - aTs;
  });
  return activeFirst[0] ?? null;
}

export async function getAccessibleProjectIds(admin: SupabaseClient, userId: string): Promise<Set<string>> {
  const ids = new Set<string>();
  const { data: om } = await admin
    .from("organization_members")
    .select("organization_id, role")
    .eq("user_id", userId);
  for (const m of om ?? []) {
    const role = String(m.role ?? "member");
    if (role === "owner" || role === "admin" || role === "agency") {
      const { data: projs } = await admin
        .from("projects")
        .select("id")
        .eq("organization_id", m.organization_id)
        .eq("archived", false);
      for (const p of projs ?? []) ids.add(String(p.id));
    }
  }
  const { data: pms } = await admin.from("project_members").select("project_id").eq("user_id", userId);
  const pids = [...new Set((pms ?? []).map((p) => p.project_id).filter(Boolean))] as string[];
  if (pids.length) {
    const { data: projs } = await admin.from("projects").select("id").in("id", pids).eq("archived", false);
    for (const p of projs ?? []) ids.add(String(p.id));
  }
  return ids;
}

export async function getPrimaryOwnerOrgId(admin: SupabaseClient, userId: string): Promise<string | null> {
  const { data: rows } = await admin
    .from("organization_members")
    .select("organization_id, role, created_at")
    .eq("user_id", userId)
    .order("created_at", { ascending: true });
  const list = rows ?? [];
  const owner = list.find((r) => String(r.role) === "owner");
  if (owner?.organization_id) return String(owner.organization_id);
  if (list[0]?.organization_id) return String(list[0].organization_id);
  return null;
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
  email: string | null
): Promise<InvitePendingShell> {
  const em = (email ?? "").trim().toLowerCase();
  if (!em) return "none";
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

async function countEnabledAdAccountsForOrg(admin: SupabaseClient, organizationId: string): Promise<number> {
  const { data: projects } = await admin
    .from("projects")
    .select("id")
    .eq("organization_id", organizationId)
    .eq("archived", false);
  const pids = (projects ?? []).map((p) => String(p.id));
  if (!pids.length) return 0;
  const { data: integrations } = await admin.from("integrations").select("id").in("project_id", pids);
  const iids = (integrations ?? []).map((i) => String(i.id));
  if (!iids.length) return 0;
  const { count } = await admin
    .from("ad_accounts")
    .select("id", { count: "exact", head: true })
    .in("integration_id", iids)
    .eq("is_enabled", true);
  return count ?? 0;
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
  if (matrix.max_seats != null) {
    const { count } = await admin
      .from("organization_members")
      .select("id", { count: "exact", head: true })
      .eq("organization_id", organizationId);
    const c = count ?? 0;
    if (c > matrix.max_seats) out.push({ type: "seats", current: c, limit: matrix.max_seats });
  }
  if (matrix.max_ad_accounts != null) {
    const n = await countEnabledAdAccountsForOrg(admin, organizationId);
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
  effective_plan: EffectivePlan
): Promise<{
  invite_pending: InvitePendingShell;
  over_limit_violations: NonNullable<ResolvedUiStateV1["over_limit_details"]>;
}> {
  const invite_pending = await computeInvitePendingState(admin, userId, email);
  const matrixPlan: BillingPlanId =
    effective_plan === "starter" || effective_plan === "growth" || effective_plan === "agency"
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
    input.effective_plan === "agency"
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
  const orgId = await getPrimaryOwnerOrgId(admin, userId);
  const company_profile_completed = orgId ? await isCompanyProfileCompleteForOrg(admin, orgId) : false;

  const { data: entitlements } = await admin
    .from("billing_entitlements")
    .select("id, plan_override, status, starts_at, ends_at, source, reason, updated_at")
    .eq("user_id", userId)
    .eq("status", "active")
    .order("updated_at", { ascending: false })
    .limit(10);

  const activeEntitlement = (entitlements ?? []).find((e) => {
    const startsAt = e.starts_at ? Date.parse(String(e.starts_at)) : 0;
    const endsAt = e.ends_at ? Date.parse(String(e.ends_at)) : null;
    const nowTs = Date.parse(nowIso);
    if (Number.isFinite(startsAt) && nowTs < startsAt) return false;
    if (endsAt != null && Number.isFinite(endsAt) && nowTs > endsAt) return false;
    return true;
  });

  if (activeEntitlement?.plan_override) {
    const plan = String(activeEntitlement.plan_override).toLowerCase();
    const normalizedPlan =
      plan === "starter" || plan === "growth" || plan === "agency" ? plan : "unknown";
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
    const shell = await buildShellEnrichment(admin, userId, email, orgId, access_state, effective_plan);
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
        primary_org_id: orgId,
        invite_pending: shell.invite_pending,
        over_limit_violations: shell.over_limit_violations,
      },
      requestId
    );
  }

  const customerIds = await collectPaddleCustomerIds(admin, userId, email);
  const pending_plan_change_db = await fetchPendingPlanChangeForCustomers(admin, customerIds);

  if (customerIds.length === 0) {
    const access_state: AccessState = "no_subscription";
    const shell = await buildShellEnrichment(admin, userId, email, orgId, access_state, null);
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
        primary_org_id: orgId,
        invite_pending: shell.invite_pending,
        over_limit_violations: shell.over_limit_violations,
      },
      requestId
    );
  }

  const { data: subs, error: subsErr } = await admin
    .from("billing_subscriptions")
    .select(
      "provider_subscription_id, provider_customer_id, provider_price_id, status, currency_code, current_period_start, current_period_end, canceled_at, last_event_type, last_event_at, updated_at, grace_until"
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
    const shell = await buildShellEnrichment(admin, userId, email, orgId, access_state, null);
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
        primary_org_id: orgId,
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
  const planMeta = detectPlanFromPriceId(top.provider_price_id ?? null);

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
    (displayStatus === "active" || displayStatus === "trialing") && !isExpiredByDate;
  await ensurePostCheckoutRowForNewPayer(admin, userId, paddlePaid);

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

  const shell = await buildShellEnrichment(admin, userId, email, orgId, access_state, effective_plan);
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
      primary_org_id: orgId,
      invite_pending: shell.invite_pending,
      over_limit_violations: shell.over_limit_violations,
    },
    requestId
  );
}

export async function resolveBillingGateContext(
  admin: SupabaseClient,
  userId: string,
  email: string | null
): Promise<{ access_state: AccessState; effective_plan: EffectivePlan }> {
  const r = await loadBillingCurrentPlan(admin, userId, email, {
    requestId: `gate-${randomUUID()}`,
  });
  if (!r.success) return { access_state: "no_subscription", effective_plan: null };
  return { access_state: r.access_state, effective_plan: r.effective_plan };
}
