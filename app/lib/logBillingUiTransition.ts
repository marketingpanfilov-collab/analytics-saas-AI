/**
 * §14.3 / §14.11 — log_ui_state_transition with dedup (same next screen+reason within window).
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import { RESOLVED_UI_CONTRACT_VERSION } from "@/app/lib/billingUiContract";

const DEDUP_MS = 4000;

export type UiTransitionSource =
  | "bootstrap"
  | "user_action"
  | "webhook"
  | "multitab"
  | "client_shell";

export async function logBillingUiTransition(
  admin: SupabaseClient,
  params: {
    userId: string;
    orgId: string | null;
    nextScreen: string;
    nextReason: string;
    requestId: string;
    source: UiTransitionSource;
  }
): Promise<void> {
  const { data: last } = await admin
    .from("billing_ui_state_transitions")
    .select("next_screen, next_reason, created_at")
    .eq("user_id", params.userId)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (last?.next_screen === params.nextScreen && last?.next_reason === params.nextReason) {
    const ts = last.created_at ? Date.parse(String(last.created_at)) : 0;
    if (Number.isFinite(ts) && Date.now() - ts < DEDUP_MS) return;
  }

  const prev_screen = last?.next_screen ?? null;
  const prev_reason = last?.next_reason ?? null;

  const { error } = await admin.from("billing_ui_state_transitions").insert({
    user_id: params.userId,
    org_id: params.orgId,
    prev_screen,
    prev_reason,
    next_screen: params.nextScreen,
    next_reason: params.nextReason,
    request_id: params.requestId,
    version: RESOLVED_UI_CONTRACT_VERSION,
    source: params.source,
  });

  if (error) {
    console.warn("[BILLING_UI_TRANSITION_LOG]", error.message);
  }
}
