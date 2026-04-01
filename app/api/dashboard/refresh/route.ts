import { NextResponse } from "next/server";
import { getInternalSyncHeaders } from "@/app/lib/auth/requireProjectAccessOrInternal";
import { requireProjectAccessOrInternal } from "@/app/lib/auth/requireProjectAccessOrInternal";

/** UTC calendar day before `isoDate` (YYYY-MM-DD). */
function calendarDayBefore(isoDate: string): string {
  const d = new Date(isoDate + "T12:00:00Z");
  d.setUTCDate(d.getUTCDate() - 1);
  return d.toISOString().slice(0, 10);
}

function maxIsoDate(a: string, b: string): string {
  return a > b ? a : b;
}

/**
 * POST /api/dashboard/refresh
 * Body: { project_id, start, end, force_full_sync?: boolean }
 * Syncs the date range for all enabled ad accounts (same contract as /api/dashboard/sync). Requires project access.
 * Default: when end === today (UTC), range is clamped to max(start, today-1d)…today unless force_full_sync is true.
 */
export async function POST(req: Request) {
  try {
    const body = await req.json();
    const project_id = body.project_id;
    const requestedStart = String(body.start ?? "");
    const requestedEnd = String(body.end ?? "");
    let start = requestedStart;
    let end = requestedEnd;
    const forceFullSync =
      body.force_full_sync === true ||
      body.force_full_sync === "true" ||
      body.force_full_sync === 1;

    if (!project_id || !start || !end) {
      return NextResponse.json(
        { success: false, error: "project_id, start, end required" },
        { status: 400 }
      );
    }

    const access = await requireProjectAccessOrInternal(req, project_id);
    if (!access.allowed) {
      console.log("[REFRESH_ACCESS_DENIED]", { projectId: project_id, status: access.status });
      return NextResponse.json(access.body, { status: access.status });
    }

    const today = new Date().toISOString().slice(0, 10);
    let rangeClamped = false;
    if (!forceFullSync && requestedEnd === today) {
      const yesterday = calendarDayBefore(today);
      const nextStart = maxIsoDate(requestedStart, yesterday);
      start = nextStart;
      end = today;
      rangeClamped = nextStart !== requestedStart;
    }

    const baseUrl = new URL(req.url).origin;
    const syncUrl = new URL(`${baseUrl}/api/dashboard/sync`);
    syncUrl.searchParams.set("project_id", project_id);
    syncUrl.searchParams.set("start", start);
    syncUrl.searchParams.set("end", end);

    const r = await fetch(syncUrl.toString(), {
      method: "POST",
      headers: { "Content-Type": "application/json", ...getInternalSyncHeaders() },
    });
    const json = await r.json().catch(() => ({}));

    if (!r.ok) {
      return NextResponse.json(
        { success: false, error: json?.error ?? "Sync failed", sync: json },
        { status: r.status >= 400 ? r.status : 500 }
      );
    }

    return NextResponse.json({
      success: true,
      refreshed_at: new Date().toISOString(),
      sync: json,
      effective_start: start,
      effective_end: end,
      range_clamped: rangeClamped,
      force_full_sync: forceFullSync,
    });
  } catch (e: unknown) {
    const message = e instanceof Error ? e.message : String(e);
    return NextResponse.json(
      { success: false, error: message },
      { status: 500 }
    );
  }
}
