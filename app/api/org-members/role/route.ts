import { NextResponse } from "next/server";
import { createServerSupabase } from "@/app/lib/supabaseServer";
import { supabaseAdmin } from "@/app/lib/supabaseAdmin";

const ORG_ROLES_ALLOWED = ["owner", "admin"];
const ALLOWED_ROLES = ["admin", "agency", "member"];

export async function PATCH(req: Request) {
  const body = await req.json().catch(() => ({}));
  const memberId = typeof body.member_id === "string" ? body.member_id.trim() : "";
  const newRole = ALLOWED_ROLES.includes(body.role) ? body.role : null;

  if (!memberId || !newRole) {
    return NextResponse.json({ success: false, error: "member_id and role required" }, { status: 400 });
  }

  const supabase = await createServerSupabase();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ success: false, error: "Unauthorized" }, { status: 401 });
  }

  const { data: myMem } = await supabase
    .from("organization_members")
    .select("organization_id, role")
    .eq("user_id", user.id)
    .maybeSingle();

  if (!myMem) {
    return NextResponse.json({ success: false, error: "No organization membership" }, { status: 403 });
  }

  const myRole = (myMem.role ?? "member") as string;
  if (!ORG_ROLES_ALLOWED.includes(myRole)) {
    return NextResponse.json({ success: false, error: "Only owner or admin can change roles" }, { status: 403 });
  }

  const { data: target, error: fetchErr } = await supabase
    .from("organization_members")
    .select("id, organization_id, role")
    .eq("id", memberId)
    .single();

  if (fetchErr || !target) {
    return NextResponse.json({ success: false, error: "Member not found" }, { status: 404 });
  }

  if (target.organization_id !== myMem.organization_id) {
    return NextResponse.json({ success: false, error: "Member not in your organization" }, { status: 403 });
  }

  if (target.role === "owner") {
    return NextResponse.json({ success: false, error: "Cannot change owner role" }, { status: 400 });
  }

  const admin = supabaseAdmin();
  const { error: updateErr } = await admin
    .from("organization_members")
    .update({ role: newRole })
    .eq("id", memberId);

  if (updateErr) {
    return NextResponse.json({ success: false, error: updateErr.message }, { status: 500 });
  }

  return NextResponse.json({ success: true });
}
