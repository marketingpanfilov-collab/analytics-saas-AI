import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/app/lib/supabaseAdmin";
import { syncMetaMarketingIntentFromAdsApi } from "@/app/lib/metaAdsMarketingIntentSync";

/**
 * GET ?project_id=&ad_account_id=
 * Scans Meta ads for campaign_intent=retention in url_tags / creative URLs; updates campaigns.marketing_intent.
 * Also invoked after Meta campaign sync.
 */
export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const projectId = searchParams.get("project_id")?.trim() ?? "";
  const adAccountId = searchParams.get("ad_account_id")?.trim() ?? "";

  if (!projectId || !adAccountId) {
    return NextResponse.json(
      { success: false, error: "project_id and ad_account_id required" },
      { status: 400 }
    );
  }

  const admin = supabaseAdmin();

  let integration: { access_token: string } | null = null;
  const { data: primaryRow } = await admin
    .from("integrations_meta")
    .select("access_token")
    .eq("project_id", projectId)
    .eq("account_id", "primary")
    .maybeSingle();
  if (primaryRow?.access_token) {
    integration = primaryRow;
  } else {
    const { data: anyRow } = await admin
      .from("integrations_meta")
      .select("access_token")
      .eq("project_id", projectId)
      .limit(1)
      .maybeSingle();
    integration = anyRow;
  }

  if (!integration?.access_token) {
    return NextResponse.json({ success: false, error: "Integration not found for project_id" }, { status: 404 });
  }

  const result = await syncMetaMarketingIntentFromAdsApi(
    integration.access_token,
    adAccountId,
    admin,
    projectId
  );

  if (!result.success) {
    return NextResponse.json(
      {
        success: false,
        step: "meta_ads_intent_sync",
        error: result.error ?? "Unknown error",
      },
      { status: 502 }
    );
  }

  return NextResponse.json(result);
}
