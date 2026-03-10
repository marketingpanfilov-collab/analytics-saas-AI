import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/app/lib/supabaseAdmin";

/**
 * POST /api/oauth/google/integration/disconnect
 * Body: { project_id: string }
 *
 * Fully removes project-bound Google integration data so the UI shows no Google accounts/counters.
 * Deletion order (respects FKs):
 * 1) integration_entities for this integration + platform = google
 * 2) ad_account_settings for Google ad_accounts of this integration (before deleting ad_accounts)
 * 3) ad_accounts for this integration (Google only; CASCADE will remove daily_ad_metrics for those accounts)
 * 4) integrations_auth for this integration
 * We keep the integrations row so reconnecting creates/uses the same slot; no orphan row is visible because auth and accounts are gone.
 */
export async function POST(req: Request) {
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ success: false, error: "Invalid JSON body" }, { status: 400 });
  }

  const projectId =
    typeof (body as Record<string, unknown>)?.project_id === "string"
      ? ((body as Record<string, unknown>).project_id as string).trim()
      : "";

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

  if (intErr) {
    return NextResponse.json(
      { success: false, error: intErr.message ?? "Failed to resolve Google integration" },
      { status: 500 }
    );
  }

  if (!integration?.id) {
    return NextResponse.json({ success: true, disconnected: true, message: "Already disconnected" });
  }

  const integrationId = integration.id as string;

  const { data: googleAdAccounts } = await admin
    .from("ad_accounts")
    .select("id")
    .eq("integration_id", integrationId);
  const adAccountIds = (googleAdAccounts ?? []).map((r: { id: string }) => r.id);

  if (adAccountIds.length > 0) {
    const { error: settingsErr } = await admin
      .from("ad_account_settings")
      .delete()
      .in("ad_account_id", adAccountIds);
    if (settingsErr) {
      return NextResponse.json(
        { success: false, error: settingsErr.message ?? "Failed to delete ad_account_settings" },
        { status: 500 }
      );
    }
  }

  const { error: entitiesErr } = await admin
    .from("integration_entities")
    .delete()
    .eq("integration_id", integrationId)
    .eq("platform", "google");
  if (entitiesErr) {
    return NextResponse.json(
      { success: false, error: entitiesErr.message ?? "Failed to delete integration_entities" },
      { status: 500 }
    );
  }

  const { error: adAccErr } = await admin
    .from("ad_accounts")
    .delete()
    .eq("integration_id", integrationId);
  if (adAccErr) {
    return NextResponse.json(
      { success: false, error: adAccErr.message ?? "Failed to delete ad_accounts" },
      { status: 500 }
    );
  }

  const { error: authErr } = await admin
    .from("integrations_auth")
    .delete()
    .eq("integration_id", integrationId);
  if (authErr) {
    return NextResponse.json(
      { success: false, error: authErr.message ?? "Failed to delete integrations_auth" },
      { status: 500 }
    );
  }

  return NextResponse.json({
    success: true,
    disconnected: true,
    message: "Google integration disconnected.",
  });
}
