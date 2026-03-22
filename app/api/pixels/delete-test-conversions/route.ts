/**
 * POST /api/pixels/delete-test-conversions
 *
 * Deletes only test-marked conversion_events for the given project.
 * Safe: only rows with external_event_id or user_external_id starting with test_/demo_/dev_
 * or metadata is_test/generated_from. Requires auth and project access.
 */
import { NextResponse } from "next/server";
import { createServerSupabase } from "@/app/lib/supabaseServer";
import { supabaseAdmin } from "@/app/lib/supabaseAdmin";
import { requireProjectAccess } from "@/app/lib/auth/requireProjectAccess";

export async function POST(req: Request) {
  try {
    const body = (await req.json().catch(() => ({}))) as { project_id?: string };
    const projectId = body?.project_id?.trim();

    if (!projectId) {
      return NextResponse.json(
        { success: false, error: "project_id required" },
        { status: 400 }
      );
    }

    const supabase = await createServerSupabase();
    const {
      data: { user },
    } = await supabase.auth.getUser();

    if (!user) {
      return NextResponse.json(
        { success: false, error: "Unauthorized" },
        { status: 401 }
      );
    }

    const access = await requireProjectAccess(user.id, projectId);
    if (!access) {
      return NextResponse.json(
        { success: false, error: "Project access denied" },
        { status: 403 }
      );
    }

    const admin = supabaseAdmin();

    // Select only ids that match test markers (safe criteria only)
    const { data: rowsPrefix, error: selectError1 } = await admin
      .from("conversion_events")
      .select("id")
      .eq("project_id", projectId)
      .or(
        "external_event_id.ilike.test_%,external_event_id.ilike.demo_%,external_event_id.ilike.dev_%," +
          "user_external_id.ilike.test_%,user_external_id.ilike.demo_%,user_external_id.ilike.dev_%"
      );

    if (selectError1) {
      console.error("[DELETE_TEST_CONVERSIONS_SELECT]", selectError1);
      return NextResponse.json(
        { success: false, error: selectError1.message },
        { status: 500 }
      );
    }

    const ids = (rowsPrefix ?? []).map((r: { id: string }) => r.id);
    if (ids.length === 0) {
      return NextResponse.json({
        success: true,
        deleted: 0,
        message: "No test conversions found",
      });
    }

    // Delete only those rows by id (no broader delete)
    const { error: deleteError } = await admin
      .from("conversion_events")
      .delete()
      .in("id", ids);

    if (deleteError) {
      console.error("[DELETE_TEST_CONVERSIONS_DELETE]", deleteError);
      return NextResponse.json(
        { success: false, error: deleteError.message },
        { status: 500 }
      );
    }

    return NextResponse.json({
      success: true,
      deleted: ids.length,
      message: `Deleted ${ids.length} test conversion(s)`,
    });
  } catch (e) {
    console.error("[DELETE_TEST_CONVERSIONS]", e);
    return NextResponse.json(
      {
        success: false,
        error: e instanceof Error ? e.message : "Internal error",
      },
      { status: 500 }
    );
  }
}
