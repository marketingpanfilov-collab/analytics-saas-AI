/**
 * URL/query parsing for dashboard & reports date range — safe for Client Components (no next/headers, no Supabase).
 */

export const PLATFORM_SOURCES = ["meta", "google", "tiktok", "yandex"] as const;

export function toISODate(s: string | null) {
  if (!s) return null;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return null;
  return s;
}

export type DashboardRangeParams = {
  projectId: string;
  start: string;
  end: string;
  sources?: string[];
  accountIds?: string[];
  sourcesKey: string;
  accountIdsKey: string;
};

export function parseDashboardRangeParams(searchParams: URLSearchParams): DashboardRangeParams | null {
  const projectId = searchParams.get("project_id")?.trim() ?? searchParams.get("project_id");
  const start = toISODate(searchParams.get("start"));
  const end = toISODate(searchParams.get("end"));
  const sourcesRaw = searchParams.get("sources");
  const sources = sourcesRaw ? sourcesRaw.split(",").map((s) => s.trim()).filter(Boolean) : undefined;
  const accountIdsRaw = searchParams.get("account_ids");
  const accountIds = accountIdsRaw ? accountIdsRaw.split(",").map((s) => s.trim()).filter(Boolean) : undefined;
  if (!projectId || !start || !end) return null;
  const sourcesKey = sources?.length ? [...sources].sort().join(",") : "all";
  const accountIdsKey = accountIds?.length ? [...accountIds].sort().join(",") : "all";
  return { projectId, start, end, sources, accountIds, sourcesKey, accountIdsKey };
}

/** When user selected sources but none are ad platforms — paid spend series must be empty/zero. */
export function isNonPlatformSourcesOnly(sources: string[] | undefined): boolean {
  if (!sources?.length) return false;
  return !sources.some((s) => PLATFORM_SOURCES.includes(s.toLowerCase() as (typeof PLATFORM_SOURCES)[number]));
}
