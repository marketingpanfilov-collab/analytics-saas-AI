import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/app/lib/supabaseAdmin";

async function fbGetJson(url: string) {
  const r = await fetch(url);
  const txt = await r.text();
  try {
    return JSON.parse(txt);
  } catch {
    return { error: { message: txt } };
  }
}

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const projectId = searchParams.get("project_id");
  const adAccountId = searchParams.get("ad_account_id");

  if (!projectId || !adAccountId) {
    return NextResponse.json(
      { success: false, error: "project_id and ad_account_id required" },
      { status: 400 }
    );
  }

  const admin = supabaseAdmin();

  // 1) токен по проекту (prefer primary, fallback to any)
  let integration: { access_token: string; integrations_id?: string | null } | null = null;
  const { data: primaryRow } = await admin
    .from("integrations_meta")
    .select("access_token, integrations_id")
    .eq("project_id", projectId)
    .eq("account_id", "primary")
    .maybeSingle();
  if (primaryRow?.access_token) {
    integration = primaryRow;
  } else {
    const { data: anyRow } = await admin
      .from("integrations_meta")
      .select("access_token, integrations_id")
      .eq("project_id", projectId)
      .limit(1)
      .maybeSingle();
    integration = anyRow;
  }

  if (!integration?.access_token) {
    return NextResponse.json(
      { success: false, error: "Integration not found for project_id" },
      { status: 404 }
    );
  }

  // 1b) Canonical: resolve ad_accounts.id for dual-write (optional if integrations_id missing)
  let adAccountsId: string | null = null;
  if (integration.integrations_id) {
    const { data: adAcc } = await admin
      .from("ad_accounts")
      .select("id")
      .eq("integration_id", integration.integrations_id)
      .eq("external_account_id", adAccountId)
      .maybeSingle();
    adAccountsId = adAcc?.id ?? null;
  }

  // 2) тянем кампании
  const url =
    `https://graph.facebook.com/v19.0/${adAccountId}/campaigns?` +
    new URLSearchParams({
      fields: "id,name,status,objective",
      limit: "200",
      access_token: integration.access_token,
    }).toString();

  const json = await fbGetJson(url);
  const list = Array.isArray(json?.data) ? json.data : [];

  // 3) готовим rows под campaigns: ad_account_id = external (act_*), platform = meta
  const rows = list
    .map((c: any) => ({
      project_id: projectId,
      meta_campaign_id: String(c.id),
      name: c.name ?? null,
      status: c.status ?? null,
      objective: c.objective ?? null,
      ad_account_id: adAccountId,
      platform: "meta" as const,
      ...(adAccountsId && { ad_accounts_id: adAccountsId }),
    }))
    .filter((row) => {
      if (!row.ad_accounts_id) {
        console.warn("[CAMPAIGN_SKIP_NO_AD_ACCOUNT]", {
          campaignId: row.meta_campaign_id,
          platform: "meta",
        });
        return false;
      }
      return true;
    });

  // 4) UPSERT в campaigns (dual-write: legacy + canonical link)
  const { error: upErr } = await admin
    .from("campaigns")
    .upsert(rows, { onConflict: "project_id,meta_campaign_id" });

  if (upErr) {
    return NextResponse.json(
      { success: false, step: "supabase_upsert_campaigns", error: upErr },
      { status: 500 }
    );
  }

  return NextResponse.json({
    success: true,
    ad_account_id: adAccountId,
    saved: rows.length,
  });
}