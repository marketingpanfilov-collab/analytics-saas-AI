import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/app/lib/supabaseAdmin";
import { authUserExistsByEmail } from "@/app/lib/authUserExistsByEmail";

/**
 * GET /api/project-invites/by-token?token=...
 * Public: invite metadata + для email-приглашений — флаг, есть ли уже аккаунт Auth.
 */
export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const token = searchParams.get("token")?.trim();

  if (!token) {
    return NextResponse.json({ success: false, error: "token required" }, { status: 400 });
  }

  const admin = supabaseAdmin();
  const { data: invite, error: inviteErr } = await admin
    .from("project_invites")
    .select("id, project_id, role, status, expires_at, email, invite_type")
    .eq("token", token)
    .maybeSingle();

  if (inviteErr) {
    return NextResponse.json({ success: false, error: "Invalid invite" }, { status: 500 });
  }
  if (!invite) {
    return NextResponse.json({ success: false, error: "invalid", reason: "not_found" }, { status: 404 });
  }

  const now = new Date().toISOString();
  if (invite.status !== "pending") {
    return NextResponse.json({
      success: false,
      error: "invalid",
      reason: invite.status === "revoked" ? "revoked" : invite.status === "accepted" ? "accepted" : "invalid",
      status: invite.status,
    }, { status: 400 });
  }
  if (invite.expires_at <= now) {
    return NextResponse.json({
      success: false,
      error: "expired",
      reason: "expired",
      expires_at: invite.expires_at,
    }, { status: 400 });
  }

  const { data: proj } = await admin.from("projects").select("name").eq("id", invite.project_id).maybeSingle();

  const inviteType = String(invite.invite_type ?? "email");
  const inviteEmail =
    inviteType === "email" && invite.email ? String(invite.email).trim().toLowerCase() : null;

  let account_exists: boolean | null = null;
  if (inviteEmail) {
    try {
      account_exists = await authUserExistsByEmail(admin, inviteEmail);
    } catch {
      account_exists = null;
    }
  }

  return NextResponse.json({
    success: true,
    project_id: invite.project_id,
    project_name: proj?.name ?? null,
    role: invite.role,
    expires_at: invite.expires_at,
    invite_type: inviteType,
    invite_email: inviteEmail,
    account_exists,
  });
}
