/**
 * Единая логика привязки пользователя к org после login-checkout (email confirm или сразу после оплаты).
 * Вызывается из POST /api/auth/finalize-login-checkout и из GET /auth/callback.
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import { subscriptionRowCountsAsPaidForLoginCheckout } from "@/app/lib/billing/loginCheckoutPaidStatuses";

const UUID_RE = /^[0-9a-f-]{36}$/i;

export type FinalizeLoginCheckoutCoreErrorCode =
  | "invalid_organization_id"
  | "no_pending_checkout"
  | "intent_org_mismatch"
  | "already_finalized"
  | "subscription_not_active_yet"
  | "organization_members_insert_failed";

export type FinalizeLoginCheckoutCoreResult =
  | { ok: true; organization_id: string; already_member: boolean }
  | { ok: false; code: FinalizeLoginCheckoutCoreErrorCode; message: string; status: number };

/**
 * @param organizationId — если не передан, берётся из открытого billing_login_checkout_intents (linked_at IS NULL) по email.
 */
export async function runFinalizeLoginCheckoutCore(
  admin: SupabaseClient,
  params: {
    userId: string;
    sessionEmailNormalized: string;
    organizationId?: string | null;
  }
): Promise<FinalizeLoginCheckoutCoreResult> {
  const sessionEmail = params.sessionEmailNormalized.trim().toLowerCase();
  if (!sessionEmail) {
    return { ok: false, code: "no_pending_checkout", message: "Missing email", status: 400 };
  }

  const { data: openIntent } = await admin
    .from("billing_login_checkout_intents")
    .select("organization_id")
    .eq("email_normalized", sessionEmail)
    .is("linked_at", null)
    .maybeSingle();

  let organizationId = String(params.organizationId ?? "").trim();
  if (!organizationId && openIntent?.organization_id) {
    organizationId = String(openIntent.organization_id);
  }

  if (openIntent?.organization_id && organizationId && String(openIntent.organization_id) !== organizationId) {
    return {
      ok: false,
      code: "intent_org_mismatch",
      message: "organization_id does not match pending checkout",
      status: 400,
    };
  }

  if (!UUID_RE.test(organizationId)) {
    return {
      ok: false,
      code: "invalid_organization_id",
      message: "Invalid or missing organization_id",
      status: 400,
    };
  }

  const { data: intent, error: intentErr } = await admin
    .from("billing_login_checkout_intents")
    .select("email_normalized, linked_at")
    .eq("email_normalized", sessionEmail)
    .eq("organization_id", organizationId)
    .maybeSingle();

  if (intentErr) {
    console.error("[finalize-login-checkout-core] intent", intentErr.message);
    return {
      ok: false,
      code: "no_pending_checkout",
      message: "Database error",
      status: 500,
    };
  }

  const { data: existingMember } = await admin
    .from("organization_members")
    .select("id")
    .eq("organization_id", organizationId)
    .eq("user_id", params.userId)
    .maybeSingle();

  if (existingMember) {
    if (intent && !intent.linked_at) {
      await admin
        .from("billing_login_checkout_intents")
        .update({ linked_at: new Date().toISOString() })
        .eq("email_normalized", sessionEmail);
    }
    await admin
      .from("billing_customer_map")
      .update({ user_id: params.userId, updated_at: new Date().toISOString() })
      .eq("provider", "paddle")
      .eq("organization_id", organizationId)
      .eq("email", sessionEmail);
    return { ok: true, organization_id: organizationId, already_member: true };
  }

  if (!intent) {
    return {
      ok: false,
      code: "no_pending_checkout",
      message: "No pending checkout for this account",
      status: 404,
    };
  }

  if (intent.linked_at) {
    return {
      ok: false,
      code: "already_finalized",
      message: "Already finalized",
      status: 409,
    };
  }

  const { data: subs } = await admin
    .from("billing_subscriptions")
    .select("id, status")
    .eq("organization_id", organizationId)
    .eq("provider", "paddle")
    .limit(5);

  const paid = (subs ?? []).some((s) => subscriptionRowCountsAsPaidForLoginCheckout(s.status));
  if (!paid) {
    return {
      ok: false,
      code: "subscription_not_active_yet",
      message: "Subscription not active yet",
      status: 409,
    };
  }

  const now = new Date().toISOString();
  const { error: omErr } = await admin.from("organization_members").insert({
    organization_id: organizationId,
    user_id: params.userId,
    role: "owner",
    created_at: now,
  });

  if (omErr) {
    console.error("[finalize-login-checkout-core] organization_members", omErr.message);
    return {
      ok: false,
      code: "organization_members_insert_failed",
      message: omErr.message,
      status: 500,
    };
  }

  await admin
    .from("billing_customer_map")
    .update({ user_id: params.userId, updated_at: now })
    .eq("provider", "paddle")
    .eq("organization_id", organizationId)
    .eq("email", sessionEmail);

  await admin
    .from("billing_login_checkout_intents")
    .update({ linked_at: now })
    .eq("email_normalized", sessionEmail)
    .eq("organization_id", organizationId);

  return { ok: true, organization_id: organizationId, already_member: false };
}
