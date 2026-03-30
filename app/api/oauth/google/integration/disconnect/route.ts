import { NextResponse } from "next/server";
import { deleteCanonicalIntegrationById } from "@/app/lib/disconnectCanonicalIntegration";
import { supabaseAdmin } from "@/app/lib/supabaseAdmin";

/**
 * POST /api/oauth/google/integration/disconnect
 * Body: { project_id: string }
 *
 * Removes the Google integration row and dependent data: `integration_entities`,
 * `ad_account_settings` for linked accounts, then `integrations` (CASCADE:
 * `integrations_auth`, `ad_accounts`, `daily_ad_metrics` for those accounts).
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

  console.log("[GOOGLE_DISCONNECT_ENTER]", { projectId });

  if (!projectId) {
    return NextResponse.json({ success: false, error: "project_id required" }, { status: 400 });
  }

  const admin = supabaseAdmin();

  const logStep = (step: string, extra?: Record<string, unknown>) => {
    console.log("[GOOGLE_DISCONNECT_STEP]", { step, ...(extra || {}) });
  };

  logStep("resolve_integration_start", { projectId });

  const { data: integration, error: intErr } = await admin
    .from("integrations")
    .select("id")
    .eq("project_id", projectId)
    .eq("platform", "google")
    .maybeSingle();

  if (intErr) {
    console.error("[GOOGLE_DISCONNECT_DB_ERROR]", {
      step: "resolve_integration",
      message: intErr.message,
      details: (intErr as { details?: string }).details ?? null,
      hint: (intErr as { hint?: string }).hint ?? null,
    });
    return NextResponse.json(
      {
        success: false,
        step: "resolve_integration",
        error: intErr.message ?? "Failed to resolve Google integration",
      },
      { status: 500 }
    );
  }

  if (!integration?.id) {
    logStep("already_disconnected", { projectId });
    return NextResponse.json({ success: true, disconnected: true, message: "Already disconnected" });
  }

  const integrationId = integration.id as string;

  console.log("[GOOGLE_DISCONNECT_BEFORE_DB]", { projectId, integrationId });
  logStep("delete_canonical_integration", { projectId, integrationId });

  const { error: delErr } = await deleteCanonicalIntegrationById(admin, integrationId, {
    integrationEntitiesPlatform: "google",
  });

  if (delErr) {
    console.error("[GOOGLE_DISCONNECT_DB_ERROR]", {
      step: "delete_canonical_integration",
      message: delErr.message,
    });
    return NextResponse.json(
      {
        success: false,
        step: "delete_canonical_integration",
        error: delErr.message ?? "Failed to disconnect Google integration",
      },
      { status: 500 }
    );
  }

  console.log("[GOOGLE_DISCONNECT_AFTER_DB]", { projectId, integrationId });
  logStep("after_db", { projectId, integrationId });

  return NextResponse.json({
    success: true,
    disconnected: true,
    message: "Google integration disconnected.",
  });
}
