/**
 * GET /api/projects/ingest-key?project_id=...
 *
 * Returns the project's public ingest key for browser conversion events.
 * Requires authenticated user with access to the project.
 * Full key only for owner/admin/project_admin; others get masked key.
 */
import { NextResponse } from "next/server";
import { createServerSupabase } from "@/app/lib/supabaseServer";
import { requireProjectAccess } from "@/app/lib/auth/requireProjectAccess";

const EDIT_ROLES = ["owner", "admin", "project_admin"];
const VISIBLE_KEY_LENGTH = 14;

function maskIngestKey(key: string): string {
  if (!key || key.length <= VISIBLE_KEY_LENGTH) return "bq_pub_*************************";
  return key.slice(0, VISIBLE_KEY_LENGTH) + "*".repeat(Math.max(0, key.length - VISIBLE_KEY_LENGTH));
}

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const projectId = searchParams.get("project_id")?.trim();

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

  const { data: proj, error } = await supabase
    .from("projects")
    .select("public_ingest_key")
    .eq("id", projectId)
    .maybeSingle();

  if (error) {
    return NextResponse.json(
      { success: false, error: error.message },
      { status: 500 }
    );
  }
  if (!proj) {
    return NextResponse.json(
      { success: false, error: "Project not found" },
      { status: 404 }
    );
  }

  const canManage = EDIT_ROLES.includes(access.role);
  const rawKey = proj.public_ingest_key ?? null;
  const public_ingest_key = rawKey && canManage ? rawKey : (rawKey ? maskIngestKey(rawKey) : null);

  return NextResponse.json({
    success: true,
    public_ingest_key,
    can_manage_ingest_key: canManage,
    can_regenerate: canManage,
  });
}
