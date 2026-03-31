/**
 * POST /api/weekly-board-report/share — create share link (auth required).
 * GET /api/weekly-board-report/share?project_id=... — get active share status (auth required).
 */
import { NextResponse } from "next/server";
import { createServerSupabase } from "@/app/lib/supabaseServer";
import { supabaseAdmin } from "@/app/lib/supabaseAdmin";
import { requireProjectAccess } from "@/app/lib/auth/requireProjectAccess";
import { buildWeeklyReportPayload } from "../route";

const REPORT_TYPE = "weekly_board_report";

/** Matches `app/app/(public)/share/...` → `/app/share/weekly-report/:token` (not `/share/...`). */
const PUBLIC_SHARE_PATH = "/app/share/weekly-report";

function generateToken(): string {
  const buf = new Uint8Array(24);
  if (typeof crypto !== "undefined" && crypto.getRandomValues) {
    crypto.getRandomValues(buf);
  }
  return Array.from(buf, (b) => b.toString(16).padStart(2, "0")).join("");
}

export async function GET(req: Request) {
  try {
    const { searchParams } = new URL(req.url);
    const projectId = searchParams.get("project_id")?.trim() ?? null;
    if (!projectId) {
      return NextResponse.json({ success: false, error: "project_id is required" }, { status: 400 });
    }

    const supabase = await createServerSupabase();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) {
      return NextResponse.json({ success: false, error: "Unauthorized" }, { status: 401 });
    }

    const access = await requireProjectAccess(user.id, projectId);
    if (!access) {
      return NextResponse.json({ success: false, error: "Project access denied" }, { status: 403 });
    }

    const admin = supabaseAdmin();
    const { data: row } = await admin
      .from("report_share_links")
      .select("id, token, created_at")
      .eq("project_id", projectId)
      .eq("report_type", REPORT_TYPE)
      .is("revoked_at", null)
      .maybeSingle();

    if (!row) {
      return NextResponse.json({ success: true, active: false });
    }

    const baseUrl = process.env.NEXT_PUBLIC_APP_URL || "";
    const shareUrl = `${baseUrl.replace(/\/$/, "")}${PUBLIC_SHARE_PATH}/${(row as { token: string }).token}`;

    return NextResponse.json({
      success: true,
      active: true,
      token: (row as { token: string }).token,
      url: shareUrl,
      created_at: (row as { created_at: string }).created_at,
    });
  } catch (e) {
    console.error("[WEEKLY_REPORT_SHARE_STATUS]", e);
    return NextResponse.json(
      { success: false, error: e instanceof Error ? e.message : "Internal error" },
      { status: 500 }
    );
  }
}

export async function POST(req: Request) {
  try {
    const body = await req.json().catch(() => null);
    const projectId = typeof body?.project_id === "string" ? body.project_id.trim() : null;
    const start = typeof body?.start === "string" ? body.start.trim() : null;
    const end = typeof body?.end === "string" ? body.end.trim() : null;
    const sources = Array.isArray(body?.sources)
      ? body.sources.map((v: unknown) => String(v)).filter(Boolean)
      : typeof body?.sources === "string"
        ? body.sources.split(",").map((v: string) => v.trim()).filter(Boolean)
        : [];
    const accountIds = Array.isArray(body?.account_ids)
      ? body.account_ids.map((v: unknown) => String(v)).filter(Boolean)
      : typeof body?.account_ids === "string"
        ? body.account_ids.split(",").map((v: string) => v.trim()).filter(Boolean)
        : [];
    if (!projectId) {
      return NextResponse.json({ success: false, error: "project_id is required" }, { status: 400 });
    }

    const supabase = await createServerSupabase();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) {
      return NextResponse.json({ success: false, error: "Unauthorized" }, { status: 401 });
    }

    const access = await requireProjectAccess(user.id, projectId);
    if (!access) {
      return NextResponse.json({ success: false, error: "Project access denied" }, { status: 403 });
    }

    const admin = supabaseAdmin();

    const { data: existingRow } = await admin
      .from("report_share_links")
      .select("id, token, created_at")
      .eq("project_id", projectId)
      .eq("report_type", REPORT_TYPE)
      .is("revoked_at", null)
      .maybeSingle();

    if (existingRow) {
      const row = existingRow as { token: string; created_at: string };
      const baseUrl = process.env.NEXT_PUBLIC_APP_URL || "";
      const shareUrl = `${baseUrl.replace(/\/$/, "")}${PUBLIC_SHARE_PATH}/${row.token}`;
      return NextResponse.json({
        success: true,
        token: row.token,
        url: shareUrl,
        created_at: row.created_at,
        existing: true,
      });
    }

    const today = new Date().toISOString().slice(0, 10);
    const monthStart = `${today.slice(0, 8)}01`;
    const payload = await buildWeeklyReportPayload(admin, projectId, {
      start: start && /^\d{4}-\d{2}-\d{2}$/.test(start) ? start : monthStart,
      end: end && /^\d{4}-\d{2}-\d{2}$/.test(end) ? end : today,
      sources,
      accountIds,
    });

    const token = generateToken();
    const { error: insertErr } = await admin.from("report_share_links").insert({
      project_id: projectId,
      token,
      report_type: REPORT_TYPE,
      period_end_iso: `${payload.period.end}T23:59:59.999Z`,
      report_snapshot: payload,
      created_by: user.id,
    });

    if (insertErr) {
      console.error("[WEEKLY_REPORT_SHARE_CREATE]", insertErr);
      return NextResponse.json(
        { success: false, error: insertErr.message },
        { status: 500 }
      );
    }

    const baseUrl = process.env.NEXT_PUBLIC_APP_URL || "";
    const shareUrl = `${baseUrl.replace(/\/$/, "")}${PUBLIC_SHARE_PATH}/${token}`;

    return NextResponse.json({
      success: true,
      token,
      url: shareUrl,
      created_at: new Date().toISOString(),
      existing: false,
    });
  } catch (e) {
    console.error("[WEEKLY_REPORT_SHARE_CREATE]", e);
    return NextResponse.json(
      { success: false, error: e instanceof Error ? e.message : "Internal error" },
      { status: 500 }
    );
  }
}
