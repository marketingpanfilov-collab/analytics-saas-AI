import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/app/lib/supabaseAdmin";
import { getMetaIntegrationForProject } from "@/app/lib/metaIntegration";

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const projectId = searchParams.get("project_id");

  if (!projectId) {
    return NextResponse.json({ success: false, error: "project_id required" }, { status: 400 });
  }

  const admin = supabaseAdmin();
  const integration = await getMetaIntegrationForProject(admin, projectId);

  const token = integration?.access_token ?? null;
  const expiresAt = integration?.expires_at ? new Date(integration.expires_at).getTime() : 0;
  const now = Date.now();
  const valid = Boolean(token) && (expiresAt === 0 || expiresAt > now);

  return NextResponse.json({
    success: true,
    integration: integration
      ? {
          id: integration.id,
          project_id: integration.project_id,
          access_token: token,
          expires_at: integration.expires_at,
          created_at: integration.created_at,
        }
      : null,
    valid,
  });
}