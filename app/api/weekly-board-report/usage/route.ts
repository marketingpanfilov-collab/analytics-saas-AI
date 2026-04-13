/**
 * GET /api/weekly-board-report/usage?project_id= — использовано/лимит weekly report за текущий UTC-месяц (организация проекта).
 */
import { NextResponse } from "next/server";
import { createServerSupabase } from "@/app/lib/supabaseServer";
import { supabaseAdmin } from "@/app/lib/supabaseAdmin";
import { requireProjectAccess } from "@/app/lib/auth/requireProjectAccess";
import {
  billingAnalyticsReadGateBeforeProject,
  billingGateUnavailableResponse,
} from "@/app/lib/auth/requireBillingAccess";
import { resolveBillingGateContext } from "@/app/lib/billingCurrentPlan";
import {
  countWeeklyReportUsageForMonth,
  isWeeklyBoardReportPlanAllowed,
  loadProjectOrganizationId,
  maxWeeklyReportsForEffectivePlan,
  weeklyReportUsageMonthUtc,
} from "@/app/lib/weeklyReportOrgUsage";
import { PLAN_RESTRICTED_ANALYTICS_MESSAGE } from "@/app/lib/planRestrictedCopy";

export async function GET(req: Request) {
  try {
    const { searchParams } = new URL(req.url);
    const projectId = searchParams.get("project_id")?.trim() ?? null;
    if (!projectId) {
      return NextResponse.json({ success: false, error: "project_id is required" }, { status: 400 });
    }

    const billingRead = await billingAnalyticsReadGateBeforeProject(req);
    if (!billingRead.ok) return billingRead.response;

    const supabase = await createServerSupabase();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) {
      return NextResponse.json({ success: false, error: "Unauthorized" }, { status: 401 });
    }

    const access = await requireProjectAccess(user.id, projectId);
    if (!access) {
      return NextResponse.json({ success: false, error: "Project access denied" }, { status: 403 });
    }

    const admin = supabaseAdmin();
    const ctx = await resolveBillingGateContext(admin, user.id, user.email ?? null, { projectId });
    if (!ctx.ok) {
      return billingGateUnavailableResponse();
    }
    if (!isWeeklyBoardReportPlanAllowed(ctx.effective_plan)) {
      return NextResponse.json(
        {
          success: false,
          error: PLAN_RESTRICTED_ANALYTICS_MESSAGE,
          code: "WEEKLY_REPORT_REQUIRES_PAID_PLAN",
          effective_plan: ctx.effective_plan,
        },
        { status: 403 }
      );
    }
    const limit = maxWeeklyReportsForEffectivePlan(ctx.effective_plan, ctx.experience_tier);
    const month = weeklyReportUsageMonthUtc();

    const organizationId = await loadProjectOrganizationId(admin, projectId);
    const used = organizationId ? await countWeeklyReportUsageForMonth(admin, organizationId, month) : 0;

    return NextResponse.json({
      success: true,
      used,
      limit,
      unlimited: limit == null,
      usage_month_utc: month,
      effective_plan: ctx.effective_plan,
      exhausted: limit != null && used >= limit,
    });
  } catch (e) {
    console.error("[WEEKLY_REPORT_USAGE]", e);
    return NextResponse.json(
      { success: false, error: e instanceof Error ? e.message : "Internal error" },
      { status: 500 }
    );
  }
}
