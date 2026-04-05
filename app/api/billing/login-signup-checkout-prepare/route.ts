import crypto from "node:crypto";
import { NextResponse } from "next/server";
import { authUserExistsByEmail } from "@/app/lib/authUserExistsByEmail";
import { makeLoginCheckoutStatusToken } from "@/app/lib/billing/loginCheckoutStatusToken";
import { supabaseAdmin } from "@/app/lib/supabaseAdmin";

const UUID_RE = /^[0-9a-f-]{36}$/i;

/**
 * POST /api/billing/login-signup-checkout-prepare
 * Unauthenticated: reserve organization + intent for Paddle checkout before Auth signUp (email after pay).
 */
export async function POST(req: Request) {
  let body: { email?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ success: false, error: "Invalid JSON" }, { status: 400 });
  }

  const raw = String(body.email ?? "").trim();
  const em = raw.toLowerCase();
  if (!em || !raw.includes("@")) {
    return NextResponse.json({ success: false, error: "Invalid email" }, { status: 400 });
  }

  const admin = supabaseAdmin();
  try {
    if (await authUserExistsByEmail(admin, em)) {
      return NextResponse.json(
        { success: false, error: "Аккаунт с этим email уже есть. Войдите или используйте другой адрес." },
        { status: 409 }
      );
    }
  } catch (e) {
    console.error("[login-signup-checkout-prepare] auth listUsers failed", e);
    return NextResponse.json({ success: false, error: "Не удалось проверить email. Попробуйте позже." }, { status: 503 });
  }

  const { data: intent, error: intentReadErr } = await admin
    .from("billing_login_checkout_intents")
    .select("organization_id, linked_at")
    .eq("email_normalized", em)
    .maybeSingle();

  if (intentReadErr) {
    console.error("[login-signup-checkout-prepare] intent read", intentReadErr.message);
    return NextResponse.json({ success: false, error: "Database error" }, { status: 500 });
  }

  if (intent?.linked_at) {
    return NextResponse.json(
      { success: false, error: "Регистрация для этого email уже завершена. Войдите." },
      { status: 409 }
    );
  }

  const now = new Date();
  const expiresAt = new Date(now.getTime() + 24 * 60 * 60 * 1000).toISOString();

  if (intent?.organization_id && UUID_RE.test(String(intent.organization_id))) {
    const organizationId = String(intent.organization_id);
    const { error: upErr } = await admin
      .from("billing_login_checkout_intents")
      .update({ expires_at: expiresAt })
      .eq("email_normalized", em);
    if (upErr) {
      console.error("[login-signup-checkout-prepare] intent extend", upErr.message);
      return NextResponse.json({ success: false, error: "Database error" }, { status: 500 });
    }
    let status_token: string;
    try {
      status_token = makeLoginCheckoutStatusToken(organizationId, em);
    } catch (e) {
      console.error("[login-signup-checkout-prepare] token", e);
      return NextResponse.json({ success: false, error: "Server misconfiguration" }, { status: 500 });
    }
    return NextResponse.json({ success: true, organization_id: organizationId, status_token });
  }

  const emailLocal = em.split("@")[0]?.slice(0, 48) || "user";
  const name = `Компания (${emailLocal})`;
  const slug = `login-${crypto.randomUUID().replace(/-/g, "").slice(0, 20)}`;

  const { data: orgIns, error: oErr } = await admin
    .from("organizations")
    .insert({
      name,
      slug,
      updated_at: now.toISOString(),
    })
    .select("id")
    .single();

  if (oErr || !orgIns?.id) {
    console.error("[login-signup-checkout-prepare] org insert", oErr?.message);
    return NextResponse.json(
      { success: false, error: oErr?.message ?? "Failed to create organization" },
      { status: 500 }
    );
  }

  const organizationId = String(orgIns.id);
  const { error: insErr } = await admin.from("billing_login_checkout_intents").insert({
    email_normalized: em,
    organization_id: organizationId,
    expires_at: expiresAt,
  });

  if (insErr) {
    console.error("[login-signup-checkout-prepare] intent insert", insErr.message);
    await admin.from("organizations").delete().eq("id", organizationId);
    return NextResponse.json({ success: false, error: insErr.message }, { status: 500 });
  }

  let status_token: string;
  try {
    status_token = makeLoginCheckoutStatusToken(organizationId, em);
  } catch (e) {
    console.error("[login-signup-checkout-prepare] token", e);
    await admin.from("billing_login_checkout_intents").delete().eq("email_normalized", em);
    await admin.from("organizations").delete().eq("id", organizationId);
    return NextResponse.json({ success: false, error: "Server misconfiguration" }, { status: 500 });
  }

  return NextResponse.json({ success: true, organization_id: organizationId, status_token });
}
