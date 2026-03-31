/**
 * Attribution Flow
 * Builds most frequent paths `traffic_source → ... → purchase` for purchases only.
 * Reuses Assisted Attribution paths to avoid duplication.
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import {
  buildAssistedAttribution,
  type ConversionWithPath,
} from "./assistedAttribution";

export type AttributionFlowPath = {
  path: string[];
  conversions: number;
  percent: number;
};

export type AttributionFlowOptions = {
  project_id: string;
  days?: number;
  start?: string | null;
  end?: string | null;
  sources?: string[] | null;
  account_ids?: string[] | null;
  limit?: number;
};

const srcKey = (s: string | null | undefined): string =>
  s && s.trim() ? s : "direct";

function isPurchase(conv: ConversionWithPath["conversion"]): boolean {
  return (conv.event_name || "").toLowerCase() === "purchase";
}

export async function buildAttributionFlow(
  admin: SupabaseClient,
  options: AttributionFlowOptions
): Promise<AttributionFlowPath[]> {
  const { project_id, days, limit = 5 } = options;

  const assisted = await buildAssistedAttribution(admin, {
    project_id,
    days,
    start: options.start ?? null,
    end: options.end ?? null,
    sources: options.sources ?? null,
    account_ids: options.account_ids ?? null,
  });

  const purchases = assisted.conversions.filter(({ conversion }) =>
    isPurchase(conversion)
  );

  if (!purchases.length) return [];

  const agg = new Map<string, { path: string[]; conversions: number }>();

  for (const { path, conversion } of purchases) {
    const ordered = [...path.visits].sort(
      (a, b) =>
        new Date(a.created_at).getTime() - new Date(b.created_at).getTime()
    );
    const sources = ordered.map((v) => srcKey(v.traffic_source));
    const fullPath = [...sources, "purchase"];
    const key = fullPath.join(">");
    const cur = agg.get(key) ?? { path: fullPath, conversions: 0 };
    cur.conversions += 1;
    agg.set(key, cur);
  }

  const total = Array.from(agg.values()).reduce(
    (sum, v) => sum + v.conversions,
    0
  );

  const paths: AttributionFlowPath[] = Array.from(agg.values())
    .map((v) => ({
      path: v.path,
      conversions: v.conversions,
      percent: total > 0 ? Math.round((v.conversions / total) * 100) : 0,
    }))
    .sort((a, b) => b.conversions - a.conversions)
    .slice(0, limit);

  return paths;
}

