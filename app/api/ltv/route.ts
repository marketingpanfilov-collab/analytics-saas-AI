/**
 * LTV / Retention API — source of truth: conversion_events (purchases).
 * First purchase: global MIN(event_time) per user over all time.
 * Repeat: any purchase with event_time > first_purchase_time (still filtered by period for display).
 * User key: user_external_id || visitor_id only; no fallback to event id (events without key don't create fake users).
 *
 * Acquisition source filter: one source per user, derived from first purchase (click_id → redirect,
 * else visitor_id → first visit, else conversion traffic_source, else "unknown"). Retention campaigns
 * (campaign_intent=retention) are a separate dimension and are not mixed with acquisition source.
 */
import { NextResponse } from "next/server";
import { createServerSupabase } from "@/app/lib/supabaseServer";
import { supabaseAdmin } from "@/app/lib/supabaseAdmin";
import { requireProjectAccess } from "@/app/lib/auth/requireProjectAccess";
import { getCanonicalSummary } from "@/app/lib/dashboardCanonical";

const PAGE_SIZE = 1000;
const MAX_PAGES = 50; // cap at 50k events
const CLICK_ID_BATCH = 200;
const VISITOR_ID_BATCH = 500;

function toISODate(s: string | null): string | null {
  if (!s) return null;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return null;
  return s;
}

type PurchaseRow = {
  id: string;
  event_time: string | null;
  created_at: string;
  user_external_id: string | null;
  visitor_id: string | null;
  value: number | null;
  campaign_intent?: string | null;
  click_id?: string | null;
  traffic_source?: string | null;
};

/** First purchase info per user: time + fields needed to resolve acquisition source. */
type FirstPurchaseInfo = {
  firstEventTime: string;
  click_id: string | null;
  visitor_id: string | null;
  traffic_source: string | null;
};

/** Canonical acquisition source values for filter. Unattributed users are returned as "direct" (unknown only in comments). */
const ACQUISITION_SOURCE_VALUES = ["meta", "google", "tiktok", "yandex", "direct", "organic_search", "referral"] as const;

function normalizeAcquisitionSource(raw: string | null | undefined): string {
  if (raw == null || String(raw).trim() === "") return "direct";
  const v = String(raw).trim().toLowerCase();
  if (ACQUISITION_SOURCE_VALUES.includes(v as (typeof ACQUISITION_SOURCE_VALUES)[number])) return v;
  if (v === "organic_social") return "referral";
  if (v === "paid" || v === "unknown") return "direct";
  return v;
}

function parseEventTime(row: PurchaseRow): string {
  const t = row.event_time ?? row.created_at;
  return t ?? "";
}

/** Stable user identity. No fallback to event id — events without both are not attributed to a user. */
function userKey(row: PurchaseRow): string | null {
  const u = row.user_external_id?.trim();
  const v = row.visitor_id?.trim();
  return (u || v) || null;
}

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const projectId = searchParams.get("project_id")?.trim() ?? "";
  const start = toISODate(searchParams.get("start"));
  const end = toISODate(searchParams.get("end"));
  const cohortMonth = searchParams.get("cohort_month")?.trim() ?? ""; // YYYY-MM
  const acquisitionSourceParam = searchParams.get("acquisition_source")?.trim().toLowerCase() ?? "";

  if (!projectId) {
    return NextResponse.json({ success: false, error: "project_id required" }, { status: 400 });
  }
  if (!start || !end) {
    return NextResponse.json(
      { success: false, error: "start and end required (YYYY-MM-DD)" },
      { status: 400 }
    );
  }

  try {
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

    // Project currency: conversion_events.value is stored in project currency. Expose for frontend formatting.
    const { data: projectRow } = await admin
      .from("projects")
      .select("currency")
      .eq("id", projectId)
      .maybeSingle();
    const currency = (projectRow as { currency?: string } | null)?.currency ?? "USD";
    const displayCurrency = currency === "KZT" ? "KZT" : "USD";

    const from = `${start}T00:00:00.000Z`;
    const to = `${end}T23:59:59.999Z`;

    // 1) Global first purchase time and total purchase count per user (over all time). Also store first purchase's
    // click_id, visitor_id, traffic_source for acquisition source resolution (priority: click → first visit → conversion → direct).
    const firstByUserKey = new Map<string, FirstPurchaseInfo>();
    const totalPurchasesByUserKey = new Map<string, number>();
    for (let page = 0; page < MAX_PAGES; page++) {
      const fromIdx = page * PAGE_SIZE;
      const toIdx = fromIdx + PAGE_SIZE - 1;
      const { data: firstChunk, error: firstErr } = await admin
        .from("conversion_events")
        .select("user_external_id, visitor_id, event_time, click_id, traffic_source")
        .eq("project_id", projectId)
        .eq("event_name", "purchase")
        .order("event_time", { ascending: true })
        .range(fromIdx, toIdx);

      if (firstErr) {
        console.error("[LTV_FIRST_PURCHASE_ERROR]", firstErr);
        return NextResponse.json({ success: false, error: firstErr.message }, { status: 500 });
      }
      const rows = (firstChunk ?? []) as {
        user_external_id: string | null;
        visitor_id: string | null;
        event_time: string | null;
        click_id: string | null;
        traffic_source: string | null;
      }[];
      for (const row of rows) {
        const key = (row.user_external_id?.trim() || row.visitor_id?.trim()) || null;
        if (!key) continue;
        const t = row.event_time ?? "";
        if (!firstByUserKey.has(key)) {
          firstByUserKey.set(key, {
            firstEventTime: t,
            click_id: row.click_id?.trim() || null,
            visitor_id: row.visitor_id?.trim() || null,
            traffic_source: row.traffic_source?.trim() || null,
          });
        }
        totalPurchasesByUserKey.set(key, (totalPurchasesByUserKey.get(key) ?? 0) + 1);
      }
      if (rows.length < PAGE_SIZE) break;
    }

    // 2) Build acquisition_source per user: click_id → redirect_click_events.traffic_source; else visitor_id → first visit; else conversion traffic_source; else "unknown".
    const acquisitionSourceByKey = new Map<string, string>();
    const clickIdsToResolve = new Set<string>();
    for (const [, info] of firstByUserKey) {
      if (info.click_id) clickIdsToResolve.add(info.click_id);
    }
    const clickIdToSource = new Map<string, string>();
    if (clickIdsToResolve.size > 0) {
      const clickIdsArr = Array.from(clickIdsToResolve);
      for (let i = 0; i < clickIdsArr.length; i += CLICK_ID_BATCH) {
        const chunk = clickIdsArr.slice(i, i + CLICK_ID_BATCH);
        const { data: clickRows } = await admin
          .from("redirect_click_events")
          .select("bq_click_id, traffic_source")
          .eq("project_id", projectId)
          .in("bq_click_id", chunk);
        for (const r of (clickRows ?? []) as { bq_click_id: string; traffic_source: string | null }[]) {
          if (r.bq_click_id) clickIdToSource.set(r.bq_click_id, normalizeAcquisitionSource(r.traffic_source));
        }
      }
    }
    const visitorIdsToResolve = new Set<string>();
    for (const [key, info] of firstByUserKey) {
      const fromClick = info.click_id ? clickIdToSource.get(info.click_id) : null;
      if (fromClick) {
        acquisitionSourceByKey.set(key, fromClick);
      } else if (info.visitor_id) {
        visitorIdsToResolve.add(info.visitor_id);
      } else {
        acquisitionSourceByKey.set(key, normalizeAcquisitionSource(info.traffic_source));
      }
    }
    const visitorIdToSource = new Map<string, string>();
    if (visitorIdsToResolve.size > 0) {
      const visitorIdsArr = Array.from(visitorIdsToResolve);
      for (let i = 0; i < visitorIdsArr.length; i += VISITOR_ID_BATCH) {
        const chunk = visitorIdsArr.slice(i, i + VISITOR_ID_BATCH);
        const { data: visitRows } = await admin
          .from("visit_source_events")
          .select("visitor_id, traffic_source, source_classification, created_at")
          .eq("site_id", projectId)
          .in("visitor_id", chunk)
          .order("created_at", { ascending: true });
        for (const v of (visitRows ?? []) as { visitor_id: string; traffic_source: string | null; source_classification: string | null; created_at: string }[]) {
          if (!v.visitor_id) continue;
          if (visitorIdToSource.has(v.visitor_id)) continue;
          const src = v.traffic_source?.trim()
            ? normalizeAcquisitionSource(v.traffic_source)
            : (v.source_classification?.trim() ? normalizeAcquisitionSource(v.source_classification) : "direct");
          visitorIdToSource.set(v.visitor_id, src);
        }
      }
    }
    for (const [key, info] of firstByUserKey) {
      if (acquisitionSourceByKey.has(key)) continue;
      if (info.visitor_id && visitorIdToSource.has(info.visitor_id)) {
        acquisitionSourceByKey.set(key, visitorIdToSource.get(info.visitor_id)!);
      } else {
        acquisitionSourceByKey.set(key, normalizeAcquisitionSource(info.traffic_source));
      }
    }
    const acquisitionSourcesList = Array.from(new Set(acquisitionSourceByKey.values())).sort();
    const requestedSource = acquisitionSourceParam === "unknown" ? "direct" : acquisitionSourceParam;
    const filterByAcquisitionSource = requestedSource && requestedSource !== "all" && requestedSource.length > 0;
    const allowedUserKeys =
      filterByAcquisitionSource
        ? new Set<string>([...acquisitionSourceByKey.entries()].filter(([, src]) => src === requestedSource).map(([k]) => k))
        : new Set<string>(firstByUserKey.keys());
    const firstPurchaseTimeByKey = new Map<string, string>();
    for (const [k, info] of firstByUserKey) firstPurchaseTimeByKey.set(k, info.firstEventTime);

    // 3) Purchases in period [start, end] (paginate), with campaign_intent for retention
    const purchases: PurchaseRow[] = [];
    for (let page = 0; page < MAX_PAGES; page++) {
      const fromIdx = page * PAGE_SIZE;
      const toIdx = fromIdx + PAGE_SIZE - 1;
      const { data, error } = await admin
        .from("conversion_events")
        .select("id, event_time, created_at, user_external_id, visitor_id, value, campaign_intent")
        .eq("project_id", projectId)
        .eq("event_name", "purchase")
        .gte("event_time", from)
        .lte("event_time", to)
        .order("event_time", { ascending: true })
        .range(fromIdx, toIdx);

      if (error) {
        console.error("[LTV_CONVERSION_EVENTS_ERROR]", error);
        return NextResponse.json({ success: false, error: error.message }, { status: 500 });
      }
      const chunk = (data ?? []) as PurchaseRow[];
      purchases.push(...chunk);
      if (chunk.length < PAGE_SIZE) break;
    }

    // 4) Classify first/repeat by global first_purchase_time. Only include users in allowedUserKeys (acquisition_source filter).
    const byUser = new Map<string, { value: number; eventTime: string; campaignIntent: string | null }[]>();
    let totalRevenue = 0;
    let firstPurchaseCount = 0;
    let firstRevenue = 0;
    let repeatPurchaseCount = 0;
    let repeatRevenue = 0;
    let retentionPurchaseCount = 0;
    let retentionRevenue = 0;

    for (const r of purchases) {
      const key = userKey(r);
      if (key === null) continue;
      if (!allowedUserKeys.has(key)) continue;

      const val = r.value != null ? Number(r.value) : 0;
      totalRevenue += val;
      const eventTime = parseEventTime(r);
      const campaignIntent = (r.campaign_intent?.trim() === "retention" ? "retention" : null) || null;

      if (campaignIntent === "retention") {
        retentionPurchaseCount += 1;
        retentionRevenue += val;
      }

      const list = byUser.get(key) ?? [];
      list.push({ value: val, eventTime, campaignIntent });
      byUser.set(key, list);

      const globalFirst = firstPurchaseTimeByKey.get(key);
      const isFirst = globalFirst != null && eventTime === globalFirst;
      if (isFirst) {
        firstPurchaseCount += 1;
        firstRevenue += val;
      } else {
        repeatPurchaseCount += 1;
        repeatRevenue += val;
      }
    }

    const totalPurchaseCount = firstPurchaseCount + repeatPurchaseCount;
    const repeatPurchaseRate = totalPurchaseCount > 0 ? repeatPurchaseCount / totalPurchaseCount : 0;
    const repeatRevenueShare = totalRevenue > 0 ? repeatRevenue / totalRevenue : null;
    const retentionRevenueShare = totalRevenue > 0 ? retentionRevenue / totalRevenue : null;
    const firstRevenueShare = totalRevenue > 0 ? firstRevenue / totalRevenue : null;
    let revenueRecaptureRate: number | null =
      firstRevenue > 0 ? retentionRevenue / firstRevenue : null;
    if (revenueRecaptureRate != null && revenueRecaptureRate > 1) revenueRecaptureRate = null;

    for (const [, list] of byUser) {
      list.sort((a, b) => a.eventTime.localeCompare(b.eventTime));
    }

    const uniquePurchasers = byUser.size;

    // User-level: repeat purchasers = users with >1 purchase ever and at least one in period
    let repeatPurchasersCount = 0;
    let usersWithRetentionPurchase = 0;
    for (const [key, list] of byUser) {
      const totalEver = totalPurchasesByUserKey.get(key) ?? 0;
      if (totalEver > 1) repeatPurchasersCount += 1;
      if (list.some((p) => p.campaignIntent === "retention")) usersWithRetentionPurchase += 1;
    }
    const repeatUserRate = uniquePurchasers > 0 ? repeatPurchasersCount / uniquePurchasers : null;
    const retentionUserRate = uniquePurchasers > 0 ? usersWithRetentionPurchase / uniquePurchasers : null;
    const revenueMi = totalRevenue;
    const arpuMi = uniquePurchasers > 0 ? revenueMi / uniquePurchasers : 0;

    // userFirstDate for cohorts: only allowed users, global first purchase date (YYYY-MM-DD)
    const userFirstDate = new Map<string, string>();
    for (const key of allowedUserKeys) {
      const firstTime = firstPurchaseTimeByKey.get(key);
      if (firstTime) userFirstDate.set(key, firstTime.slice(0, 10));
    }

    // 4) Cohort month range for retention: M0 = cohort month, M1..M6 = next months
    const cohortMonths: string[] = [];
    if (cohortMonth && /^\d{4}-\d{2}$/.test(cohortMonth)) {
      const [y, m] = cohortMonth.split("-").map(Number);
      for (let i = 0; i <= 6; i++) {
        const d = new Date(y, m - 1 + i, 1);
        cohortMonths.push(
          `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`
        );
      }
    }

    const cohortUserFirstDates = new Map<string, string>();
    for (const [key, firstDate] of userFirstDate) {
      const month = firstDate.slice(0, 7);
      if (month === cohortMonth) cohortUserFirstDates.set(key, firstDate);
    }
    const usersM0 = cohortUserFirstDates.size;

    const activeInMonth = (userKeys: Map<string, string>, monthStr: string): number => {
      const [y, m] = monthStr.split("-").map(Number);
      const startM = `${monthStr}-01T00:00:00.000Z`;
      const lastDay = new Date(y, m, 0).getDate();
      const endM = `${monthStr}-${String(lastDay).padStart(2, "0")}T23:59:59.999Z`;
      let count = 0;
      for (const [key] of userKeys) {
        const list = byUser.get(key) ?? [];
        const hasInRange = list.some((p) => p.eventTime >= startM && p.eventTime <= endM);
        if (hasInRange) count += 1;
      }
      return count;
    };

    const m0Active = usersM0 > 0 ? activeInMonth(cohortUserFirstDates, cohortMonths[0] ?? "") : 0;
    const usersMi = cohortMonths.length ? activeInMonth(cohortUserFirstDates, cohortMonths[cohortMonths.length - 1] ?? "") : uniquePurchasers;
    const retentionPct = usersM0 > 0 ? (m0Active / usersM0) * 100 : 0;

    // 5) LTV curve (D1..D90) for selected cohort; use global first_purchase_time
    const horizons = [1, 7, 14, 30, 60, 90];
    const lineData: { day: string; ltv: number; arpu: number }[] = [];
    if (cohortMonth && usersM0 > 0) {
      const cohortUsers = Array.from(cohortUserFirstDates.keys());
      for (const d of horizons) {
        let sumLtv = 0;
        for (const key of cohortUsers) {
          const list = byUser.get(key) ?? [];
          const firstTime = firstPurchaseTimeByKey.get(key) ?? list[0]?.eventTime ?? "";
          const firstTs = new Date(firstTime).getTime();
          const endTs = firstTs + d * 24 * 60 * 60 * 1000;
          let userRev = 0;
          for (const p of list) {
            const t = new Date(p.eventTime).getTime();
            if (t <= endTs) userRev += p.value;
          }
          sumLtv += userRev;
        }
        const ltv = usersM0 > 0 ? sumLtv / usersM0 : 0;
        lineData.push({ day: `D${d}`, ltv, arpu: ltv });
      }
    }
    if (lineData.length === 0) {
      horizons.forEach((d) => lineData.push({ day: `D${d}`, ltv: 0, arpu: 0 }));
    }

    // 6) Cohort heatmap rows: retention % by cohort month (global first purchase month)
    const uniqueCohortMonths = Array.from(
      new Set([...userFirstDate.values()].map((d) => d.slice(0, 7)))
    ).sort();
    const cohortMonthList = uniqueCohortMonths.slice(-5);
    const cohortRows: { cohort: string; values: number[] }[] = [];
    const cohortSizes: Record<string, number> = {};
    for (const co of cohortMonthList) {
      const usersInCohort = new Map<string, string>();
      for (const [key, firstDate] of userFirstDate) {
        if (firstDate.slice(0, 7) === co) usersInCohort.set(key, firstDate);
      }
      const n0 = usersInCohort.size;
      cohortSizes[co] = n0;
      const values: number[] = [];
      const [cy, cm] = co.split("-").map(Number);
      for (let i = 0; i <= 6; i++) {
        const d = new Date(cy, cm - 1 + i, 1);
        const monthStr = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
        const active = activeInMonth(usersInCohort, monthStr);
        values.push(n0 > 0 ? Math.round((active / n0) * 100) : 0);
      }
      cohortRows.push({ cohort: co, values });
    }

    // 6b) Cohort revenue rows for money mode: real revenue per cohort per month (only months in period have data)
    const cohortRevenueRows: { cohort: string; values: number[] }[] = [];
    for (const co of cohortMonthList) {
      const usersInCohort = new Map<string, string>();
      for (const [key, firstDate] of userFirstDate) {
        if (firstDate.slice(0, 7) === co) usersInCohort.set(key, firstDate);
      }
      const values: number[] = [];
      const [cy, cm] = co.split("-").map(Number);
      for (let i = 0; i <= 6; i++) {
        const d = new Date(cy, cm - 1 + i, 1);
        const monthStr = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
        const [y, m] = monthStr.split("-").map(Number);
        const startM = `${monthStr}-01T00:00:00.000Z`;
        const lastDay = new Date(y, m, 0).getDate();
        const endM = `${monthStr}-${String(lastDay).padStart(2, "0")}T23:59:59.999Z`;
        let rev = 0;
        for (const [key] of usersInCohort) {
          const list = byUser.get(key) ?? [];
          for (const p of list) {
            if (p.eventTime >= startM && p.eventTime <= endM) rev += p.value;
          }
        }
        values.push(Math.round(rev));
      }
      cohortRevenueRows.push({ cohort: co, values });
    }

    const canonical = await getCanonicalSummary(admin, projectId, start, end, undefined);
    const spend = canonical?.data?.spend ?? 0;

    // Actual retention spend: SUM(spend) for campaigns that lead to retention links (redirect_click_events.campaign_intent = 'retention').
    // Map: redirect_click_events.utm_campaign -> campaigns (meta_campaign_id or external_campaign_id) -> daily_ad_metrics.spend.
    let retentionSpend: number | null = null;
    try {
      const { data: retentionClicks } = await admin
        .from("redirect_click_events")
        .select("utm_campaign")
        .eq("project_id", projectId)
        .ilike("campaign_intent", "retention");
      const utmCampaigns = [...new Set((retentionClicks ?? []).map((r: { utm_campaign: string | null }) => r.utm_campaign?.trim()).filter(Boolean))] as string[];
      if (utmCampaigns.length > 0) {
        const { data: byMeta } = await admin
          .from("campaigns")
          .select("id")
          .eq("project_id", projectId)
          .in("meta_campaign_id", utmCampaigns);
        const { data: byExternal } = await admin
          .from("campaigns")
          .select("id")
          .eq("project_id", projectId)
          .in("external_campaign_id", utmCampaigns);
        const campaignIds = [...new Set([...(byMeta ?? []), ...(byExternal ?? [])].map((c: { id: string }) => c.id))];
        if (campaignIds.length > 0) {
          const { data: metrics } = await admin
            .from("daily_ad_metrics_campaign")
            .select("spend")
            .in("campaign_id", campaignIds)
            .gte("date", start)
            .lte("date", end);
          const total = (metrics ?? []).reduce((s: number, r: { spend?: number | null }) => s + Number(r.spend ?? 0), 0);
          retentionSpend = Math.round(total * 10000) / 10000;
        } else {
          retentionSpend = 0;
        }
      } else {
        retentionSpend = 0;
      }
    } catch (retErr) {
      console.error("[LTV_RETENTION_SPEND]", retErr);
      retentionSpend = null;
    }
    if (retentionSpend != null && Number.isFinite(spend) && spend >= 0 && retentionSpend > spend) {
      retentionSpend = spend;
    }

    let budgetForRepeatSales: number | null = null;
    if (cohortMonth && /^\d{4}-\d{2}$/.test(cohortMonth)) {
      const [y, m] = cohortMonth.split("-").map(Number);
      const { data: plan } = await admin
        .from("project_monthly_plans")
        .select("repeat_sales_budget")
        .eq("project_id", projectId)
        .eq("year", y)
        .eq("month", m)
        .maybeSingle();
      budgetForRepeatSales = plan?.repeat_sales_budget != null ? Number(plan.repeat_sales_budget) : null;
    }

    // CPR (plan) = budget_for_repeat_sales / repeat_purchase_count.
    const cpr: number | null =
      budgetForRepeatSales != null &&
      budgetForRepeatSales > 0 &&
      repeatPurchaseCount > 0
        ? budgetForRepeatSales / repeatPurchaseCount
        : null;

    // CPR (actual) = retention_spend / retention_purchases_count. Only for retention-labeled campaigns.
    const cprActual: number | null =
      retentionSpend != null &&
      Number.isFinite(retentionSpend) &&
      retentionPurchaseCount > 0
        ? retentionSpend / retentionPurchaseCount
        : null;

    // Retention ROAS = retention_revenue / retention_spend. Null if spend is 0 or null.
    const retentionRoas: number | null =
      retentionSpend != null &&
      Number.isFinite(retentionSpend) &&
      retentionSpend > 0 &&
      Number.isFinite(retentionRevenue)
        ? retentionRevenue / retentionSpend
        : null;

    const ltvCum = lineData.length ? lineData[lineData.length - 1]?.ltv ?? 0 : 0;
    const payingShare: number | null = null; // would need registrations in period
    const retentionMoM: number | null = null;
    const revenueMoM: number | null = null;
    const cohortSize = cohortMonth ? usersM0 : uniquePurchasers;
    const activeInCohort = cohortMonth ? m0Active : uniquePurchasers;
    const ltvXUsers = ltvCum * cohortSize;
    const arpuSafe = uniquePurchasers > 0 ? revenueMi / uniquePurchasers : 0;

    return NextResponse.json({
      success: true,
      source: "conversion_events",
      currency: displayCurrency,
      acquisition_sources: acquisitionSourcesList,
      kpi: {
        usersMi: cohortSize,
        activeUsersMi: activeInCohort,
        revenueMi: totalRevenue,
        arpuMi: arpuSafe,
        ltvCum,
        payingShare,
        retentionPct,
        usersM0,
        retentionMoM,
        revenueMoM,
        ltvXUsers,
        total_purchase_count: totalPurchaseCount,
        first_purchase_count: firstPurchaseCount,
        repeat_purchase_count: repeatPurchaseCount,
        unique_purchasers: uniquePurchasers,
        total_revenue: totalRevenue,
        first_revenue: firstRevenue,
        repeat_revenue: repeatRevenue,
        repeat_revenue_share: repeatRevenueShare,
        retention_purchases_count: retentionPurchaseCount,
        retention_revenue: retentionRevenue,
        retention_revenue_share: retentionRevenueShare,
        repeat_purchase_rate: repeatPurchaseRate,
        repeat_purchasers_count: repeatPurchasersCount,
        repeat_user_rate: repeatUserRate,
        retention_user_rate: retentionUserRate,
        first_revenue_share: firstRevenueShare,
        revenue_recapture_rate: revenueRecaptureRate,
        spend,
        budget_for_repeat_sales: budgetForRepeatSales,
        cpr,
        retention_spend: retentionSpend,
        cpr_actual: cprActual,
        retention_roas: retentionRoas,
      },
      lineData,
      cohortRows,
      cohortSizes,
      cohortRevenueRows,
    });
  } catch (e) {
    console.error("[LTV_FATAL]", e);
    return NextResponse.json(
      { success: false, error: e instanceof Error ? e.message : "Internal error" },
      { status: 500 }
    );
  }
}
