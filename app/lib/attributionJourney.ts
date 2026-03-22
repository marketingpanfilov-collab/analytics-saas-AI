/**
 * Attribution Debugger v9: Cross-Chain User Journey
 * Groups chains by user_external_id / visitor_id and builds journey objects.
 * v10: attribution_models added per journey.
 * No extra DB — uses existing chain data.
 */

import type { ChainItem } from "./attributionDebugger";
import { calculateAttributionModels, type AttributionModelsResult } from "./attributionModels";

export type JourneyIdentity = {
  user_external_id: string | null;
  visitor_ids: string[];
  click_ids: string[];
};

export type JourneySummary = {
  first_touch_source: string | null;
  first_touch_platform: string | null;
  last_touch_source: string | null;
  last_touch_platform: string | null;
  clicks_count: number;
  visits_count: number;
  registrations_count: number;
  purchases_count: number;
  revenue_total: number;
  first_event_at: string | null;
  last_event_at: string | null;
  /** Clicks before first registration (in time order) */
  clicks_before_registration: number;
  /** Clicks before first purchase */
  clicks_before_purchase: number;
};

export type TouchpointType = "click" | "visit" | "registration" | "purchase";

export type JourneyTouchpoint = {
  type: TouchpointType;
  source: string | null;
  platform: string | null;
  timestamp: string;
  click_id: string | null;
  visit_id: string | null;
  user_external_id: string | null;
  value: number | null;
  currency: string | null;
  external_event_id: string | null;
  event_id?: string;
};

export type JourneyHealthLabel = "Broken" | "Weak" | "Fair" | "Strong" | "Excellent";

export type Journey = {
  journey_id: string;
  project_id: string;
  identity: JourneyIdentity;
  summary: JourneySummary;
  touchpoints: JourneyTouchpoint[];
  chains: ChainItem[];
  journey_health_score: number;
  journey_health_label: JourneyHealthLabel;
  journey_insights: string[];
  /** v10: Revenue by attribution model and source */
  attribution_models: AttributionModelsResult;
};

// ---------------------------------------------------------------------------
// Union-Find to group chains by shared identity
// ---------------------------------------------------------------------------

function getIdentityKeys(chain: ChainItem): { users: Set<string>; visitors: Set<string> } {
  const users = new Set<string>();
  const visitors = new Set<string>();
  for (const r of chain.registrations) {
    if (r.user_external_id) users.add(r.user_external_id);
    if (r.visitor_id) visitors.add(r.visitor_id);
  }
  for (const p of chain.purchases) {
    if (p.user_external_id) users.add(p.user_external_id);
    if (p.visitor_id) visitors.add(p.visitor_id);
  }
  for (const v of chain.visits) visitors.add(v.visitor_id);
  if (chain.click.exists) visitors.add(chain.click.bq_click_id); // use bq_click_id as a weak link
  return { users, visitors };
}

class UnionFind {
  parent: number[];
  constructor(n: number) {
    this.parent = Array.from({ length: n }, (_, i) => i);
  }
  find(x: number): number {
    if (this.parent[x] !== x) this.parent[x] = this.find(this.parent[x]);
    return this.parent[x];
  }
  union(x: number, y: number): void {
    const px = this.find(x);
    const py = this.find(y);
    if (px !== py) this.parent[px] = py;
  }
}

function groupChainIndicesByIdentity(chains: ChainItem[]): number[][] {
  const n = chains.length;
  const uf = new UnionFind(n);
  const keyToChains = new Map<string, number[]>();

  chains.forEach((chain, i) => {
    const { users, visitors } = getIdentityKeys(chain);
    const keys: string[] = [];
    users.forEach((u) => keys.push("u:" + u));
    visitors.forEach((v) => keys.push("v:" + v));
    keys.forEach((k) => {
      if (!keyToChains.has(k)) keyToChains.set(k, []);
      keyToChains.get(k)!.push(i);
    });
  });

  keyToChains.forEach((indices) => {
    for (let j = 1; j < indices.length; j++) uf.union(indices[0], indices[j]);
  });

  const rootToGroup = new Map<number, number[]>();
  for (let i = 0; i < n; i++) {
    const r = uf.find(i);
    if (!rootToGroup.has(r)) rootToGroup.set(r, []);
    rootToGroup.get(r)!.push(i);
  }
  return Array.from(rootToGroup.values());
}

// ---------------------------------------------------------------------------
// Touchpoints from chains
// ---------------------------------------------------------------------------

function collectTouchpoints(chains: ChainItem[]): JourneyTouchpoint[] {
  const out: JourneyTouchpoint[] = [];

  chains.forEach((chain) => {
    if (chain.click.exists) {
      out.push({
        type: "click",
        source: chain.click.traffic_source,
        platform: chain.click.traffic_platform,
        timestamp: chain.click.created_at,
        click_id: chain.click.bq_click_id,
        visit_id: null,
        user_external_id: null,
        value: null,
        currency: null,
        external_event_id: null,
      });
    }
    chain.visits.forEach((v) => {
      out.push({
        type: "visit",
        source: v.traffic_source,
        platform: v.traffic_platform,
        timestamp: v.created_at,
        click_id: v.click_id,
        visit_id: v.visit_id,
        user_external_id: null,
        value: null,
        currency: null,
        external_event_id: null,
      });
    });
    chain.registrations.forEach((r) => {
      out.push({
        type: "registration",
        source: r.traffic_source,
        platform: null,
        timestamp: r.created_at,
        click_id: r.click_id,
        visit_id: null,
        user_external_id: r.user_external_id,
        value: null,
        currency: null,
        external_event_id: null,
        event_id: r.event_id,
      });
    });
    chain.purchases.forEach((p) => {
      out.push({
        type: "purchase",
        source: p.traffic_source,
        platform: null,
        timestamp: p.created_at,
        click_id: p.click_id,
        visit_id: null,
        user_external_id: p.user_external_id,
        value: p.value,
        currency: p.currency,
        external_event_id: p.external_event_id,
        event_id: p.event_id,
      });
    });
  });

  const order: Record<TouchpointType, number> = { click: 0, visit: 1, registration: 2, purchase: 3 };
  out.sort((a, b) => {
    const t = a.timestamp.localeCompare(b.timestamp);
    if (t !== 0) return t;
    return order[a.type] - order[b.type];
  });
  return out;
}

// ---------------------------------------------------------------------------
// First / Last touch
// ---------------------------------------------------------------------------

function firstLastTouch(touchpoints: JourneyTouchpoint[]): Pick<
  JourneySummary,
  "first_touch_source" | "first_touch_platform" | "last_touch_source" | "last_touch_platform"
> {
  const clicks = touchpoints.filter((t) => t.type === "click");
  if (clicks.length === 0)
    return {
      first_touch_source: null,
      first_touch_platform: null,
      last_touch_source: null,
      last_touch_platform: null,
    };
  const first = clicks[0];
  const last = clicks[clicks.length - 1];
  return {
    first_touch_source: first.source,
    first_touch_platform: first.platform,
    last_touch_source: last.source,
    last_touch_platform: last.platform,
  };
}

function clicksBeforeConversion(touchpoints: JourneyTouchpoint[], type: "registration" | "purchase"): number {
  const firstConv = touchpoints.find((t) => t.type === type);
  if (!firstConv) return 0;
  const convTime = firstConv.timestamp;
  return touchpoints.filter((t) => t.type === "click" && t.timestamp <= convTime).length;
}

// ---------------------------------------------------------------------------
// Journey health score (0–100)
// ---------------------------------------------------------------------------

function journeyHealthScore(
  identity: JourneyIdentity,
  summary: JourneySummary,
  touchpoints: JourneyTouchpoint[],
  chains: ChainItem[]
): { score: number; label: JourneyHealthLabel } {
  let score = 0;
  if (identity.user_external_id) score += 25;
  else if (identity.visitor_ids.length > 0) score += 15;
  if (summary.registrations_count >= 1) score += 20;
  if (summary.purchases_count >= 1) score += 25;
  if (summary.clicks_count >= 1 && summary.visits_count >= 1) score += 15;
  const sources = new Set(touchpoints.filter((t) => t.type === "click" && t.source).map((t) => t.source));
  if (sources.size > 1) score += 10;
  const avgChainQuality = chains.reduce((s, c) => s + (c.match_quality === "high" ? 1 : c.match_quality === "medium" ? 0.5 : 0), 0) / Math.max(1, chains.length);
  score += Math.round(avgChainQuality * 5);

  score = Math.min(100, Math.max(0, score));

  let label: JourneyHealthLabel = "Broken";
  if (score >= 85) label = "Excellent";
  else if (score >= 70) label = "Strong";
  else if (score >= 50) label = "Fair";
  else if (score >= 30) label = "Weak";
  return { score, label };
}

// ---------------------------------------------------------------------------
// Journey insights
// ---------------------------------------------------------------------------

function buildJourneyInsights(
  identity: JourneyIdentity,
  summary: JourneySummary,
  touchpoints: JourneyTouchpoint[]
): string[] {
  const insights: string[] = [];
  if (summary.clicks_count > 1)
    insights.push(`User interacted with ${summary.clicks_count} ad clicks before conversion.`);
  const firstSource = summary.first_touch_source;
  const lastSource = summary.last_touch_source;
  if (firstSource && lastSource && firstSource !== lastSource)
    insights.push("Last-touch source differs from first-touch source.");
  if (summary.first_event_at && summary.last_event_at) {
    const days = (new Date(summary.last_event_at).getTime() - new Date(summary.first_event_at).getTime()) / (24 * 60 * 60 * 1000);
    if (days >= 1) insights.push(`Journey spans ${Math.round(days)} day(s).`);
  }
  if (summary.purchases_count > 1) insights.push("Journey contains repeat purchase.");
  const sources = new Set(touchpoints.filter((t) => t.type === "click" && t.source).map((t) => t.source!));
  if (sources.size > 1) insights.push("Journey includes multiple channels.");
  if (summary.clicks_before_registration > 0)
    insights.push(`Registration after ${summary.clicks_before_registration} click(s).`);
  if (summary.clicks_before_purchase > 0)
    insights.push(`Purchase after ${summary.clicks_before_purchase} click(s).`);
  return insights;
}

// ---------------------------------------------------------------------------
// Main builder
// ---------------------------------------------------------------------------

export function buildJourneysFromChains(chains: ChainItem[]): Journey[] {
  if (chains.length === 0) return [];

  const groups = groupChainIndicesByIdentity(chains);
  const journeys: Journey[] = [];

  groups.forEach((indices, gIndex) => {
    const groupChains = indices.map((i) => chains[i]);
    const touchpoints = collectTouchpoints(groupChains);

    const userExternalIds = new Set<string>();
    const visitorIds = new Set<string>();
    const clickIds = new Set<string>();
    groupChains.forEach((c) => {
      if (c.click.exists) clickIds.add(c.click.bq_click_id);
      c.visits.forEach((v) => visitorIds.add(v.visitor_id));
      c.registrations.forEach((r) => {
        if (r.user_external_id) userExternalIds.add(r.user_external_id);
        if (r.visitor_id) visitorIds.add(r.visitor_id);
      });
      c.purchases.forEach((p) => {
        if (p.user_external_id) userExternalIds.add(p.user_external_id);
        if (p.visitor_id) visitorIds.add(p.visitor_id);
      });
    });

    const identity: JourneyIdentity = {
      user_external_id: userExternalIds.size === 1 ? Array.from(userExternalIds)[0]! : (userExternalIds.size > 1 ? Array.from(userExternalIds)[0]! : null),
      visitor_ids: Array.from(visitorIds),
      click_ids: Array.from(clickIds),
    };

    const firstLast = firstLastTouch(touchpoints);
    const clicksBeforeReg = clicksBeforeConversion(touchpoints, "registration");
    const clicksBeforePurch = clicksBeforeConversion(touchpoints, "purchase");

    const regCount = groupChains.reduce((s, c) => s + c.registrations.length, 0);
    const purchCount = groupChains.reduce((s, c) => s + c.purchases.length, 0);
    const visitCount = groupChains.reduce((s, c) => s + c.visits.length, 0);
    const clickCount = groupChains.filter((c) => c.click.exists).length;
    const revenue = groupChains.reduce((s, c) => s + c.summary.revenue_total, 0);

    const firstEvent = touchpoints[0]?.timestamp ?? null;
    const lastEvent = touchpoints[touchpoints.length - 1]?.timestamp ?? null;

    const summary: JourneySummary = {
      ...firstLast,
      clicks_count: clickCount,
      visits_count: visitCount,
      registrations_count: regCount,
      purchases_count: purchCount,
      revenue_total: revenue,
      first_event_at: firstEvent,
      last_event_at: lastEvent,
      clicks_before_registration: clicksBeforeReg,
      clicks_before_purchase: clicksBeforePurch,
    };

    const { score, label } = journeyHealthScore(identity, summary, touchpoints, groupChains);
    const journey_insights = buildJourneyInsights(identity, summary, touchpoints);

    const journey_id =
      identity.user_external_id ?? identity.visitor_ids[0] ?? identity.click_ids[0] ?? `journey-${gIndex}`;

    const attribution_models = calculateAttributionModels(
      touchpoints as Array<{ type: "click" | "visit" | "registration" | "purchase"; source: string | null; platform: string | null; timestamp: string; value?: number | null }>,
      revenue
    );

    journeys.push({
      journey_id: `j-${journey_id}`,
      project_id: groupChains[0]!.project_id,
      identity,
      summary,
      touchpoints,
      chains: groupChains,
      journey_health_score: score,
      journey_health_label: label,
      journey_insights,
      attribution_models,
    });
  });

  return journeys.sort((a, b) => (b.summary.last_event_at ?? "").localeCompare(a.summary.last_event_at ?? ""));
}
