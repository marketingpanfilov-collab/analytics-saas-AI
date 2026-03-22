/**
 * Attribution Debugger v6: Automatic Anomaly Detection
 * Compares current window (e.g. last 24h) vs baseline (e.g. previous 7 days).
 * No new tables — aggregated queries only.
 */

import type { SupabaseClient } from "@supabase/supabase-js";

export type AnomalySeverity = "high" | "medium" | "low";

export type AttributionAnomaly = {
  type: string;
  severity: AnomalySeverity;
  title: string;
  description: string;
  current_value: number | null;
  baseline_value: number | null;
  change: number | null; // percent change
  detected_at: string;
  suggested_action?: string;
};

export type WindowMetrics = {
  total_clicks: number;
  visits_with_click_id: number;
  total_visits: number;
  total_registrations: number;
  regs_with_click_id: number;
  total_purchases: number;
  purch_with_click_id: number;
  purch_with_value_currency: number;
  conversions_with_click_id_rate: number; // (regs_with_click_id + purch_with_click_id) / (regs + purch)
  click_to_visit_rate: number;
  visit_to_registration_rate: number;
  registration_to_purchase_rate: number;
  orphan_visits_count: number;
  conversion_missing_click_id_rate: number;
  purchase_missing_value_rate: number;
  traffic_by_source: Record<string, number>;
};

const CLICK_ID_BATCH = 500;
const MAX_CLICK_IDS = 5000;

function toIso(d: Date): string {
  return d.toISOString();
}

async function getClickIdsInWindow(
  admin: SupabaseClient,
  project_id: string,
  start: string,
  end: string
): Promise<string[]> {
  const all: string[] = [];
  let offset = 0;
  const pageSize = 1000;
  while (all.length < MAX_CLICK_IDS) {
    const { data } = await admin
      .from("redirect_click_events")
      .select("bq_click_id")
      .eq("project_id", project_id)
      .gte("created_at", start)
      .lte("created_at", end)
      .order("created_at", { ascending: true })
      .range(offset, offset + pageSize - 1);
    const ids = (data ?? []).map((r: { bq_click_id: string }) => r.bq_click_id).filter(Boolean);
    if (ids.length === 0) break;
    all.push(...ids);
    if (ids.length < pageSize) break;
    offset += pageSize;
  }
  return all.slice(0, MAX_CLICK_IDS);
}

async function countVisitsWithClickIds(
  admin: SupabaseClient,
  project_id: string,
  clickIds: string[],
  start: string,
  end: string
): Promise<number> {
  if (clickIds.length === 0) return 0;
  let total = 0;
  for (let i = 0; i < clickIds.length; i += CLICK_ID_BATCH) {
    const chunk = clickIds.slice(i, i + CLICK_ID_BATCH);
    const { count } = await admin
      .from("visit_source_events")
      .select("id", { count: "exact", head: true })
      .eq("site_id", project_id)
      .gte("created_at", start)
      .lte("created_at", end)
      .in("click_id", chunk);
    total += count ?? 0;
  }
  return total;
}

export async function getWindowMetrics(
  admin: SupabaseClient,
  project_id: string,
  startIso: string,
  endIso: string
): Promise<WindowMetrics> {
  const [
    { count: total_clicks },
    { count: total_visits },
    { count: total_registrations },
    { count: regs_with_click_id },
    { count: total_purchases },
    { count: purch_with_click_id },
    { count: purch_with_value_currency },
    { data: trafficRows },
  ] = await Promise.all([
    admin
      .from("redirect_click_events")
      .select("id", { count: "exact", head: true })
      .eq("project_id", project_id)
      .gte("created_at", startIso)
      .lte("created_at", endIso),
    admin
      .from("visit_source_events")
      .select("id", { count: "exact", head: true })
      .eq("site_id", project_id)
      .gte("created_at", startIso)
      .lte("created_at", endIso),
    admin
      .from("conversion_events")
      .select("id", { count: "exact", head: true })
      .eq("project_id", project_id)
      .eq("event_name", "registration")
      .gte("created_at", startIso)
      .lte("created_at", endIso),
    admin
      .from("conversion_events")
      .select("id", { count: "exact", head: true })
      .eq("project_id", project_id)
      .eq("event_name", "registration")
      .not("click_id", "is", null)
      .gte("created_at", startIso)
      .lte("created_at", endIso),
    admin
      .from("conversion_events")
      .select("id", { count: "exact", head: true })
      .eq("project_id", project_id)
      .eq("event_name", "purchase")
      .gte("created_at", startIso)
      .lte("created_at", endIso),
    admin
      .from("conversion_events")
      .select("id", { count: "exact", head: true })
      .eq("project_id", project_id)
      .eq("event_name", "purchase")
      .not("click_id", "is", null)
      .gte("created_at", startIso)
      .lte("created_at", endIso),
    admin
      .from("conversion_events")
      .select("id", { count: "exact", head: true })
      .eq("project_id", project_id)
      .eq("event_name", "purchase")
      .not("value", "is", null)
      .not("currency", "is", null)
      .gte("created_at", startIso)
      .lte("created_at", endIso),
    admin
      .from("redirect_click_events")
      .select("traffic_source")
      .eq("project_id", project_id)
      .gte("created_at", startIso)
      .lte("created_at", endIso),
  ]);

  const clickIdsList = await getClickIdsInWindow(admin, project_id, startIso, endIso);
  const visits_with_click_id = await countVisitsWithClickIds(
    admin,
    project_id,
    clickIdsList,
    startIso,
    endIso
  );

  const tc = total_clicks ?? 0;
  const tv = total_visits ?? 0;
  const tr = total_registrations ?? 0;
  const tp = total_purchases ?? 0;
  const rwc = regs_with_click_id ?? 0;
  const pwc = purch_with_click_id ?? 0;
  const pvc = purch_with_value_currency ?? 0;

  const click_to_visit_rate = tc > 0 ? visits_with_click_id / tc : 0;
  const visit_to_registration_rate = tv > 0 ? tr / tv : 0;
  const registration_to_purchase_rate = tr > 0 ? tp / tr : 0;
  const orphan_visits_count = Math.max(0, tv - visits_with_click_id);
  const total_conv = tr + tp;
  const conv_with_click = rwc + pwc;
  const conversions_with_click_id_rate = total_conv > 0 ? conv_with_click / total_conv : 0;
  const conversion_missing_click_id_rate = total_conv > 0 ? 1 - conv_with_click / total_conv : 0;
  const purchase_missing_value_rate = tp > 0 ? 1 - pvc / tp : 0;

  const traffic_by_source: Record<string, number> = {};
  (trafficRows ?? []).forEach((r: { traffic_source: string | null }) => {
    const s = r.traffic_source ?? "unknown";
    traffic_by_source[s] = (traffic_by_source[s] ?? 0) + 1;
  });

  return {
    total_clicks: tc,
    visits_with_click_id,
    total_visits: tv,
    total_registrations: tr,
    regs_with_click_id: rwc,
    total_purchases: tp,
    purch_with_click_id: pwc,
    purch_with_value_currency: pvc,
    conversions_with_click_id_rate,
    click_to_visit_rate,
    visit_to_registration_rate,
    registration_to_purchase_rate,
    orphan_visits_count,
    conversion_missing_click_id_rate,
    purchase_missing_value_rate,
    traffic_by_source,
  };
}

function pctChange(current: number, baseline: number): number | null {
  if (baseline === 0) return current > 0 ? 100 : null;
  return Math.round(((current - baseline) / baseline) * 100);
}

const MAJOR_SOURCES = ["meta", "google", "tiktok", "yandex"];

function detectAnomalies(
  current: WindowMetrics,
  baseline: WindowMetrics,
  detected_at: string
): AttributionAnomaly[] {
  const anomalies: AttributionAnomaly[] = [];

  // 1. Drop in click → visit rate
  if (baseline.total_clicks > 0 && current.total_clicks > 0) {
    const curRate = current.click_to_visit_rate;
    const baseRate = baseline.click_to_visit_rate;
    const change = baseRate > 0 ? pctChange(curRate, baseRate) : null;
    if (baseRate > 0 && (curRate < baseRate * 0.6 || (change != null && change < -30))) {
      anomalies.push({
        type: "click_to_visit_drop",
        severity: "high",
        title: "Click to visit rate dropped",
        description:
          "The share of clicks that led to a tracked visit decreased significantly compared to the previous period.",
        current_value: Math.round(curRate * 100) / 100,
        baseline_value: Math.round(baseRate * 100) / 100,
        change,
        detected_at,
        suggested_action: "Check if pixel is loading correctly on landing pages.",
      });
    }
  }

  // 2. Drop in visit → registration rate
  if (baseline.total_visits > 0 && current.total_visits > 0) {
    const curRate = current.visit_to_registration_rate;
    const baseRate = baseline.visit_to_registration_rate;
    const change = baseRate > 0 ? pctChange(curRate, baseRate) : null;
    if (baseRate > 0 && change != null && change < -40) {
      anomalies.push({
        type: "visit_to_registration_drop",
        severity: "high",
        title: "Visit to registration rate dropped",
        description:
          "Visit to registration conversion rate decreased significantly compared to the previous period.",
        current_value: Math.round(curRate * 100) / 100,
        baseline_value: Math.round(baseRate * 100) / 100,
        change,
        detected_at,
        suggested_action: "Verify registration tracking and landing page flow.",
      });
    }
  }

  // 3. Drop in registration → purchase rate
  if (baseline.total_registrations > 0 && current.total_registrations > 0) {
    const curRate = current.registration_to_purchase_rate;
    const baseRate = baseline.registration_to_purchase_rate;
    const change = baseRate > 0 ? pctChange(curRate, baseRate) : null;
    if (baseRate > 0 && change != null && change < -40) {
      anomalies.push({
        type: "registration_to_purchase_drop",
        severity: "medium",
        title: "Registration to purchase rate dropped",
        description:
          "Registration to purchase conversion rate decreased significantly compared to the previous period.",
        current_value: Math.round(curRate * 100) / 100,
        baseline_value: Math.round(baseRate * 100) / 100,
        change,
        detected_at,
        suggested_action: "Check purchase event implementation and checkout flow.",
      });
    }
  }

  // 4. Orphan spike
  const curOrphan = current.orphan_visits_count;
  const baseOrphan = baseline.orphan_visits_count;
  if (baseOrphan > 0 && curOrphan >= baseOrphan * 2) {
    const change = pctChange(curOrphan, baseOrphan);
    anomalies.push({
      type: "orphan_spike",
      severity: "high",
      title: "Sudden spike in orphan visits",
      description:
        "The number of visits that could not be linked to a click more than doubled compared to the baseline.",
      current_value: curOrphan,
      baseline_value: baseOrphan,
      change,
      detected_at,
      suggested_action: "Ensure redirect links pass click_id and landing page pixel receives it.",
    });
  } else if (baseOrphan === 0 && curOrphan > 0) {
    anomalies.push({
      type: "orphan_spike",
      severity: "medium",
      title: "Orphan visits appeared",
      description: "Visits without a matching click started appearing.",
      current_value: curOrphan,
      baseline_value: 0,
      change: 100,
      detected_at,
      suggested_action: "Verify that click_id is passed from redirect to landing page.",
    });
  }

  // 5. Missing click_id in conversions
  const curMissing = current.conversion_missing_click_id_rate;
  const baseMissing = baseline.conversion_missing_click_id_rate;
  if (curMissing > 0.3 && baseMissing < 0.1) {
    anomalies.push({
      type: "missing_click_id_conversions",
      severity: "high",
      title: "Conversions missing click_id",
      description:
        "A large share of conversion events no longer have click_id, while baseline had few missing.",
      current_value: Math.round(curMissing * 100),
      baseline_value: Math.round(baseMissing * 100),
      change: pctChange(curMissing, baseMissing),
      detected_at,
      suggested_action: "Verify that click_id (bqcid) is passed to conversion events.",
    });
  }

  // 6. Missing purchase value/currency
  if (current.total_purchases > 0 && current.purchase_missing_value_rate > 0.2) {
    anomalies.push({
      type: "missing_purchase_value",
      severity: "high",
      title: "Purchase events missing revenue data",
      description:
        "More than 20% of purchase events are missing value or currency.",
      current_value: Math.round(current.purchase_missing_value_rate * 100),
      baseline_value: Math.round(baseline.purchase_missing_value_rate * 100),
      change: pctChange(
        current.purchase_missing_value_rate,
        baseline.purchase_missing_value_rate
      ),
      detected_at,
      suggested_action: "Ensure purchase events include value and currency.",
    });
  }

  // 7. Traffic source disappearance
  for (const src of MAJOR_SOURCES) {
    const baseVol = Object.entries(baseline.traffic_by_source).reduce(
      (s, [k, v]) => s + (k.toLowerCase().includes(src) ? v : 0),
      0
    );
    const curVol = Object.entries(current.traffic_by_source).reduce(
      (s, [k, v]) => s + (k.toLowerCase().includes(src) ? v : 0),
      0
    );
    if (baseVol >= 10 && curVol <= 1) {
      anomalies.push({
        type: "traffic_source_disappearance",
        severity: "medium",
        title: `Traffic source "${src}" disappeared`,
        description: `Traffic from ${src} had significant volume in the baseline but almost none in the current window.`,
        current_value: curVol,
        baseline_value: baseVol,
        change: baseVol > 0 ? pctChange(curVol, baseVol) : null,
        detected_at,
        suggested_action: "Check tracking links and UTM parameters for this source.",
      });
    }
  }

  // 8. Match quality degradation (proxy: conversions with click_id rate)
  const curMatch = current.conversions_with_click_id_rate;
  const baseMatch = baseline.conversions_with_click_id_rate;
  const change = baseMatch > 0 ? pctChange(curMatch, baseMatch) : null;
  if (baseMatch > 0 && change != null && change < -30) {
    anomalies.push({
      type: "match_quality_degradation",
      severity: "medium",
      title: "Attribution match quality dropped",
      description:
        "The share of conversions linked by click_id decreased significantly.",
      current_value: Math.round(curMatch * 100) / 100,
      baseline_value: Math.round(baseMatch * 100) / 100,
      change,
      detected_at,
      suggested_action: "Link conversions using click_id instead of only user_external_id.",
    });
  }

  return anomalies;
}

export type AttributionAnomaliesOptions = {
  project_id: string;
  /** Current window in hours (default 24) */
  current_window_hours?: number;
  /** Baseline window in days (default 7) */
  baseline_days?: number;
};

export async function getAttributionAnomalies(
  admin: SupabaseClient,
  options: AttributionAnomaliesOptions
): Promise<AttributionAnomaly[]> {
  const {
    project_id,
    current_window_hours = 24,
    baseline_days = 7,
  } = options;

  const now = new Date();
  const currentEnd = new Date(now);
  const currentStart = new Date(now.getTime() - current_window_hours * 60 * 60 * 1000);
  const baselineEnd = new Date(currentStart);
  const baselineStart = new Date(
    baselineEnd.getTime() - baseline_days * 24 * 60 * 60 * 1000
  );

  const [current, baseline] = await Promise.all([
    getWindowMetrics(admin, project_id, toIso(currentStart), toIso(currentEnd)),
    getWindowMetrics(admin, project_id, toIso(baselineStart), toIso(baselineEnd)),
  ]);

  const detected_at = toIso(now);
  return detectAnomalies(current, baseline, detected_at);
}
