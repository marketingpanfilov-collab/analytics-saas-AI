/**
 * BoardIQ: Assisted Attribution
 * Builds full user path (all visits before conversion) and assigns channel roles:
 * first_touch, assist, last_touch. Does not modify Data Quality or Attribution Debugger.
 */

import type { SupabaseClient } from "@supabase/supabase-js";

export type TouchRole = "first_touch" | "assist" | "last_touch";

export type AttributionVisit = {
  id: string;
  visitor_id: string;
  visit_id: string | null;
  click_id: string | null;
  traffic_source: string | null;
  traffic_platform: string | null;
  created_at: string;
  role: TouchRole;
};

export type AttributionPath = {
  visits: AttributionVisit[];
  first_touch: AttributionVisit | null;
  last_touch: AttributionVisit | null;
  assists: AttributionVisit[];
};

export type ConversionRecord = {
  id: string;
  event_name: string;
  event_time?: string | null;
  visitor_id: string | null;
  click_id: string | null;
  user_external_id: string | null;
  created_at: string;
  traffic_source?: string | null;
  value?: number | null;
  currency?: string | null;
  external_event_id?: string | null;
};

export type VisitRecord = {
  id: string;
  visitor_id: string;
  visit_id: string | null;
  click_id: string | null;
  traffic_source: string | null;
  traffic_platform: string | null;
  created_at: string;
};

function syntheticDirectVisitFromConversion(conv: ConversionRecord): VisitRecord {
  return {
    id: `synthetic:${conv.id}`,
    visitor_id: conv.visitor_id?.trim() || `conv:${conv.id}`,
    visit_id: null,
    click_id: conv.click_id ?? null,
    traffic_source: conv.traffic_source?.trim() || "direct",
    traffic_platform: null,
    created_at: conv.created_at,
  };
}

/**
 * Pure: given visits sorted by created_at ASC (before conversion time), assign roles.
 * First visit → first_touch, last → last_touch, middle → assist.
 */
export function buildAttributionPathFromVisits(
  visits: VisitRecord[],
  _conversionCreatedAt: string
): AttributionPath {
  const sorted = [...visits].sort(
    (a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime()
  );
  const withRole: AttributionVisit[] = sorted.map((v, i) => {
    let role: TouchRole = "assist";
    if (sorted.length === 1) role = "first_touch";
    else if (i === 0) role = "first_touch";
    else if (i === sorted.length - 1) role = "last_touch";
    return { ...v, role };
  });
  const first_touch = withRole[0] ?? null;
  const last_touch = withRole.length > 0 ? withRole[withRole.length - 1]! : null;
  const assists = withRole.filter((v) => v.role === "assist");
  return {
    visits: withRole,
    first_touch,
    last_touch,
    assists,
  };
}

export type AssistedAttributionOptions = {
  project_id: string;
  days?: number;
  start?: string | null;
  end?: string | null;
  source?: string | null;
  sources?: string[] | null;
  account_ids?: string[] | null;
};

const ATTRIBUTION_SOURCE_WHITELIST = new Set([
  "meta",
  "google",
  "tiktok",
  "yandex",
  "direct",
  "organic_search",
  "referral",
]);

export type ConversionWithPath = {
  conversion: ConversionRecord;
  path: AttributionPath;
};

export type ChannelRow = {
  traffic_source: string;
  direct_conversions: number;
  assisted_conversions: number;
  /** Count of conversions where this channel was first_touch (opens path). */
  first_touch_conversions?: number;
};

/**
 * Fetch conversions in period, then for each conversion fetch all visits
 * where visitor_id matches and created_at < conversion.created_at; build path.
 * Returns conversions with paths and aggregated channels (direct = last_touch, assisted = assist count).
 */
export async function buildAssistedAttribution(
  admin: SupabaseClient,
  options: AssistedAttributionOptions
): Promise<{
  conversions: ConversionWithPath[];
  channels: ChannelRow[];
  diagnostics: {
    conversions_total: number;
    conversions_with_visitor_id: number;
    conversions_without_visitor_id: number;
    conversions_with_visits: number;
    conversions_without_visits: number;
  };
}> {
  const { project_id, days, source } = options;
  const start = options.start?.trim() || null;
  const end = options.end?.trim() || null;
  const since = start ? `${start}T00:00:00.000Z` : sinceIso(days ?? 30);
  const until = end ? `${end}T23:59:59.999Z` : null;
  const sourceList = (options.sources ?? [])
    .map((s) => String(s).trim().toLowerCase())
    .filter((s) => s.length > 0 && ATTRIBUTION_SOURCE_WHITELIST.has(s));
  const accountIds = (options.account_ids ?? []).map((v) => String(v).trim()).filter(Boolean);

  const applySourceFilter = <T extends { eq: Function; in: Function }>(q: T): T =>
    source ? (q.eq("traffic_source", source) as T) : sourceList.length > 0 ? (q.in("traffic_source", sourceList) as T) : q;

  const qByEventTime = applySourceFilter(
    admin
      .from("conversion_events")
      .select("id, event_name, event_time, visitor_id, click_id, user_external_id, created_at, traffic_source, value, currency, external_event_id")
      .eq("project_id", project_id)
      .eq("event_name", "purchase")
      .gte("event_time", since)
      .lte("event_time", until ?? new Date().toISOString())
      .order("event_time", { ascending: true })
  );
  const qByCreatedAtFallback = applySourceFilter(
    admin
      .from("conversion_events")
      .select("id, event_name, event_time, visitor_id, click_id, user_external_id, created_at, traffic_source, value, currency, external_event_id")
      .eq("project_id", project_id)
      .eq("event_name", "purchase")
      .is("event_time", null)
      .gte("created_at", since)
      .lte("created_at", until ?? new Date().toISOString())
      .order("created_at", { ascending: true })
  );
  const [{ data: eventTimedRows }, { data: createdTimedRows }] = await Promise.all([
    qByEventTime,
    qByCreatedAtFallback,
  ]);

  const byId = new Map<string, ConversionRecord>();
  for (const row of (eventTimedRows ?? []) as ConversionRecord[]) byId.set(row.id, row);
  for (const row of (createdTimedRows ?? []) as ConversionRecord[]) byId.set(row.id, row);
  let conversions = Array.from(byId.values());

  if (accountIds.length > 0) {
    const { data: campaignRows } = await admin
      .from("campaigns")
      .select("id, external_campaign_id, meta_campaign_id")
      .eq("project_id", project_id)
      .in("ad_accounts_id", accountIds);
    const allowedCampaignKeys = new Set<string>();
    for (const c of (campaignRows ?? []) as { id: string; external_campaign_id: string | null; meta_campaign_id: string | null }[]) {
      if (c.id) allowedCampaignKeys.add(String(c.id).trim());
      if (c.external_campaign_id) allowedCampaignKeys.add(String(c.external_campaign_id).trim());
      if (c.meta_campaign_id) allowedCampaignKeys.add(String(c.meta_campaign_id).trim());
    }
    if (allowedCampaignKeys.size > 0) {
      const clickIds = Array.from(
        new Set(
          conversions
            .map((c) => c.click_id?.trim())
            .filter((v): v is string => Boolean(v))
        )
      );
      const allowedClickIds = new Set<string>();
      const batchSize = 300;
      for (let i = 0; i < clickIds.length; i += batchSize) {
        const batch = clickIds.slice(i, i + batchSize);
        const { data: clickRows } = await admin
          .from("redirect_click_events")
          .select("bq_click_id, platform_campaign_id")
          .eq("project_id", project_id)
          .in("bq_click_id", batch);
        for (const row of (clickRows ?? []) as { bq_click_id: string; platform_campaign_id: string | null }[]) {
          const campaignKey = row.platform_campaign_id ? String(row.platform_campaign_id).trim() : "";
          if (campaignKey && allowedCampaignKeys.has(campaignKey)) {
            allowedClickIds.add(String(row.bq_click_id));
          }
        }
      }
      if (allowedClickIds.size > 0) {
        conversions = conversions.filter((c) => {
          const cid = c.click_id?.trim();
          // Keep unattributed/direct purchases (no click_id) to avoid false-empty blocks.
          if (!cid) return true;
          return allowedClickIds.has(cid);
        });
      }
    }
  }
  const conversionsWithPaths: ConversionWithPath[] = [];
  const channelCount: Record<string, { direct: number; assisted: number; first_touch: number }> = {};
  const srcKey = (s: string | null | undefined) => (s && s.trim() ? s : "direct");
  let withVisitorId = 0;
  let withoutVisitorId = 0;
  let withVisits = 0;
  let withoutVisits = 0;

  for (const conv of conversions) {
    const convTs = (conv.event_time && conv.event_time.trim()) ? conv.event_time : conv.created_at;
    const visitorId = conv.visitor_id?.trim();
    if (!visitorId) {
      withoutVisitorId += 1;
      const synthetic = syntheticDirectVisitFromConversion(conv);
      const path = buildAttributionPathFromVisits([synthetic], convTs);
      conversionsWithPaths.push({ conversion: conv, path });
      withVisits += 1;
      const key = srcKey(path.last_touch?.traffic_source ?? "direct");
      if (!channelCount[key]) channelCount[key] = { direct: 0, assisted: 0, first_touch: 0 };
      channelCount[key].direct += 1;
      continue;
    }
    withVisitorId += 1;

    const { data: visitRows } = await admin
      .from("visit_source_events")
      .select("id, visitor_id, visit_id, click_id, traffic_source, traffic_platform, created_at")
      .eq("site_id", project_id)
      .eq("visitor_id", visitorId)
      .lt("created_at", convTs)
      .order("created_at", { ascending: true });

    const visits = (visitRows ?? []) as VisitRecord[];
    const effectiveVisits =
      visits.length > 0 ? visits : [syntheticDirectVisitFromConversion(conv)];
    if (visits.length > 0) withVisits += 1;
    else withoutVisits += 1;
    const path = buildAttributionPathFromVisits(visits, convTs);
    const normalizedPath =
      visits.length > 0 ? path : buildAttributionPathFromVisits(effectiveVisits, convTs);
    conversionsWithPaths.push({ conversion: conv, path: normalizedPath });

    const isSyntheticSingleTouchFallback = visits.length === 0 && normalizedPath.visits.length === 1;
    if (normalizedPath.first_touch && !isSyntheticSingleTouchFallback) {
      const key = srcKey(normalizedPath.first_touch.traffic_source);
      if (!channelCount[key]) channelCount[key] = { direct: 0, assisted: 0, first_touch: 0 };
      channelCount[key].first_touch += 1;
    }
    if (normalizedPath.last_touch) {
      const key = srcKey(normalizedPath.last_touch.traffic_source);
      if (!channelCount[key]) channelCount[key] = { direct: 0, assisted: 0, first_touch: 0 };
      channelCount[key].direct += 1;
    }
    for (const a of normalizedPath.assists) {
      const key = srcKey(a.traffic_source);
      if (!channelCount[key]) channelCount[key] = { direct: 0, assisted: 0, first_touch: 0 };
      channelCount[key].assisted += 1;
    }
  }

  const channels: ChannelRow[] = Object.entries(channelCount)
    .map(([traffic_source, counts]) => ({
      traffic_source,
      direct_conversions: counts.direct,
      assisted_conversions: counts.assisted,
      first_touch_conversions: counts.first_touch,
    }))
    .sort((a, b) => {
      const totA = (a.first_touch_conversions ?? 0) + a.assisted_conversions + a.direct_conversions;
      const totB = (b.first_touch_conversions ?? 0) + b.assisted_conversions + b.direct_conversions;
      return totB - totA;
    });

  return {
    conversions: conversionsWithPaths,
    channels,
    diagnostics: {
      conversions_total: conversions.length,
      conversions_with_visitor_id: withVisitorId,
      conversions_without_visitor_id: withoutVisitorId,
      conversions_with_visits: withVisits,
      conversions_without_visits: withoutVisits,
    },
  };
}

function sinceIso(days: number): string {
  const d = new Date();
  d.setDate(d.getDate() - days);
  return d.toISOString();
}
