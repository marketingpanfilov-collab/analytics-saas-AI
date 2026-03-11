import { NextResponse } from "next/server";
import { createServerSupabase } from "@/app/lib/supabaseServer";

/**
 * GET /api/project-invites/by-token?token=...
 * Public: returns minimal invite info for accept page (project name, role, status, expires_at).
 * Does not require auth.
 */
export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const token = searchParams.get("token")?.trim();

  if (!token) {
    return NextResponse.json({ success: false, error: "token required" }, { status: 400 });
  }

  const supabase = await createServerSupabase();
  const { data: invite, error: inviteErr } = await supabase
    .from("project_invites")
    .select("id, project_id, role, status, expires_at")
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

  const { data: proj } = await supabase
    .from("projects")
    .select("name")
    .eq("id", invite.project_id)
    .single();

  return NextResponse.json({
    success: true,
    project_id: invite.project_id,
    project_name: proj?.name ?? null,
    role: invite.role,
    expires_at: invite.expires_at,
  });
}
