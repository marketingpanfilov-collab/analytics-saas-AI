import { NextResponse } from "next/server";
import { createServerSupabase } from "@/app/lib/supabaseServer";
import { supabaseAdmin } from "@/app/lib/supabaseAdmin";
import { runFinalizeLoginCheckoutCore } from "@/app/lib/auth/finalizeLoginCheckoutCore";

/**
 * POST /api/auth/finalize-login-checkout
 * After email confirm: link session user as org owner for org paid via /login prepare flow.
 * organization_id опционален: если не передан, берётся из открытого billing_login_checkout_intents по email сессии.
 */
export async function POST(req: Request) {
  const supabase = await createServerSupabase();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ success: false, error: "Unauthorized" }, { status: 401 });
  }

  let body: { organization_id?: string | null } = {};
  try {
    body = (await req.json()) as { organization_id?: string | null };
  } catch {
    body = {};
  }

  const sessionEmail = (user.email ?? "").trim().toLowerCase();
  if (!sessionEmail) {
    return NextResponse.json({ success: false, error: "Missing email on session" }, { status: 400 });
  }

  const organizationId =
    typeof body.organization_id === "string" && body.organization_id.trim()
      ? body.organization_id.trim()
      : null;

  const admin = supabaseAdmin();
  const result = await runFinalizeLoginCheckoutCore(admin, {
    userId: user.id,
    sessionEmailNormalized: sessionEmail,
    organizationId,
  });

  if (result.ok) {
    return NextResponse.json({
      success: true,
      already_member: result.already_member,
      organization_id: result.organization_id,
    });
  }

  const status = result.status;
  const errBody = { success: false as const, error: result.message, code: result.code };
  return NextResponse.json(errBody, { status });
}
