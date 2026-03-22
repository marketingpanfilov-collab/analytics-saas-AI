/**
 * BoardIQ: Top Attribution Paths
 * Builds most frequent user paths to conversion (source → source → … → Registration/Purchase).
 * Uses visit_source_events + conversion_events; normalizes and collapses sequential sources.
 */

import type { SupabaseClient } from "@supabase/supabase-js";

const SOURCE_LABELS: Record<string, string> = {
  meta: "Meta Ads",
  google: "Google Ads",
  tiktok: "TikTok Ads",
  yandex: "Яндекс Директ",
  direct: "Прямой переход",
  organic_search: "Органический поиск",
  referral: "Реферальный переход",
  organic_social: "Органический соц.",
  paid: "Платный трафик",
  unknown: "Неизвестный источник",
};

/**
 * Normalize raw traffic_source / source to UI-friendly label.
 */
export function normalizePathSource(source: string | null | undefined): string {
  if (source == null || String(source).trim() === "") return "Неизвестный источник";
  const key = String(source).trim().toLowerCase();
  return SOURCE_LABELS[key] ?? source;
}

/**
 * Collapse consecutive identical labels into one.
 * Example: ["Meta Ads", "Meta Ads", "Прямой переход"] → ["Meta Ads", "Прямой переход"]
 */
export function collapseSequentialSources(labels: string[]): string[] {
  if (labels.length <= 1) return labels;
  const out: string[] = [];
  for (const label of labels) {
    if (out.length === 0 || out[out.length - 1] !== label) out.push(label);
  }
  return out;
}

export type PathRow = {
  path_label: string;
  conversions_count: number;
  purchases_count: number;
  registrations_count: number;
  revenue_total: number;
};

type ConversionRow = {
  id: string;
  event_name: string;
  visitor_id: string | null;
  created_at: string;
  value?: number | null;
};

type VisitRow = {
  visitor_id: string;
  traffic_source: string | null;
  source_classification?: string | null;
  created_at: string;
};

export type TopAttributionPathsOptions = {
  project_id: string;
  days: number;
  limit?: number;
};

function sinceIso(days: number): string {
  const d = new Date();
  d.setDate(d.getDate() - days);
  return d.toISOString();
}

/**
 * Build path string from visits (before conversion) + conversion type.
 * Visits must be sorted by created_at ASC.
 */
function buildPathString(
  visitSources: string[],
  conversionType: "registration" | "purchase"
): string {
  const normalized = visitSources.map((s) => normalizePathSource(s));
  const collapsed = collapseSequentialSources(normalized);
  const lastStep = conversionType === "purchase" ? "Покупка" : "Регистрация";
  const parts = collapsed.length > 0 ? [...collapsed, lastStep] : [lastStep];
  return parts.join(" → ");
}

/**
 * Fetch conversions and visits in bulk; build paths; aggregate by path_label; return top N.
 */
export async function buildTopAttributionPaths(
  admin: SupabaseClient,
  options: TopAttributionPathsOptions
): Promise<PathRow[]> {
  const { project_id, days, limit = 5 } = options;
  const since = sinceIso(days);

  const [convRes, visitsRes] = await Promise.all([
    admin
      .from("conversion_events")
      .select("id, event_name, visitor_id, created_at, value")
      .eq("project_id", project_id)
      .in("event_name", ["registration", "purchase"])
      .gte("created_at", since),
    admin
      .from("visit_source_events")
      .select("visitor_id, traffic_source, source_classification, created_at")
      .eq("site_id", project_id)
      .gte("created_at", since),
  ]);

  const conversions = (convRes.data ?? []) as ConversionRow[];
  const visits = (visitsRes.data ?? []) as VisitRow[];

  const visitsByVisitor = new Map<string, VisitRow[]>();
  for (const v of visits) {
    if (!v.visitor_id) continue;
    if (!visitsByVisitor.has(v.visitor_id)) visitsByVisitor.set(v.visitor_id, []);
    visitsByVisitor.get(v.visitor_id)!.push(v);
  }
  for (const arr of visitsByVisitor.values()) {
    arr.sort((a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime());
  }

  const pathAgg = new Map<
    string,
    { conversions_count: number; purchases_count: number; registrations_count: number; revenue_total: number }
  >();

  const convTime = (c: ConversionRow) => new Date(c.created_at).getTime();

  for (const conv of conversions) {
    const visitorId = conv.visitor_id?.trim();
    const conversionType = conv.event_name === "purchase" ? "purchase" : "registration";
    const visitorVisits = visitorId ? visitsByVisitor.get(visitorId) ?? [] : [];
    const beforeConversion = visitorVisits.filter(
      (v) => new Date(v.created_at).getTime() < convTime(conv)
    );
    const sources = beforeConversion.map((v) =>
      (v.traffic_source && String(v.traffic_source).trim()) ? v.traffic_source : (v.source_classification ?? "")
    );
    const pathLabel = buildPathString(sources, conversionType);

    const cur = pathAgg.get(pathLabel) ?? {
      conversions_count: 0,
      purchases_count: 0,
      registrations_count: 0,
      revenue_total: 0,
    };
    cur.conversions_count += 1;
    if (conversionType === "purchase") {
      cur.purchases_count += 1;
      cur.revenue_total += Number(conv.value ?? 0) || 0;
    } else {
      cur.registrations_count += 1;
    }
    pathAgg.set(pathLabel, cur);
  }

  const paths: PathRow[] = Array.from(pathAgg.entries())
    .map(([path_label, agg]) => ({ path_label, ...agg }))
    .sort((a, b) => b.conversions_count - a.conversions_count)
    .slice(0, limit);

  return paths;
}
