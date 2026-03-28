import { NextResponse } from "next/server";
import { parseBearerToken } from "@/app/lib/auth/parseBearerAuth";
import { supabaseAdmin } from "@/app/lib/supabaseAdmin";

const INTERNAL_HEADER = "x-internal-sync-secret";
const SCALE = 6;

function roundToScale(value: number): number {
  const factor = 10 ** SCALE;
  return Math.round(value * factor) / factor;
}

function ymdUtc(date: Date): string {
  return date.toISOString().slice(0, 10);
}

async function authorizeInternalCron(req: Request): Promise<boolean> {
  const internalSecret = process.env.INTERNAL_SYNC_SECRET;
  const cronSecret = process.env.CRON_SECRET;

  const headerSecret = req.headers.get(INTERNAL_HEADER) ?? req.headers.get(INTERNAL_HEADER.toLowerCase());
  if (typeof internalSecret === "string" && internalSecret.length > 0 && headerSecret === internalSecret) {
    return true;
  }

  const bearer = parseBearerToken(req.headers.get("authorization"));
  if (typeof cronSecret === "string" && cronSecret.length > 0 && bearer === cronSecret) return true;
  if (typeof internalSecret === "string" && internalSecret.length > 0 && bearer === internalSecret) return true;

  return false;
}

type PlanRow = {
  id: string;
  project_id: string;
  month: number;
  year: number;
  sales_plan_count: number | null;
  sales_plan_budget: number | null;
  repeat_sales_count: number | null;
  repeat_sales_budget: number | null;
  planned_revenue: number | null;
  primary_avg_check: number | null;
  repeat_avg_check: number | null;
};

type PurchaseRow = {
  project_id: string | null;
  value: number | null;
};

type SpendRow = {
  project_id: string | null;
  spend: number | null;
};

async function runSnapshotForDate(targetYmd: string) {
  const admin = supabaseAdmin();
  const dateObj = new Date(`${targetYmd}T00:00:00.000Z`);
  const month = dateObj.getUTCMonth() + 1;
  const year = dateObj.getUTCFullYear();
  const dayStart = `${targetYmd}T00:00:00.000Z`;
  const dayEnd = `${targetYmd}T23:59:59.999Z`;

  const { data: plans, error: plansError } = await admin
    .from("project_monthly_plans")
    .select(
      "id, project_id, month, year, sales_plan_count, sales_plan_budget, repeat_sales_count, repeat_sales_budget, planned_revenue, primary_avg_check, repeat_avg_check"
    )
    .eq("month", month)
    .eq("year", year)
    .limit(5000);

  if (plansError) {
    return { success: false, error: plansError.message };
  }

  const planRows = (plans ?? []) as PlanRow[];
  if (planRows.length === 0) {
    return { success: true, snapshot_date: targetYmd, upserted: 0 };
  }

  const projectIds = Array.from(new Set(planRows.map((p) => p.project_id)));

  const { data: purchaseRows, error: purchasesError } = await admin
    .from("conversion_events")
    .select("project_id, value")
    .in("project_id", projectIds)
    .eq("event_name", "purchase")
    .gte("created_at", dayStart)
    .lte("created_at", dayEnd)
    .limit(100000);
  if (purchasesError) {
    return { success: false, error: purchasesError.message };
  }

  const purchaseAgg = new Map<string, { sales: number; revenue: number }>();
  for (const row of (purchaseRows ?? []) as PurchaseRow[]) {
    const projectId = String(row.project_id ?? "");
    if (!projectId) continue;
    const cur = purchaseAgg.get(projectId) ?? { sales: 0, revenue: 0 };
    cur.sales += 1;
    cur.revenue += Number(row.value ?? 0) || 0;
    purchaseAgg.set(projectId, cur);
  }

  const { data: spendRows, error: spendError } = await admin
    .from("daily_ad_metrics")
    .select("project_id, spend")
    .in("project_id", projectIds)
    .eq("day", targetYmd)
    .limit(100000);
  if (spendError) {
    return { success: false, error: spendError.message };
  }

  const spendAgg = new Map<string, number>();
  for (const row of (spendRows ?? []) as SpendRow[]) {
    const projectId = String(row.project_id ?? "");
    if (!projectId) continue;
    const cur = spendAgg.get(projectId) ?? 0;
    spendAgg.set(projectId, cur + (Number(row.spend ?? 0) || 0));
  }

  const payload = planRows.map((plan) => {
    const facts = purchaseAgg.get(plan.project_id) ?? { sales: 0, revenue: 0 };
    const spend = spendAgg.get(plan.project_id) ?? 0;
    const factSales = roundToScale(facts.sales);
    const factRevenue = roundToScale(facts.revenue);
    const factSpend = roundToScale(spend);
    const factRoas = factSpend > 0 ? roundToScale(factRevenue / factSpend) : null;
    const factCac = factSales > 0 ? roundToScale(factSpend / factSales) : null;

    return {
      project_id: plan.project_id,
      snapshot_date: targetYmd,
      month: plan.month,
      year: plan.year,
      sales_plan_count: plan.sales_plan_count,
      sales_plan_budget: plan.sales_plan_budget,
      repeat_sales_count: plan.repeat_sales_count,
      repeat_sales_budget: plan.repeat_sales_budget,
      planned_revenue: plan.planned_revenue,
      primary_avg_check: plan.primary_avg_check,
      repeat_avg_check: plan.repeat_avg_check,
      fact_sales: factSales,
      fact_spend: factSpend,
      fact_revenue: factRevenue,
      fact_roas: factRoas,
      fact_cac: factCac,
      fact_cpr: null,
      updated_at: new Date().toISOString(),
    };
  });

  const { error: upsertError } = await admin
    .from("project_plan_fact_daily")
    .upsert(payload, { onConflict: "project_id,snapshot_date" });

  if (upsertError) {
    return { success: false, error: upsertError.message };
  }

  return { success: true, snapshot_date: targetYmd, upserted: payload.length };
}

export async function POST(req: Request) {
  const ok = await authorizeInternalCron(req);
  if (!ok) return NextResponse.json({ success: false, error: "Unauthorized" }, { status: 401 });
  const { searchParams } = new URL(req.url);
  const dateParam = searchParams.get("date");
  const targetYmd =
    dateParam && /^\d{4}-\d{2}-\d{2}$/.test(dateParam) ? dateParam : ymdUtc(new Date());
  const result = await runSnapshotForDate(targetYmd);
  return NextResponse.json(result, { status: result.success ? 200 : 500 });
}

export async function GET(req: Request) {
  return POST(req);
}

