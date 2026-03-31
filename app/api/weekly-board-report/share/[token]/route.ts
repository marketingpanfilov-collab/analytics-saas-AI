/**
 * GET /api/weekly-board-report/share/[token] — public readonly report by token (no auth).
 * Returns snapshot JSON or error (invalid / revoked).
 */
import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/app/lib/supabaseAdmin";
import { buildWeeklyReportPayload } from "../../route";

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ token: string }> }
) {
  try {
    const token = (await params).token?.trim();
    if (!token) {
      return NextResponse.json(
        { success: false, error: "invalid_link", message: "Ссылка недействительна" },
        { status: 404 }
      );
    }

    const admin = supabaseAdmin();
    const { data: row, error: fetchErr } = await admin
      .from("report_share_links")
      .select("project_id, period_end_iso, report_snapshot, revoked_at")
      .eq("token", token)
      .maybeSingle();

    if (fetchErr) {
      console.error("[WEEKLY_REPORT_SHARE_FETCH]", fetchErr);
      return NextResponse.json(
        { success: false, error: "unavailable", message: "Отчёт недоступен" },
        { status: 500 }
      );
    }

    if (!row) {
      return NextResponse.json(
        { success: false, error: "invalid_link", message: "Ссылка недействительна" },
        { status: 404 }
      );
    }

    const r = row as { revoked_at: string | null; report_snapshot: unknown; project_id: string; period_end_iso: string };

    if (r.revoked_at) {
      return NextResponse.json(
        { success: false, error: "revoked", message: "Эта ссылка была отозвана и больше недоступна" },
        { status: 410 }
      );
    }

    if (r.report_snapshot && typeof r.report_snapshot === "object") {
      const snap = r.report_snapshot as Record<string, unknown>;
      return NextResponse.json({
        success: true,
        ...snap,
      });
    }

    const periodEnd = new Date(r.period_end_iso);
    const end = Number.isNaN(periodEnd.getTime())
      ? new Date().toISOString().slice(0, 10)
      : periodEnd.toISOString().slice(0, 10);
    const start = `${end.slice(0, 8)}01`;
    const payload = await buildWeeklyReportPayload(admin, r.project_id, {
      start,
      end,
      sources: [],
      accountIds: [],
    });
    return NextResponse.json(payload);
  } catch (e) {
    console.error("[WEEKLY_REPORT_SHARE_PUBLIC]", e);
    return NextResponse.json(
      { success: false, error: "unavailable", message: "Отчёт недоступен" },
      { status: 500 }
    );
  }
}
