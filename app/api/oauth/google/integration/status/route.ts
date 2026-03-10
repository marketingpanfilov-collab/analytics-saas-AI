import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/app/lib/supabaseAdmin";

/**
 * GET /api/oauth/google/integration/status?project_id=...
 * Resolves Google Ads connection from shared model only: integrations + integrations_auth.
 * No Google-specific tables. Returns valid when integration exists and has access_token.
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

  const { data: auth, error: authErr } = await admin
    .from("integrations_auth")
    .select("access_token, token_expires_at")
    .eq("integration_id", integration.id)
    .maybeSingle();

  if (authErr || !auth?.access_token) {
    return NextResponse.json({
      success: true,
      valid: false,
      integration_id: integration.id,
    });
  }

  const expiresAtMs = auth.token_expires_at ? new Date(auth.token_expires_at).getTime() : null;
  const expired = expiresAtMs != null && expiresAtMs <= Date.now();

  return NextResponse.json({
    success: true,
    valid: !expired,
    integration_id: integration.id,
  });
}
