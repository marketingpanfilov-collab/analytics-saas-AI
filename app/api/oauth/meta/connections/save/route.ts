import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/app/lib/supabaseAdmin";
import { requireProjectAccessOrInternal } from "@/app/lib/auth/requireProjectAccessOrInternal";
import { billingHeavySyncGateBeforeProject } from "@/app/lib/auth/requireBillingAccess";
import { logCabinetState } from "@/app/lib/cabinetAuditLog";

export async function POST(req: Request) {
  const body = await req.json().catch(() => null);

  const projectId: string | undefined = body?.project_id;
  const integrationId: string | undefined = body?.integration_id;
  const adAccountIds: string[] = Array.isArray(body?.ad_account_ids) ? body.ad_account_ids : [];

  if (!projectId || !integrationId) {
    return NextResponse.json({ success: false, error: "project_id + integration_id required" }, { status: 400 });
  }

  const billingPre = await billingHeavySyncGateBeforeProject(req);
  if (!billingPre.ok) return billingPre.response;

  const access = await requireProjectAccessOrInternal(req, projectId, { allowInternalBypass: false });
  if (!access.allowed) {
    return NextResponse.json(access.body, { status: access.status });
  }

  logCabinetState("meta_connections_save_request", {
    project_id: projectId,
    integration_id: integrationId,
    selected_count: adAccountIds.length,
  });

  const admin = supabaseAdmin();

  // 0) проверим что интеграция реально существует и в ней есть токен
  const { data: intRow, error: intErr } = await admin
    .from("integrations_meta")
    .select("id, access_token")
    .eq("id", integrationId)
    .eq("project_id", projectId)
    .single();

  if (intErr || !intRow?.id || !intRow?.access_token) {
    return NextResponse.json({ success: false, error: "integration not found or no token" }, { status: 400 });
  }

  // 1) meta_ad_accounts: single DB transaction (see save_meta_ad_account_selection migration)
  const { error: rpcErr } = await admin.rpc("save_meta_ad_account_selection", {
    p_project_id: projectId,
    p_integration_meta_id: integrationId,
    p_ad_account_ids: adAccountIds,
  });

  if (rpcErr) {
    logCabinetState("meta_connections_save_rpc_error", {
      project_id: projectId,
      integration_id: integrationId,
      message: rpcErr.message ?? String(rpcErr),
    });
    return NextResponse.json({ success: false, error: rpcErr }, { status: 500 });
  }

  // 2) Platform-agnostic source of truth: ad_account_settings
  const { data: canonicalInt } = await admin
    .from("integrations_meta")
    .select("integrations_id")
    .eq("id", integrationId)
    .eq("project_id", projectId)
    .single();

  const integrationsId = (canonicalInt as { integrations_id?: string } | null)?.integrations_id ?? null;
  if (integrationsId) {
    const { data: adRows } = await admin
      .from("ad_accounts")
      .select("id, external_account_id")
      .eq("integration_id", integrationsId);

    const now = new Date().toISOString();
    const selectedSet = new Set(adAccountIds);
    const settingsRows = (adRows ?? []).map((row: { id: string; external_account_id: string }) => {
      const isEnabled = selectedSet.has(row.external_account_id);
      return {
        ad_account_id: row.id,
        project_id: projectId,
        is_enabled: isEnabled,
        selected_for_reporting: isEnabled,
        updated_at: now,
      };
    });

    if (settingsRows.length > 0) {
      const { error: settingsErr } = await admin
        .from("ad_account_settings")
        .upsert(settingsRows, { onConflict: "ad_account_id" });
      if (settingsErr) {
        logCabinetState("meta_connections_save_settings_error", {
          project_id: projectId,
          integration_id: integrationId,
          message: settingsErr.message ?? String(settingsErr),
        });
        return NextResponse.json({ success: false, error: settingsErr }, { status: 500 });
      }
    }
  }

  logCabinetState("meta_connections_save_ok", {
    project_id: projectId,
    integration_id: integrationId,
    saved: adAccountIds.length,
  });

  return NextResponse.json({ success: true, saved: adAccountIds.length });
}