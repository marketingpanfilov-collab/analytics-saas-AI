import { NextResponse } from "next/server";
import { createServerSupabase } from "@/app/lib/supabaseServer";
import { supabaseAdmin } from "@/app/lib/supabaseAdmin";

export async function POST(req: Request) {
  const body = await req.json().catch(() => ({}));
  const token = typeof body.token === "string" ? body.token.trim() : "";

  if (!token) {
    return NextResponse.json({ success: false, error: "token required" }, { status: 400 });
  }

  const supabase = await createServerSupabase();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ success: false, error: "Unauthorized" }, { status: 401 });
  }

  const admin = supabaseAdmin();
  const { data: invite, error: inviteErr } = await admin
    .from("project_invites")
    .select("id, project_id, organization_id, role, status, expires_at")
    .eq("token", token)
    .maybeSingle();

  if (inviteErr || !invite) {
    return NextResponse.json({ success: false, error: "invalid", reason: "not_found" }, { status: 404 });
  }

  if (invite.status !== "pending") {
    return NextResponse.json({
      success: false,
      error: "invalid",
      reason: invite.status === "revoked" ? "revoked" : "accepted",
    }, { status: 400 });
  }

  const now = new Date().toISOString();
  if (invite.expires_at <= now) {
    return NextResponse.json({ success: false, error: "expired", reason: "expired" }, { status: 400 });
  }

  const { data: existing } = await admin
    .from("project_members")
    .select("id")
    .eq("project_id", invite.project_id)
    .eq("user_id", user.id)
    .maybeSingle();
  if (existing) {
    await admin
      .from("project_invites")
      .update({ status: "accepted", accepted_by: user.id, accepted_at: now })
      .eq("id", invite.id);
    return NextResponse.json({ success: true, project_id: invite.project_id, already_member: true });
  }

  const { error: insertMemErr } = await admin.from("project_members").insert({
    project_id: invite.project_id,
    user_id: user.id,
    role: invite.role,
  });
  if (insertMemErr) {
    return NextResponse.json({ success: false, error: insertMemErr.message }, { status: 500 });
  }

  const { error: updateErr } = await admin
    .from("project_invites")
    .update({
      status: "accepted",
      accepted_by: user.id,
      accepted_at: now,
    })
    .eq("id", invite.id);

  if (updateErr) {
    return NextResponse.json({ success: false, error: updateErr.message }, { status: 500 });
  }

  return NextResponse.json({ success: true, project_id: invite.project_id });
}
