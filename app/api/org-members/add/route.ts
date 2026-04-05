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

const ORG_ROLES_ALLOWED = ["owner", "admin"];
const ADDABLE_ROLES = ["admin", "agency", "member"];

export async function POST(req: Request) {
  const body = await req.json().catch(() => ({}));
  const email = typeof body.email === "string" ? body.email.trim().toLowerCase() : "";
  const role = ADDABLE_ROLES.includes(body.role) ? body.role : "member";

  if (!email) {
    return NextResponse.json({ success: false, error: "email required" }, { status: 400 });
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
    return NextResponse.json({ success: false, error: "Only owner or admin can add members" }, { status: 403 });
  }

  const admin = supabaseAdmin();
  const organizationId = String(myMem.organization_id ?? "");
  let maxSeats: number | null;
  try {
    maxSeats = await getPlanMaxSeatsForUser(admin, user.id, user.email ?? null, organizationId);
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Seat limit check failed";
    return NextResponse.json({ success: false, error: msg }, { status: 500 });
  }

  let page = 1;
  const perPage = 100;
  let foundUserId: string | null = null;
  while (true) {
    const { data, error } = await admin.auth.admin.listUsers({ page, perPage });
    if (error) {
      return NextResponse.json({ success: false, error: error.message }, { status: 500 });
    }
    const users = data?.users ?? [];
    const found = users.find((u) => u.email?.toLowerCase() === email);
    if (found) {
      foundUserId = found.id;
      break;
    }
    if (users.length < perPage) break;
    page += 1;
    if (page > 20) break;
  }

  if (!foundUserId) {
    return NextResponse.json({ success: false, error: "Пользователь не найден" }, { status: 404 });
  }

  try {
    const seatCount = await countBillableSeatsForOrganization(admin, myMem.organization_id);
    const alreadySeated = await userHasBillableSeatInOrganization(admin, myMem.organization_id, foundUserId);
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

  const { error: insertErr } = await admin
    .from("organization_members")
    .insert({
      organization_id: myMem.organization_id,
      user_id: foundUserId,
      role,
    });

  if (insertErr) {
    if (insertErr.code === "23505") {
      return NextResponse.json({ success: false, error: "Пользователь уже добавлен в организацию" }, { status: 409 });
    }
    return NextResponse.json({ success: false, error: insertErr.message }, { status: 500 });
  }

  return NextResponse.json({ success: true });
}
