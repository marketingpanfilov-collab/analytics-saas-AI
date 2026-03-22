import { NextResponse } from "next/server";
import { getInternalSyncHeaders } from "@/app/lib/auth/requireProjectAccessOrInternal";
import { requireProjectAccessOrInternal } from "@/app/lib/auth/requireProjectAccessOrInternal";

/**
 * POST /api/dashboard/refresh
 * Body: { project_id, start, end }
 * Syncs the date range for all enabled ad accounts (same contract as /api/dashboard/sync). Requires project access.
 */
export async function POST(req: Request) {
  try {
    const body = await req.json();
    const project_id = body.project_id;
    const start = body.start;
    const end = body.end;

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
    });
  } catch (e: unknown) {
    const message = e instanceof Error ? e.message : String(e);
    return NextResponse.json(
      { success: false, error: message },
      { status: 500 }
    );
  }
}
