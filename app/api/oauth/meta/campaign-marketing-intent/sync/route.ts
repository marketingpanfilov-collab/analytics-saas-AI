import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/app/lib/supabaseAdmin";
import { syncMetaMarketingIntentFromAdsApi } from "@/app/lib/metaAdsMarketingIntentSync";
import {
  requireProjectAccessOrInternal,
  isInternalSyncRequest,
} from "@/app/lib/auth/requireProjectAccessOrInternal";
import { billingHeavySyncGateBeforeProject } from "@/app/lib/auth/requireBillingAccess";

/**
 * GET ?project_id=&ad_account_id=
 * Scans Meta ads for campaign_intent=retention in url_tags / creative URLs; updates campaigns.marketing_intent.
 * Also invoked after Meta campaign sync.
 */
export async function GET(req: Request) {
  const t0 = Date.now();
  const { searchParams } = new URL(req.url);
  const projectId = searchParams.get("project_id")?.trim() ?? "";
  const adAccountId = searchParams.get("ad_account_id")?.trim() ?? "";
  console.log("[META_INTENT_SYNC] start", { projectId, adAccountId });

  if (!projectId || !adAccountId) {
    console.log("[META_INTENT_SYNC] validation_failed", {
      reason: "project_id and ad_account_id required",
      projectId,
      adAccountId,
      ms: Date.now() - t0,
    });
    return NextResponse.json(
      { success: false, error: "project_id and ad_account_id required" },
      { status: 400 }
    );
  }

  if (!isInternalSyncRequest(req)) {
    const billingPre = await billingHeavySyncGateBeforeProject(req);
    if (!billingPre.ok) return billingPre.response;
  }

  const access = await requireProjectAccessOrInternal(req, projectId, { allowInternalBypass: true });
  if (!access.allowed) {
    return NextResponse.json(access.body, { status: access.status });
  }

  const admin = supabaseAdmin();
  const tAccessStart = Date.now();

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
    console.log("[META_INTENT_SYNC] step: access_resolved", {
      ms: Date.now() - tAccessStart,
      integrationFound: false,
    });
    return NextResponse.json({ success: false, error: "Integration not found for project_id" }, { status: 404 });
  }
  console.log("[META_INTENT_SYNC] step: access_resolved", {
    ms: Date.now() - tAccessStart,
    integrationFound: true,
  });

  const tSyncStart = Date.now();
  const result = await syncMetaMarketingIntentFromAdsApi(
    integration.access_token,
    adAccountId,
    admin,
    projectId
  );
  console.log("[META_INTENT_SYNC] step: marketing_intent_processed", {
    ms: Date.now() - tSyncStart,
    success: result.success,
    code: result.code ?? null,
    ads_scanned: result.ads_scanned,
    retention_campaign_ids: result.retention_campaign_ids,
    updated_retention: result.updated_retention,
    updated_acquisition: result.updated_acquisition,
    error: result.error ?? null,
  });

  if (!result.success) {
    if (result.code === "incomplete_scan") {
      console.log("[META_INTENT_SYNC] step: done", { totalMs: Date.now() - t0, status: 503, code: "incomplete_scan" });
      return NextResponse.json(
        {
          success: false,
          step: "meta_ads_intent_sync",
          code: "incomplete_scan",
          error: result.error ?? "Incomplete scan",
          ads_scanned: result.ads_scanned,
          pages_fetched: result.pages_fetched,
          has_more: result.has_more,
        },
        { status: 503 }
      );
    }
    if (result.code === "rate_limited") {
      console.log("[META_INTENT_SYNC] step: done", { totalMs: Date.now() - t0, status: 429, code: "rate_limited" });
      return NextResponse.json(
        {
          success: false,
          step: "meta_ads_intent_sync",
          code: "rate_limited",
          error: result.error ?? "Rate limited",
          ads_scanned: result.ads_scanned,
          pages_fetched: result.pages_fetched,
        },
        { status: 429 }
      );
    }
    console.log("[META_INTENT_SYNC] step: done", { totalMs: Date.now() - t0, status: 502 });
    return NextResponse.json(
      {
        success: false,
        step: "meta_ads_intent_sync",
        error: result.error ?? "Unknown error",
        ads_scanned: result.ads_scanned,
        pages_fetched: result.pages_fetched,
      },
      { status: 502 }
    );
  }

  console.log("[META_INTENT_SYNC] step: done", { totalMs: Date.now() - t0, status: 200 });
  return NextResponse.json(result);
}
