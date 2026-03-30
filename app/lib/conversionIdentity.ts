/**
 * Canonical user key for conversion_events: tie visitor_id ↔ user_external_id via same-row
 * and same session_id (aligned with LTV /api/ltv).
 */
import type { SupabaseClient } from "@supabase/supabase-js";

const PAGE_SIZE = 1000;
const MAX_PAGES = 150;

export type ConversionIdentitySlice = {
  user_external_id: string | null;
  visitor_id: string | null;
  session_id: string | null;
};

export type IdentityLinkRow = {
  user_external_id?: string | null;
  visitor_id?: string | null;
  session_id?: string | null;
};

/** Link visitor_id to user_external_id (same row, then same session as any row with user_external_id). */
export function buildVisitorAndSessionMaps(rows: ConversionIdentitySlice[]): {
  visitorToExternal: Map<string, string>;
  sessionCanonical: Map<string, string>;
} {
  const visitorToExternal = new Map<string, string>();
  const sessionBuckets = new Map<string, { u: string | null; v: string | null }[]>();

  for (const row of rows) {
    const u = row.user_external_id?.trim() || null;
    const v = row.visitor_id?.trim() || null;
    const sid = row.session_id?.trim() || null;
    if (u && v && !visitorToExternal.has(v)) visitorToExternal.set(v, u);
    if (sid) {
      if (!sessionBuckets.has(sid)) sessionBuckets.set(sid, []);
      sessionBuckets.get(sid)!.push({ u, v });
    }
  }

  const sessionCanonical = new Map<string, string>();
  for (const [sid, sessRows] of sessionBuckets) {
    let preferredU: string | null = null;
    for (const r of sessRows) {
      if (r.u) {
        preferredU = r.u;
        break;
      }
    }
    if (preferredU) {
      sessionCanonical.set(sid, preferredU);
      for (const r of sessRows) {
        if (r.v && !visitorToExternal.has(r.v)) visitorToExternal.set(r.v, preferredU);
      }
    }
  }
  for (const [sid, sessRows] of sessionBuckets) {
    if (sessionCanonical.has(sid)) continue;
    let key: string | null = null;
    for (const r of sessRows) {
      if (r.v && visitorToExternal.has(r.v)) {
        key = visitorToExternal.get(r.v)!;
        break;
      }
    }
    if (!key) {
      for (const r of sessRows) {
        if (r.v) {
          key = r.v;
          break;
        }
      }
    }
    if (key) sessionCanonical.set(sid, key);
  }

  return { visitorToExternal, sessionCanonical };
}

export function makeIdentityKey(
  visitorToExternal: Map<string, string>,
  sessionCanonical: Map<string, string>
): (row: IdentityLinkRow) => string | null {
  return (row) => {
    const u = row.user_external_id?.trim();
    const v = row.visitor_id?.trim();
    const s = row.session_id?.trim();
    if (u) return u;
    if (v) {
      const mapped = visitorToExternal.get(v);
      if (mapped) return mapped;
    }
    if (v) return v;
    if (s && sessionCanonical.has(s)) return sessionCanonical.get(s)!;
    return null;
  };
}

/** Paginated scan of registration + purchase rows for identity graph (project-wide). */
export async function fetchProjectIdentityKeyResolver(
  admin: SupabaseClient,
  projectId: string
): Promise<(row: IdentityLinkRow) => string | null> {
  const slices: ConversionIdentitySlice[] = [];
  for (let page = 0; page < MAX_PAGES; page++) {
    const fromIdx = page * PAGE_SIZE;
    const toIdx = fromIdx + PAGE_SIZE - 1;
    const { data, error } = await admin
      .from("conversion_events")
      .select("user_external_id, visitor_id, session_id")
      .eq("project_id", projectId)
      .in("event_name", ["purchase", "registration"])
      .order("created_at", { ascending: true })
      .order("id", { ascending: true })
      .range(fromIdx, toIdx);
    if (error) throw error;
    const rows = (data ?? []) as ConversionIdentitySlice[];
    for (const row of rows) slices.push(row);
    if (rows.length < PAGE_SIZE) break;
  }
  const { visitorToExternal, sessionCanonical } = buildVisitorAndSessionMaps(slices);
  return makeIdentityKey(visitorToExternal, sessionCanonical);
}
