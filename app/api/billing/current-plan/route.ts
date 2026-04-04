import { randomUUID } from "node:crypto";
import { NextResponse } from "next/server";
import { createServerSupabase } from "@/app/lib/supabaseServer";
import { supabaseAdmin } from "@/app/lib/supabaseAdmin";
import { loadBillingCurrentPlan } from "@/app/lib/billingCurrentPlan";
import { logBillingUiTransition } from "@/app/lib/logBillingUiTransition";

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

  const admin = supabaseAdmin();
  const email = (user.email ?? "").trim().toLowerCase() || null;
  const payload = await loadBillingCurrentPlan(admin, user.id, email, { requestId });

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
  const body = {
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
    feature_flags: rest.feature_flags,
    resolved_ui_state: rest.resolved_ui_state,
  };

  return NextResponse.json(body, { headers: { "x-request-id": requestId } });
}
