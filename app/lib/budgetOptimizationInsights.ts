/**
 * Attribution Debugger v11: Budget Optimization Insights
 * Channel-level metrics and insights from journey attribution data.
 * Works without spend (graceful fallback).
 */

import type { AttributionModelsResult } from "./attributionModels";

const UNKNOWN = "unknown";

function normalizeSource(source: string | null | undefined): string {
  const s = (source ?? "").trim().toLowerCase();
  if (!s) return UNKNOWN;
  if (s.includes("facebook") || s === "fb") return "meta";
  if (s.includes("google") || s === "gclid") return "google";
  if (s.includes("tiktok") || s === "tt") return "tiktok";
  if (s.includes("yandex") || s === "yclid") return "yandex";
  return s;
}

export type JourneyForBudget = {
  attribution_models: AttributionModelsResult;
  touchpoints: Array<{ type: string; source: string | null }>;
  summary: { revenue_total: number; purchases_count: number };
};

export type ChannelMetrics = {
  channel: string;
  revenue_first_touch: number;
  revenue_last_touch: number;
  revenue_linear: number;
  revenue_position_based: number;
  revenue_data_driven: number;
  purchases_count: number;
  registrations_count: number;
  clicks_count: number;
  visits_count: number;
  spend: number | null;
  roas_first_touch: number | null;
  roas_last_touch: number | null;
  roas_data_driven: number | null;
};

export type BudgetInsight = {
  type: string;
  severity: "high" | "medium" | "low";
  channel: string;
  title: string;
  description: string;
  evidence: Record<string, number | string>;
  recommended_action: string;
};

export type PortfolioSummary = {
  top_growth_candidate: string | null;
  top_overvalued_channel: string | null;
  top_underattributed_channel: string | null;
  top_closing_channel: string | null;
  top_first_touch_channel: string | null;
  total_revenue: number;
  has_spend: boolean;
};

function getChannelsFromAttribution(am: AttributionModelsResult): Set<string> {
  const set = new Set<string>();
  Object.values(am).forEach((rec) => Object.keys(rec).forEach((k) => set.add(k)));
  return set;
}

export function buildChannelAttributionMetrics(
  journeys: JourneyForBudget[],
  spendBySource: Record<string, number> | null = null
): ChannelMetrics[] {
  const byChannel = new Map<
    string,
    {
      revenue_first_touch: number;
      revenue_last_touch: number;
      revenue_linear: number;
      revenue_position_based: number;
      revenue_data_driven: number;
      purchases_count: number;
      registrations_count: number;
      clicks_count: number;
      visits_count: number;
    }
  >();

  function get(ch: string) {
    if (!byChannel.has(ch)) {
      byChannel.set(ch, {
        revenue_first_touch: 0,
        revenue_last_touch: 0,
        revenue_linear: 0,
        revenue_position_based: 0,
        revenue_data_driven: 0,
        purchases_count: 0,
        registrations_count: 0,
        clicks_count: 0,
        visits_count: 0,
      });
    }
    return byChannel.get(ch)!;
  }

  journeys.forEach((j) => {
    const am = j.attribution_models;
    const channelsInJourney = getChannelsFromAttribution(am);
    channelsInJourney.forEach((ch) => {
      const m = get(ch);
      m.revenue_first_touch += am.first_touch[ch] ?? 0;
      m.revenue_last_touch += am.last_touch[ch] ?? 0;
      m.revenue_linear += am.linear[ch] ?? 0;
      m.revenue_position_based += am.position_based[ch] ?? 0;
      m.revenue_data_driven += am.data_driven[ch] ?? 0;
      if (j.summary.purchases_count > 0) m.purchases_count += j.summary.purchases_count;
    });
    j.touchpoints.forEach((tp) => {
      const ch = normalizeSource(tp.source);
      const m = get(ch);
      if (tp.type === "click") m.clicks_count += 1;
      if (tp.type === "visit") m.visits_count += 1;
      if (tp.type === "registration") m.registrations_count += 1;
    });
  });

  const totalRevenue = journeys.reduce((s, j) => s + j.summary.revenue_total, 0);
  const channels = Array.from(byChannel.entries())
    .map(([channel, m]) => {
      const spend = spendBySource?.[channel] ?? null;
      return {
        channel,
        ...m,
        spend: spend ?? null,
        roas_first_touch: spend != null && spend > 0 ? m.revenue_first_touch / spend : null,
        roas_last_touch: spend != null && spend > 0 ? m.revenue_last_touch / spend : null,
        roas_data_driven: spend != null && spend > 0 ? m.revenue_data_driven / spend : null,
      };
    })
    .sort((a, b) => b.revenue_data_driven - a.revenue_data_driven);

  return channels;
}

export function buildBudgetOptimizationInsights(
  metrics: ChannelMetrics[],
  totalRevenue: number
): BudgetInsight[] {
  const insights: BudgetInsight[] = [];
  const hasSpend = metrics.some((m) => m.spend != null && m.spend > 0);

  metrics.forEach((m) => {
    const lastTouch = m.revenue_last_touch;
    const dataDriven = m.revenue_data_driven;
    const firstTouch = m.revenue_first_touch;
    const linear = m.revenue_linear;

    if (lastTouch > 0 && dataDriven > lastTouch * 1.3) {
      const diffPct = Math.round(((dataDriven - lastTouch) / lastTouch) * 100);
      insights.push({
        type: "under_attributed_channel",
        severity: diffPct > 50 ? "high" : "medium",
        channel: m.channel,
        title: `${m.channel} may be undervalued in last-click reporting`,
        description: `${m.channel} contributes more revenue in multi-touch attribution than in last-touch.`,
        evidence: {
          last_touch_revenue: Math.round(lastTouch * 100) / 100,
          data_driven_revenue: Math.round(dataDriven * 100) / 100,
          difference_percent: diffPct,
        },
        recommended_action:
          "Review budget allocation using multi-touch models before reducing spend on this channel.",
      });
    }

    if (dataDriven > 0 && lastTouch > dataDriven * 1.3) {
      const diffPct = Math.round(((lastTouch - dataDriven) / dataDriven) * 100);
      insights.push({
        type: "over_attributed_channel",
        severity: diffPct > 50 ? "high" : "medium",
        channel: m.channel,
        title: `${m.channel} may be overvalued by last-click attribution`,
        description: `${m.channel} gets more credit in last-touch than in multi-touch models.`,
        evidence: {
          last_touch_revenue: Math.round(lastTouch * 100) / 100,
          data_driven_revenue: Math.round(dataDriven * 100) / 100,
          difference_percent: diffPct,
        },
        recommended_action: "Consider multi-touch attribution before increasing budget on this channel.",
      });
    }

    if (totalRevenue > 0 && firstTouch >= totalRevenue * 0.25 && m.clicks_count >= 2) {
      insights.push({
        type: "strong_first_touch_channel",
        severity: "medium",
        channel: m.channel,
        title: `${m.channel} is effective at starting customer journeys`,
        description: `${m.channel} frequently appears as first touch in converting journeys.`,
        evidence: {
          first_touch_revenue: Math.round(firstTouch * 100) / 100,
          revenue_share_percent: Math.round((firstTouch / totalRevenue) * 100),
        },
        recommended_action: "Awareness and top-of-funnel value; consider in full-funnel strategy.",
      });
    }

    if (totalRevenue > 0 && lastTouch >= totalRevenue * 0.25 && m.clicks_count >= 2) {
      insights.push({
        type: "strong_closing_channel",
        severity: "medium",
        channel: m.channel,
        title: `${m.channel} is effective at closing conversions`,
        description: `${m.channel} frequently appears as last touch before purchase.`,
        evidence: {
          last_touch_revenue: Math.round(lastTouch * 100) / 100,
          revenue_share_percent: Math.round((lastTouch / totalRevenue) * 100),
        },
        recommended_action: "Strong closer; ensure conversion tracking is correct.",
      });
    }

    if (m.clicks_count >= 2 && m.revenue_data_driven < totalRevenue * 0.05 && totalRevenue > 0) {
      insights.push({
        type: "weak_channel",
        severity: "low",
        channel: m.channel,
        title: `${m.channel} currently shows weak conversion contribution`,
        description: `${m.channel} has clicks/visits but limited attributed revenue.`,
        evidence: {
          clicks_count: m.clicks_count,
          data_driven_revenue: Math.round(m.revenue_data_driven * 100) / 100,
          revenue_share_percent: Math.round((m.revenue_data_driven / totalRevenue) * 100),
        },
        recommended_action: "Investigate traffic quality or consider reallocating budget.",
      });
    }

    if (hasSpend && m.spend != null && m.spend > 0) {
      const roas = m.revenue_data_driven / m.spend;
      const revShare = totalRevenue > 0 ? m.revenue_data_driven / totalRevenue : 0;
      if (roas >= 2 && revShare >= 0.15 && lastTouch <= dataDriven * 1.2) {
        insights.push({
          type: "scaling_opportunity",
          severity: "high",
          channel: m.channel,
          title: `${m.channel} may be a candidate for budget expansion`,
          description: `${m.channel} shows strong ROAS and multi-touch contribution.`,
          evidence: {
            roas_data_driven: Math.round(roas * 100) / 100,
            revenue_share_percent: Math.round(revShare * 100),
          },
          recommended_action: "Consider increasing budget on this channel; monitor incrementality.",
        });
      }
      if (m.spend > 0 && m.revenue_data_driven < m.spend * 0.5) {
        insights.push({
          type: "budget_waste_signal",
          severity: m.spend > totalRevenue * 0.2 ? "high" : "medium",
          channel: m.channel,
          title: `${m.channel} may be overspending relative to contribution`,
          description: `Spend is high but attributed revenue is low.`,
          evidence: {
            spend: m.spend,
            data_driven_revenue: Math.round(m.revenue_data_driven * 100) / 100,
            roas: Math.round((m.revenue_data_driven / m.spend) * 100) / 100,
          },
          recommended_action: "Review spend and consider reallocation or creative/audience changes.",
        });
      }
    }
  });

  return insights.sort((a, b) => {
    const sev: Record<string, number> = { high: 0, medium: 1, low: 2 };
    return (sev[a.severity] ?? 1) - (sev[b.severity] ?? 1);
  });
}

export function buildPortfolioSummary(
  metrics: ChannelMetrics[],
  insights: BudgetInsight[]
): PortfolioSummary {
  const totalRevenue = metrics.reduce((s, m) => s + m.revenue_data_driven, 0);
  const hasSpend = metrics.some((m) => m.spend != null && m.spend > 0);

  const topFirst = metrics.length > 0
    ? metrics.reduce((best, m) => (m.revenue_first_touch > best.revenue_first_touch ? m : best), metrics[0]!)
    : null;
  const topLast = metrics.length > 0
    ? metrics.reduce((best, m) => (m.revenue_last_touch > best.revenue_last_touch ? m : best), metrics[0]!)
    : null;
  const topDataDriven = metrics.length > 0
    ? metrics.reduce((best, m) => (m.revenue_data_driven > best.revenue_data_driven ? m : best), metrics[0]!)
    : null;

  const overvalued = insights.find((i) => i.type === "over_attributed_channel");
  const underattributed = insights.find((i) => i.type === "under_attributed_channel");
  const growth = insights.find((i) => i.type === "scaling_opportunity");

  return {
    top_growth_candidate: growth?.channel ?? topDataDriven?.channel ?? null,
    top_overvalued_channel: overvalued?.channel ?? null,
    top_underattributed_channel: underattributed?.channel ?? null,
    top_closing_channel: topLast?.channel ?? null,
    top_first_touch_channel: topFirst?.channel ?? null,
    total_revenue: Math.round(totalRevenue * 100) / 100,
    has_spend: hasSpend,
  };
}

export function buildPriorityActions(
  insights: BudgetInsight[],
  summary: PortfolioSummary
): string[] {
  const actions: string[] = [];

  if (!summary.has_spend) {
    actions.push("Spend data is unavailable; recommendations are based on attribution contribution only.");
  }

  const scaling = insights.filter((i) => i.type === "scaling_opportunity");
  scaling.slice(0, 2).forEach((i) => {
    actions.push(`Consider increasing budget on ${i.channel}; it performs well across multi-touch models.`);
  });

  const under = insights.filter((i) => i.type === "under_attributed_channel");
  under.slice(0, 2).forEach((i) => {
    actions.push(`Review ${i.channel} spend before reducing it; last-click may understate its role.`);
  });

  const over = insights.filter((i) => i.type === "over_attributed_channel");
  over.slice(0, 1).forEach((i) => {
    actions.push(`Re-check ${i.channel} — high last-touch attribution but lower multi-touch contribution.`);
  });

  const weak = insights.filter((i) => i.type === "weak_channel");
  weak.slice(0, 1).forEach((i) => {
    actions.push(`Investigate ${i.channel} traffic quality; it drives visits but limited purchase contribution.`);
  });

  const waste = insights.filter((i) => i.type === "budget_waste_signal");
  waste.slice(0, 1).forEach((i) => {
    actions.push(`Channels with high spend but weak multi-touch contribution may need reallocation.`);
  });

  return actions.slice(0, 6);
}

export type BudgetOptimizationResult = {
  channel_metrics: ChannelMetrics[];
  insights: BudgetInsight[];
  portfolio_summary: PortfolioSummary;
  priority_actions: string[];
};

export function buildBudgetOptimization(
  journeys: JourneyForBudget[],
  spendBySource: Record<string, number> | null = null
): BudgetOptimizationResult {
  const channel_metrics = buildChannelAttributionMetrics(journeys, spendBySource);
  const totalRevenue = journeys.reduce((s, j) => s + j.summary.revenue_total, 0);
  const insights = buildBudgetOptimizationInsights(channel_metrics, totalRevenue);
  const portfolio_summary = buildPortfolioSummary(channel_metrics, insights);
  const priority_actions = buildPriorityActions(insights, portfolio_summary);
  return {
    channel_metrics,
    insights,
    portfolio_summary,
    priority_actions,
  };
}
