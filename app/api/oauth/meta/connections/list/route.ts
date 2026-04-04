// app/api/oauth/meta/connections/list/route.ts
import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/app/lib/supabaseAdmin";
import { getMetaIntegrationForProject } from "@/app/lib/metaIntegration";
import { requireProjectAccessOrInternal } from "@/app/lib/auth/requireProjectAccessOrInternal";
import { billingAnalyticsReadGateBeforeProject } from "@/app/lib/auth/requireBillingAccess";

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const projectId = searchParams.get("project_id");

  if (!projectId) {
    return NextResponse.json({ success: false, error: "project_id required" }, { status: 400 });
  }

  const billingPre = await billingAnalyticsReadGateBeforeProject(req);
  if (!billingPre.ok) return billingPre.response;

  const access = await requireProjectAccessOrInternal(req, projectId, { allowInternalBypass: false });
  if (!access.allowed) {
    return NextResponse.json(access.body, { status: access.status });
  }

  const admin = supabaseAdmin();

  const integration = await getMetaIntegrationForProject(admin, projectId);

  if (!integration?.id) {
    return NextResponse.json({
      success: true,
      integration_id: null,
      active_ad_account_ids: [],
    });
  }

  const { data: activeRows, error: actErr } = await admin
    .from("meta_ad_accounts")
    .select("ad_account_id")
    .eq("project_id", projectId)
    .eq("is_enabled", true);

  if (actErr) {
    return NextResponse.json({ success: false, error: actErr }, { status: 500 });
  }

  return NextResponse.json({
    success: true,
    integration_id: integration.id,
    active_ad_account_ids: (activeRows ?? []).map((x) => x.ad_account_id),
  });
}
