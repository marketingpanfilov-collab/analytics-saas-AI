/**
 * POST /api/projects/ingest-key/regenerate
 *
 * Body: { project_id: string }
 * Generates a new public ingest key for the project. Only owner / admin / project_admin.
 */
import { randomBytes } from "crypto";
import { NextResponse } from "next/server";
import { createServerSupabase } from "@/app/lib/supabaseServer";
import { supabaseAdmin } from "@/app/lib/supabaseAdmin";
import { requireProjectAccess } from "@/app/lib/auth/requireProjectAccess";
import { billingHeavySyncGateBeforeProject } from "@/app/lib/auth/requireBillingAccess";

const EDIT_ROLES = ["owner", "admin", "project_admin"];

function generatePublicIngestKey(): string {
  const raw = randomBytes(24);
  const token = raw.toString("base64url");
  return `bq_pub_${token}`;
}

export async function POST(req: Request) {
  let body: { project_id?: string };
  try {
    body = (await req.json()) as { project_id?: string };
  } catch {
    return NextResponse.json(
      { success: false, error: "Invalid JSON body" },
      { status: 400 }
    );
  }

  const projectId = typeof body.project_id === "string" ? body.project_id.trim() : "";
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

  const billingPre = await billingHeavySyncGateBeforeProject(req);
  if (!billingPre.ok) return billingPre.response;

  const access = await requireProjectAccess(user.id, projectId);
  if (!access) {
    return NextResponse.json(
      { success: false, error: "Project access denied" },
      { status: 403 }
    );
  }

  if (!EDIT_ROLES.includes(access.role)) {
    return NextResponse.json(
      { success: false, error: "Not allowed to regenerate ingest key" },
      { status: 403 }
    );
  }

  const newKey = generatePublicIngestKey();
  const admin = supabaseAdmin();
  const { error } = await admin
    .from("projects")
    .update({ public_ingest_key: newKey })
    .eq("id", projectId);

  if (error) {
    return NextResponse.json(
      { success: false, error: error.message },
      { status: 500 }
    );
  }

  return NextResponse.json({
    success: true,
    public_ingest_key: newKey,
  });
}
