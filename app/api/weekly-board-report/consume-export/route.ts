/**
 * POST /api/weekly-board-report/consume-export — списание месячной квоты перед печатью / Save as PDF (Starter).
 */
import { NextResponse } from "next/server";
import { createServerSupabase } from "@/app/lib/supabaseServer";
import { supabaseAdmin } from "@/app/lib/supabaseAdmin";
import { requireProjectAccess } from "@/app/lib/auth/requireProjectAccess";
import { billingHeavySyncGateBeforeProject } from "@/app/lib/auth/requireBillingAccess";
import { resolveBillingGateContext } from "@/app/lib/billingCurrentPlan";
import {
  consumeWeeklyReportUsageAfterSuccess,
  countWeeklyReportUsageForMonth,
  isValidWeeklyReportExportNonce,
  loadProjectOrganizationId,
  maxWeeklyReportsForEffectivePlan,
  weeklyReportUsageMonthUtc,
} from "@/app/lib/weeklyReportOrgUsage";
import { buildWeeklyReportPayload } from "../route";

export async function POST(req: Request) {
  try {
    const body = await req.json().catch(() => null);
    const projectId = typeof body?.project_id === "string" ? body.project_id.trim() : null;
    const start = typeof body?.start === "string" ? body.start.trim() : null;
    const end = typeof body?.end === "string" ? body.end.trim() : null;
    const sources = Array.isArray(body?.sources)
      ? body.sources.map((v: unknown) => String(v)).filter(Boolean)
      : typeof body?.sources === "string"
        ? body.sources.split(",").map((v: string) => v.trim()).filter(Boolean)
        : [];
    const accountIds = Array.isArray(body?.account_ids)
      ? body.account_ids.map((v: unknown) => String(v)).filter(Boolean)
      : typeof body?.account_ids === "string"
        ? body.account_ids.split(",").map((v: string) => v.trim()).filter(Boolean)
        : [];
    const exportNonceRaw = body?.export_nonce ?? body?.export_attempt_nonce;
    const exportNonce = isValidWeeklyReportExportNonce(exportNonceRaw) ? exportNonceRaw.trim() : null;

    if (!projectId) {
      return NextResponse.json({ success: false, error: "project_id is required" }, { status: 400 });
    }
    if (!exportNonce) {
      return NextResponse.json(
        { success: false, error: "export_nonce is required (unique id per print/PDF, e.g. crypto.randomUUID())" },
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

    const billingPre = await billingHeavySyncGateBeforeProject(req);
    if (!billingPre.ok) return billingPre.response;

    const access = await requireProjectAccess(user.id, projectId);
    if (!access) {
      return NextResponse.json({ success: false, error: "Project access denied" }, { status: 403 });
    }

    const admin = supabaseAdmin();
    const today = new Date().toISOString().slice(0, 10);
    const monthStart = `${today.slice(0, 8)}01`;
    const periodStart = start && /^\d{4}-\d{2}-\d{2}$/.test(start) ? start : monthStart;
    const periodEnd = end && /^\d{4}-\d{2}-\d{2}$/.test(end) ? end : today;

    const payload = await buildWeeklyReportPayload(admin, projectId, {
      start: periodStart,
      end: periodEnd,
      sources,
      accountIds,
    });

    if (!payload.has_sufficient_data) {
      return NextResponse.json(
        { success: false, error: "Недостаточно данных для отчёта." },
        { status: 400 }
      );
    }

    const ctx = await resolveBillingGateContext(admin, user.id, user.email ?? null, { projectId });
    const maxWeekly = maxWeeklyReportsForEffectivePlan(ctx.effective_plan);
    const usageMonth = weeklyReportUsageMonthUtc();
    const organizationId = await loadProjectOrganizationId(admin, projectId);

    if (maxWeekly != null && organizationId) {
      const consume = await consumeWeeklyReportUsageAfterSuccess(admin, {
        organizationId,
        projectId,
        start: periodStart,
        end: periodEnd,
        sources,
        accountIds,
        maxPerMonth: maxWeekly,
        kind: "export_print",
        exportAttemptNonce: exportNonce,
      });
      if (!consume.ok) {
        return NextResponse.json(
          {
            success: false,
            code: consume.code,
            used: consume.used,
            limit: consume.limit,
            usage_month_utc: usageMonth,
          },
          { status: 403 }
        );
      }
    }

    let weeklyUsage: {
      used: number;
      limit: number | null;
      unlimited: boolean;
      usage_month_utc: string;
    } | null = null;
    if (organizationId) {
      const used = await countWeeklyReportUsageForMonth(admin, organizationId, usageMonth);
      weeklyUsage = {
        used,
        limit: maxWeekly,
        unlimited: maxWeekly == null,
        usage_month_utc: usageMonth,
      };
    }

    return NextResponse.json({
      success: true,
      weekly_usage: weeklyUsage,
    });
  } catch (e) {
    console.error("[WEEKLY_REPORT_CONSUME_EXPORT]", e);
    return NextResponse.json(
      { success: false, error: e instanceof Error ? e.message : "Internal error" },
      { status: 500 }
    );
  }
}
