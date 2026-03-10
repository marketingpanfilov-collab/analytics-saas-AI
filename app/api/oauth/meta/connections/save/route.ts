import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/app/lib/supabaseAdmin";

export async function POST(req: Request) {
  const body = await req.json().catch(() => null);

  const projectId: string | undefined = body?.project_id;
  const integrationId: string | undefined = body?.integration_id;
  const adAccountIds: string[] = Array.isArray(body?.ad_account_ids) ? body.ad_account_ids : [];

  if (!projectId || !integrationId) {
    return NextResponse.json({ success: false, error: "project_id + integration_id required" }, { status: 400 });
  }

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

  // 1) meta_ad_accounts: keep in sync for backward compatibility during transition
  const { error: offErr } = await admin
    .from("meta_ad_accounts")
    .update({ is_enabled: false })
    .eq("project_id", projectId)
    .eq("is_enabled", true);

  if (offErr) {
    return NextResponse.json({ success: false, error: offErr }, { status: 500 });
  }

  if (adAccountIds.length > 0) {
    const { error: onErr } = await admin
      .from("meta_ad_accounts")
      .update({ is_enabled: true, integration_id: integrationId })
      .eq("project_id", projectId)
      .in("ad_account_id", adAccountIds);

    if (onErr) {
      return NextResponse.json({ success: false, error: onErr }, { status: 500 });
    }
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
      await admin.from("ad_account_settings").upsert(settingsRows, { onConflict: "ad_account_id" });
    }
  }

  return NextResponse.json({ success: true, saved: adAccountIds.length });
}