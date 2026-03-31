/**
 * LTV / Retention API — source of truth: conversion_events (purchases).
 * First purchase: earliest purchase per user over paginated global scan (see MAX_PAGES).
 * Repeat: any purchase not within FIRST_PURCHASE_MS_TOLERANCE of first instant (KPIs use purchases in [start,end] only).
 * When cohort_month is set, LTV curve / cohort heatmap / cohort revenue use an extended purchase window:
 * from min(first purchase date in cohort) through max(report end, first+90d, last day of M6 in the M0–M6 grid).
 * User key: canonical identity — user_external_id on the row, else visitor_id resolved via visitor↔user and
 * session maps (same session may tie anonymous visitor to logged-in user), else raw visitor_id; no event-id fallback.
 *
 * Acquisition source filter: one source per user, derived from first purchase (click_id → redirect,
 * else visitor_id → first visit, else conversion traffic_source, else "unknown"). Retention campaigns
 * (campaign_intent=retention) are a separate dimension and are not mixed with acquisition source.
 *
 * Paying share (by channel): purchase events in KPI window ÷ registration events in KPI window, ×100,
 * same acquisition filter as the rest of the board (first-purchase source per user; registration row fallback).
 *
 * KPI window: [start,end] из запроса. Если передан cohort_month (YYYY-MM), окно = пересечение с календарным
 * месяцем когорты [YYYY-MM-01 … последний день], чтобы даты в UI совпадали с фактическим запросом к БД.
 * Полный календарный месяц — только если отчёт покрывает его целиком. Кривая LTV / расширенная выборка
 * для когорты по-прежнему используют параметр end отчёта для горизонта.
 */
import { NextResponse } from "next/server";
import { createServerSupabase } from "@/app/lib/supabaseServer";
import { supabaseAdmin } from "@/app/lib/supabaseAdmin";
import { requireProjectAccess } from "@/app/lib/auth/requireProjectAccess";
import { getCanonicalSummary } from "@/app/lib/dashboardCanonical";
import {
  buildVisitorAndSessionMaps,
  makeIdentityKey,
  type ConversionIdentitySlice,
} from "@/app/lib/conversionIdentity";
import {
  convertMoneyStrict,
  createCurrencyDiagnostics,
  getLatestUsdToKztRate,
  getUsdToKztRateMapForDays,
  normalizeCurrencyCode,
  pushCurrencyReason,
  resolveUsdToKztRateForDay,
} from "@/app/lib/currencyNormalization";
import { convertUsdToProjectCurrency, type ProjectCurrency } from "@/app/lib/currency";
import { ensureUsdToKztRatesForDays, fetchAndStoreLatestUsdKztRate } from "@/app/lib/exchangeRatesUsdKzt";
const PAGE_SIZE = 1000;
/** Cap total rows fetched per scan (first-pass + period + cohort extension). Raised from 50k; consider DB-side aggregation if projects exceed this. */
const MAX_PAGES = 150;
/** Treat two timestamps as same first-purchase instant (ISO format differences / clock skew). */
const FIRST_PURCHASE_MS_TOLERANCE = 2000;
const CLICK_ID_BATCH = 200;
const VISITOR_ID_BATCH = 500;
const PLATFORM_SOURCES = ["meta", "google", "tiktok", "yandex"] as const;
const ATTRIBUTION_SOURCE_WHITELIST = ["meta", "google", "tiktok", "yandex", "direct", "organic_search", "referral"] as const;

/** True if this page was the last allowed and still full — more rows may exist in DB. */
function paginationHitCap(page: number, rowCount: number, pageSize: number, maxPages: number): boolean {
  return page === maxPages - 1 && rowCount === pageSize;
}

function toISODate(s: string | null): string | null {
  if (!s) return null;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return null;
  return s;
}

/** YYYY-MM-DD lexicographic order matches chronological order. */
function maxIsoDate(a: string, b: string): string {
  return a >= b ? a : b;
}
function minIsoDate(a: string, b: string): string {
  return a <= b ? a : b;
}

type PurchaseRow = {
  id: string;
  event_time: string | null;
  created_at: string;
  user_external_id: string | null;
  visitor_id: string | null;
  session_id?: string | null;
  value: number | null;
  currency?: string | null;
  campaign_intent?: string | null;
  click_id?: string | null;
  traffic_source?: string | null;
};

/** First purchase info per user: time + value for cohort revenue + fields for acquisition source. */
type FirstPurchaseInfo = {
  firstEventTime: string;
  firstEventTimeMs: number;
  firstValueRaw: number;
  firstCurrency: string | null;
  click_id: string | null;
  visitor_id: string | null;
  traffic_source: string | null;
};

type UserPurchaseEvent = {
  id: string;
  value: number;
  eventTime: string;
  campaignIntent: string | null;
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

function isPlatformSource(v: string): v is (typeof PLATFORM_SOURCES)[number] {
  return PLATFORM_SOURCES.includes(v as (typeof PLATFORM_SOURCES)[number]);
}

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const projectId = searchParams.get("project_id")?.trim() ?? "";
  const start = toISODate(searchParams.get("start"));
  const end = toISODate(searchParams.get("end"));
  const cohortMonth = searchParams.get("cohort_month")?.trim() ?? ""; // YYYY-MM
  const acquisitionSourceParam = searchParams.get("acquisition_source")?.trim().toLowerCase() ?? "";
  const sourcesRaw = searchParams.get("sources")?.trim() ?? "";
  const accountIdsRaw = searchParams.get("account_ids")?.trim() ?? "";
  const sources = sourcesRaw
    ? sourcesRaw
        .split(",")
        .map((s) => s.trim().toLowerCase())
        .filter((s) => s.length > 0 && ATTRIBUTION_SOURCE_WHITELIST.includes(s as any))
    : [];
  const accountIds = accountIdsRaw
    ? accountIdsRaw
        .split(",")
        .map((s) => s.trim())
        .filter(Boolean)
    : [];

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
    let latestUsdToKztRate: number | null = null;
    let usdToKztRateByDay = new Map<string, number>();
    if (displayCurrency === "KZT") {
      latestUsdToKztRate = await getLatestUsdToKztRate(admin);
      if (latestUsdToKztRate == null || latestUsdToKztRate <= 0) {
        latestUsdToKztRate = await fetchAndStoreLatestUsdKztRate(admin);
      }
    }
    const currencyDiagnostics = createCurrencyDiagnostics();
    const projectCurrency: ProjectCurrency = displayCurrency === "KZT" ? "KZT" : "USD";
    /** Канонический spend/планы в USD → отображение как на маркетинговом отчёте (`convertUsdToProjectCurrency`). */
    const toProjectMoney = (v: number | null): number | null => {
      if (v == null || !Number.isFinite(v)) return v;
      return convertUsdToProjectCurrency(v, projectCurrency, latestUsdToKztRate);
    };
    let scanTruncated = false;

    let kpiStartDate = start;
    let kpiEndDate = end;
    let kpiWindowCohortScoped = false;
    let kpiWindowFullCohortCalendarMonth = false;
    if (cohortMonth && /^\d{4}-\d{2}$/.test(cohortMonth)) {
      const [cy, cm] = cohortMonth.split("-").map(Number);
      if (Number.isFinite(cy) && Number.isFinite(cm) && cm >= 1 && cm <= 12) {
        const lastD = new Date(cy, cm, 0).getDate();
        const cohortMonthStart = `${cohortMonth}-01`;
        const cohortMonthEnd = `${cohortMonth}-${String(lastD).padStart(2, "0")}`;
        const lo = maxIsoDate(start, cohortMonthStart);
        const hi = minIsoDate(end, cohortMonthEnd);
        if (lo <= hi) {
          kpiStartDate = lo;
          kpiEndDate = hi;
          kpiWindowCohortScoped = true;
          kpiWindowFullCohortCalendarMonth = lo === cohortMonthStart && hi === cohortMonthEnd;
        }
      }
    }
    const from = `${kpiStartDate}T00:00:00.000Z`;
    const to = `${kpiEndDate}T23:59:59.999Z`;

    // 0) Identity linking: registration often has only visitor_id; purchase (e.g. CRM) may send only user_external_id.
    // Tie them via same-row (both ids) and same session_id across events (paginate by created_at so null event_time still links).
    const identitySlices: ConversionIdentitySlice[] = [];
    for (let page = 0; page < MAX_PAGES; page++) {
      const fromIdx = page * PAGE_SIZE;
      const toIdx = fromIdx + PAGE_SIZE - 1;
      const { data: idChunk, error: idErr } = await admin
        .from("conversion_events")
        .select("user_external_id, visitor_id, session_id")
        .eq("project_id", projectId)
        .in("event_name", ["purchase", "registration"])
        .order("created_at", { ascending: true })
        .order("id", { ascending: true })
        .range(fromIdx, toIdx);
      if (idErr) {
        console.error("[LTV_IDENTITY_SCAN_ERROR]", idErr);
        return NextResponse.json({ success: false, error: idErr.message }, { status: 500 });
      }
      const rows = (idChunk ?? []) as ConversionIdentitySlice[];
      for (const row of rows) {
        identitySlices.push({
          user_external_id: row.user_external_id,
          visitor_id: row.visitor_id,
          session_id: row.session_id,
        });
      }
      if (paginationHitCap(page, rows.length, PAGE_SIZE, MAX_PAGES)) scanTruncated = true;
      if (rows.length < PAGE_SIZE) break;
    }
    const { visitorToExternal, sessionCanonical } = buildVisitorAndSessionMaps(identitySlices);
    const identityKey = makeIdentityKey(visitorToExternal, sessionCanonical);

    // 1) Global first purchase time and total purchase count per user (over all time). Also store first purchase's
    // click_id, visitor_id, traffic_source for acquisition source resolution (priority: click → first visit → conversion → direct).
    const firstByUserKey = new Map<string, FirstPurchaseInfo>();
    const totalPurchasesByUserKey = new Map<string, number>();
    for (let page = 0; page < MAX_PAGES; page++) {
      const fromIdx = page * PAGE_SIZE;
      const toIdx = fromIdx + PAGE_SIZE - 1;
        const { data: firstChunk, error: firstErr } = await admin
          .from("conversion_events")
          .select("user_external_id, visitor_id, session_id, event_time, created_at, value, currency, click_id, traffic_source")
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
        session_id: string | null;
        event_time: string | null;
        created_at: string;
        value: number | null;
        currency: string | null;
        click_id: string | null;
        traffic_source: string | null;
      }[];
      for (const row of rows) {
        const pr: PurchaseRow = {
          id: "",
          event_time: row.event_time,
          created_at: row.created_at,
          user_external_id: row.user_external_id,
          visitor_id: row.visitor_id,
          session_id: row.session_id,
          value: row.value,
          currency: row.currency,
          click_id: row.click_id,
          traffic_source: row.traffic_source,
        };
        const key = identityKey(pr);
        if (!key) continue;
        const tStr = parseEventTime(pr);
        const tMs = Date.parse(tStr);
        if (!Number.isFinite(tMs)) continue;
        if (!firstByUserKey.has(key)) {
          const rawVal = row.value != null ? Number(row.value) : 0;
          firstByUserKey.set(key, {
            firstEventTime: tStr,
            firstEventTimeMs: tMs,
            firstValueRaw: Number.isFinite(rawVal) ? rawVal : 0,
            firstCurrency: row.currency?.trim() || null,
            click_id: row.click_id?.trim() || null,
            visitor_id: row.visitor_id?.trim() || null,
            traffic_source: row.traffic_source?.trim() || null,
          });
        }
        totalPurchasesByUserKey.set(key, (totalPurchasesByUserKey.get(key) ?? 0) + 1);
      }
      if (paginationHitCap(page, rows.length, PAGE_SIZE, MAX_PAGES)) scanTruncated = true;
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
    const firstPurchaseTimeMsByKey = new Map<string, number>();
    for (const [k, info] of firstByUserKey) {
      firstPurchaseTimeByKey.set(k, info.firstEventTime);
      firstPurchaseTimeMsByKey.set(k, info.firstEventTimeMs);
    }

    /** Users whose global first purchase falls in `cohortMonth` (YYYY-MM); used to align plan vs fact with monthly plan row. */
    const cohortUserKeysForPlan = new Set<string>();
    if (cohortMonth && /^\d{4}-\d{2}$/.test(cohortMonth)) {
      for (const [key, firstIso] of firstPurchaseTimeByKey) {
        if (!allowedUserKeys.has(key)) continue;
        if (firstIso.slice(0, 7) === cohortMonth) cohortUserKeysForPlan.add(key);
      }
    }

    // 3) Purchases in period [start, end] (paginate), with campaign_intent for retention
    const purchases: PurchaseRow[] = [];
    let cohortRepeatPurchasesInPeriod = 0;
    let cohortRepeatRevenueInPeriod = 0;
    for (let page = 0; page < MAX_PAGES; page++) {
      const fromIdx = page * PAGE_SIZE;
      const toIdx = fromIdx + PAGE_SIZE - 1;
      const { data, error } = await admin
        .from("conversion_events")
        .select("id, event_time, created_at, user_external_id, visitor_id, session_id, value, currency, campaign_intent, click_id, traffic_source")
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
    if (displayCurrency === "KZT") {
      const daysForRates = new Set<string>();
      for (const r of purchases) {
        const d = String((r.event_time ?? r.created_at) ?? "").slice(0, 10);
        if (/^\d{4}-\d{2}-\d{2}$/.test(d)) daysForRates.add(d);
      }
      if (cohortUserKeysForPlan.size > 0) {
        for (const k of cohortUserKeysForPlan) {
          const t = firstByUserKey.get(k)?.firstEventTime;
          if (t) {
            const d = t.slice(0, 10);
            if (/^\d{4}-\d{2}-\d{2}$/.test(d)) daysForRates.add(d);
          }
        }
      }
      const dayArr = [...daysForRates];
      if (dayArr.length > 0) {
        await ensureUsdToKztRatesForDays(admin, dayArr);
        usdToKztRateByDay = await getUsdToKztRateMapForDays(admin, dayArr);
        latestUsdToKztRate = await getLatestUsdToKztRate(admin);
        if (latestUsdToKztRate == null || latestUsdToKztRate <= 0) {
          latestUsdToKztRate = await fetchAndStoreLatestUsdKztRate(admin);
        }
      }
    }

    // 3b) Registrations in period (event_time window; fallback rows with null event_time use created_at in same wall range).
    const registrationRows: PurchaseRow[] = [];
    for (let page = 0; page < MAX_PAGES; page++) {
      const fromIdx = page * PAGE_SIZE;
      const toIdx = fromIdx + PAGE_SIZE - 1;
      const { data: regChunk, error: regErr } = await admin
        .from("conversion_events")
        .select("id, event_time, created_at, user_external_id, visitor_id, session_id, click_id, traffic_source")
        .eq("project_id", projectId)
        .eq("event_name", "registration")
        .gte("event_time", from)
        .lte("event_time", to)
        .order("event_time", { ascending: true })
        .range(fromIdx, toIdx);
      if (regErr) {
        console.error("[LTV_REGISTRATION_EVENTS_ERROR]", regErr);
        return NextResponse.json({ success: false, error: regErr.message }, { status: 500 });
      }
      const chunk = (regChunk ?? []) as PurchaseRow[];
      registrationRows.push(...chunk);
      if (paginationHitCap(page, chunk.length, PAGE_SIZE, MAX_PAGES)) scanTruncated = true;
      if (chunk.length < PAGE_SIZE) break;
    }
    const seenRegIds = new Set(registrationRows.map((r) => r.id));
    for (let page = 0; page < MAX_PAGES; page++) {
      const fromIdx = page * PAGE_SIZE;
      const toIdx = fromIdx + PAGE_SIZE - 1;
      const { data: regNullChunk, error: regNullErr } = await admin
        .from("conversion_events")
        .select("id, event_time, created_at, user_external_id, visitor_id, session_id, click_id, traffic_source")
        .eq("project_id", projectId)
        .eq("event_name", "registration")
        .is("event_time", null)
        .gte("created_at", from)
        .lte("created_at", to)
        .order("created_at", { ascending: true })
        .range(fromIdx, toIdx);
      if (regNullErr) {
        console.error("[LTV_REGISTRATION_NULL_TIME_ERROR]", regNullErr);
        return NextResponse.json({ success: false, error: regNullErr.message }, { status: 500 });
      }
      const chunk = (regNullChunk ?? []) as PurchaseRow[];
      for (const r of chunk) {
        if (!seenRegIds.has(r.id)) {
          seenRegIds.add(r.id);
          registrationRows.push(r);
        }
      }
      if (paginationHitCap(page, chunk.length, PAGE_SIZE, MAX_PAGES)) scanTruncated = true;
      if (chunk.length < PAGE_SIZE) break;
    }

    const regExtraClickIds = new Set<string>();
    const regExtraVisitorIds = new Set<string>();
    for (const row of registrationRows) {
      const key = identityKey(row);
      if (!key) continue;
      if (acquisitionSourceByKey.has(key)) continue;
      const cid = row.click_id?.trim();
      if (cid && !clickIdToSource.has(cid)) regExtraClickIds.add(cid);
      const vid = row.visitor_id?.trim();
      if (vid && !visitorIdToSource.has(vid)) regExtraVisitorIds.add(vid);
    }
    if (regExtraClickIds.size > 0) {
      const arr = Array.from(regExtraClickIds);
      for (let i = 0; i < arr.length; i += CLICK_ID_BATCH) {
        const batch = arr.slice(i, i + CLICK_ID_BATCH);
        const { data: clickRows } = await admin
          .from("redirect_click_events")
          .select("bq_click_id, traffic_source")
          .eq("project_id", projectId)
          .in("bq_click_id", batch);
        for (const r of (clickRows ?? []) as { bq_click_id: string; traffic_source: string | null }[]) {
          if (r.bq_click_id && !clickIdToSource.has(r.bq_click_id)) {
            clickIdToSource.set(r.bq_click_id, normalizeAcquisitionSource(r.traffic_source));
          }
        }
      }
    }
    if (regExtraVisitorIds.size > 0) {
      const arr = Array.from(regExtraVisitorIds);
      for (let i = 0; i < arr.length; i += VISITOR_ID_BATCH) {
        const batch = arr.slice(i, i + VISITOR_ID_BATCH);
        const { data: visitRows } = await admin
          .from("visit_source_events")
          .select("visitor_id, traffic_source, source_classification, created_at")
          .eq("site_id", projectId)
          .in("visitor_id", batch)
          .order("created_at", { ascending: true });
        for (const v of (visitRows ?? []) as {
          visitor_id: string;
          traffic_source: string | null;
          source_classification: string | null;
          created_at: string;
        }[]) {
          if (!v.visitor_id || visitorIdToSource.has(v.visitor_id)) continue;
          const src = v.traffic_source?.trim()
            ? normalizeAcquisitionSource(v.traffic_source)
            : v.source_classification?.trim()
              ? normalizeAcquisitionSource(v.source_classification)
              : "direct";
          visitorIdToSource.set(v.visitor_id, src);
        }
      }
    }

    function effectiveAcquisitionForRegistrant(key: string, regRow: PurchaseRow): string {
      const fromPurchase = acquisitionSourceByKey.get(key);
      if (fromPurchase !== undefined) return fromPurchase;
      const cid = regRow.click_id?.trim();
      if (cid) {
        const s = clickIdToSource.get(cid);
        if (s) return s;
      }
      const vid = regRow.visitor_id?.trim();
      if (vid) {
        const s = visitorIdToSource.get(vid);
        if (s) return s;
      }
      return normalizeAcquisitionSource(regRow.traffic_source);
    }

    // 4) Classify first/repeat by global first_purchase_time. Only include users in allowedUserKeys (acquisition_source filter).
    const byUser = new Map<string, UserPurchaseEvent[]>();
    let totalRevenue = 0;
    let firstPurchaseCount = 0;
    let firstRevenue = 0;
    let repeatPurchaseCount = 0;
    let repeatRevenue = 0;
    let retentionPurchaseCount = 0;
    let retentionRevenue = 0;

    for (const r of purchases) {
      const key = identityKey(r);
      if (key === null) continue;
      if (!allowedUserKeys.has(key)) continue;

      const rawVal = r.value != null ? Number(r.value) : 0;
      const normalized = normalizeCurrencyCode(r.currency);
      const rowCurrency = normalized ?? displayCurrency;
      if (!normalized && (r.currency == null || String(r.currency).trim() === "")) {
        pushCurrencyReason(currencyDiagnostics, "currency_missing", "conversion_events.currency missing; fallback used.");
      } else if (!normalized) {
        pushCurrencyReason(currencyDiagnostics, "currency_unsupported", `Unsupported currency '${String(r.currency)}'; fallback used.`);
      }
      const day = String((r.event_time ?? r.created_at) ?? "").slice(0, 10);
      const dayRate = resolveUsdToKztRateForDay(
        day,
        usdToKztRateByDay,
        latestUsdToKztRate,
        currencyDiagnostics
      );
      const val = convertMoneyStrict(rawVal, rowCurrency, displayCurrency, dayRate, currencyDiagnostics);
      totalRevenue += val;
      const eventTime = parseEventTime(r);
      const campaignIntent = (r.campaign_intent?.trim() === "retention" ? "retention" : null) || null;

      if (campaignIntent === "retention") {
        retentionPurchaseCount += 1;
        retentionRevenue += val;
      }

      const list = byUser.get(key) ?? [];
      list.push({ id: r.id, value: val, eventTime, campaignIntent });
      byUser.set(key, list);

      const firstMs = firstPurchaseTimeMsByKey.get(key);
      const eventMs = Date.parse(eventTime);
      const isFirst =
        firstMs != null && Number.isFinite(eventMs) && Math.abs(eventMs - firstMs) <= FIRST_PURCHASE_MS_TOLERANCE;
      if (isFirst) {
        firstPurchaseCount += 1;
        firstRevenue += val;
      } else {
        repeatPurchaseCount += 1;
        repeatRevenue += val;
      }
      if (cohortUserKeysForPlan.size > 0 && cohortUserKeysForPlan.has(key) && !isFirst) {
        cohortRepeatPurchasesInPeriod += 1;
        cohortRepeatRevenueInPeriod += val;
      }
    }
    if (currencyDiagnostics.reason_codes.length > 0) {
      console.warn("[LTV_CURRENCY_DIAGNOSTICS]", {
        projectId,
        reason_codes: currencyDiagnostics.reason_codes,
        warnings: currencyDiagnostics.warnings,
      });
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

    let cohortFirstOrderRevenueSum = 0;
    if (cohortUserKeysForPlan.size > 0) {
      for (const key of cohortUserKeysForPlan) {
        const info = firstByUserKey.get(key);
        if (!info) continue;
        const day = info.firstEventTime.slice(0, 10);
        const dayRate = resolveUsdToKztRateForDay(
          day,
          usdToKztRateByDay,
          latestUsdToKztRate,
          currencyDiagnostics
        );
        const normalized = normalizeCurrencyCode(info.firstCurrency);
        const rowCurrency = normalized ?? displayCurrency;
        if (!normalized && (info.firstCurrency == null || String(info.firstCurrency).trim() === "")) {
          pushCurrencyReason(currencyDiagnostics, "currency_missing", "cohort first purchase currency missing; fallback used.");
        } else if (!normalized && info.firstCurrency) {
          pushCurrencyReason(currencyDiagnostics, "currency_unsupported", `Unsupported currency '${String(info.firstCurrency)}'; fallback used.`);
        }
        cohortFirstOrderRevenueSum += convertMoneyStrict(
          info.firstValueRaw,
          rowCurrency,
          displayCurrency,
          dayRate,
          currencyDiagnostics
        );
      }
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

    /** Purchases used for cohort LTV curve, retention grid, and cohort revenue — extended beyond [start,end] when a cohort is selected. */
    let byUserForCohortRetention: Map<string, UserPurchaseEvent[]> = byUser;
    if (cohortMonth && /^\d{4}-\d{2}$/.test(cohortMonth) && usersM0 > 0 && cohortMonths.length > 0) {
      const cohortUserSet = new Set(cohortUserFirstDates.keys());
      let extStartDay = end;
      for (const fd of cohortUserFirstDates.values()) {
        if (fd < extStartDay) extStartDay = fd;
      }
      let heatmapEndStr = end;
      const lastCohortMonthStr = cohortMonths[cohortMonths.length - 1] ?? "";
      const [ly, lm] = lastCohortMonthStr.split("-").map(Number);
      if (Number.isFinite(ly) && Number.isFinite(lm)) {
        const lastDom = new Date(ly, lm, 0).getDate();
        heatmapEndStr = `${lastCohortMonthStr}-${String(lastDom).padStart(2, "0")}`;
      }
      let extEndDay = end;
      for (const fd of cohortUserFirstDates.values()) {
        const baseMs = new Date(`${fd}T12:00:00.000Z`).getTime();
        if (!Number.isFinite(baseMs)) continue;
        const iso90 = new Date(baseMs + 90 * 86400000).toISOString().slice(0, 10);
        if (iso90 > extEndDay) extEndDay = iso90;
      }
      if (heatmapEndStr > extEndDay) extEndDay = heatmapEndStr;
      if (extStartDay > extEndDay) extEndDay = extStartDay;

      const extFromIso = `${extStartDay}T00:00:00.000Z`;
      const extToIso = `${extEndDay}T23:59:59.999Z`;

      const extendedPurchases: PurchaseRow[] = [];
      for (let page = 0; page < MAX_PAGES; page++) {
        const fromIdx = page * PAGE_SIZE;
        const toIdx = fromIdx + PAGE_SIZE - 1;
        const { data, error: extErr } = await admin
          .from("conversion_events")
          .select("id, event_time, created_at, user_external_id, visitor_id, session_id, value, currency, campaign_intent")
          .eq("project_id", projectId)
          .eq("event_name", "purchase")
          .gte("event_time", extFromIso)
          .lte("event_time", extToIso)
          .order("event_time", { ascending: true })
          .range(fromIdx, toIdx);

        if (extErr) {
          console.error("[LTV_COHORT_EXTEND_ERROR]", extErr);
          break;
        }
        const chunk = (data ?? []) as PurchaseRow[];
        extendedPurchases.push(...chunk);
        if (paginationHitCap(page, chunk.length, PAGE_SIZE, MAX_PAGES)) scanTruncated = true;
        if (chunk.length < PAGE_SIZE) break;
      }

      if (displayCurrency === "KZT" && extendedPurchases.length > 0) {
        const extDays = extendedPurchases.map((r) =>
          String((r.event_time ?? r.created_at) ?? "").slice(0, 10)
        );
        await ensureUsdToKztRatesForDays(admin, extDays);
        const extRateMap = await getUsdToKztRateMapForDays(admin, extDays);
        for (const [d, rate] of extRateMap) usdToKztRateByDay.set(d, rate);
        latestUsdToKztRate = await getLatestUsdToKztRate(admin);
      }

      const merged = new Map<string, UserPurchaseEvent[]>();
      const seenId = new Map<string, Set<string>>();
      for (const key of cohortUserSet) {
        if (!allowedUserKeys.has(key)) continue;
        const baseList = (byUser.get(key) ?? []).map((u) => ({ ...u }));
        merged.set(key, baseList);
        seenId.set(key, new Set(baseList.map((p) => p.id)));
      }

      for (const r of extendedPurchases) {
        const key = identityKey(r);
        if (key === null || !cohortUserSet.has(key) || !allowedUserKeys.has(key)) continue;
        if (seenId.get(key)?.has(r.id)) continue;

        const rawVal = r.value != null ? Number(r.value) : 0;
        const normalized = normalizeCurrencyCode(r.currency);
        const rowCurrency = normalized ?? displayCurrency;
        const day = String((r.event_time ?? r.created_at) ?? "").slice(0, 10);
        const dayRate = resolveUsdToKztRateForDay(
          day,
          usdToKztRateByDay,
          latestUsdToKztRate,
          currencyDiagnostics
        );
        const val = convertMoneyStrict(rawVal, rowCurrency, displayCurrency, dayRate, currencyDiagnostics);
        const eventTime = parseEventTime(r);
        const campaignIntent = (r.campaign_intent?.trim() === "retention" ? "retention" : null) || null;
        const list = merged.get(key) ?? [];
        list.push({ id: r.id, value: val, eventTime, campaignIntent });
        merged.set(key, list);
        const s = seenId.get(key) ?? new Set<string>();
        s.add(r.id);
        seenId.set(key, s);
      }
      for (const [, list] of merged) {
        list.sort((a, b) => a.eventTime.localeCompare(b.eventTime));
      }
      byUserForCohortRetention = merged;
    }

    const activeInMonth = (userKeys: Map<string, string>, monthStr: string): number => {
      const [y, m] = monthStr.split("-").map(Number);
      const startM = `${monthStr}-01T00:00:00.000Z`;
      const lastDay = new Date(y, m, 0).getDate();
      const endM = `${monthStr}-${String(lastDay).padStart(2, "0")}T23:59:59.999Z`;
      let count = 0;
      for (const [key] of userKeys) {
        const list = byUserForCohortRetention.get(key) ?? [];
        const hasInRange = list.some((p) => p.eventTime >= startM && p.eventTime <= endM);
        if (hasInRange) count += 1;
      }
      return count;
    };

    const m0Active = usersM0 > 0 ? activeInMonth(cohortUserFirstDates, cohortMonths[0] ?? "") : 0;
    const usersMi = cohortMonths.length ? activeInMonth(cohortUserFirstDates, cohortMonths[cohortMonths.length - 1] ?? "") : uniquePurchasers;
    const retentionPct = usersM0 > 0 ? (m0Active / usersM0) * 100 : 0;

    // 5) LTV curve (D1..D90) for selected cohort: classical = cumulative revenue in first D days after first purchase.
    // Mature cohorts often have $0 classical D90 (no purchases in that early window) while report-period revenue exists.
    // Fallback: realized average revenue per cohort member from first purchase through report `end` (flat curve + ltvCum).
    const horizons = [1, 7, 14, 30, 60, 90];
    const reportClipEndDate = kpiWindowCohortScoped ? kpiEndDate : end;
    const reportEndTs = new Date(`${reportClipEndDate}T23:59:59.999Z`).getTime();
    const lineData: { day: string; ltv: number; arpu: number }[] = [];
    let ltvCurveMode: "first_n_days" | "realized_period_end" = "first_n_days";

    if (cohortMonth && usersM0 > 0) {
      const cohortUsers = Array.from(cohortUserFirstDates.keys());
      let prevAvg = 0;
      for (const d of horizons) {
        let sumLtv = 0;
        for (const key of cohortUsers) {
          const list = byUserForCohortRetention.get(key) ?? [];
          const firstTime = firstPurchaseTimeByKey.get(key) ?? list[0]?.eventTime ?? "";
          const firstTs = new Date(firstTime).getTime();
          if (!Number.isFinite(firstTs)) continue;
          const endTs = firstTs + d * 24 * 60 * 60 * 1000;
          let userRev = 0;
          for (const p of list) {
            const t = new Date(p.eventTime).getTime();
            if (Number.isFinite(t) && t <= endTs) userRev += p.value;
          }
          sumLtv += userRev;
        }
        const ltv = usersM0 > 0 ? sumLtv / usersM0 : 0;
        const arpuInc = Math.max(0, ltv - prevAvg);
        prevAvg = ltv;
        lineData.push({ day: `D${d}`, ltv, arpu: arpuInc });
      }
    }
    if (lineData.length === 0) {
      horizons.forEach((d) => lineData.push({ day: `D${d}`, ltv: 0, arpu: 0 }));
    }

    const classicalD90 = lineData.length ? (lineData[lineData.length - 1]?.ltv ?? 0) : 0;
    let cohortLifetimeToReportSum = 0;
    if (cohortMonth && usersM0 > 0) {
      const cohortUsers = Array.from(cohortUserFirstDates.keys());
      for (const key of cohortUsers) {
        const list = byUserForCohortRetention.get(key) ?? [];
        const firstTime = firstPurchaseTimeByKey.get(key) ?? list[0]?.eventTime ?? "";
        const firstTs = new Date(firstTime).getTime();
        if (!Number.isFinite(firstTs)) continue;
        for (const p of list) {
          const t = new Date(p.eventTime).getTime();
          if (Number.isFinite(t) && t >= firstTs && t <= reportEndTs) cohortLifetimeToReportSum += p.value;
        }
      }
    }
    const ltvLifetimeAvg = usersM0 > 0 ? cohortLifetimeToReportSum / usersM0 : 0;
    const LTV_CURVE_EPS = 1e-6;
    if (cohortMonth && usersM0 > 0 && classicalD90 < LTV_CURVE_EPS && ltvLifetimeAvg > LTV_CURVE_EPS) {
      ltvCurveMode = "realized_period_end";
      lineData.length = 0;
      for (const d of horizons) {
        lineData.push({ day: `D${d}`, ltv: ltvLifetimeAvg, arpu: d === 1 ? ltvLifetimeAvg : 0 });
      }
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
          const list = byUserForCohortRetention.get(key) ?? [];
          for (const p of list) {
            if (p.eventTime >= startM && p.eventTime <= endM) rev += p.value;
          }
        }
        values.push(Math.round(rev));
      }
      cohortRevenueRows.push({ cohort: co, values });
    }

    const platformSourcesFromFilter = sources.filter((s) => isPlatformSource(s));
    const spendSources = (() => {
      const base = platformSourcesFromFilter.length > 0 ? platformSourcesFromFilter : null;
      if (filterByAcquisitionSource && requestedSource) {
        if (!isPlatformSource(requestedSource)) return [];
        if (!base) return [requestedSource];
        return base.includes(requestedSource) ? [requestedSource] : [];
      }
      return base ?? undefined;
    })();
    const canonical = await getCanonicalSummary(admin, projectId, kpiStartDate, kpiEndDate, {
      sources: spendSources,
      accountIds: accountIds.length > 0 ? accountIds : undefined,
    });
    const spend = canonical?.data?.spend ?? 0;

    // Retention spend: campaigns.marketing_intent = 'retention' (set by Meta ad sync from URLs containing campaign_intent=retention).
    let retentionSpend: number | null = null;
    try {
      let rcQuery = admin
        .from("campaigns")
        .select("id")
        .eq("project_id", projectId)
        .eq("marketing_intent", "retention");
      if (spendSources != null && spendSources.length > 0) {
        rcQuery = rcQuery.in("platform", spendSources);
      }
      if (accountIds.length > 0) {
        rcQuery = rcQuery.in("ad_accounts_id", accountIds);
      }
      const { data: retentionCampaigns } = await rcQuery;
      const campaignIds = [...new Set((retentionCampaigns ?? []).map((c: { id: string }) => c.id))];
      if (campaignIds.length > 0) {
        const { data: metrics } = await admin
          .from("daily_ad_metrics_campaign")
          .select("spend")
          .in("campaign_id", campaignIds)
          .gte("date", kpiStartDate)
          .lte("date", kpiEndDate);
        const total = (metrics ?? []).reduce((s: number, r: { spend?: number | null }) => s + Number(r.spend ?? 0), 0);
        retentionSpend = Math.round(total * 10000) / 10000;
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
    const acquisitionSpendForKpi =
      retentionSpend != null && Number.isFinite(retentionSpend) && Number.isFinite(spend)
        ? Math.max(0, spend - retentionSpend)
        : spend;

    /** project_monthly_plans row month: cohort month when set, else calendar month of report `end` (so plan shows without forcing cohort). */
    let monthlyPlanYear: number | null = null;
    let monthlyPlanMonth: number | null = null;
    let monthlyPlanSource: "cohort" | "report_end" | null = null;
    if (cohortMonth && /^\d{4}-\d{2}$/.test(cohortMonth)) {
      const [y, m] = cohortMonth.split("-").map(Number);
      if (Number.isFinite(y) && Number.isFinite(m) && m >= 1 && m <= 12) {
        monthlyPlanYear = y;
        monthlyPlanMonth = m;
        monthlyPlanSource = "cohort";
      }
    }
    if (monthlyPlanYear == null && /^\d{4}-\d{2}-\d{2}$/.test(end)) {
      monthlyPlanYear = parseInt(end.slice(0, 4), 10);
      monthlyPlanMonth = parseInt(end.slice(5, 7), 10);
      if (Number.isFinite(monthlyPlanYear) && Number.isFinite(monthlyPlanMonth) && monthlyPlanMonth >= 1 && monthlyPlanMonth <= 12) {
        monthlyPlanSource = "report_end";
      } else {
        monthlyPlanYear = null;
        monthlyPlanMonth = null;
        monthlyPlanSource = null;
      }
    }

    let budgetForRepeatSales: number | null = null;
    let planRepeatSalesCount: number | null = null;
    let planSalesPlanCount: number | null = null;
    let planSalesPlanBudget: number | null = null;
    let plannedRevenue: number | null = null;
    let plannedRetentionRevenue: number | null = null;
    let monthlyPlanRowFound = false;
    if (monthlyPlanYear != null && monthlyPlanMonth != null) {
      const { data: plan } = await admin
        .from("project_monthly_plans")
        .select("repeat_sales_budget, repeat_sales_count, sales_plan_budget, sales_plan_count, planned_revenue, repeat_avg_check")
        .eq("project_id", projectId)
        .eq("year", monthlyPlanYear)
        .eq("month", monthlyPlanMonth)
        .maybeSingle();
      if (plan) {
        monthlyPlanRowFound = true;
        budgetForRepeatSales =
          plan.repeat_sales_budget != null && plan.repeat_sales_budget !== ""
            ? Number(plan.repeat_sales_budget)
            : null;
        planRepeatSalesCount =
          plan.repeat_sales_count != null && plan.repeat_sales_count !== ""
            ? Number(plan.repeat_sales_count)
            : null;
        planSalesPlanBudget =
          plan.sales_plan_budget != null && plan.sales_plan_budget !== ""
            ? Number(plan.sales_plan_budget)
            : null;
        planSalesPlanCount =
          plan.sales_plan_count != null && plan.sales_plan_count !== ""
            ? Number(plan.sales_plan_count)
            : null;
        plannedRevenue =
          plan.planned_revenue != null && plan.planned_revenue !== "" ? Number(plan.planned_revenue) : null;
        const repeatAvgCheck =
          (plan as { repeat_avg_check?: number | string | null }).repeat_avg_check != null &&
          (plan as { repeat_avg_check?: number | string | null }).repeat_avg_check !== ""
            ? Number((plan as { repeat_avg_check?: number | string | null }).repeat_avg_check)
            : null;
        plannedRetentionRevenue =
          repeatAvgCheck != null &&
          Number.isFinite(repeatAvgCheck) &&
          planRepeatSalesCount != null &&
          Number.isFinite(planRepeatSalesCount)
            ? repeatAvgCheck * planRepeatSalesCount
            : null;
      }
    }

    // CPR (plan) = repeat_sales_budget / repeat_sales_count (same as Sales plan modal / project-monthly-plans planCpr).
    const cpr: number | null =
      budgetForRepeatSales != null &&
      budgetForRepeatSales > 0 &&
      planRepeatSalesCount != null &&
      planRepeatSalesCount > 0
        ? Math.round((10000 * budgetForRepeatSales) / planRepeatSalesCount) / 10000
        : null;

    const planCac: number | null =
      planSalesPlanBudget != null &&
      planSalesPlanBudget > 0 &&
      planSalesPlanCount != null &&
      planSalesPlanCount > 0
        ? Math.round((10000 * planSalesPlanBudget) / planSalesPlanCount) / 10000
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

    let registrationEventsInPeriod = 0;
    for (const r of registrationRows) {
      const key = identityKey(r);
      if (!key) continue;
      const src = effectiveAcquisitionForRegistrant(key, r);
      if (filterByAcquisitionSource && src !== requestedSource) continue;
      registrationEventsInPeriod += 1;
    }

    let purchaseEventsInPeriod = 0;
    for (const p of purchases) {
      const key = identityKey(p);
      if (!key) continue;
      if (filterByAcquisitionSource && !allowedUserKeys.has(key)) continue;
      purchaseEventsInPeriod += 1;
    }

    const payingShare: number | null =
      registrationEventsInPeriod > 0
        ? Math.round((1000 * purchaseEventsInPeriod) / registrationEventsInPeriod) / 10
        : null;
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
      /** Тот же курс для USD→KZT, что и `convertUsdToProjectCurrency` / маркетинговый отчёт (последняя запись exchange_rates). */
      usd_to_kzt_rate_used: displayCurrency === "KZT" ? latestUsdToKztRate : null,
      /** Хотя бы один скан conversion_events уперся в лимит страниц — цифры могут быть неполными. */
      scan_truncated: scanTruncated,
      scan_max_rows: MAX_PAGES * PAGE_SIZE,
      acquisition_sources: acquisitionSourcesList,
      kpi: {
        usersMi: cohortSize,
        activeUsersMi: activeInCohort,
        revenueMi: totalRevenue,
        arpuMi: arpuSafe,
        ltvCum,
        payingShare,
        registrants_in_period: registrationEventsInPeriod,
        purchases_in_period: purchaseEventsInPeriod,
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
        spend: toProjectMoney(spend) ?? 0,
        /** Остаток total spend − retention_spend (те же источники/период, что spend); если retention не посчитан — равен spend. */
        acquisition_spend: toProjectMoney(acquisitionSpendForKpi) ?? 0,
        budget_for_repeat_sales: toProjectMoney(budgetForRepeatSales),
        cpr: toProjectMoney(cpr),
        retention_spend: toProjectMoney(retentionSpend),
        cpr_actual: toProjectMoney(cprActual),
        retention_roas: retentionRoas,
        monthly_plan_year: monthlyPlanYear,
        monthly_plan_month: monthlyPlanMonth,
        monthly_plan_source: monthlyPlanSource,
        monthly_plan_row_found: monthlyPlanRowFound,
        plan_repeat_sales_count: planRepeatSalesCount,
        plan_sales_plan_count: planSalesPlanCount,
        plan_sales_plan_budget: toProjectMoney(planSalesPlanBudget),
        planned_revenue: toProjectMoney(plannedRevenue),
        planned_retention_revenue:
          toProjectMoney(plannedRetentionRevenue != null ? plannedRetentionRevenue : plannedRevenue),
        plan_cac: toProjectMoney(planCac),
        kpi_window_start: kpiStartDate,
        kpi_window_end: kpiEndDate,
        /** Пересечение периода запроса с календарным месяцем cohort_month. */
        kpi_window_cohort_calendar_month: kpiWindowCohortScoped,
        /** Совпадает с полным календарным месяцем когорты (1-е — последний день). */
        kpi_window_full_cohort_month: kpiWindowFullCohortCalendarMonth,
        /** Сумма первых оплат пользователей когорты (первая оплата в `cohort_month`), в валюте отчёта — сопоставимо с планом первички. */
        cohort_first_order_revenue:
          cohortMonth && /^\d{4}-\d{2}$/.test(cohortMonth) ? cohortFirstOrderRevenueSum : null,
        /** Repeat-транзакции в [start,end] только у пользователей этой когорты. */
        cohort_repeat_purchases_in_period:
          cohortMonth && /^\d{4}-\d{2}$/.test(cohortMonth) ? cohortRepeatPurchasesInPeriod : null,
        cohort_repeat_revenue_in_period:
          cohortMonth && /^\d{4}-\d{2}$/.test(cohortMonth) ? cohortRepeatRevenueInPeriod : null,
      },
      lineData,
      cohortRows,
      cohortSizes,
      cohortRevenueRows,
      currency_diagnostics: currencyDiagnostics,
      ltv_curve_mode: ltvCurveMode,
    });
  } catch (e) {
    console.error("[LTV_FATAL]", e);
    return NextResponse.json(
      { success: false, error: e instanceof Error ? e.message : "Internal error" },
      { status: 500 }
    );
  }
}
