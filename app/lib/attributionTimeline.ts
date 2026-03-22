/**
 * Attribution Debugger v8: Timeline Playback
 * Builds a unified timeline array and summary from chain data (no extra DB).
 */

import type { ChainItem, ChainVisitItem, ChainRegistrationItem, ChainPurchaseItem } from "./attributionDebugger";

export type TimelineEventStatus = "normal" | "warning" | "error";

export type TimelineEvent = {
  event_type: "click" | "visit" | "registration" | "purchase" | "gap";
  event_subtype?: string;
  id: string;
  timestamp: string;
  title: string;
  description: string;
  source?: string;
  /** Attribution state for visits: direct, organic_search, referral, paid_attributed, missing_expected_attribution (for UI labels) */
  source_type?: string;
  status: TimelineEventStatus;
  /** Milliseconds from previous event (null for first) */
  delta_from_previous_ms: number | null;
  metadata: Record<string, unknown>;
};

export type TimelineSummary = {
  total_events: number;
  first_click_at: string | null;
  last_event_at: string | null;
  time_to_registration_ms: number | null;
  time_to_purchase_ms: number | null;
  repeat_purchases_count: number;
};

const TYPE_ORDER: Record<TimelineEvent["event_type"], number> = {
  click: 0,
  visit: 1,
  registration: 2,
  purchase: 3,
  gap: 4,
};

const VALID_NO_SOURCE = ["direct", "organic_search", "referral"];

function eventStatus(
  chain: ChainItem,
  type: TimelineEvent["event_type"],
  item?: { traffic_source?: string | null; attribution_state?: string; value?: number | null; currency?: string | null; click_id?: string | null; user_external_id?: string | null }
): TimelineEventStatus {
  if (type === "click") return "normal";
  if (type === "visit" && item && !item.traffic_source && (!item.attribution_state || !VALID_NO_SOURCE.includes(item.attribution_state))) return "warning";
  if (type === "registration" && item && !item.click_id) return "warning";
  if (type === "purchase") {
    if (item && (item.value == null || item.currency == null)) return "warning";
    if (item && !item.user_external_id) return "warning";
    if (chain.match_quality === "low") return "warning";
  }
  return "normal";
}

function formatDelta(ms: number): string {
  if (ms < 1000) return `+${ms} ms`;
  if (ms < 60 * 1000) return `+${Math.round(ms / 1000)} sec`;
  if (ms < 60 * 60 * 1000) return `+${Math.round(ms / (60 * 1000))} min`;
  if (ms < 24 * 60 * 60 * 1000) return `+${Math.round(ms / (60 * 60 * 1000))} h`;
  return `+${Math.round(ms / (24 * 60 * 60 * 1000))} days`;
}

export function formatDeltaShort(ms: number): string {
  return formatDelta(ms);
}

function collectEvents(chain: ChainItem): Array<{ ts: string; type: TimelineEvent["event_type"]; order: number; payload: Omit<TimelineEvent, "delta_from_previous_ms"> }> {
  const out: Array<{ ts: string; type: TimelineEvent["event_type"]; order: number; payload: Omit<TimelineEvent, "delta_from_previous_ms"> }> = [];

  if (chain.click.exists) {
    out.push({
      ts: chain.click.created_at,
      type: "click",
      order: TYPE_ORDER.click,
      payload: {
        event_type: "click",
        id: `click-${chain.click.bq_click_id}`,
        timestamp: chain.click.created_at,
        title: "Ad Click",
        description: [chain.click.traffic_source, chain.click.traffic_platform].filter(Boolean).join(" / ") || "—",
        source: chain.click.traffic_source ?? undefined,
        status: "normal",
        metadata: { bq_click_id: chain.click.bq_click_id },
      },
    });
  }

  chain.visits.forEach((v: ChainVisitItem, i: number) => {
    const status = eventStatus(chain, "visit", v);
    out.push({
      ts: v.created_at,
      type: "visit",
      order: TYPE_ORDER.visit,
      payload: {
        event_type: "visit",
        event_subtype: chain.visits.length > 1 ? (i === 0 ? "first" : "repeat") : undefined,
        id: `visit-${v.visit_id ?? v.visitor_id}-${i}`,
        timestamp: v.created_at,
        title: chain.visits.length > 1 && i > 0 ? `Visit #${i + 1}` : "Landing Visit",
        description: v.visit_id ?? v.visitor_id ?? "—",
        source: v.traffic_source ?? undefined,
        source_type: v.attribution_state,
        status,
        metadata: { visit_id: v.visit_id, visitor_id: v.visitor_id, click_id: v.click_id },
      },
    });
  });

  chain.registrations.forEach((r: ChainRegistrationItem, i: number) => {
    const status = eventStatus(chain, "registration", r);
    out.push({
      ts: r.created_at,
      type: "registration",
      order: TYPE_ORDER.registration,
      payload: {
        event_type: "registration",
        id: `reg-${r.event_id}`,
        timestamp: r.created_at,
        title: "Registration",
        description: r.user_external_id ?? r.event_id.slice(0, 8),
        source: r.traffic_source ?? undefined,
        status,
        metadata: { event_id: r.event_id, user_external_id: r.user_external_id, click_id: r.click_id, visitor_id: r.visitor_id },
      },
    });
  });

  chain.purchases.forEach((p: ChainPurchaseItem, i: number) => {
    const status = eventStatus(chain, "purchase", p);
    const valueStr = p.value != null ? `${p.value} ${(p.currency ?? "").trim() || "USD"}` : "—";
    out.push({
      ts: p.created_at,
      type: "purchase",
      order: TYPE_ORDER.purchase,
      payload: {
        event_type: "purchase",
        event_subtype: chain.purchases.length > 1 && i > 0 ? "repeat" : undefined,
        id: `purch-${p.event_id}`,
        timestamp: p.created_at,
        title: chain.purchases.length > 1 && i > 0 ? `Purchase #${i + 1}` : "Purchase",
        description: valueStr,
        source: p.traffic_source ?? undefined,
        status,
        metadata: {
          event_id: p.event_id,
          external_event_id: p.external_event_id,
          user_external_id: p.user_external_id,
          value: p.value,
          currency: p.currency,
          click_id: p.click_id,
          visitor_id: p.visitor_id,
        },
      },
    });
  });

  return out;
}

/** Insert gap placeholders when visits exist but no registration, or registrations exist but no purchase. */
function insertGapPlaceholders(chain: ChainItem, sorted: Array<{ ts: string; type: TimelineEvent["event_type"]; order: number; payload: Omit<TimelineEvent, "delta_from_previous_ms"> }>): typeof sorted {
  const result = [...sorted];
  const hasVisit = chain.visits.length > 0;
  const hasReg = chain.registrations.length > 0;
  const hasPurch = chain.purchases.length > 0;
  const lastTs = sorted.length > 0 ? sorted[sorted.length - 1].ts : null;

  if (hasVisit && !hasReg && !hasPurch) {
    const afterVisit = chain.visits[chain.visits.length - 1]?.created_at ?? lastTs;
    result.push({
      ts: afterVisit,
      type: "gap",
      order: TYPE_ORDER.gap,
      payload: {
        event_type: "gap",
        id: "gap-no-reg",
        timestamp: afterVisit,
        title: "No registration detected",
        description: "Missing registration event in this chain.",
        status: "warning",
        metadata: { gap: "visits_without_registration" },
      },
    });
  }
  if (hasReg && !hasPurch) {
    const afterReg = chain.registrations[chain.registrations.length - 1]?.created_at ?? lastTs;
    result.push({
      ts: afterReg,
      type: "gap",
      order: TYPE_ORDER.gap,
      payload: {
        event_type: "gap",
        id: "gap-no-purchase",
        timestamp: afterReg,
        title: "No purchase detected",
        description: "Registration present but no purchase in this chain.",
        status: "warning",
        metadata: { gap: "registrations_without_purchase" },
      },
    });
  }

  result.sort((a, b) => {
    const t = a.ts.localeCompare(b.ts);
    if (t !== 0) return t;
    return a.order - b.order;
  });
  return result;
}

export function buildChainTimeline(chain: ChainItem): { events: TimelineEvent[]; summary: TimelineSummary } {
  const collected = collectEvents(chain);
  const sorted = collected.sort((a, b) => {
    const t = a.ts.localeCompare(b.ts);
    if (t !== 0) return t;
    return a.order - b.order;
  });
  const withGaps = insertGapPlaceholders(chain, sorted);

  let prevTs: number | null = null;
  const events: TimelineEvent[] = withGaps.map(({ payload }) => {
    const tsMs = new Date(payload.timestamp).getTime();
    const delta = prevTs != null ? tsMs - prevTs : null;
    prevTs = tsMs;
    return { ...payload, delta_from_previous_ms: delta };
  });

  const firstClick = chain.click.exists ? chain.click.created_at : null;
  const lastTs = events.length > 0 ? events[events.length - 1].timestamp : null;
  const firstReg = chain.registrations[0]?.created_at;
  const firstPurch = chain.purchases[0]?.created_at;
  const firstClickMs = firstClick ? new Date(firstClick).getTime() : null;
  const timeToReg = firstClickMs != null && firstReg ? new Date(firstReg).getTime() - firstClickMs : null;
  const timeToPurch = firstClickMs != null && firstPurch ? new Date(firstPurch).getTime() - firstClickMs : null;

  const summary: TimelineSummary = {
    total_events: events.filter((e) => e.event_type !== "gap").length,
    first_click_at: firstClick,
    last_event_at: lastTs,
    time_to_registration_ms: timeToReg,
    time_to_purchase_ms: timeToPurch,
    repeat_purchases_count: chain.summary.repeat_purchases_count,
  };

  return { events, summary };
}

export function formatTimeToEvent(ms: number): string {
  return formatDelta(ms).replace("+", "");
}
