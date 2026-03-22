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
  days: number;
  source?: string | null;
};

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
}> {
  const { project_id, days, source } = options;
  const since = sinceIso(days);

  const convQuery = admin
    .from("conversion_events")
    .select("id, event_name, visitor_id, click_id, user_external_id, created_at, traffic_source, value, currency, external_event_id")
    .eq("project_id", project_id)
    .in("event_name", ["registration", "purchase"])
    .gte("created_at", since);

  const { data: convRows } = source
    ? await convQuery.eq("traffic_source", source)
    : await convQuery;

  const conversions = (convRows ?? []) as ConversionRecord[];
  const conversionsWithPaths: ConversionWithPath[] = [];
  const channelCount: Record<string, { direct: number; assisted: number; first_touch: number }> = {};

  for (const conv of conversions) {
    const visitorId = conv.visitor_id?.trim();
    if (!visitorId) {
      conversionsWithPaths.push({ conversion: conv, path: { visits: [], first_touch: null, last_touch: null, assists: [] } });
      continue;
    }

    const { data: visitRows } = await admin
      .from("visit_source_events")
      .select("id, visitor_id, visit_id, click_id, traffic_source, traffic_platform, created_at")
      .eq("site_id", project_id)
      .eq("visitor_id", visitorId)
      .lt("created_at", conv.created_at)
      .order("created_at", { ascending: true });

    const visits = (visitRows ?? []) as VisitRecord[];
    const path = buildAttributionPathFromVisits(visits, conv.created_at);
    conversionsWithPaths.push({ conversion: conv, path });

    const srcKey = (s: string | null) => (s && s.trim() ? s : "direct");
    if (path.first_touch) {
      const key = srcKey(path.first_touch.traffic_source);
      if (!channelCount[key]) channelCount[key] = { direct: 0, assisted: 0, first_touch: 0 };
      channelCount[key].first_touch += 1;
    }
    if (path.last_touch) {
      const key = srcKey(path.last_touch.traffic_source);
      if (!channelCount[key]) channelCount[key] = { direct: 0, assisted: 0, first_touch: 0 };
      channelCount[key].direct += 1;
    }
    for (const a of path.assists) {
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

  return { conversions: conversionsWithPaths, channels };
}

function sinceIso(days: number): string {
  const d = new Date();
  d.setDate(d.getDate() - days);
  return d.toISOString();
}
