import { NextResponse } from "next/server";
import { createServerSupabase } from "@/app/lib/supabaseServer";
import { supabaseAdmin } from "@/app/lib/supabaseAdmin";

const UUID_RE = /^[0-9a-f-]{36}$/i;
const PAID_STATUSES = new Set(["active", "trialing", "past_due"]);

/**
 * POST /api/auth/finalize-login-checkout
 * After email confirm: link session user as org owner for org paid via /login prepare flow.
 */
export async function POST(req: Request) {
  const supabase = await createServerSupabase();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ success: false, error: "Unauthorized" }, { status: 401 });
  }

  let body: { organization_id?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ success: false, error: "Invalid JSON" }, { status: 400 });
  }

  const organizationId = String(body.organization_id ?? "").trim();
  if (!UUID_RE.test(organizationId)) {
    return NextResponse.json({ success: false, error: "Invalid organization_id" }, { status: 400 });
  }

  const sessionEmail = (user.email ?? "").trim().toLowerCase();
  if (!sessionEmail) {
    return NextResponse.json({ success: false, error: "Missing email on session" }, { status: 400 });
  }

  const admin = supabaseAdmin();
  const { data: intent, error: intentErr } = await admin
    .from("billing_login_checkout_intents")
    .select("email_normalized, linked_at")
    .eq("email_normalized", sessionEmail)
    .eq("organization_id", organizationId)
    .maybeSingle();

  if (intentErr) {
    console.error("[finalize-login-checkout] intent", intentErr.message);
    return NextResponse.json({ success: false, error: "Database error" }, { status: 500 });
  }

  const { data: existingMember } = await admin
    .from("organization_members")
    .select("id")
    .eq("organization_id", organizationId)
    .eq("user_id", user.id)
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
      .update({ user_id: user.id, updated_at: new Date().toISOString() })
      .eq("provider", "paddle")
      .eq("organization_id", organizationId)
      .eq("email", sessionEmail);
    return NextResponse.json({ success: true, already_member: true });
  }

  if (!intent) {
    return NextResponse.json({ success: false, error: "No pending checkout for this account" }, { status: 404 });
  }

  if (intent.linked_at) {
    return NextResponse.json({ success: false, error: "Already finalized" }, { status: 409 });
  }

  const { data: subs } = await admin
    .from("billing_subscriptions")
    .select("id, status")
    .eq("organization_id", organizationId)
    .eq("provider", "paddle")
    .limit(5);

  const paid = (subs ?? []).some((s) => PAID_STATUSES.has(String(s.status ?? "").toLowerCase()));
  if (!paid) {
    return NextResponse.json({ success: false, error: "Subscription not active yet" }, { status: 409 });
  }

  const now = new Date().toISOString();
  const { error: omErr } = await admin.from("organization_members").insert({
    organization_id: organizationId,
    user_id: user.id,
    role: "owner",
    created_at: now,
  });

  if (omErr) {
    console.error("[finalize-login-checkout] organization_members", omErr.message);
    return NextResponse.json({ success: false, error: omErr.message }, { status: 500 });
  }

  await admin
    .from("billing_customer_map")
    .update({ user_id: user.id, updated_at: now })
    .eq("provider", "paddle")
    .eq("organization_id", organizationId)
    .eq("email", sessionEmail);

  await admin
    .from("billing_login_checkout_intents")
    .update({ linked_at: now })
    .eq("email_normalized", sessionEmail)
    .eq("organization_id", organizationId);

  return NextResponse.json({ success: true });
}
