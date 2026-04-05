import { NextResponse } from "next/server";
import { createServerSupabase } from "@/app/lib/supabaseServer";
import { supabaseAdmin } from "@/app/lib/supabaseAdmin";
import { finalizeOrganizationOwnershipTransfer } from "@/app/lib/organizationTransferFinalize";
import { sendOrganizationTransferCompletedEmail } from "@/app/lib/organizationTransferEmail";
import { checkRateLimit, getRequestIp } from "@/app/lib/security/rateLimit";

export const runtime = "nodejs";

export const TRANSFER_EMAIL_MISMATCH_CODE = "TRANSFER_EMAIL_MISMATCH";

/**
 * POST /api/org/transfer-request/accept
 * Body: { token } — session user must match to_email on the request.
 */
export async function POST(req: Request) {
  const body = await req.json().catch(() => ({}));
  const token = typeof body.token === "string" ? body.token.trim() : "";
  if (!token) {
    return NextResponse.json({ success: false, error: "token required" }, { status: 400 });
  }

  const ip = getRequestIp(req);
  const rl = await checkRateLimit(`org-transfer-accept:${ip}`, 30, 60_000);
  if (!rl.ok) {
    return NextResponse.json(
      { success: false, error: `Слишком много попыток. Повторите через ${rl.retryAfterSec} с` },
      { status: 429 }
    );
  }

  const supabase = await createServerSupabase();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ success: false, error: "Unauthorized" }, { status: 401 });
  }

  const admin = supabaseAdmin();
  const now = new Date().toISOString();

  const { data: tr, error: trErr } = await admin
    .from("organization_transfer_requests")
    .select("id, organization_id, from_user_id, to_email, status, expires_at")
    .eq("token", token)
    .maybeSingle();

  if (trErr || !tr) {
    return NextResponse.json({ success: false, error: "invalid", reason: "not_found" }, { status: 404 });
  }

  if (tr.status === "completed") {
    return NextResponse.json(
      { success: false, error: "Передача уже завершена", reason: "completed" },
      { status: 400 }
    );
  }
  if (tr.status !== "pending") {
    return NextResponse.json({ success: false, error: "Ссылка недействительна", reason: tr.status }, { status: 400 });
  }
  if (tr.expires_at <= now) {
    return NextResponse.json(
      { success: false, error: "Ссылка устарела", reason: "expired" },
      { status: 400 }
    );
  }

  const expectedEmail = String(tr.to_email).trim().toLowerCase();
  const sessionEmail = (user.email ?? "").trim().toLowerCase();
  if (!sessionEmail || sessionEmail !== expectedEmail) {
    return NextResponse.json(
      {
        success: false,
        error: "Войдите под email, на который отправлена передача организации.",
        code: TRANSFER_EMAIL_MISMATCH_CODE,
      },
      { status: 403 }
    );
  }

  if (tr.from_user_id === user.id) {
    return NextResponse.json(
      { success: false, error: "Нельзя принять передачу на аккаунт текущего владельца" },
      { status: 400 }
    );
  }

  const orgId = tr.organization_id;
  const fromUserId = tr.from_user_id;
  const newUserId = user.id;

  const { data: org } = await admin.from("organizations").select("name").eq("id", orgId).maybeSingle();

  const fin = await finalizeOrganizationOwnershipTransfer(admin, {
    organizationId: orgId,
    fromUserId,
    toUserId: newUserId,
  });
  if (!fin.ok) {
    return NextResponse.json({ success: false, error: fin.error }, { status: fin.status });
  }

  const completedAt = new Date().toISOString();
  const { error: updTrErr } = await admin
    .from("organization_transfer_requests")
    .update({
      status: "completed",
      completed_at: completedAt,
      to_user_id: newUserId,
    })
    .eq("id", tr.id)
    .eq("status", "pending");

  if (updTrErr) {
    console.error("[org-transfer-accept] failed to mark completed", updTrErr);
  }

  const origin = new URL(req.url).origin;
  const { data: formerAuth } = await admin.auth.admin.getUserById(fromUserId);
  const formerEmail = formerAuth?.user?.email?.trim();
  if (formerEmail) {
    void sendOrganizationTransferCompletedEmail({
      to: formerEmail,
      organizationName: org?.name ?? "Организация",
      newOwnerEmail: sessionEmail,
      transferredAtIso: completedAt,
      appUrl: origin,
    }).catch((e) => console.error("[org-transfer-accept] former owner email", e));
  }

  return NextResponse.json({
    success: true,
    organization_id: orgId,
    organization_name: org?.name ?? null,
  });
}
