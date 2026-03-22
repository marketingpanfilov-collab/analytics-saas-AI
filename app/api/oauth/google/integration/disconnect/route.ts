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
      details: (intErr as any).details ?? null,
      hint: (intErr as any).hint ?? null,
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
  logStep("before_db", { projectId, integrationId });

  logStep("select_ad_accounts", { projectId, integrationId });

  const { data: googleAdAccounts, error: adAccountsSelectErr } = await admin
    .from("ad_accounts")
    .select("id")
    .eq("integration_id", integrationId);
  if (adAccountsSelectErr) {
    console.error("[GOOGLE_DISCONNECT_DB_ERROR]", {
      step: "select_ad_accounts",
      message: adAccountsSelectErr.message,
      details: (adAccountsSelectErr as any).details ?? null,
      hint: (adAccountsSelectErr as any).hint ?? null,
    });
    return NextResponse.json(
      {
        success: false,
        step: "select_ad_accounts",
        error: adAccountsSelectErr.message ?? "Failed to load Google ad_accounts",
      },
      { status: 500 }
    );
  }
  const adAccountIds = (googleAdAccounts ?? []).map((r: { id: string }) => r.id);

  if (adAccountIds.length > 0) {
    logStep("delete_ad_account_settings", {
      projectId,
      integrationId,
      adAccountIdsCount: adAccountIds.length,
    });

    const { error: settingsErr } = await admin
      .from("ad_account_settings")
      .delete()
      .in("ad_account_id", adAccountIds);
    if (settingsErr) {
      console.error("[GOOGLE_DISCONNECT_DB_ERROR]", {
        step: "delete_ad_account_settings",
        message: settingsErr.message,
        details: (settingsErr as any).details ?? null,
        hint: (settingsErr as any).hint ?? null,
      });
      return NextResponse.json(
        {
          success: false,
          step: "delete_ad_account_settings",
          error: settingsErr.message ?? "Failed to delete ad_account_settings",
        },
        { status: 500 }
      );
    }
  }

  logStep("delete_integration_entities", { projectId, integrationId });

  const { error: entitiesErr } = await admin
    .from("integration_entities")
    .delete()
    .eq("integration_id", integrationId)
    .eq("platform", "google");
  if (entitiesErr) {
    console.error("[GOOGLE_DISCONNECT_DB_ERROR]", {
      step: "delete_integration_entities",
      message: entitiesErr.message,
      details: (entitiesErr as any).details ?? null,
      hint: (entitiesErr as any).hint ?? null,
    });
    return NextResponse.json(
      {
        success: false,
        step: "delete_integration_entities",
        error: entitiesErr.message ?? "Failed to delete integration_entities",
      },
      { status: 500 }
    );
  }

  logStep("delete_integrations_auth", { projectId, integrationId });

  const { error: authErr } = await admin
    .from("integrations_auth")
    .delete()
    .eq("integration_id", integrationId);
  if (authErr) {
    console.error("[GOOGLE_DISCONNECT_DB_ERROR]", {
      step: "delete_integrations_auth",
      message: authErr.message,
      details: (authErr as any).details ?? null,
      hint: (authErr as any).hint ?? null,
    });
    return NextResponse.json(
      {
        success: false,
        step: "delete_integrations_auth",
        error: authErr.message ?? "Failed to delete integrations_auth",
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
