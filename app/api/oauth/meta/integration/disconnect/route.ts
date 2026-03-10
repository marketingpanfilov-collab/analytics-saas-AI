import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/app/lib/supabaseAdmin";
import { getMetaIntegrationForProject } from "@/app/lib/metaIntegration";

/**
 * POST /api/oauth/meta/integration/disconnect
 * Body: { project_id: string }
 *
 * Removes the Meta integration (token and link) but keeps historical data:
 * - Deletes meta_ad_accounts for this project (legacy selection state).
 * - Deletes integrations_auth row (shared auth layer).
 * - Deletes the integrations_meta row (legacy token storage).
 * Does NOT delete: integrations row, ad_accounts, daily_ad_metrics, campaigns.
 */
export async function POST(req: Request) {
  const body = await req.json().catch(() => ({}));
  const projectId = body?.project_id;

  if (!projectId) {
    return NextResponse.json({ success: false, error: "project_id required" }, { status: 400 });
  }

  const admin = supabaseAdmin();
  const integration = await getMetaIntegrationForProject(admin, projectId);

  if (!integration?.id) {
    return NextResponse.json({ success: true, disconnected: true, message: "Already disconnected" });
  }

  const integrationsMetaId = integration.id;

  // Resolve canonical integration_id for integrations_auth delete
  const { data: metaRow } = await admin
    .from("integrations_meta")
    .select("integrations_id")
    .eq("id", integrationsMetaId)
    .maybeSingle();
  const canonicalIntegrationId =
    (metaRow as { integrations_id?: string } | null)?.integrations_id ?? integration.id;

  const { error: metaAccErr } = await admin
    .from("meta_ad_accounts")
    .delete()
    .eq("project_id", projectId)
    .eq("integration_id", integrationsMetaId);

  if (metaAccErr) {
    return NextResponse.json(
      { success: false, error: metaAccErr.message ?? "Failed to delete meta_ad_accounts" },
      { status: 500 }
    );
  }

  if (canonicalIntegrationId) {
    const { error: authErr } = await admin
      .from("integrations_auth")
      .delete()
      .eq("integration_id", canonicalIntegrationId);
    if (authErr) {
      return NextResponse.json(
        { success: false, error: authErr.message ?? "Failed to delete integrations_auth" },
        { status: 500 }
      );
    }
  }

  const { error: metaErr } = await admin
    .from("integrations_meta")
    .delete()
    .eq("id", integrationsMetaId);

  if (metaErr) {
    return NextResponse.json(
      { success: false, error: metaErr.message ?? "Failed to delete integrations_meta" },
      { status: 500 }
    );
  }

  return NextResponse.json({
    success: true,
    disconnected: true,
    message: "Meta integration disconnected. Historical data preserved.",
  });
}
