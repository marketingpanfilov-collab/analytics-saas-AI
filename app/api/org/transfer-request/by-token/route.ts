import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/app/lib/supabaseAdmin";
import { authUserExistsByEmail } from "@/app/lib/authUserExistsByEmail";

/**
 * GET /api/org/transfer-request/by-token?token=...
 * Public metadata for accept / set-password flows.
 */
export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const token = searchParams.get("token")?.trim();

  if (!token) {
    return NextResponse.json({ success: false, error: "token required" }, { status: 400 });
  }

  const admin = supabaseAdmin();
  const { data: row, error } = await admin
    .from("organization_transfer_requests")
    .select("id, organization_id, to_email, status, expires_at, from_user_id")
    .eq("token", token)
    .maybeSingle();

  if (error) {
    return NextResponse.json({ success: false, error: "lookup_failed" }, { status: 500 });
  }
  if (!row) {
    return NextResponse.json({ success: false, error: "invalid", reason: "not_found" }, { status: 404 });
  }

  const now = new Date().toISOString();
  if (row.status === "completed") {
    return NextResponse.json({
      success: false,
      error: "invalid",
      reason: "completed",
      status: row.status,
    }, { status: 400 });
  }
  if (row.status === "cancelled") {
    return NextResponse.json({
      success: false,
      error: "invalid",
      reason: "cancelled",
      status: row.status,
    }, { status: 400 });
  }
  if (row.status !== "pending") {
    return NextResponse.json({ success: false, error: "invalid", reason: "invalid" }, { status: 400 });
  }
  if (row.expires_at <= now) {
    return NextResponse.json(
      { success: false, error: "expired", reason: "expired", expires_at: row.expires_at },
      { status: 400 }
    );
  }

  const { data: org } = await admin.from("organizations").select("name").eq("id", row.organization_id).maybeSingle();

  const inviteEmail = String(row.to_email).trim().toLowerCase();
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
    organization_id: row.organization_id,
    organization_name: org?.name ?? null,
    recipient_email: inviteEmail,
    expires_at: row.expires_at,
    invite_type: "email",
    invite_email: inviteEmail,
    account_exists,
  });
}
