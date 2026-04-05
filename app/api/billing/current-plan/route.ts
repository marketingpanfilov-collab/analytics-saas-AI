import { randomUUID } from "node:crypto";
import { NextResponse } from "next/server";
import { createServerSupabase } from "@/app/lib/supabaseServer";
import { supabaseAdmin } from "@/app/lib/supabaseAdmin";
import { loadBillingCurrentPlan } from "@/app/lib/billingCurrentPlan";
import { logBillingUiTransition } from "@/app/lib/logBillingUiTransition";
import { getBillableSeatsBreakdownForOrganization } from "@/app/lib/orgSeatPlanLimit";
import { normalizeMaxSeatsForEnforcement } from "@/app/lib/planConfig";

export async function GET(request: Request) {
  const supabase = await createServerSupabase();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ success: false, error: "Unauthorized" }, { status: 401 });
  }

  const incoming = request.headers.get("x-request-id")?.trim();
  const requestId = incoming && incoming.length > 0 ? incoming : randomUUID();
  const sp = new URL(request.url).searchParams;
  const seatAudit = sp.get("seat_audit") === "1";
  const projectId = sp.get("project_id")?.trim() || null;

  const admin = supabaseAdmin();
  const email = (user.email ?? "").trim().toLowerCase() || null;
  const payload = await loadBillingCurrentPlan(admin, user.id, email, { requestId, projectId });

  if (!payload.success) {
    return NextResponse.json(
      { success: false, error: payload.error, request_id: requestId },
      { status: 500, headers: { "x-request-id": requestId } }
    );
  }

  await logBillingUiTransition(admin, {
    userId: user.id,
    orgId: payload.primary_org_id,
    nextScreen: payload.resolved_ui_state.screen,
    nextReason: payload.resolved_ui_state.reason,
    requestId,
    source: "bootstrap",
  });

  const { success: _s, ...rest } = payload;
  const body: Record<string, unknown> = {
    success: true as const,
    request_id: rest.request_id,
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
  };

  if (seatAudit && rest.primary_org_id) {
    try {
      const breakdown = await getBillableSeatsBreakdownForOrganization(admin, rest.primary_org_id);
      const limit = normalizeMaxSeatsForEnforcement(rest.plan_feature_matrix.max_seats);
      const unionCount = breakdown.distinct_union_user_ids.length;
      body.billable_seats_audit = breakdown;
      body.seat_enforcement = {
        primary_org_id: rest.primary_org_id,
        max_seats_raw: rest.plan_feature_matrix.max_seats,
        max_seats_normalized_for_enforcement: limit,
        distinct_union_count: unionCount,
        seats_violation_active: limit != null && unionCount > limit,
      };
    } catch (e) {
      body.billable_seats_audit_error = e instanceof Error ? e.message : "audit_failed";
    }
  }

  return NextResponse.json(body, { headers: { "x-request-id": requestId } });
}
