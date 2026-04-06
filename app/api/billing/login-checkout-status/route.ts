import { NextResponse } from "next/server";
import { subscriptionRowCountsAsPaidForLoginCheckout } from "@/app/lib/billing/loginCheckoutPaidStatuses";
import { verifyLoginCheckoutStatusToken } from "@/app/lib/billing/loginCheckoutStatusToken";
import { supabaseAdmin } from "@/app/lib/supabaseAdmin";

const UUID_RE = /^[0-9a-f-]{36}$/i;

/**
 * GET /api/billing/login-checkout-status?organization_id=&email=&status_token=
 * Unauthenticated: subscription row present for org (after webhook). Token binds org+email from prepare.
 */
export async function GET(req: Request) {
  const url = new URL(req.url);
  const organizationId = (url.searchParams.get("organization_id") ?? "").trim();
  const emailRaw = (url.searchParams.get("email") ?? "").trim();
  const statusToken = (url.searchParams.get("status_token") ?? "").trim();
  const em = emailRaw.toLowerCase();

  if (!UUID_RE.test(organizationId) || !em || !statusToken) {
    return NextResponse.json({ success: false, ready: false, error: "Bad request" }, { status: 400 });
  }

  if (!verifyLoginCheckoutStatusToken(organizationId, em, statusToken)) {
    return NextResponse.json({ success: false, ready: false, error: "Invalid token" }, { status: 403 });
  }

  const admin = supabaseAdmin();
  const { data: subs, error } = await admin
    .from("billing_subscriptions")
    .select("status")
    .eq("organization_id", organizationId)
    .eq("provider", "paddle")
    .limit(8);

  if (error) {
    console.error("[login-checkout-status]", error.message);
    return NextResponse.json({ success: false, ready: false, error: "Database error" }, { status: 500 });
  }

  const ready = (subs ?? []).some((r) => subscriptionRowCountsAsPaidForLoginCheckout(r.status));
  return NextResponse.json({ success: true, ready });
}
