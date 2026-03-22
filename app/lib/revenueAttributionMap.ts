/**
 * Revenue Attribution Map
 * Builds management-friendly revenue metrics per channel on top of existing
 * Assisted Attribution paths (does not change their behaviour).
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import {
  buildAssistedAttribution,
  type ConversionWithPath,
} from "./assistedAttribution";

export type RevenueChannelRow = {
  source: string;
  revenue_closed: number;
  revenue_assisted: number;
  purchases_closed: number;
  purchases_assisted: number;
  total_revenue_influence: number;
};

export type RevenueAttributionSummary = {
  total_closed_revenue: number;
  total_assisted_revenue: number;
  strongest_closer: string | null;
  strongest_influencer: string | null;
};

export type RevenueAttributionOptions = {
  project_id: string;
  days: number;
};

type ChannelAcc = {
  revenue_closed: number;
  revenue_assisted: number;
  purchases_closed: number;
  purchases_assisted: number;
};

const srcKey = (s: string | null | undefined): string =>
  s && s.trim() ? s : "direct";

function isPurchase(conv: ConversionWithPath["conversion"]): boolean {
  return (conv.event_name || "").toLowerCase() === "purchase";
}

function getValue(conv: ConversionWithPath["conversion"]): number {
  const v = Number(conv.value ?? 0);
  if (!Number.isFinite(v)) return 0;
  return v;
}

export async function buildRevenueAttributionMap(
  admin: SupabaseClient,
  options: RevenueAttributionOptions
): Promise<{ summary: RevenueAttributionSummary; channels: RevenueChannelRow[] }> {
  const { project_id, days } = options;

  const assisted = await buildAssistedAttribution(admin, {
    project_id,
    days,
  });

  const purchases = assisted.conversions.filter(({ conversion }) =>
    isPurchase(conversion)
  );

  if (!purchases.length) {
    return {
      summary: {
        total_closed_revenue: 0,
        total_assisted_revenue: 0,
        strongest_closer: null,
        strongest_influencer: null,
      },
      channels: [],
    };
  }

  const acc: Record<string, ChannelAcc> = {};

  const ensure = (key: string): ChannelAcc => {
    if (!acc[key]) {
      acc[key] = {
        revenue_closed: 0,
        revenue_assisted: 0,
        purchases_closed: 0,
        purchases_assisted: 0,
      };
    }
    return acc[key]!;
  };

  for (const { conversion, path } of purchases) {
    const value = getValue(conversion);
    if (value <= 0) continue;

    const last = path.last_touch;
    const lastSource = last ? srcKey(last.traffic_source) : null;

    if (lastSource) {
      const bucket = ensure(lastSource);
      bucket.revenue_closed += value;
      bucket.purchases_closed += 1;
    }

    if (path.assists && path.assists.length > 0) {
      const distinctAssistSources = Array.from(
        new Set(path.assists.map((v) => srcKey(v.traffic_source)))
      ).filter((s) => !lastSource || s !== lastSource);

      for (const s of distinctAssistSources) {
        const bucket = ensure(s);
        bucket.revenue_assisted += value;
        bucket.purchases_assisted += 1;
      }
    }
  }

  const channels: RevenueChannelRow[] = Object.entries(acc).map(
    ([source, agg]) => ({
      source,
      revenue_closed: agg.revenue_closed,
      revenue_assisted: agg.revenue_assisted,
      purchases_closed: agg.purchases_closed,
      purchases_assisted: agg.purchases_assisted,
      total_revenue_influence: agg.revenue_closed + agg.revenue_assisted,
    })
  );

  channels.sort(
    (a, b) => b.total_revenue_influence - a.total_revenue_influence
  );

  let total_closed_revenue = 0;
  let total_assisted_revenue = 0;
  let strongest_closer: string | null = null;
  let strongest_influencer: string | null = null;

  let maxClosed = 0;
  let maxAssisted = 0;

  for (const ch of channels) {
    total_closed_revenue += ch.revenue_closed;
    total_assisted_revenue += ch.revenue_assisted;

    if (ch.revenue_closed > maxClosed) {
      maxClosed = ch.revenue_closed;
      strongest_closer = ch.source;
    }
    if (ch.revenue_assisted > maxAssisted) {
      maxAssisted = ch.revenue_assisted;
      strongest_influencer = ch.source;
    }
  }

  const summary: RevenueAttributionSummary = {
    total_closed_revenue,
    total_assisted_revenue,
    strongest_closer,
    strongest_influencer,
  };

  return { summary, channels };
}

