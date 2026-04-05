import { randomUUID } from "node:crypto";
import { NextResponse } from "next/server";
import { createServerSupabase } from "@/app/lib/supabaseServer";
import { supabaseAdmin } from "@/app/lib/supabaseAdmin";
import { isBillingBlocking } from "@/app/lib/billingBootstrapClient";
import { loadBillingCurrentPlan } from "@/app/lib/billingCurrentPlan";
import { logBillingUiTransition } from "@/app/lib/logBillingUiTransition";

/**
 * POST /api/billing/reconcile-latest-checkout
 * Soft recovery: re-read DB (customer map, subscriptions, failures hint) and return fresh bootstrap.
 * Does not create charges or call Paddle unless extended later.
 */
export async function POST(req: Request) {
  const supabase = await createServerSupabase();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ success: false, error: "Unauthorized" }, { status: 401 });
  }

  let checkoutAttemptId: string | null = null;
  try {
    const body = (await req.json()) as { checkout_attempt_id?: unknown };
    const raw = body?.checkout_attempt_id;
    checkoutAttemptId = typeof raw === "string" && raw.trim() ? raw.trim() : null;
  } catch {
    checkoutAttemptId = null;
  }

  const requestId = randomUUID();
  const admin = supabaseAdmin();
  const email = (user.email ?? "").trim().toLowerCase() || null;
  const payload = await loadBillingCurrentPlan(admin, user.id, email, { requestId, projectId: null });

  if (!payload.success) {
    return NextResponse.json(
      { success: false, error: payload.error, request_id: requestId, checkout_attempt_id: checkoutAttemptId },
      { status: 500, headers: { "x-request-id": requestId } }
    );
  }

  const orgId = payload.primary_org_id ?? null;
  let hasCustomerMap = false;
  let hasSubRow = false;
  let webhookFailuresForOrg24h = 0;

  if (orgId) {
    const since = new Date(Date.now() - 24 * 3600_000).toISOString();
    const { data: cm } = await admin
      .from("billing_customer_map")
      .select("id")
      .eq("provider", "paddle")
      .eq("organization_id", orgId)
      .limit(1);
    hasCustomerMap = Boolean(cm?.length);

    const { data: sub } = await admin
      .from("billing_subscriptions")
      .select("id")
      .eq("provider", "paddle")
      .eq("organization_id", orgId)
      .limit(1);
    hasSubRow = Boolean(sub?.length);

    const { data: failRows } = await admin
      .from("billing_webhook_failures")
      .select("details")
      .gte("created_at", since)
      .limit(120);
    webhookFailuresForOrg24h = (failRows ?? []).filter((r) => {
      const d = r.details as Record<string, unknown> | null | undefined;
      const oid = d?.organization_id;
      return oid != null && String(oid) === String(orgId);
    }).length;
  }

  await logBillingUiTransition(admin, {
    userId: user.id,
    orgId: payload.primary_org_id,
    nextScreen: payload.resolved_ui_state.screen,
    nextReason: payload.resolved_ui_state.reason,
    requestId,
    source: "user_action",
  });

  const { success: _s, ...rest } = payload;
  const accessReady = !isBillingBlocking(payload.resolved_ui_state);

  return NextResponse.json(
    {
      success: true as const,
      request_id: rest.request_id,
      checkout_attempt_id: checkoutAttemptId,
      access_ready: accessReady,
      reconcile: {
        primary_org_id: orgId,
        has_billing_customer_map: hasCustomerMap,
        has_billing_subscription_row: hasSubRow,
        webhook_failures_for_org_24h: webhookFailuresForOrg24h,
      },
      client_safe_mode: false as const,
      primary_org_id: rest.primary_org_id,
      subscription: rest.subscription,
      access_state: rest.access_state,
      effective_plan: rest.effective_plan,
      requires_post_checkout_onboarding: rest.requires_post_checkout_onboarding,
      post_checkout_onboarding_step: rest.post_checkout_onboarding_step,
      company_profile_completed: rest.company_profile_completed,
      onboarding_state: rest.onboarding_state,
      has_any_accessible_project: rest.has_any_accessible_project,
      has_org_membership: rest.has_org_membership,
      onboarding_progress: rest.onboarding_progress,
      plan_feature_matrix: rest.plan_feature_matrix,
      org_enabled_ad_accounts: rest.org_enabled_ad_accounts,
      feature_flags: rest.feature_flags,
      resolved_ui_state: rest.resolved_ui_state,
    },
    { headers: { "x-request-id": requestId } }
  );
}
