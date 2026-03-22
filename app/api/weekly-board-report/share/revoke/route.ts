/**
 * POST /api/weekly-board-report/share/revoke — revoke share link (auth required).
 * Body: { token: string }
 */
import { NextResponse } from "next/server";
import { createServerSupabase } from "@/app/lib/supabaseServer";
import { supabaseAdmin } from "@/app/lib/supabaseAdmin";
import { requireProjectAccess } from "@/app/lib/auth/requireProjectAccess";

export async function POST(req: Request) {
  try {
    const body = await req.json().catch(() => null);
    const token = typeof body?.token === "string" ? body.token.trim() : null;
    if (!token) {
      return NextResponse.json({ success: false, error: "token is required" }, { status: 400 });
    }

    const supabase = await createServerSupabase();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) {
      return NextResponse.json({ success: false, error: "Unauthorized" }, { status: 401 });
    }

    const admin = supabaseAdmin();
    const { data: row, error: fetchErr } = await admin
      .from("report_share_links")
      .select("id, project_id, revoked_at")
      .eq("token", token)
      .maybeSingle();

    if (fetchErr || !row) {
      return NextResponse.json({ success: false, error: "Link not found" }, { status: 404 });
    }

    const r = row as { project_id: string; revoked_at: string | null };
    if (r.revoked_at) {
      return NextResponse.json({ success: true, revoked: true, message: "Link already revoked" });
    }

    const access = await requireProjectAccess(user.id, r.project_id);
    if (!access) {
      return NextResponse.json({ success: false, error: "Project access denied" }, { status: 403 });
    }

    const { error: updateErr } = await admin
      .from("report_share_links")
      .update({ revoked_at: new Date().toISOString() })
      .eq("token", token);

    if (updateErr) {
      console.error("[WEEKLY_REPORT_SHARE_REVOKE]", updateErr);
      return NextResponse.json(
        { success: false, error: updateErr.message },
        { status: 500 }
      );
    }

    return NextResponse.json({ success: true, revoked: true });
  } catch (e) {
    console.error("[WEEKLY_REPORT_SHARE_REVOKE]", e);
    return NextResponse.json(
      { success: false, error: e instanceof Error ? e.message : "Internal error" },
      { status: 500 }
    );
  }
}
