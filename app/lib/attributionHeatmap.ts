/**
 * Attribution Heatmap
 * Aggregates how often each traffic_source appears as first / assist / last touch
 * in purchase paths, reusing Assisted Attribution logic.
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import {
  buildAssistedAttribution,
  type ConversionWithPath,
} from "./assistedAttribution";

export type HeatmapChannelRow = {
  source: string;
  first_touch: number;
  assist_touch: number;
  last_touch: number;
};

export type AttributionHeatmapOptions = {
  project_id: string;
  days: number;
};

const srcKey = (s: string | null | undefined): string =>
  s && s.trim() ? s : "direct";

function isPurchase(conv: ConversionWithPath["conversion"]): boolean {
  return (conv.event_name || "").toLowerCase() === "purchase";
}

export async function buildAttributionHeatmap(
  admin: SupabaseClient,
  options: AttributionHeatmapOptions
): Promise<HeatmapChannelRow[]> {
  const { project_id, days } = options;

  const assisted = await buildAssistedAttribution(admin, {
    project_id,
    days,
  });

  const purchases = assisted.conversions.filter(({ conversion }) =>
    isPurchase(conversion)
  );

  const acc: Record<
    string,
    { first_touch: number; assist_touch: number; last_touch: number }
  > = {};

  const ensure = (key: string) => {
    if (!acc[key]) {
      acc[key] = { first_touch: 0, assist_touch: 0, last_touch: 0 };
    }
    return acc[key]!;
  };

  for (const { path } of purchases) {
    if (path.first_touch) {
      const k = srcKey(path.first_touch.traffic_source);
      ensure(k).first_touch += 1;
    }

    for (const a of path.assists) {
      const k = srcKey(a.traffic_source);
      ensure(k).assist_touch += 1;
    }

    if (path.last_touch) {
      const k = srcKey(path.last_touch.traffic_source);
      ensure(k).last_touch += 1;
    }
  }

  const rows: HeatmapChannelRow[] = Object.entries(acc).map(
    ([source, counts]) => ({
      source,
      first_touch: counts.first_touch,
      assist_touch: counts.assist_touch,
      last_touch: counts.last_touch,
    })
  );

  rows.sort(
    (a, b) =>
      b.first_touch + b.assist_touch + b.last_touch -
      (a.first_touch + a.assist_touch + a.last_touch)
  );

  return rows;
}

