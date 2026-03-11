import { NextResponse } from "next/server";
import { createServerSupabase } from "@/app/lib/supabaseServer";
import { requireProjectAccess } from "@/app/lib/auth/requireProjectAccess";

/** Roles that can edit monthly plan: org owner/admin or project-level project_admin */
const ROLES_CAN_EDIT_PLAN = ["owner", "admin", "project_admin"];

export type MonthlyPlanRow = {
  id: string;
  project_id: string;
  month: number;
  year: number;
  sales_plan_count: number | null;
  sales_plan_budget: number | null;
  repeat_sales_count: number | null;
  repeat_sales_budget: number | null;
  planned_revenue: number | null;
  created_at: string;
  updated_at: string;
};

/**
 * GET /api/project-monthly-plans?project_id=...&month=...&year=...
 * Returns plan for the given project/month/year if user has access. 404 when no plan.
 */
export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const projectId = searchParams.get("project_id")?.trim();
  const month = searchParams.get("month")?.trim();
  const year = searchParams.get("year")?.trim();

  if (!projectId || !month || !year) {
    return NextResponse.json(
      { success: false, error: "project_id, month, year required" },
      { status: 400 }
    );
  }

  const monthNum = parseInt(month, 10);
  const yearNum = parseInt(year, 10);
  if (!Number.isFinite(monthNum) || monthNum < 1 || monthNum > 12 || !Number.isFinite(yearNum)) {
    return NextResponse.json(
      { success: false, error: "Invalid month or year" },
      { status: 400 }
    );
  }

  const supabase = await createServerSupabase();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ success: false, error: "Unauthorized" }, { status: 401 });
  }

  const access = await requireProjectAccess(user.id, projectId);
  if (!access) {
    console.log("[project-monthly-plans GET] access denied", { userId: user.id, projectId });
    return NextResponse.json({ success: false, error: "Project access denied" }, { status: 403 });
  }

  const canEdit = ROLES_CAN_EDIT_PLAN.includes(access.role);
  console.log("[project-monthly-plans GET] canEdit computed", {
    userId: user.id,
    projectId,
    accessRole: access.role,
    rolesCanEditPlan: ROLES_CAN_EDIT_PLAN,
    canEdit,
  });

  const { data: row, error } = await supabase
    .from("project_monthly_plans")
    .select("id, project_id, month, year, sales_plan_count, sales_plan_budget, repeat_sales_count, repeat_sales_budget, planned_revenue, created_at, updated_at")
    .eq("project_id", projectId)
    .eq("month", monthNum)
    .eq("year", yearNum)
    .maybeSingle();

  if (error) {
    return NextResponse.json({ success: false, error: error.message }, { status: 500 });
  }

  return NextResponse.json({
    success: true,
    canEdit,
    plan: row
      ? {
          id: row.id,
          project_id: row.project_id,
          month: row.month,
          year: row.year,
          sales_plan_count: row.sales_plan_count ?? null,
          sales_plan_budget: row.sales_plan_budget ?? null,
          repeat_sales_count: row.repeat_sales_count ?? null,
          repeat_sales_budget: row.repeat_sales_budget ?? null,
          planned_revenue: row.planned_revenue ?? null,
          created_at: row.created_at,
          updated_at: row.updated_at,
        }
      : null,
  });
}

/**
 * POST /api/project-monthly-plans — create or update monthly plan.
 * Body: project_id, month, year, sales_plan_count?, sales_plan_budget?, repeat_sales_count?, repeat_sales_budget?, planned_revenue?
 * Only owner, admin or project_admin can save.
 */
export async function POST(req: Request) {
  const supabase = await createServerSupabase();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ success: false, error: "Unauthorized" }, { status: 401 });
  }

  let body: {
    project_id?: string;
    month?: number;
    year?: number;
    sales_plan_count?: number | null;
    sales_plan_budget?: number | null;
    repeat_sales_count?: number | null;
    repeat_sales_budget?: number | null;
    planned_revenue?: number | null;
  };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ success: false, error: "Invalid JSON" }, { status: 400 });
  }

  const projectId = body.project_id?.trim();
  const month = body.month != null ? Number(body.month) : NaN;
  const year = body.year != null ? Number(body.year) : NaN;

  if (!projectId || !Number.isFinite(month) || month < 1 || month > 12 || !Number.isFinite(year)) {
    return NextResponse.json(
      { success: false, error: "project_id, month (1-12), year required" },
      { status: 400 }
    );
  }

  const access = await requireProjectAccess(user.id, projectId);
  if (!access) {
    return NextResponse.json({ success: false, error: "Project access denied" }, { status: 403 });
  }

  if (!ROLES_CAN_EDIT_PLAN.includes(access.role)) {
    return NextResponse.json(
      { success: false, error: "Only owner, admin or project_admin can edit plan" },
      { status: 403 }
    );
  }

  const payload = {
    project_id: projectId,
    month: Math.floor(month),
    year: Math.floor(year),
    sales_plan_count: body.sales_plan_count ?? null,
    sales_plan_budget: body.sales_plan_budget ?? null,
    repeat_sales_count: body.repeat_sales_count ?? null,
    repeat_sales_budget: body.repeat_sales_budget ?? null,
    planned_revenue: body.planned_revenue ?? null,
    updated_by: user.id,
    updated_at: new Date().toISOString(),
  };

  const { data: existing } = await supabase
    .from("project_monthly_plans")
    .select("id")
    .eq("project_id", projectId)
    .eq("month", payload.month)
    .eq("year", payload.year)
    .maybeSingle();

  if (existing) {
    const { data: updated, error } = await supabase
      .from("project_monthly_plans")
      .update({
        sales_plan_count: payload.sales_plan_count,
        sales_plan_budget: payload.sales_plan_budget,
        repeat_sales_count: payload.repeat_sales_count,
        repeat_sales_budget: payload.repeat_sales_budget,
        planned_revenue: payload.planned_revenue,
        updated_by: payload.updated_by,
        updated_at: payload.updated_at,
      })
      .eq("id", existing.id)
      .select()
      .single();

    if (error) {
      return NextResponse.json({ success: false, error: error.message }, { status: 500 });
    }
    return NextResponse.json({ success: true, plan: updated });
  }

  const { data: inserted, error } = await supabase
    .from("project_monthly_plans")
    .insert({
      project_id: payload.project_id,
      month: payload.month,
      year: payload.year,
      sales_plan_count: payload.sales_plan_count,
      sales_plan_budget: payload.sales_plan_budget,
      repeat_sales_count: payload.repeat_sales_count,
      repeat_sales_budget: payload.repeat_sales_budget,
      planned_revenue: payload.planned_revenue,
      created_by: user.id,
      updated_by: payload.updated_by,
    })
    .select()
    .single();

  if (error) {
    return NextResponse.json({ success: false, error: error.message }, { status: 500 });
  }
  return NextResponse.json({ success: true, plan: inserted });
}
