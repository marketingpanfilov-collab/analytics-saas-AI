import { NextResponse } from "next/server";
import { createServerSupabase } from "@/app/lib/supabaseServer";
import { supabaseAdmin } from "@/app/lib/supabaseAdmin";
import { billingHeavySyncGateBeforeProject } from "@/app/lib/auth/requireBillingAccess";

const ORG_ROLES_ALLOWED = ["owner", "admin"];

/**
 * Снимает у user_id весь доступ через project_members по проектам текущей организации,
 * если у пользователя нет строки в organization_members (project-only seat).
 * Не трогает пользователей из «Команды» — для них сначала org remove.
 */
export async function POST(req: Request) {
  const body = await req.json().catch(() => ({}));
  const targetUserId = typeof body.user_id === "string" ? body.user_id.trim() : "";
  if (!targetUserId) {
    return NextResponse.json({ success: false, error: "user_id required" }, { status: 400 });
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
    return NextResponse.json({ success: false, error: "Only owner or admin can remove access" }, { status: 403 });
  }

  const organizationId = String(myMem.organization_id);
  const admin = supabaseAdmin();

  const { data: orgRow, error: omErr } = await admin
    .from("organization_members")
    .select("id")
    .eq("organization_id", organizationId)
    .eq("user_id", targetUserId)
    .maybeSingle();
  if (omErr) {
    return NextResponse.json({ success: false, error: omErr.message }, { status: 500 });
  }
  if (orgRow) {
    return NextResponse.json(
      {
        success: false,
        error:
          "Пользователь состоит в команде организации. Сначала удалите его из списка команды, затем при необходимости уберите из проектов.",
      },
      { status: 400 }
    );
  }

  const { data: projRows, error: pErr } = await admin
    .from("projects")
    .select("id")
    .eq("organization_id", organizationId);
  if (pErr) {
    return NextResponse.json({ success: false, error: pErr.message }, { status: 500 });
  }
  const projectIds = (projRows ?? []).map((p: { id: string }) => String(p.id)).filter(Boolean);
  if (projectIds.length === 0) {
    return NextResponse.json({ success: true, removed: false, message: "No projects in organization" });
  }

  const { error: delErr } = await admin
    .from("project_members")
    .delete()
    .eq("user_id", targetUserId)
    .in("project_id", projectIds);

  if (delErr) {
    return NextResponse.json({ success: false, error: delErr.message }, { status: 500 });
  }

  return NextResponse.json({ success: true, removed: true, organization_id: organizationId, user_id: targetUserId });
}
