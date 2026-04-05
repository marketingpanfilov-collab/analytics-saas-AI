import { NextResponse } from "next/server";
import { createServerSupabase } from "@/app/lib/supabaseServer";
import { supabaseAdmin } from "@/app/lib/supabaseAdmin";
import { getBillableSeatsBreakdownForOrganization } from "@/app/lib/orgSeatPlanLimit";

const ORG_ROLES_ALLOWED = ["owner", "admin"];

export async function GET(req: Request) {
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
    return NextResponse.json({ success: false, error: "Only owner or admin can view org members" }, { status: 403 });
  }

  const seatAudit = new URL(req.url).searchParams.get("seat_audit") === "1";

  // RLS на organization_members для authenticated: SELECT только своя строка (user_id = auth.uid()).
  // Список команды org иначе содержит одного пользователя; биллинг (service role) видит всех — расхождение с UI.
  const admin = supabaseAdmin();
  const { data: rows, error } = await admin
    .from("organization_members")
    .select("id, organization_id, user_id, role, created_at")
    .eq("organization_id", myMem.organization_id)
    .order("created_at", { ascending: true });

  if (error) {
    return NextResponse.json({ success: false, error: error.message }, { status: 500 });
  }
  const orgId = String(myMem.organization_id);
  let billableSeatCount = 0;
  let seatVisibility: {
    billable_seat_count: number;
    organization_members_list_count: number;
    project_only_billable_user_count: number;
    project_only_seat_details: {
      user_id: string;
      project_ids: string[];
      projects: { id: string; name: string }[];
      email: string | null;
    }[];
  } | null = null;
  let billable_seats_audit: Awaited<ReturnType<typeof getBillableSeatsBreakdownForOrganization>> | null = null;

  try {
    const breakdown = await getBillableSeatsBreakdownForOrganization(admin, orgId);
    billableSeatCount = breakdown.distinct_union_user_ids.length;

    const { data: orgProjects, error: opErr } = await admin
      .from("projects")
      .select("id, name")
      .eq("organization_id", orgId);
    if (opErr) throw new Error(opErr.message);
    const projectNameById = new Map<string, string>();
    for (const p of orgProjects ?? []) {
      const id = p?.id != null ? String(p.id) : "";
      if (id) projectNameById.set(id, String(p.name ?? "").trim() || "Без названия");
    }

    const projectOnlySeatDetails = await Promise.all(
      breakdown.project_only_seat_details.map(async (d) => {
        let email: string | null = null;
        try {
          const { data: u } = await admin.auth.admin.getUserById(d.user_id);
          email = u?.user?.email ?? null;
        } catch {
          email = null;
        }
        const projects = d.project_ids.map((pid) => ({
          id: pid,
          name: projectNameById.get(pid) ?? pid,
        }));
        return {
          user_id: d.user_id,
          project_ids: d.project_ids,
          projects,
          email,
        };
      })
    );

    seatVisibility = {
      billable_seat_count: billableSeatCount,
      organization_members_list_count: (rows ?? []).length,
      project_only_billable_user_count: breakdown.seat_holders_without_org_membership_row.length,
      project_only_seat_details: projectOnlySeatDetails,
    };
    if (seatAudit) {
      billable_seats_audit = breakdown;
    }
  } catch {
    billableSeatCount = (rows ?? []).length;
    seatVisibility = {
      billable_seat_count: billableSeatCount,
      organization_members_list_count: (rows ?? []).length,
      project_only_billable_user_count: 0,
      project_only_seat_details: [],
    };
  }

  const members = await Promise.all(
    (rows ?? []).map(async (row: { id: string; organization_id: string; user_id: string; role: string; created_at: string }) => {
      let email: string | null = null;
      try {
        const { data: u } = await admin.auth.admin.getUserById(row.user_id);
        email = u?.user?.email ?? null;
      } catch {
        // leave email null
      }
      return {
        id: row.id,
        organization_id: row.organization_id,
        user_id: row.user_id,
        role: row.role,
        created_at: row.created_at,
        email,
      };
    })
  );

  const payload: Record<string, unknown> = {
    success: true,
    members,
    billable_seat_count: billableSeatCount,
    primary_organization_id: orgId,
    seat_visibility: seatVisibility,
  };
  if (billable_seats_audit) {
    payload.billable_seats_audit = billable_seats_audit;
  }
  return NextResponse.json(payload);
}
