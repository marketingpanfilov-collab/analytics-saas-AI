import { NextResponse } from "next/server";
import { createServerSupabase } from "@/app/lib/supabaseServer";
import { supabaseAdmin } from "@/app/lib/supabaseAdmin";
import { billingHeavySyncGateBeforeProject } from "@/app/lib/auth/requireBillingAccess";

const ORG_ROLES_ALLOWED = ["owner", "admin"];

export async function DELETE(req: Request) {
  const { searchParams } = new URL(req.url);
  const memberId = searchParams.get("member_id")?.trim();

  if (!memberId) {
    return NextResponse.json({ success: false, error: "member_id required" }, { status: 400 });
  }

  const supabase = await createServerSupabase();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ success: false, error: "Unauthorized" }, { status: 401 });
  }

  const billingPre = await billingHeavySyncGateBeforeProject(req);
  if (!billingPre.ok) return billingPre.response;

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
    return NextResponse.json({ success: false, error: "Only owner or admin can remove members" }, { status: 403 });
  }

  const admin = supabaseAdmin();
  // RLS для authenticated SELECT только своя строка — чужой member_id не виден; читаем target через service role после проверки прав.
  const { data: target, error: fetchErr } = await admin
    .from("organization_members")
    .select("id, organization_id, user_id, role")
    .eq("id", memberId)
    .single();

  if (fetchErr || !target) {
    return NextResponse.json({ success: false, error: "Member not found" }, { status: 404 });
  }

  if (target.organization_id !== myMem.organization_id) {
    return NextResponse.json({ success: false, error: "Member not in your organization" }, { status: 403 });
  }

  if (target.role === "owner") {
    return NextResponse.json({ success: false, error: "Cannot remove owner" }, { status: 400 });
  }

  if (target.user_id === user.id && myRole === "owner") {
    return NextResponse.json({ success: false, error: "Owner cannot remove themselves" }, { status: 400 });
  }

  const orgId = String(target.organization_id);
  const targetUserId = String(target.user_id);

  // Инвариант биллинга: после выхода из организации не должно оставаться project_members по проектам этой org.
  // Сначала снимаем доступ к проектам (при сбое пользователь ещё в organization_members), затем строку org.
  const { data: projRows, error: pErr } = await admin.from("projects").select("id").eq("organization_id", orgId);
  if (pErr) {
    return NextResponse.json({ success: false, error: pErr.message }, { status: 500 });
  }
  const projectIds = (projRows ?? []).map((p: { id: string }) => String(p.id)).filter(Boolean);
  if (projectIds.length > 0) {
    const { error: pmDelErr } = await admin
      .from("project_members")
      .delete()
      .eq("user_id", targetUserId)
      .in("project_id", projectIds);
    if (pmDelErr) {
      return NextResponse.json({ success: false, error: pmDelErr.message }, { status: 500 });
    }
  }

  const { error: deleteErr } = await admin.from("organization_members").delete().eq("id", memberId);
  if (deleteErr) {
    return NextResponse.json({ success: false, error: deleteErr.message }, { status: 500 });
  }

  return NextResponse.json({ success: true });
}
