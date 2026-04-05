import { NextResponse } from "next/server";
import { createServerSupabase } from "@/app/lib/supabaseServer";
import { supabaseAdmin } from "@/app/lib/supabaseAdmin";
import { billingAnalyticsReadGateBeforeProject } from "@/app/lib/auth/requireBillingAccess";
import { canTransferOrganizationOwnership } from "@/app/lib/auth/projectPermissions";
import { sendOrganizationTransferInviteEmail } from "@/app/lib/organizationTransferEmail";

export const runtime = "nodejs";

const TRANSFER_TTL_MS = 7 * 24 * 60 * 60 * 1000;

function normalizeEmail(raw: string): string {
  return raw.trim().toLowerCase();
}

function isValidEmail(em: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(em);
}

/**
 * POST /api/org/transfer-request/initiate
 * Body: { organization_id, to_email, reauth_token }
 */
export async function POST(req: Request) {
  const body = await req.json().catch(() => null);
  const organizationId =
    typeof body?.organization_id === "string" ? body.organization_id.trim() : "";
  const toEmailRaw = typeof body?.to_email === "string" ? body.to_email : "";
  const reauthToken = typeof body?.reauth_token === "string" ? body.reauth_token.trim() : "";

  if (!organizationId || !toEmailRaw || !reauthToken) {
    return NextResponse.json(
      { success: false, error: "organization_id, to_email and reauth_token are required" },
      { status: 400 }
    );
  }

  const toEmail = normalizeEmail(toEmailRaw);
  if (!isValidEmail(toEmail)) {
    return NextResponse.json({ success: false, error: "Некорректный email" }, { status: 400 });
  }

  const billingPre = await billingAnalyticsReadGateBeforeProject(req);
  if (!billingPre.ok) return billingPre.response;

  const supabase = await createServerSupabase();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ success: false, error: "Unauthorized" }, { status: 401 });
  }

  const ownerEmail = (user.email ?? "").trim().toLowerCase();
  if (ownerEmail && ownerEmail === toEmail) {
    return NextResponse.json(
      { success: false, error: "Нельзя передать организацию на свой же email" },
      { status: 400 }
    );
  }

  const { data: mem } = await supabase
    .from("organization_members")
    .select("organization_id, role")
    .eq("user_id", user.id)
    .eq("organization_id", organizationId)
    .maybeSingle();

  if (!mem || !canTransferOrganizationOwnership(mem.role ?? "")) {
    return NextResponse.json(
      { success: false, error: "Only the organization owner can transfer ownership" },
      { status: 403 }
    );
  }

  const admin = supabaseAdmin();

  const { data: tokenRow, error: tokenErr } = await admin
    .from("reauth_tokens")
    .select("id, user_id, expires_at")
    .eq("id", reauthToken)
    .eq("user_id", user.id)
    .single();

  if (tokenErr || !tokenRow) {
    return NextResponse.json(
      { success: false, error: "Invalid or expired confirmation. Please re-enter your password." },
      { status: 401 }
    );
  }

  if (new Date(tokenRow.expires_at).getTime() < Date.now()) {
    await admin.from("reauth_tokens").delete().eq("id", reauthToken);
    return NextResponse.json(
      { success: false, error: "Confirmation expired. Please re-enter your password." },
      { status: 401 }
    );
  }

  const { data: org } = await admin.from("organizations").select("id, name").eq("id", organizationId).maybeSingle();
  if (!org) {
    return NextResponse.json({ success: false, error: "Organization not found" }, { status: 404 });
  }

  await admin
    .from("organization_transfer_requests")
    .update({ status: "cancelled" })
    .eq("organization_id", organizationId)
    .eq("status", "pending");

  const expiresAt = new Date(Date.now() + TRANSFER_TTL_MS).toISOString();

  const { data: inserted, error: insErr } = await admin
    .from("organization_transfer_requests")
    .insert({
      organization_id: organizationId,
      from_user_id: user.id,
      to_email: toEmail,
      expires_at: expiresAt,
      status: "pending",
    })
    .select("id, token")
    .single();

  if (insErr || !inserted?.token) {
    return NextResponse.json(
      { success: false, error: insErr?.message ?? "Failed to create transfer request" },
      { status: 500 }
    );
  }

  const origin = new URL(req.url).origin;
  const acceptUrl = `${origin}/app/transfer/accept?token=${encodeURIComponent(String(inserted.token))}`;

  const sent = await sendOrganizationTransferInviteEmail({
    to: toEmail,
    acceptUrl,
    organizationName: org.name ?? "Организация",
    expiresAtIso: expiresAt,
  });

  if (!sent.ok) {
    await admin.from("organization_transfer_requests").delete().eq("id", inserted.id);
    return NextResponse.json(
      {
        success: false,
        error:
          sent.error === "smtp_not_configured"
            ? "Почта не настроена на сервере. Обратитесь в поддержку."
            : "Не удалось отправить письмо. Попробуйте позже.",
      },
      { status: 503 }
    );
  }

  await admin.from("reauth_tokens").delete().eq("id", reauthToken);

  return NextResponse.json({
    success: true,
    to_email: toEmail,
    expires_at: expiresAt,
  });
}
