import type { PostgrestError } from "@supabase/supabase-js";

/** PostgREST default max rows per request; must paginate beyond this. */
export const POSTGREST_PAGE_SIZE = 1000;

export type PaginatedFetchResult<T> = {
  rows: T[];
  pagesFetched: number;
};

/**
 * Fetch all rows for a query by advancing `.range(from, to)` until a page returns fewer than PAGE_SIZE rows.
 * Caller must apply a deterministic `.order(...)` on the query so pagination is stable.
 */
export async function fetchAllPages<T>(
  fetchPage: (from: number, to: number) => Promise<{ data: T[] | null; error: PostgrestError | null }>
): Promise<PaginatedFetchResult<T>> {
  const rows: T[] = [];
  let pagesFetched = 0;
  for (let from = 0; ; from += POSTGREST_PAGE_SIZE) {
    const to = from + POSTGREST_PAGE_SIZE - 1;
    const { data, error } = await fetchPage(from, to);
    pagesFetched += 1;
    if (error) throw error;
    const chunk = data ?? [];
    rows.push(...chunk);
    if (chunk.length < POSTGREST_PAGE_SIZE) break;
  }
  return { rows, pagesFetched };
}
