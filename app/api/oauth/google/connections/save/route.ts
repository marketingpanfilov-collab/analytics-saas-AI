import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/app/lib/supabaseAdmin";
import { requireProjectAccessOrInternal } from "@/app/lib/auth/requireProjectAccessOrInternal";
import { billingHeavySyncGateBeforeProject } from "@/app/lib/auth/requireBillingAccess";
import { logCabinetState } from "@/app/lib/cabinetAuditLog";

function isUuid(v: string) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(v);
}

/**
 * POST /api/oauth/google/connections/save
 * Body: { project_id: string, ad_account_ids: string[] }
 * ad_account_ids = Google external_account_id values (customer ids).
 *
 * Updates ad_account_settings for the project's Google integration:
 * - all Google ad_accounts for this project: is_enabled = false
 * - submitted selected ids: is_enabled = true, selected_for_reporting = true
 * - sync_enabled remains false (no Google sync yet)
 * Uses shared ad_account_settings only; no Google-specific tables.
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
  const adAccountIds = Array.isArray((body as Record<string, unknown>)?.ad_account_ids)
    ? ((body as Record<string, unknown>).ad_account_ids as string[]).filter(
        (id): id is string => typeof id === "string" && id.trim().length > 0
      )
    : [];

  if (!projectId || !isUuid(projectId)) {
    return NextResponse.json(
      { success: false, error: "project_id is required and must be a valid UUID" },
      { status: 400 }
    );
  }

  const billingPre = await billingHeavySyncGateBeforeProject(req);
  if (!billingPre.ok) return billingPre.response;

  const access = await requireProjectAccessOrInternal(req, projectId, { allowInternalBypass: false });
  if (!access.allowed) {
    return NextResponse.json(access.body, { status: access.status });
  }

  logCabinetState("google_connections_save_request", {
    project_id: projectId,
    selected_count: adAccountIds.length,
  });

  const admin = supabaseAdmin();

  const { data: intRows, error: intErr } = await admin
    .from("integrations")
    .select("id")
    .eq("project_id", projectId)
    .eq("platform", "google")
    .order("created_at", { ascending: false })
    .limit(1);

  const integration = intRows?.[0] as { id: string } | undefined;

  if (intErr || !integration?.id) {
    return NextResponse.json(
      { success: false, error: "Google integration not found for this project" },
      { status: 404 }
    );
  }

  const { data: adRows, error: adErr } = await admin
    .from("ad_accounts")
    .select("id, external_account_id")
    .eq("integration_id", integration.id);

  if (adErr) {
    return NextResponse.json(
      { success: false, error: adErr.message ?? "Failed to load ad_accounts" },
      { status: 500 }
    );
  }

  const list = (adRows ?? []) as { id: string; external_account_id: string }[];
  const selectedSet = new Set(adAccountIds);
  const now = new Date().toISOString();

  const settingsRows = list.map((row) => ({
    ad_account_id: row.id,
    project_id: projectId,
    is_enabled: selectedSet.has(row.external_account_id),
    selected_for_reporting: selectedSet.has(row.external_account_id),
    sync_enabled: false,
    updated_at: now,
  }));

  if (settingsRows.length > 0) {
    const { error: setErr } = await admin
      .from("ad_account_settings")
      .upsert(settingsRows, { onConflict: "ad_account_id" });

    if (setErr) {
      return NextResponse.json(
        { success: false, error: setErr.message ?? "Failed to update ad_account_settings" },
        { status: 500 }
      );
    }
  }

  logCabinetState("google_connections_save_ok", { project_id: projectId, saved: adAccountIds.length });

  return NextResponse.json({ success: true, saved: adAccountIds.length });
}
