import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/app/lib/supabaseAdmin";
import { requireProjectAccessOrInternal } from "@/app/lib/auth/requireProjectAccessOrInternal";
import { billingHeavySyncGateBeforeProject } from "@/app/lib/auth/requireBillingAccess";

export async function POST(req: Request) {
  const body = await req.json().catch(() => ({}));
  const projectId = body.project_id;
  const integrationId = body.integration_id;
  const adAccountId = body.ad_account_id;

  if (!projectId || !integrationId || !adAccountId) {
    return NextResponse.json(
      { success: false, error: "project_id, integration_id, ad_account_id required" },
      { status: 400 }
    );
  }

  const billingPre = await billingHeavySyncGateBeforeProject(req);
  if (!billingPre.ok) return billingPre.response;

  const access = await requireProjectAccessOrInternal(req, projectId, { allowInternalBypass: false });
  if (!access.allowed) {
    return NextResponse.json(access.body, { status: access.status });
  }

  const admin = supabaseAdmin();

  const { data, error } = await admin.from("meta_connections").upsert(
    {
      project_id: projectId,
      integration_id: integrationId,
      ad_account_id: adAccountId,
      status: "active",
      updated_at: new Date().toISOString(),
    },
    {
      onConflict: "project_id,integration_id,ad_account_id",
    }
  ).select("id,project_id,integration_id,ad_account_id,status").single();

  if (error) {
    return NextResponse.json(
      { success: false, step: "supabase_upsert_meta_connections", error },
      { status: 500 }
    );
  }

  return NextResponse.json({ success: true, connection: data });
}
