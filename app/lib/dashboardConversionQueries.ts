import type { SupabaseClient } from "@supabase/supabase-js";
import { fetchAllPages, type PaginatedFetchResult } from "@/app/lib/supabasePagination";

/** PostgREST / URL limits on `.in()` list size for visitor_id batches. */
export const VISITOR_ID_IN_CHUNK = 500;

/**
 * Load all registration/purchase conversion_events for a project and created_at window.
 * Paginates past PostgREST's default ~1000 row cap.
 */
export async function fetchConversionEventsPaginated(
  admin: SupabaseClient,
  projectId: string,
  createdFrom: string,
  createdTo: string,
  select: string
): Promise<PaginatedFetchResult<Record<string, unknown>>> {
  return fetchAllPages<Record<string, unknown>>(async (rangeFrom, rangeTo) => {
    const res = await admin
      .from("conversion_events")
      .select(select)
      .eq("project_id", projectId)
      .gte("created_at", createdFrom)
      .lte("created_at", createdTo)
      .in("event_name", ["registration", "purchase"])
      .order("created_at", { ascending: true })
      .order("id", { ascending: true })
      .range(rangeFrom, rangeTo);
    return {
      data: (res.data ?? null) as Record<string, unknown>[] | null,
      error: res.error,
    };
  });
}

export type VisitSourceEventRow = {
  visitor_id: string | null;
  source_classification: string | null;
  traffic_source: string | null;
  traffic_platform: string | null;
  created_at: string;
};

/**
 * visit_source_events for attribution: batch `.in("visitor_id", …)` to avoid oversized requests.
 */
export async function fetchVisitSourceEventsForVisitors(
  admin: SupabaseClient,
  projectId: string,
  visitorIds: string[],
  lookupFromIso: string,
  createdTo: string
): Promise<{ rows: VisitSourceEventRow[]; batches: number }> {
  const rows: VisitSourceEventRow[] = [];
  let batches = 0;
  for (let i = 0; i < visitorIds.length; i += VISITOR_ID_IN_CHUNK) {
    const chunk = visitorIds.slice(i, i + VISITOR_ID_IN_CHUNK);
    batches += 1;
    const { rows: pageRows } = await fetchAllPages<VisitSourceEventRow>(async (rangeFrom, rangeTo) => {
      const res = await admin
        .from("visit_source_events")
        .select("visitor_id, source_classification, traffic_source, traffic_platform, created_at")
        .eq("site_id", projectId)
        .in("visitor_id", chunk)
        .gte("created_at", lookupFromIso)
        .lte("created_at", createdTo)
        .order("created_at", { ascending: true })
        .order("id", { ascending: true })
        .range(rangeFrom, rangeTo);
      return {
        data: (res.data ?? null) as VisitSourceEventRow[] | null,
        error: res.error,
      };
    });
    for (const v of pageRows) {
      rows.push(v);
    }
  }
  return { rows, batches };
}
