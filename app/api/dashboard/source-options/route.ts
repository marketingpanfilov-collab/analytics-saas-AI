import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/app/lib/supabaseAdmin";
import { requireProjectAccessOrInternal } from "@/app/lib/auth/requireProjectAccessOrInternal";
import { getDashboardSourceOptions } from "@/app/lib/dashboardSourceOptions";

function toISODate(s: string | null) {
  if (!s) return null;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return null;
  return s;
}

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const projectId = searchParams.get("project_id")?.trim() ?? "";
  const start = toISODate(searchParams.get("start"));
  const end = toISODate(searchParams.get("end"));

  if (!projectId) {
    return NextResponse.json({ success: false, error: "project_id required" }, { status: 400 });
  }
  if (!start || !end) {
    return NextResponse.json(
      { success: false, error: "start and end are required (YYYY-MM-DD)" },
      { status: 400 }
    );
  }

  const access = await requireProjectAccessOrInternal(req, projectId);
  if (!access.allowed) {
    console.log("[SOURCE_OPTIONS_ACCESS_DENIED]", { projectId, status: access.status });
    return NextResponse.json(access.body, { status: access.status });
  }

  const admin = supabaseAdmin();

  try {
    const options = await getDashboardSourceOptions(admin, projectId, start, end);
    return NextResponse.json({ success: true, options });
  } catch (e: unknown) {
    console.error("[DASHBOARD_SOURCE_OPTIONS_FATAL]", e);
    return NextResponse.json(
      { success: false, error: e instanceof Error ? e.message : "Internal error" },
      { status: 500 }
    );
  }
}
