/**
 * Attribution Debugger: build Click → Visit → Registration → Purchase chains
 * for diagnostic and attribution verification.
 *
 * Matching priority: click_id (bqcid) → visitor_id (visit↔conversion) → user_external_id (fallback).
 * conversion_events has no visit_id; we link via visitor_id to visit_source_events.
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import { generateChainSuggestions } from "./attributionSuggestions";
import { getAttributionState, type AttributionState } from "./trafficSourceDetection";

export type ChainStatus = "complete" | "partial" | "broken";

export type MatchQuality = "high" | "medium" | "low";

export type ChainGap =
  | "click_without_visit"
  | "visit_without_registration"
  | "visits_without_registration"
  | "registration_without_click"
  | "purchase_without_click"
  | "purchase_without_user_external_id"
  | "purchase_without_value"
  | "visit_without_traffic_source"
  | "visit_lost_attribution";

export type ChainClick = {
  exists: true;
  bq_click_id: string;
  traffic_source: string | null;
  traffic_platform: string | null;
  utm_source: string | null;
  utm_campaign: string | null;
  utm_medium: string | null;
  created_at: string;
};

export type ChainVisit = {
  exists: true;
  visit_id: string | null;
  click_id: string | null;
  visitor_id: string;
  traffic_source: string | null;
  traffic_platform: string | null;
  created_at: string;
};

export type ChainRegistration = {
  exists: true;
  event_id: string;
  user_external_id: string | null;
  click_id: string | null;
  visitor_id: string | null;
  traffic_source: string | null;
  created_at: string;
};

export type ChainPurchase = {
  exists: true;
  event_id: string;
  user_external_id: string | null;
  external_event_id: string | null;
  value: number | null;
  currency: string | null;
  click_id: string | null;
  visitor_id: string | null;
  traffic_source: string | null;
  created_at: string;
};

/** Single visit in a one-to-many chain */
export type ChainVisitItem = {
  exists: true;
  visit_id: string | null;
  click_id: string | null;
  visitor_id: string;
  traffic_source: string | null;
  traffic_platform: string | null;
  attribution_state?: AttributionState;
  created_at: string;
};

/** Single registration in a one-to-many chain */
export type ChainRegistrationItem = {
  exists: true;
  event_id: string;
  user_external_id: string | null;
  click_id: string | null;
  visitor_id: string | null;
  traffic_source: string | null;
  created_at: string;
};

/** Single purchase in a one-to-many chain */
export type ChainPurchaseItem = {
  exists: true;
  event_id: string;
  user_external_id: string | null;
  external_event_id: string | null;
  value: number | null;
  currency: string | null;
  click_id: string | null;
  visitor_id: string | null;
  traffic_source: string | null;
  created_at: string;
};

/** Aggregated summary for one-to-many chain */
export type ChainSummary = {
  visits_count: number;
  registrations_count: number;
  purchases_count: number;
  revenue_total: number;
  repeat_purchases_count: number;
};

/** v5: Suggested fix for attribution issues (product-level recommendation) */
export type SuggestedFixSeverity = "high" | "medium" | "low";

export type SuggestedFixType =
  | "missing_click_id"
  | "visit_without_traffic_source"
  | "visit_lost_attribution"
  | "purchase_without_value"
  | "weak_match_quality"
  | "no_visit_after_click"
  | "purchase_without_user_id"
  | "registration_not_linked";

export type SuggestedFix = {
  severity: SuggestedFixSeverity;
  type: SuggestedFixType;
  title: string;
  description: string;
  suggested_action: string;
  impact: string;
};

export type ChainItem = {
  chain_id: string;
  project_id: string;
  status: ChainStatus;
  click: { exists: true; bq_click_id: string; traffic_source: string | null; traffic_platform: string | null; utm_source: string | null; utm_campaign: string | null; utm_medium: string | null; created_at: string } | { exists: false };
  /** All visits linked by click_id (sorted by created_at ASC) */
  visits: ChainVisitItem[];
  /** All registrations linked by click_id or visitor_id (deduped, sorted by created_at ASC) */
  registrations: ChainRegistrationItem[];
  /** All purchases linked by click_id, visitor_id or user_external_id (deduped, sorted by created_at ASC) */
  purchases: ChainPurchaseItem[];
  summary: ChainSummary;
  gaps: ChainGap[];
  match_quality: MatchQuality;
  explanation: string;
  last_event_at: string;
  /** v5: Product-level suggested fixes for this chain (max 3–5) */
  suggested_fixes: SuggestedFix[];
};

export type AttributionDebuggerOptions = {
  project_id: string;
  days: number;
  page: number;
  page_size: number;
  search?: string | null;
  filter_status?: ChainStatus | null;
  filter_source?: string | null;
};

export type AttributionDebuggerResult = {
  chains: ChainItem[];
  total: number;
  page: number;
  page_size: number;
};

// ---------------------------------------------------------------------------
// Orphan / Unmatched events (v2)
// ---------------------------------------------------------------------------

export type OrphanVisitItem = {
  type: "orphan_visit";
  status: "unmatched";
  visit_id: string | null;
  click_id: string | null;
  visitor_id: string;
  traffic_source: string | null;
  traffic_platform: string | null;
  created_at: string;
  reason: string;
};

export type UnmatchedRegistrationItem = {
  type: "unmatched_registration";
  status: "unmatched";
  event_id: string;
  click_id: string | null;
  visitor_id: string | null;
  user_external_id: string | null;
  traffic_source: string | null;
  created_at: string;
  reason: string;
};

export type UnmatchedPurchaseItem = {
  type: "unmatched_purchase";
  status: "unmatched";
  event_id: string;
  click_id: string | null;
  visitor_id: string | null;
  user_external_id: string | null;
  external_event_id: string | null;
  value: number | null;
  currency: string | null;
  traffic_source: string | null;
  created_at: string;
  reason: string;
};

export type OrphanItem = OrphanVisitItem | UnmatchedRegistrationItem | UnmatchedPurchaseItem;

export type OrphanOptions = {
  project_id: string;
  days: number;
  page: number;
  page_size: number;
  search?: string | null;
  orphan_type?: "orphan_visit" | "unmatched_registration" | "unmatched_purchase" | null;
  filter_source?: string | null;
};

export type OrphanResult = {
  items: OrphanItem[];
  total: number;
  page: number;
  page_size: number;
};

function sinceIso(days: number): string {
  const d = new Date();
  d.setDate(d.getDate() - days);
  return d.toISOString();
}

/** Status for one-to-many chain: complete = click + ≥1 visit + (≥1 reg or ≥1 purch); partial = click + some; broken = click only / weak */
function determineStatusV3(
  hasClick: boolean,
  visitsCount: number,
  regsCount: number,
  purchsCount: number,
  gaps: ChainGap[]
): ChainStatus {
  if (!hasClick) return "partial";
  if (hasClick && visitsCount >= 1 && (regsCount >= 1 || purchsCount >= 1) && !gaps.includes("click_without_visit")) return "complete";
  if (hasClick && (visitsCount >= 1 || regsCount >= 1 || purchsCount >= 1)) return "partial";
  return "partial";
}

/** Match quality at chain level: high = majority by click_id; medium = majority by visitor_id; low = mainly user_external_id */
function determineMatchQualityV3(
  regsByClickId: number,
  regsByVisitorId: number,
  purchsByClickId: number,
  purchsByVisitorId: number,
  purchsByUserExt: number
): MatchQuality {
  const totalConv = regsByClickId + regsByVisitorId + purchsByClickId + purchsByVisitorId + purchsByUserExt;
  if (totalConv === 0) return "high";
  const byClick = regsByClickId + purchsByClickId;
  const byVisitor = regsByVisitorId + purchsByVisitorId;
  if (byClick >= totalConv * 0.5) return "high";
  if (byVisitor >= totalConv * 0.5) return "medium";
  return "low";
}

function buildExplanationV3(
  visitsCount: number,
  regsCount: number,
  purchsCount: number,
  byClick: number,
  byVisitor: number,
  byUserExt: number,
  gaps: ChainGap[]
): string {
  const parts: string[] = [];
  parts.push("Click from redirect_click_events.");
  if (visitsCount > 0) parts.push(`${visitsCount} visit(s) linked by click_id.`);
  if (gaps.includes("click_without_visit")) parts.push("Gap: no visit for this click.");
  if (regsCount > 0) parts.push(`${regsCount} registration(s): ${byClick} by click_id, ${byVisitor} by visitor_id, ${byUserExt} by user_external_id.`);
  if (purchsCount > 0) parts.push(`${purchsCount} purchase(s) in chain.`);
  if (gaps.includes("visits_without_registration")) parts.push("Gap: visits without registration or purchase.");
  return parts.join(" ");
}

const VALID_NO_SOURCE_STATES: AttributionState[] = ["direct", "organic_search", "referral"];

function buildGapsV3(
  hasClick: boolean,
  visits: ChainVisitItem[],
  regs: ChainRegistrationItem[],
  purchs: ChainPurchaseItem[]
): ChainGap[] {
  const gaps: ChainGap[] = [];
  if (hasClick && visits.length === 0) gaps.push("click_without_visit");
  const anyVisitLostAttribution = visits.some((v) => v.attribution_state === "missing_expected_attribution");
  if (anyVisitLostAttribution) gaps.push("visit_lost_attribution");
  const anyVisitWithoutSourceAndNotValid = visits.some(
    (v) => !v.traffic_source && v.attribution_state != null && !VALID_NO_SOURCE_STATES.includes(v.attribution_state)
  );
  if (anyVisitWithoutSourceAndNotValid) gaps.push("visit_without_traffic_source");
  if (visits.length > 0 && regs.length === 0 && purchs.length === 0) gaps.push("visits_without_registration");
  const anyPurchWithoutUserExt = purchs.some((p) => !p.user_external_id);
  if (anyPurchWithoutUserExt) gaps.push("purchase_without_user_external_id");
  const anyPurchWithoutValue = purchs.some((p) => p.value == null || p.value === undefined);
  if (anyPurchWithoutValue) gaps.push("purchase_without_value");
  return gaps;
}

export async function buildAttributionChains(
  admin: SupabaseClient,
  options: AttributionDebuggerOptions
): Promise<AttributionDebuggerResult> {
  const { project_id, days, page, page_size, search, filter_status, filter_source } = options;
  const since = sinceIso(days);

  let clicks: Array<{
    id: string;
    bq_click_id: string;
    traffic_source: string | null;
    traffic_platform: string | null;
    utm_source: string | null;
    utm_medium: string | null;
    utm_campaign: string | null;
    created_at: string;
  }> = [];
  let total = 0;

  if (search?.trim()) {
    const searchTrim = search.trim();
    const [clicksByBq, visitsByVisitId, convByUserExt, convByExtId] = await Promise.all([
      admin
        .from("redirect_click_events")
        .select("bq_click_id")
        .eq("project_id", project_id)
        .gte("created_at", since)
        .ilike("bq_click_id", `%${searchTrim}%`),
      admin
        .from("visit_source_events")
        .select("click_id")
        .eq("site_id", project_id)
        .gte("created_at", since)
        .ilike("visit_id", `%${searchTrim}%`),
      admin
        .from("conversion_events")
        .select("click_id, visitor_id")
        .eq("project_id", project_id)
        .gte("created_at", since)
        .ilike("user_external_id", `%${searchTrim}%`),
      admin
        .from("conversion_events")
        .select("click_id, visitor_id")
        .eq("project_id", project_id)
        .gte("created_at", since)
        .ilike("external_event_id", `%${searchTrim}%`),
    ]);
    const idSet = new Set<string>();
    (clicksByBq.data ?? []).forEach((r: { bq_click_id?: string }) => r.bq_click_id && idSet.add(r.bq_click_id));
    (visitsByVisitId.data ?? []).forEach((r: { click_id?: string }) => r.click_id && idSet.add(r.click_id));
    (convByUserExt.data ?? []).forEach((r: { click_id?: string }) => r.click_id && idSet.add(r.click_id));
    (convByExtId.data ?? []).forEach((r: { click_id?: string }) => r.click_id && idSet.add(r.click_id));
    if (idSet.size === 0) {
      return { chains: [], total: 0, page, page_size };
    }
    const allClicks = await admin
      .from("redirect_click_events")
      .select("id, bq_click_id, traffic_source, traffic_platform, utm_source, utm_medium, utm_campaign, created_at")
      .eq("project_id", project_id)
      .gte("created_at", since)
      .in("bq_click_id", Array.from(idSet))
      .order("created_at", { ascending: false });
    const allRows = (allClicks.data ?? []) as Array<{
      id: string;
      bq_click_id: string;
      traffic_source: string | null;
      traffic_platform: string | null;
      utm_source: string | null;
      utm_medium: string | null;
      utm_campaign: string | null;
      created_at: string;
    }>;
    total = allRows.length;
    const start = (page - 1) * page_size;
    clicks = allRows.slice(start, start + page_size);
  } else {
    let countQuery = admin
      .from("redirect_click_events")
      .select("id", { count: "exact", head: true })
      .eq("project_id", project_id)
      .gte("created_at", since);
    if (filter_source) countQuery = countQuery.eq("traffic_source", filter_source);
    const { count } = await countQuery;
    total = count ?? 0;

    let pageQuery = admin
      .from("redirect_click_events")
      .select("id, bq_click_id, traffic_source, traffic_platform, utm_source, utm_medium, utm_campaign, created_at")
      .eq("project_id", project_id)
      .gte("created_at", since)
      .order("created_at", { ascending: false })
      .range((page - 1) * page_size, page * page_size - 1);
    if (filter_source) pageQuery = pageQuery.eq("traffic_source", filter_source);
    const { data: pageRows } = await pageQuery;
    clicks = (pageRows ?? []) as Array<{
      id: string;
      bq_click_id: string;
      traffic_source: string | null;
      traffic_platform: string | null;
      utm_source: string | null;
      utm_medium: string | null;
      utm_campaign: string | null;
      created_at: string;
    }>;
  }

  if (clicks.length === 0) {
    return { chains: [], total, page, page_size };
  }

  const clickIdsOrdered = clicks.map((c) => c.bq_click_id);

  const visitsData = await admin
    .from("visit_source_events")
    .select("click_id, visit_id, visitor_id, traffic_source, traffic_platform, referrer, utm_source, fbclid, gclid, ttclid, yclid, created_at")
    .eq("site_id", project_id)
    .in("click_id", clickIdsOrdered)
    .gte("created_at", since);

  type VisitRow = {
    visit_id: string | null;
    visitor_id: string;
    traffic_source: string | null;
    traffic_platform: string | null;
    referrer?: string | null;
    utm_source?: string | null;
    fbclid?: string | null;
    gclid?: string | null;
    ttclid?: string | null;
    yclid?: string | null;
    created_at: string;
  };
  const visitsByClickId = new Map<string, VisitRow[]>();
  (visitsData.data ?? []).forEach((v: VisitRow & { click_id: string | null }) => {
    if (!v.click_id) return;
    if (!visitsByClickId.has(v.click_id)) visitsByClickId.set(v.click_id, []);
    visitsByClickId.get(v.click_id)!.push({
      visit_id: v.visit_id,
      visitor_id: v.visitor_id,
      traffic_source: v.traffic_source,
      traffic_platform: v.traffic_platform,
      referrer: v.referrer,
      utm_source: v.utm_source,
      fbclid: v.fbclid,
      gclid: v.gclid,
      ttclid: v.ttclid,
      yclid: v.yclid,
      created_at: v.created_at,
    });
  });

  const visitorIds = Array.from(visitsByClickId.values()).flat().map((v) => v.visitor_id).filter(Boolean);
  const [regsByClickRes, regsByVisitorRes] = await Promise.all([
    admin
      .from("conversion_events")
      .select("id, click_id, visitor_id, user_external_id, traffic_source, created_at")
      .eq("project_id", project_id)
      .eq("event_name", "registration")
      .gte("created_at", since)
      .in("click_id", clickIdsOrdered),
    visitorIds.length > 0
      ? admin
          .from("conversion_events")
          .select("id, click_id, visitor_id, user_external_id, traffic_source, created_at")
          .eq("project_id", project_id)
          .eq("event_name", "registration")
          .gte("created_at", since)
          .in("visitor_id", visitorIds)
      : { data: [] as Array<{ id: string; click_id: string | null; visitor_id: string | null; user_external_id: string | null; traffic_source: string | null; created_at: string }> },
  ]);
  const regsData = {
    data: [
      ...(regsByClickRes.data ?? []),
      ...(regsByVisitorRes.data ?? []),
    ],
  };
  const regsSeen = new Set<string>();
  const regsDeduped = (regsData.data as Array<{ id: string; click_id: string | null; visitor_id: string | null; user_external_id: string | null; traffic_source: string | null; created_at: string }>).filter((r) => {
    if (regsSeen.has(r.id)) return false;
    regsSeen.add(r.id);
    return true;
  });

  const regsByClickId = new Map<string, Array<{ id: string; visitor_id: string | null; user_external_id: string | null; traffic_source: string | null; created_at: string }>>();
  const regsByVisitorId = new Map<string, Array<{ id: string; click_id: string | null; user_external_id: string | null; traffic_source: string | null; created_at: string }>>();
  regsDeduped.forEach((r: { id: string; click_id: string | null; visitor_id: string | null; user_external_id: string | null; traffic_source: string | null; created_at: string }) => {
    if (r.click_id) {
      if (!regsByClickId.has(r.click_id)) regsByClickId.set(r.click_id, []);
      regsByClickId.get(r.click_id)!.push({
        id: r.id,
        visitor_id: r.visitor_id,
        user_external_id: r.user_external_id,
        traffic_source: r.traffic_source,
        created_at: r.created_at,
      });
    }
    if (r.visitor_id) {
      if (!regsByVisitorId.has(r.visitor_id)) regsByVisitorId.set(r.visitor_id, []);
      regsByVisitorId.get(r.visitor_id)!.push({
        id: r.id,
        click_id: r.click_id,
        user_external_id: r.user_external_id,
        traffic_source: r.traffic_source,
        created_at: r.created_at,
      });
    }
  });

  const regUserExtIds = Array.from(regsByClickId.values())
    .flat()
    .map((r) => r.user_external_id)
    .filter(Boolean) as string[];
  const [purchByClickRes, purchByVisitorRes, purchByUserExtRes] = await Promise.all([
    admin
      .from("conversion_events")
      .select("id, click_id, visitor_id, user_external_id, external_event_id, value, currency, traffic_source, created_at")
      .eq("project_id", project_id)
      .eq("event_name", "purchase")
      .gte("created_at", since)
      .in("click_id", clickIdsOrdered),
    visitorIds.length > 0
      ? admin
          .from("conversion_events")
          .select("id, click_id, visitor_id, user_external_id, external_event_id, value, currency, traffic_source, created_at")
          .eq("project_id", project_id)
          .eq("event_name", "purchase")
          .gte("created_at", since)
          .in("visitor_id", visitorIds)
      : { data: [] as Array<{ id: string; click_id: string | null; visitor_id: string | null; user_external_id: string | null; external_event_id: string | null; value: number | null; currency: string | null; traffic_source: string | null; created_at: string }> },
    regUserExtIds.length > 0
      ? admin
          .from("conversion_events")
          .select("id, click_id, visitor_id, user_external_id, external_event_id, value, currency, traffic_source, created_at")
          .eq("project_id", project_id)
          .eq("event_name", "purchase")
          .gte("created_at", since)
          .in("user_external_id", regUserExtIds)
      : { data: [] as Array<{ id: string; click_id: string | null; visitor_id: string | null; user_external_id: string | null; external_event_id: string | null; value: number | null; currency: string | null; traffic_source: string | null; created_at: string }> },
  ]);
  const purchSeen = new Set<string>();
  const purchData = {
    data: [...(purchByClickRes.data ?? []), ...(purchByVisitorRes.data ?? []), ...(purchByUserExtRes.data ?? [])].filter((p: { id: string }) => {
      if (purchSeen.has(p.id)) return false;
      purchSeen.add(p.id);
      return true;
    }),
  };

  const purchByClickId = new Map<string, Array<{ id: string; visitor_id: string | null; user_external_id: string | null; external_event_id: string | null; value: number | null; currency: string | null; traffic_source: string | null; created_at: string }>>();
  const purchByVisitorId = new Map<string, Array<{ id: string; click_id: string | null; user_external_id: string | null; external_event_id: string | null; value: number | null; currency: string | null; traffic_source: string | null; created_at: string }>>();
  (purchData.data as Array<{ id: string; click_id: string | null; visitor_id: string | null; user_external_id: string | null; external_event_id: string | null; value: number | null; currency: string | null; traffic_source: string | null; created_at: string }>).forEach((p) => {
    if (p.click_id) {
      if (!purchByClickId.has(p.click_id)) purchByClickId.set(p.click_id, []);
      purchByClickId.get(p.click_id)!.push({
        id: p.id,
        visitor_id: p.visitor_id,
        user_external_id: p.user_external_id,
        external_event_id: p.external_event_id,
        value: p.value,
        currency: p.currency,
        traffic_source: p.traffic_source,
        created_at: p.created_at,
      });
    }
    if (p.visitor_id) {
      if (!purchByVisitorId.has(p.visitor_id)) purchByVisitorId.set(p.visitor_id, []);
      purchByVisitorId.get(p.visitor_id)!.push({
        id: p.id,
        click_id: p.click_id,
        user_external_id: p.user_external_id,
        external_event_id: p.external_event_id,
        value: p.value,
        currency: p.currency,
        traffic_source: p.traffic_source,
        created_at: p.created_at,
      });
    }
  });

  type RegRecord = { id: string; visitor_id: string | null; user_external_id: string | null; traffic_source: string | null; created_at: string };
  type RegRecordByVisitor = { id: string; click_id: string | null; user_external_id: string | null; traffic_source: string | null; created_at: string };
  type PurchRecord = { id: string; click_id: string | null; visitor_id: string | null; user_external_id: string | null; external_event_id: string | null; value: number | null; currency: string | null; traffic_source: string | null; created_at: string };

  const chains: ChainItem[] = [];
  for (const click of clicks) {
    const bq = click.bq_click_id;
    const visitListRaw = visitsByClickId.get(bq) ?? [];
    const visitDedupKey = (v: { visit_id: string | null; visitor_id: string; created_at: string }) => v.visit_id ?? `${v.visitor_id}-${v.created_at}`;
    const seenVisit = new Set<string>();
    const visitList = visitListRaw
      .filter((v) => {
        const k = visitDedupKey(v);
        if (seenVisit.has(k)) return false;
        seenVisit.add(k);
        return true;
      })
      .sort((a, b) => (a.created_at < b.created_at ? -1 : 1));
    const visits: ChainVisitItem[] = visitList.map((v) => {
      const attribution_state = getAttributionState({
        referrer: v.referrer,
        utm_source: v.utm_source,
        click_id: bq,
        fbclid: v.fbclid,
        gclid: v.gclid,
        ttclid: v.ttclid,
        yclid: v.yclid,
      });
      return {
        exists: true as const,
        visit_id: v.visit_id,
        click_id: bq,
        visitor_id: v.visitor_id,
        traffic_source: v.traffic_source,
        traffic_platform: v.traffic_platform,
        attribution_state,
        created_at: v.created_at,
      };
    });

    const regIds = new Set<string>();
    let regsByClickIdCount = 0;
    let regsByVisitorIdCount = 0;
    const regsList: Array<RegRecord & { visitor_id_resolved: string | null; click_id_resolved: string | null }> = [];
    for (const r of regsByClickId.get(bq) ?? []) {
      if (!regIds.has(r.id)) {
        regIds.add(r.id);
        regsByClickIdCount++;
        regsList.push({ ...r, visitor_id_resolved: r.visitor_id, click_id_resolved: bq });
      }
    }
    for (const v of visitList) {
      for (const r of regsByVisitorId.get(v.visitor_id) ?? []) {
        if (!regIds.has(r.id)) {
          regIds.add(r.id);
          regsByVisitorIdCount++;
          regsList.push({ ...r, visitor_id: v.visitor_id, visitor_id_resolved: v.visitor_id, click_id_resolved: r.click_id ?? bq });
        }
      }
    }
    regsList.sort((a, b) => (a.created_at < b.created_at ? -1 : 1));
    const registrations: ChainRegistrationItem[] = regsList.map((r) => ({
      exists: true as const,
      event_id: r.id,
      user_external_id: r.user_external_id,
      click_id: r.click_id_resolved,
      visitor_id: r.visitor_id_resolved,
      traffic_source: r.traffic_source,
      created_at: r.created_at,
    }));

    const regUserExtIdsChain = new Set(registrations.map((r) => r.user_external_id).filter(Boolean) as string[]);
    const purchIds = new Set<string>();
    let purchsByClickIdCount = 0;
    let purchsByVisitorIdCount = 0;
    let purchsByUserExtCount = 0;
    const purchsList: PurchRecord[] = [];
    for (const p of purchByClickId.get(bq) ?? []) {
      if (!purchIds.has(p.id)) {
        purchIds.add(p.id);
        purchsByClickIdCount++;
        purchsList.push({
          id: p.id,
          click_id: bq,
          visitor_id: p.visitor_id,
          user_external_id: p.user_external_id,
          external_event_id: p.external_event_id,
          value: p.value,
          currency: p.currency,
          traffic_source: p.traffic_source,
          created_at: p.created_at,
        });
      }
    }
    for (const v of visitList) {
      for (const p of purchByVisitorId.get(v.visitor_id) ?? []) {
        if (!purchIds.has(p.id)) {
          purchIds.add(p.id);
          purchsByVisitorIdCount++;
          purchsList.push({
            id: p.id,
            click_id: p.click_id,
            visitor_id: v.visitor_id,
            user_external_id: p.user_external_id,
            external_event_id: p.external_event_id,
            value: p.value,
            currency: p.currency,
            traffic_source: p.traffic_source,
            created_at: p.created_at,
          });
        }
      }
    }
    for (const p of purchData.data as PurchRecord[]) {
      if (p.user_external_id && regUserExtIdsChain.has(p.user_external_id) && !purchIds.has(p.id)) {
        purchIds.add(p.id);
        purchsByUserExtCount++;
        purchsList.push(p);
      }
    }
    purchsList.sort((a, b) => (a.created_at < b.created_at ? -1 : 1));
    const purchases: ChainPurchaseItem[] = purchsList.map((p) => ({
      exists: true as const,
      event_id: p.id,
      user_external_id: p.user_external_id,
      external_event_id: p.external_event_id,
      value: p.value,
      currency: p.currency,
      click_id: p.click_id ?? bq,
      visitor_id: p.visitor_id,
      traffic_source: p.traffic_source,
      created_at: p.created_at,
    }));

    const revenue_total = purchases.reduce((s, p) => s + (p.value ?? 0), 0);
    const summary: ChainSummary = {
      visits_count: visits.length,
      registrations_count: registrations.length,
      purchases_count: purchases.length,
      revenue_total,
      repeat_purchases_count: Math.max(0, purchases.length - 1),
    };

    const gaps = buildGapsV3(true, visits, registrations, purchases);
    const matchQuality = determineMatchQualityV3(
      regsByClickIdCount,
      regsByVisitorIdCount,
      purchsByClickIdCount,
      purchsByVisitorIdCount,
      purchsByUserExtCount
    );
    const status = determineStatusV3(true, visits.length, registrations.length, purchases.length, gaps);
    const byClick = regsByClickIdCount + purchsByClickIdCount;
    const byVisitor = regsByVisitorIdCount + purchsByVisitorIdCount;
    const byUserExt = purchsByUserExtCount;
    const explanation = buildExplanationV3(
      visits.length,
      registrations.length,
      purchases.length,
      byClick,
      byVisitor,
      byUserExt,
      gaps
    );

    const allDates = [click.created_at, ...visits.map((v) => v.created_at), ...registrations.map((r) => r.created_at), ...purchases.map((p) => p.created_at)];
    const last_event_at = allDates.sort()[allDates.length - 1] ?? click.created_at;

    const chainItem: ChainItem = {
      chain_id: click.id,
      project_id,
      status,
      click: {
        exists: true,
        bq_click_id: click.bq_click_id,
        traffic_source: click.traffic_source,
        traffic_platform: click.traffic_platform,
        utm_source: click.utm_source,
        utm_campaign: click.utm_campaign,
        utm_medium: click.utm_medium,
        created_at: click.created_at,
      },
      visits,
      registrations,
      purchases,
      summary,
      gaps,
      match_quality: matchQuality,
      explanation,
      last_event_at,
      suggested_fixes: [], // set below
    };
    chainItem.suggested_fixes = generateChainSuggestions(chainItem);
    chains.push(chainItem);
  }

  let filtered = chains;
  if (filter_status) filtered = chains.filter((c) => c.status === filter_status);
  if (filter_source) filtered = filtered.filter((c) => c.click.exists && c.click.traffic_source === filter_source);

  return {
    chains: filtered,
    total,
    page,
    page_size,
  };
}

// ---------------------------------------------------------------------------
// Orphan / Unmatched events: visits and conversions not linked to any click chain
// ---------------------------------------------------------------------------

function reasonOrphanVisit(clickId: string | null): string {
  if (!clickId || clickId === "") return "No redirect click id; visit not from tracking link.";
  return "No matching redirect click found for this visit.";
}

function reasonUnmatchedReg(hasClickId: boolean, hasVisitorId: boolean): string {
  if (!hasClickId && !hasVisitorId) return "Missing click_id and visitor_id; cannot link to any click or visit.";
  if (!hasClickId) return "Registration could not be linked to any click or visit.";
  return "Registration could not be linked to any click or visit.";
}

function reasonUnmatchedPurch(hasClickId: boolean, hasVisitorId: boolean, hasUserExt: boolean): string {
  if (!hasClickId && !hasVisitorId && !hasUserExt) return "Missing click_id, visitor_id and user_external_id; attribution path is incomplete.";
  return "Purchase could not be linked to any click, visit or registration chain.";
}

export async function buildOrphanEvents(
  admin: SupabaseClient,
  options: OrphanOptions
): Promise<OrphanResult> {
  const { project_id, days, page, page_size, search, orphan_type, filter_source } = options;
  const since = sinceIso(days);

  const { data: clickIdsRows } = await admin
    .from("redirect_click_events")
    .select("bq_click_id")
    .eq("project_id", project_id)
    .gte("created_at", since);
  const R = new Set((clickIdsRows ?? []).map((r: { bq_click_id: string }) => r.bq_click_id));

  const { data: visitsRows } = await admin
    .from("visit_source_events")
    .select("id, visit_id, click_id, visitor_id, traffic_source, traffic_platform, created_at")
    .eq("site_id", project_id)
    .gte("created_at", since);

  const visitorIdsFromLinkedVisits = new Set<string>();
  (visitsRows ?? []).forEach((v: { click_id: string | null; visitor_id: string }) => {
    if (v.click_id && R.has(v.click_id)) visitorIdsFromLinkedVisits.add(v.visitor_id);
  });

  const orphanVisits: OrphanVisitItem[] = [];
  (visitsRows ?? []).forEach((v: { visit_id: string | null; click_id: string | null; visitor_id: string; traffic_source: string | null; traffic_platform: string | null; created_at: string }) => {
    const isOrphan = !v.click_id || v.click_id === "" || !R.has(v.click_id);
    if (!isOrphan) return;
    if (filter_source && v.traffic_source !== filter_source) return;
    orphanVisits.push({
      type: "orphan_visit",
      status: "unmatched",
      visit_id: v.visit_id,
      click_id: v.click_id,
      visitor_id: v.visitor_id,
      traffic_source: v.traffic_source,
      traffic_platform: v.traffic_platform,
      created_at: v.created_at,
      reason: reasonOrphanVisit(v.click_id),
    });
  });

  const { data: regsRows } = await admin
    .from("conversion_events")
    .select("id, click_id, visitor_id, user_external_id, traffic_source, created_at")
    .eq("project_id", project_id)
    .eq("event_name", "registration")
    .gte("created_at", since);

  const matchedRegIds = new Set<string>();
  (regsRows ?? []).forEach((r: { id: string; click_id: string | null; visitor_id: string | null }) => {
    if (r.click_id && R.has(r.click_id)) matchedRegIds.add(r.id);
    else if (r.visitor_id && visitorIdsFromLinkedVisits.has(r.visitor_id)) matchedRegIds.add(r.id);
  });

  const matchedUserExtIds = new Set<string>();
  (regsRows ?? []).forEach((r: { id: string; user_external_id: string | null }) => {
    if (matchedRegIds.has(r.id) && r.user_external_id) matchedUserExtIds.add(r.user_external_id);
  });

  const unmatchedRegs: UnmatchedRegistrationItem[] = [];
  (regsRows ?? []).forEach((r: { id: string; click_id: string | null; visitor_id: string | null; user_external_id: string | null; traffic_source: string | null; created_at: string }) => {
    if (matchedRegIds.has(r.id)) return;
    if (filter_source && r.traffic_source !== filter_source) return;
    unmatchedRegs.push({
      type: "unmatched_registration",
      status: "unmatched",
      event_id: r.id,
      click_id: r.click_id,
      visitor_id: r.visitor_id,
      user_external_id: r.user_external_id,
      traffic_source: r.traffic_source,
      created_at: r.created_at,
      reason: reasonUnmatchedReg(!!(r.click_id && r.click_id !== ""), !!(r.visitor_id && r.visitor_id !== "")),
    });
  });

  const { data: purchRows } = await admin
    .from("conversion_events")
    .select("id, click_id, visitor_id, user_external_id, external_event_id, value, currency, traffic_source, created_at")
    .eq("project_id", project_id)
    .eq("event_name", "purchase")
    .gte("created_at", since);

  const matchedPurchIds = new Set<string>();
  (purchRows ?? []).forEach((p: { id: string; click_id: string | null; visitor_id: string | null; user_external_id: string | null }) => {
    if (p.click_id && R.has(p.click_id)) matchedPurchIds.add(p.id);
    else if (p.visitor_id && visitorIdsFromLinkedVisits.has(p.visitor_id)) matchedPurchIds.add(p.id);
    else if (p.user_external_id && matchedUserExtIds.has(p.user_external_id)) matchedPurchIds.add(p.id);
  });

  const unmatchedPurchs: UnmatchedPurchaseItem[] = [];
  (purchRows ?? []).forEach((p: { id: string; click_id: string | null; visitor_id: string | null; user_external_id: string | null; external_event_id: string | null; value: number | null; currency: string | null; traffic_source: string | null; created_at: string }) => {
    if (matchedPurchIds.has(p.id)) return;
    if (filter_source && p.traffic_source !== filter_source) return;
    unmatchedPurchs.push({
      type: "unmatched_purchase",
      status: "unmatched",
      event_id: p.id,
      click_id: p.click_id,
      visitor_id: p.visitor_id,
      user_external_id: p.user_external_id,
      external_event_id: p.external_event_id,
      value: p.value,
      currency: p.currency,
      traffic_source: p.traffic_source,
      created_at: p.created_at,
      reason: reasonUnmatchedPurch(
        !!(p.click_id && p.click_id !== ""),
        !!(p.visitor_id && p.visitor_id !== ""),
        !!(p.user_external_id && p.user_external_id !== "")
      ),
    });
  });

  let combined: OrphanItem[] = [
    ...orphanVisits,
    ...unmatchedRegs,
    ...unmatchedPurchs,
  ];

  if (orphan_type) {
    combined = combined.filter((i) => i.type === orphan_type);
  }

  if (search?.trim()) {
    const q = search.trim().toLowerCase();
    combined = combined.filter((i) => {
      if (i.type === "orphan_visit") {
        return (
          (i.visit_id && i.visit_id.toLowerCase().includes(q)) ||
          (i.click_id && i.click_id.toLowerCase().includes(q)) ||
          (i.visitor_id && i.visitor_id.toLowerCase().includes(q))
        );
      }
      if (i.type === "unmatched_registration") {
        return (
          (i.click_id && i.click_id.toLowerCase().includes(q)) ||
          (i.visitor_id && i.visitor_id.toLowerCase().includes(q)) ||
          (i.user_external_id && i.user_external_id.toLowerCase().includes(q))
        );
      }
      if (i.type === "unmatched_purchase") {
        return (
          (i.click_id && i.click_id.toLowerCase().includes(q)) ||
          (i.visitor_id && i.visitor_id.toLowerCase().includes(q)) ||
          (i.user_external_id && i.user_external_id.toLowerCase().includes(q)) ||
          (i.external_event_id && i.external_event_id.toLowerCase().includes(q))
        );
      }
      return false;
    });
  }

  combined.sort((a, b) => {
    const tA = a.created_at;
    const tB = b.created_at;
    return tB.localeCompare(tA);
  });

  const total = combined.length;
  const start = (page - 1) * page_size;
  const items = combined.slice(start, start + page_size);

  return { items, total, page, page_size };
}
