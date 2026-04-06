import { NextResponse } from "next/server";
import { isValidCheckoutAttemptId } from "@/app/lib/billing/isValidCheckoutAttemptId";
import { verifyLoginCheckoutStatusToken } from "@/app/lib/billing/loginCheckoutStatusToken";
import { supabaseAdmin } from "@/app/lib/supabaseAdmin";

const UUID_RE = /^[0-9a-f-]{36}$/i;

/**
 * POST /api/billing/login-checkout-bind-attempt
 * Unauthenticated: bind current Paddle checkout_attempt_id to billing_login_checkout_intents (token proves org+email).
 */
export async function POST(req: Request) {
  let body: {
    organization_id?: string;
    email?: string;
    status_token?: string;
    checkout_attempt_id?: string;
  };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ success: false, error: "Invalid JSON" }, { status: 400 });
  }

  const organizationId = String(body.organization_id ?? "").trim();
  const emailRaw = String(body.email ?? "").trim();
  const em = emailRaw.toLowerCase();
  const statusToken = String(body.status_token ?? "").trim();
  const checkoutAttemptId = String(body.checkout_attempt_id ?? "").trim();

  if (!UUID_RE.test(organizationId) || !em || !statusToken || !checkoutAttemptId) {
    return NextResponse.json({ success: false, error: "Bad request" }, { status: 400 });
  }

  if (!isValidCheckoutAttemptId(checkoutAttemptId)) {
    return NextResponse.json({ success: false, error: "invalid_checkout_attempt" }, { status: 400 });
  }

  if (!verifyLoginCheckoutStatusToken(organizationId, em, statusToken)) {
    return NextResponse.json({ success: false, error: "Invalid token" }, { status: 403 });
  }

  const admin = supabaseAdmin();
  const { data: intent, error: readErr } = await admin
    .from("billing_login_checkout_intents")
    .select("linked_at")
    .eq("email_normalized", em)
    .eq("organization_id", organizationId)
    .maybeSingle();

  if (readErr) {
    console.error("[login-checkout-bind-attempt] intent read", readErr.message);
    return NextResponse.json({ success: false, error: "Database error" }, { status: 500 });
  }

  if (!intent) {
    return NextResponse.json({ success: false, error: "No pending checkout" }, { status: 404 });
  }

  if (intent.linked_at) {
    return NextResponse.json({ success: false, error: "Already finalized" }, { status: 409 });
  }

  const { error: upErr } = await admin
    .from("billing_login_checkout_intents")
    .update({ checkout_attempt_id: checkoutAttemptId })
    .eq("email_normalized", em)
    .eq("organization_id", organizationId);

  if (upErr) {
    console.error("[login-checkout-bind-attempt] update", upErr.message);
    return NextResponse.json({ success: false, error: "Database error" }, { status: 500 });
  }

  return NextResponse.json({ success: true });
}
