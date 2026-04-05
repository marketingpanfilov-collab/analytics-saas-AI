import { NextResponse } from "next/server";
import { createServerSupabase } from "@/app/lib/supabaseServer";
import { supabaseAdmin } from "@/app/lib/supabaseAdmin";
import { billingHeavySyncGateBeforeProject } from "@/app/lib/auth/requireBillingAccess";
import {
  countBillableSeatsForOrganization,
  getPlanMaxSeatsForUser,
  isAtOrgSeatPlanLimit,
  ORG_SEAT_PLAN_LIMIT_CODE,
  ORG_SEAT_PLAN_LIMIT_USER_MESSAGE,
  userHasBillableSeatInOrganization,
} from "@/app/lib/orgSeatPlanLimit";

const ORG_ROLES_MANAGE = ["owner", "admin"];
const ORG_ROLES_ALL_PROJECTS = ["owner", "admin"];
const PROJECT_ROLES = new Set(["project_admin", "marketer", "viewer"]);

export async function POST(req: Request) {
  const body = await req.json().catch(() => ({}));
  const projectId = typeof body.project_id === "string" ? body.project_id.trim() : "";
  const targetUserId = typeof body.user_id === "string" ? body.user_id.trim() : "";
  const role = PROJECT_ROLES.has(body.role) ? body.role : "marketer";

  if (!projectId) {
    return NextResponse.json({ success: false, error: "project_id required" }, { status: 400 });
  }
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

  const { data: mem } = await supabase
    .from("organization_members")
    .select("organization_id, role")
    .eq("user_id", user.id)
    .maybeSingle();

  if (!mem) {
    return NextResponse.json({ success: false, error: "No organization membership" }, { status: 403 });
  }

  const orgRole = (mem.role ?? "member") as string;
  let allowedProjectIds: string[] = [];
  if (ORG_ROLES_ALL_PROJECTS.includes(orgRole)) {
    const { data: projs } = await supabase
      .from("projects")
      .select("id")
      .eq("organization_id", mem.organization_id);
    allowedProjectIds = (projs ?? []).map((p: { id: string }) => p.id);
  } else {
    const { data: pms } = await supabase
      .from("project_members")
      .select("project_id")
      .eq("user_id", user.id);
    allowedProjectIds = (pms ?? []).map((r: { project_id: string }) => r.project_id);
  }

  if (!allowedProjectIds.includes(projectId)) {
    return NextResponse.json({ success: false, error: "Project access denied" }, { status: 403 });
  }

  const canManage =
    ORG_ROLES_MANAGE.includes(orgRole) ||
    (await (async () => {
      const { data: pm } = await supabase
        .from("project_members")
        .select("role")
        .eq("project_id", projectId)
        .eq("user_id", user.id)
        .maybeSingle();
      return pm?.role === "project_admin";
    })());

  if (!canManage) {
    return NextResponse.json({ success: false, error: "Cannot manage members" }, { status: 403 });
  }

  const { data: proj, error: projErr } = await supabase
    .from("projects")
    .select("organization_id")
    .eq("id", projectId)
    .maybeSingle();
  if (projErr || !proj || String(proj.organization_id) !== String(mem.organization_id)) {
    return NextResponse.json({ success: false, error: "Project not in your organization" }, { status: 403 });
  }

  const organizationId = String(mem.organization_id);
  const admin = supabaseAdmin();

  const { data: existingPm, error: exErr } = await admin
    .from("project_members")
    .select("id")
    .eq("project_id", projectId)
    .eq("user_id", targetUserId)
    .maybeSingle();
  if (exErr) {
    return NextResponse.json({ success: false, error: exErr.message }, { status: 500 });
  }
  if (existingPm) {
    return NextResponse.json({ success: false, error: "Пользователь уже добавлен в проект" }, { status: 409 });
  }

  try {
    const maxSeats = await getPlanMaxSeatsForUser(
      admin,
      user.id,
      user.email ?? null,
      organizationId
    );
    const seatCount = await countBillableSeatsForOrganization(admin, organizationId);
    const alreadySeated = await userHasBillableSeatInOrganization(admin, organizationId, targetUserId);
    if (!alreadySeated && isAtOrgSeatPlanLimit(maxSeats, seatCount)) {
      return NextResponse.json(
        { success: false, error: ORG_SEAT_PLAN_LIMIT_USER_MESSAGE, code: ORG_SEAT_PLAN_LIMIT_CODE },
        { status: 403 }
      );
    }
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Seat limit check failed";
    return NextResponse.json({ success: false, error: msg }, { status: 500 });
  }

  const { error: insertErr } = await admin.from("project_members").insert({
    project_id: projectId,
    user_id: targetUserId,
    role,
  });

  if (insertErr) {
    if (insertErr.code === "23505") {
      return NextResponse.json({ success: false, error: "Пользователь уже добавлен в проект" }, { status: 409 });
    }
    return NextResponse.json({ success: false, error: insertErr.message }, { status: 500 });
  }

  return NextResponse.json({ success: true });
}
