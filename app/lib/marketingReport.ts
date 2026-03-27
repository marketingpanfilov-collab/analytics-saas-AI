/**
 * Marketing report: plan vs fact, KPIs, budget coverage, campaign alerts, campaign table.
 * Uses: project_monthly_plans, conversion_events, visit_source_events, daily_ad_metrics, campaigns.
 */
import type { SupabaseClient } from "@supabase/supabase-js";

export type PlanMetrics = {
  monthly_budget: number | null;
  target_registrations: number | null;
  target_sales: number | null;
  target_roas: number | null;
  target_cac: number | null;
  fact_budget: number;
  fact_registrations: number;
  fact_sales: number;
  fact_revenue: number;
  fact_roas: number | null;
  fact_cac: number | null;
};

export type KpiMetrics = {
  cac: number | null;
  cpr: number | null;
  cpo: number | null;
  roas: number | null;
  conversion_rate: number | null;
  new_buyers: number;
  returning_buyers: number;
  average_touches_before_purchase: number | null;
};

export type BudgetCoverage = {
  monthly_budget: number | null;
  active_campaign_budget: number;
  uncovered_budget: number | null;
  by_platform: { platform: string; spend: number }[];
};

export type CampaignAlert = {
  platform: string;
  campaign_name: string;
  campaign_id: string | null;
  problem_type: string;
  recommendation: string;
};

export type CampaignRow = {
  platform: string;
  campaign_id: string | null;
  campaign_name: string;
  spend: number;
  impressions: number;
  clicks: number;
  conversions: number;
  cac: number | null;
  roas: number | null;
  status: "green" | "yellow" | "red";
};

export type ForecastMetrics = {
  days_passed: number;
  days_total: number;
  current_spend: number;
  current_sales: number;
  current_registrations: number;
  plan_budget: number | null;
  plan_registrations: number | null;
  plan_sales: number | null;
  forecast_spend: number;
  forecast_registrations: number;
  forecast_sales: number;
};

const PLATFORM_LABEL: Record<string, string> = {
  meta: "Meta Ads",
  google: "Google Ads",
  tiktok: "TikTok Ads",
  yandex: "Yandex Ads",
};

async function resolveAdAccountIds(admin: SupabaseClient, projectId: string): Promise<string[]> {
  const { data: metaRows } = await admin
    .from("integrations_meta")
    .select("integrations_id")
    .eq("project_id", projectId);
  const metaIds = [...new Set((metaRows ?? []).map((r: { integrations_id: string | null }) => r.integrations_id).filter(Boolean))] as string[];

  const { data: googleRows } = await admin
    .from("integrations")
    .select("id")
    .eq("project_id", projectId)
    .eq("platform", "google");
  const googleIds = (googleRows ?? []).map((r: { id: string }) => r.id);

  let integrationIds: string[] = [...new Set([...metaIds, ...googleIds])];
  if (!integrationIds.length) {
    const { data: allInt } = await admin.from("integrations").select("id").eq("project_id", projectId);
    integrationIds = (allInt ?? []).map((r: { id: string }) => r.id);
  }
  if (!integrationIds.length) return [];

  const { data: adAccounts } = await admin.from("ad_accounts").select("id").in("integration_id", integrationIds);
  return (adAccounts ?? []).map((a: { id: string }) => a.id);
}

export type MarketingSummaryOptions = {
  project_id: string;
  start: string;
  end: string;
  target_cac?: number | null;
  target_roas?: number | null;
};

export async function getMarketingSummary(
  admin: SupabaseClient,
  options: MarketingSummaryOptions
): Promise<{
  plan: PlanMetrics;
  kpi: KpiMetrics;
  budget: BudgetCoverage;
  campaign_alerts: CampaignAlert[];
  campaign_table: CampaignRow[];
  forecast: ForecastMetrics | null;
}> {
  const { project_id, start, end, target_cac = null, target_roas = null } = options;

  const now = new Date();
  const month = now.getMonth() + 1;
  const year = now.getFullYear();

  const plan: PlanMetrics = {
    monthly_budget: null,
    target_registrations: null,
    target_sales: null,
    target_roas: target_roas ?? null,
    target_cac: target_cac ?? null,
    fact_budget: 0,
    fact_registrations: 0,
    fact_sales: 0,
    fact_revenue: 0,
    fact_roas: null,
    fact_cac: null,
  };

  const { data: planRow } = await admin
    .from("project_monthly_plans")
    .select("sales_plan_budget, sales_plan_count, planned_revenue")
    .eq("project_id", project_id)
    .eq("month", month)
    .eq("year", year)
    .maybeSingle();

  if (planRow) {
    plan.monthly_budget = Number((planRow as { sales_plan_budget?: number }).sales_plan_budget ?? 0) || null;
    plan.target_sales = Number((planRow as { sales_plan_count?: number }).sales_plan_count ?? 0) || null;
    if (plan.monthly_budget != null && plan.monthly_budget > 0) plan.monthly_budget = plan.monthly_budget;
    if (plan.target_sales != null && plan.target_sales > 0) plan.target_sales = plan.target_sales;
  }
  if (target_roas != null) plan.target_roas = target_roas;
  if (target_cac != null) plan.target_cac = target_cac;

  const startDate = start + "T00:00:00.000Z";
  const endDate = end + "T23:59:59.999Z";

  const { data: conversions } = await admin
    .from("conversion_events")
    .select("id, event_name, visitor_id, user_external_id, value, created_at")
    .eq("project_id", project_id)
    .gte("created_at", startDate)
    .lte("created_at", endDate)
    .in("event_name", ["registration", "purchase"]);

  const convList = (conversions ?? []) as { id: string; event_name: string; visitor_id: string | null; user_external_id: string | null; value: number | null; created_at: string }[];
  const registrations = convList.filter((c) => c.event_name === "registration");
  const purchases = convList.filter((c) => c.event_name === "purchase");
  const revenue = purchases.reduce((s, c) => s + (Number(c.value) || 0), 0);

  const purchaseByUser = new Map<string, number>();
  for (const p of purchases) {
    const uid = (p.user_external_id ?? p.visitor_id ?? p.id)?.trim() || "";
    if (uid) purchaseByUser.set(uid, (purchaseByUser.get(uid) ?? 0) + 1);
  }
  let new_buyers = 0;
  let returning_buyers = 0;
  purchaseByUser.forEach((count) => {
    if (count === 1) new_buyers += 1;
    else returning_buyers += 1;
  });

  const adAccountIds = await resolveAdAccountIds(admin, project_id);
  let totalSpend = 0;
  const spendByPlatform: Record<string, number> = {};

  if (adAccountIds.length > 0) {
    const { data: metricsRows } = await admin
      .from("daily_ad_metrics")
      .select("campaign_id, platform, spend, impressions, clicks, purchases, revenue")
      .in("ad_account_id", adAccountIds)
      .gte("date", start)
      .lte("date", end);

    const rows = (metricsRows ?? []) as { campaign_id: string | null; platform: string; spend: number; impressions: number; clicks: number; purchases: number; revenue: number }[];
    for (const r of rows) {
      const sp = Number(r.spend ?? 0) || 0;
      totalSpend += sp;
      const plat = String(r.platform || "unknown").toLowerCase();
      spendByPlatform[plat] = (spendByPlatform[plat] ?? 0) + sp;
    }
  }

  plan.fact_budget = totalSpend;
  plan.fact_registrations = registrations.length;
  plan.fact_sales = purchases.length;
  plan.fact_revenue = revenue;
  plan.fact_roas = totalSpend > 0 ? revenue / totalSpend : null;
  plan.fact_cac = registrations.length > 0 ? totalSpend / registrations.length : null;

  const by_platform = Object.entries(spendByPlatform).map(([platform, spend]) => ({
    platform: PLATFORM_LABEL[platform] ?? platform,
    spend,
  }));

  const budget: BudgetCoverage = {
    monthly_budget: plan.monthly_budget,
    active_campaign_budget: totalSpend,
    uncovered_budget: plan.monthly_budget != null ? Math.max(0, plan.monthly_budget - totalSpend) : null,
    by_platform,
  };

  let average_touches: number | null = null;
  if (purchases.length > 0) {
    const visitorIds = [...new Set(purchases.map((p) => p.visitor_id?.trim()).filter(Boolean))] as string[];
    if (visitorIds.length > 0) {
      const { data: visitRows } = await admin
        .from("visit_source_events")
        .select("visitor_id, created_at")
        .eq("site_id", project_id)
        .in("visitor_id", visitorIds)
        .lte("created_at", endDate);
      const visits = (visitRows ?? []) as { visitor_id: string; created_at: string }[];
      let totalTouches = 0;
      let counted = 0;
      for (const p of purchases) {
        const vid = p.visitor_id?.trim();
        if (!vid) continue;
        const purchaseTime = new Date(p.created_at).getTime();
        const n = visits.filter((v) => v.visitor_id === vid && new Date(v.created_at).getTime() < purchaseTime).length;
        totalTouches += n;
        counted += 1;
      }
      average_touches = counted > 0 ? totalTouches / counted : null;
    }
  }

  const kpi: KpiMetrics = {
    cac: plan.fact_cac,
    cpr: registrations.length > 0 ? totalSpend / registrations.length : null,
    cpo: purchases.length > 0 ? totalSpend / purchases.length : null,
    roas: plan.fact_roas,
    conversion_rate: registrations.length > 0 && totalSpend > 0 ? (purchases.length / registrations.length) * 100 : null,
    new_buyers,
    returning_buyers,
    average_touches_before_purchase: average_touches,
  };

  const campaignIds = new Set<string>();
  const campaignAgg: Record<
    string,
    { platform: string; spend: number; impressions: number; clicks: number; conversions: number; revenue: number }
  > = {};

  if (adAccountIds.length > 0) {
    const { data: campRows } = await admin
      .from("daily_ad_metrics")
      .select("campaign_id, platform, spend, impressions, clicks, purchases, revenue")
      .in("ad_account_id", adAccountIds)
      .not("campaign_id", "is", null)
      .gte("date", start)
      .lte("date", end);

    const cRows = (campRows ?? []) as { campaign_id: string; platform: string; spend: number; impressions: number; clicks: number; purchases: number; revenue: number }[];
    for (const r of cRows) {
      const cid = r.campaign_id;
      campaignIds.add(cid);
      const key = cid;
      if (!campaignAgg[key]) {
        campaignAgg[key] = { platform: r.platform, spend: 0, impressions: 0, clicks: 0, conversions: 0, revenue: 0 };
      }
      const agg = campaignAgg[key];
      agg.spend += Number(r.spend ?? 0) || 0;
      agg.impressions += Number(r.impressions ?? 0) || 0;
      agg.clicks += Number(r.clicks ?? 0) || 0;
      agg.conversions += Number(r.purchases ?? 0) || 0;
      agg.revenue += Number(r.revenue ?? 0) || 0;
    }
  }

  const campaignNames: Record<string, string> = {};
  if (campaignIds.size > 0) {
    const { data: cNames } = await admin
      .from("campaigns")
      .select("id, name")
      .in("id", Array.from(campaignIds));
    const list = (cNames ?? []) as { id: string; name: string | null }[];
    list.forEach((c) => {
      campaignNames[c.id] = c.name ?? "—";
    });
  }

  const targetCac = plan.target_cac ?? 0;
  const targetRoas = plan.target_roas ?? 0;

  const campaign_table: CampaignRow[] = [];
  const campaign_alerts: CampaignAlert[] = [];

  for (const [cid, agg] of Object.entries(campaignAgg)) {
    const name = campaignNames[cid] ?? "—";
    const platformLabel = PLATFORM_LABEL[agg.platform] ?? agg.platform;
    const cac = agg.conversions > 0 ? agg.spend / agg.conversions : null;
    const roas = agg.spend > 0 ? agg.revenue / agg.spend : null;

    let status: "green" | "yellow" | "red" = "green";
    if (targetCac > 0 && cac != null) {
      const pct = Math.abs(cac - targetCac) / targetCac;
      if (pct > 0.2) status = "red";
      else if (pct > 0) status = "yellow";
    }
    if (targetRoas > 0 && roas != null) {
      const pct = Math.abs(roas - targetRoas) / targetRoas;
      if (pct > 0.2) status = "red";
      else if (pct > 0 && status === "green") status = "yellow";
    }

    campaign_table.push({
      platform: platformLabel,
      campaign_id: cid,
      campaign_name: name,
      spend: agg.spend,
      impressions: agg.impressions,
      clicks: agg.clicks,
      conversions: agg.conversions,
      cac,
      roas,
      status,
    });

    if (agg.spend > 0 && agg.conversions === 0) {
      campaign_alerts.push({
        platform: platformLabel,
        campaign_name: name,
        campaign_id: cid,
        problem_type: "spend_no_conversions",
        recommendation: "Проверить креативы и таргетинг или отключить кампанию.",
      });
    }
    if (targetCac > 0 && cac != null && cac > targetCac) {
      campaign_alerts.push({
        platform: platformLabel,
        campaign_name: name,
        campaign_id: cid,
        problem_type: "cac_above_target",
        recommendation: `CAC ${cac.toFixed(0)} выше цели ${targetCac}. Оптимизировать воронку или креативы.`,
      });
    }
    if (targetRoas > 0 && roas != null && roas < targetRoas) {
      campaign_alerts.push({
        platform: platformLabel,
        campaign_name: name,
        campaign_id: cid,
        problem_type: "roas_below_target",
        recommendation: `ROAS ${(roas ?? 0).toFixed(2)} ниже цели ${targetRoas}. Пересмотреть ставки или креативы.`,
      });
    }
    if (agg.impressions === 0) {
      campaign_alerts.push({
        platform: platformLabel,
        campaign_name: name,
        campaign_id: cid,
        problem_type: "no_impressions",
        recommendation: "Нет показов. Проверить бюджет и таргетинг.",
      });
    }
    if (agg.spend === 0 && agg.impressions === 0) {
      campaign_alerts.push({
        platform: platformLabel,
        campaign_name: name,
        campaign_id: cid,
        problem_type: "no_activity",
        recommendation: "Нет активности. Запустить кампанию или проверить синхронизацию.",
      });
    }
  }

  campaign_table.sort((a, b) => b.spend - a.spend);

  // Forecast: current month to date → extrapolate to end of month
  const today = new Date();
  const monthStart = new Date(today.getFullYear(), today.getMonth(), 1);
  const monthEnd = new Date(today.getFullYear(), today.getMonth() + 1, 0);
  const monthStartStr = monthStart.toISOString().slice(0, 10);
  const todayStr = today.toISOString().slice(0, 10);
  const days_total = monthEnd.getDate();
  const days_passed = Math.min(today.getDate(), days_total) || 1;

  let forecast: ForecastMetrics | null = null;
  if (days_passed > 0) {
    const monthStartDate = monthStartStr + "T00:00:00.000Z";
    const todayEndDate = todayStr + "T23:59:59.999Z";

    let currentSpend = 0;
    if (adAccountIds.length > 0) {
      const { data: monthRows } = await admin
        .from("daily_ad_metrics")
        .select("spend")
        .in("ad_account_id", adAccountIds)
        .gte("date", monthStartStr)
        .lte("date", todayStr);
      const mRows = (monthRows ?? []) as { spend: number }[];
      currentSpend = mRows.reduce((s, r) => s + (Number(r.spend) ?? 0), 0);
    }

    const { data: monthConvs } = await admin
      .from("conversion_events")
      .select("event_name")
      .eq("project_id", project_id)
      .gte("created_at", monthStartDate)
      .lte("created_at", todayEndDate)
      .in("event_name", ["registration", "purchase"]);
    const monthConvList = (monthConvs ?? []) as { event_name: string }[];
    const currentReg = monthConvList.filter((c) => c.event_name === "registration").length;
    const currentSales = monthConvList.filter((c) => c.event_name === "purchase").length;

    const dailySpend = days_passed > 0 ? currentSpend / days_passed : 0;
    const dailyReg = days_passed > 0 ? currentReg / days_passed : 0;
    const dailySales = days_passed > 0 ? currentSales / days_passed : 0;

    forecast = {
      days_passed,
      days_total,
      current_spend: currentSpend,
      current_sales: currentSales,
      current_registrations: currentReg,
      plan_budget: plan.monthly_budget,
      plan_registrations: plan.target_registrations,
      plan_sales: plan.target_sales,
      forecast_spend: dailySpend * days_total,
      forecast_registrations: Math.round(dailyReg * days_total),
      forecast_sales: Math.round(dailySales * days_total),
    };
  }

  return {
    plan,
    kpi,
    budget,
    campaign_alerts,
    campaign_table,
    forecast,
  };
}
