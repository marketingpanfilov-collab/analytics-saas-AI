import { NextResponse } from "next/server";
import { isValidCheckoutAttemptId } from "@/app/lib/billing/isValidCheckoutAttemptId";
import { subscriptionRowCountsAsPaidForLoginCheckout } from "@/app/lib/billing/loginCheckoutPaidStatuses";
import { verifyLoginCheckoutStatusToken } from "@/app/lib/billing/loginCheckoutStatusToken";
import { supabaseAdmin } from "@/app/lib/supabaseAdmin";

const UUID_RE = /^[0-9a-f-]{36}$/i;

/**
 * GET /api/billing/login-checkout-status?organization_id=&email=&status_token=&checkout_attempt_id=
 * Unauthenticated: paid subscription row for org must match checkout_attempt_id (webhook + bind).
 */
export async function GET(req: Request) {
  const url = new URL(req.url);
  const organizationId = (url.searchParams.get("organization_id") ?? "").trim();
  const emailRaw = (url.searchParams.get("email") ?? "").trim();
  const statusToken = (url.searchParams.get("status_token") ?? "").trim();
  const checkoutAttemptId = (url.searchParams.get("checkout_attempt_id") ?? "").trim();
  const em = emailRaw.toLowerCase();

  if (!UUID_RE.test(organizationId) || !em || !statusToken || !checkoutAttemptId) {
    return NextResponse.json({ success: false, ready: false, error: "Bad request" }, { status: 400 });
  }

  if (!isValidCheckoutAttemptId(checkoutAttemptId)) {
    return NextResponse.json({ success: false, ready: false, error: "invalid_checkout_attempt" }, { status: 400 });
  }

  if (!verifyLoginCheckoutStatusToken(organizationId, em, statusToken)) {
    return NextResponse.json({ success: false, ready: false, error: "Invalid token" }, { status: 403 });
  }

  const admin = supabaseAdmin();

  const { data: intent, error: intentErr } = await admin
    .from("billing_login_checkout_intents")
    .select("checkout_attempt_id, linked_at")
    .eq("email_normalized", em)
    .eq("organization_id", organizationId)
    .maybeSingle();

  if (intentErr) {
    console.error("[login-checkout-status] intent", intentErr.message);
    return NextResponse.json({ success: false, ready: false, error: "Database error" }, { status: 500 });
  }

  if (!intent || intent.linked_at) {
    return NextResponse.json({ success: true, ready: false });
  }

  const bound = String(intent.checkout_attempt_id ?? "").trim();
  if (!bound) {
    return NextResponse.json(
      { success: false, ready: false, error: "checkout_attempt_not_bound" },
      { status: 409 }
    );
  }

  if (bound !== checkoutAttemptId) {
    return NextResponse.json({ success: false, ready: false, error: "checkout_attempt_mismatch" }, { status: 403 });
  }

  const { data: subs, error } = await admin
    .from("billing_subscriptions")
    .select("status, checkout_attempt_id")
    .eq("organization_id", organizationId)
    .eq("provider", "paddle")
    .limit(8);

  if (error) {
    console.error("[login-checkout-status]", error.message);
    return NextResponse.json({ success: false, ready: false, error: "Database error" }, { status: 500 });
  }

  const ready = (subs ?? []).some((r) => {
    if (!subscriptionRowCountsAsPaidForLoginCheckout(r.status)) return false;
    return String(r.checkout_attempt_id ?? "").trim() === checkoutAttemptId;
  });
  return NextResponse.json({ success: true, ready });
}
