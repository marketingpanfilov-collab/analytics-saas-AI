import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/app/lib/supabaseAdmin";
import { getValidGoogleAccessToken } from "@/app/lib/googleAdsAuth";

/**
 * GET /api/oauth/google/integration/status?project_id=...
 * Resolves Google Ads connection from shared model only: integrations + integrations_auth.
 * Uses refresh_token to obtain a valid access_token when expired. Returns valid when
 * integration exists and we have (or can refresh to) a valid access_token.
 */
export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const projectId = searchParams.get("project_id");

  if (!projectId) {
    return NextResponse.json({ success: false, error: "project_id required" }, { status: 400 });
  }

  const admin = supabaseAdmin();

  const { data: integration, error: intErr } = await admin
    .from("integrations")
    .select("id")
    .eq("project_id", projectId)
    .eq("platform", "google")
    .maybeSingle();

  if (intErr || !integration?.id) {
    return NextResponse.json({
      success: true,
      valid: false,
      integration_id: null,
    });
  }

  const token = await getValidGoogleAccessToken(admin, integration.id);

  return NextResponse.json({
    success: true,
    valid: !!token,
    integration_id: integration.id,
  });
}
