import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/app/lib/supabaseAdmin";
import { getMetaIntegrationForProject } from "@/app/lib/metaIntegration";
import { requireProjectAccessOrInternal } from "@/app/lib/auth/requireProjectAccessOrInternal";

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const projectId = searchParams.get("project_id");
  if (!projectId) {
    return NextResponse.json({ success: false, error: "project_id required" }, { status: 400 });
  }

  const access = await requireProjectAccessOrInternal(req, projectId, { allowInternalBypass: false });
  if (!access.allowed) {
    return NextResponse.json(access.body, { status: access.status });
  }

  const admin = supabaseAdmin();

  const integration = await getMetaIntegrationForProject(admin, projectId);

  if (!integration?.id) {
    return NextResponse.json({ success: true, accounts: [] });
  }

  // ✅ отдаём ВСЕ кабинеты, которые сохранены после OAuth
  const { data, error } = await admin
    .from("meta_ad_accounts")
    .select("ad_account_id,name,currency,account_status,is_enabled")
    .eq("project_id", projectId)
    .eq("integration_id", integration.id)
    .order("is_enabled", { ascending: false }) // сначала активные
    .order("name", { ascending: true });

  if (error) return NextResponse.json({ success: false, error }, { status: 500 });

  // Backward-compatible fallback: if accounts were stored under a different integration_id,
  // return by project_id only (avoids "empty list" after canonical key changes).
  if ((data ?? []).length === 0) {
    const { data: byProject, error: byProjectErr } = await admin
      .from("meta_ad_accounts")
      .select("ad_account_id,name,currency,account_status,is_enabled")
      .eq("project_id", projectId)
      .order("is_enabled", { ascending: false })
      .order("name", { ascending: true });

    if (byProjectErr) return NextResponse.json({ success: false, error: byProjectErr }, { status: 500 });
    return NextResponse.json({ success: true, accounts: byProject ?? [] });
  }

  return NextResponse.json({ success: true, accounts: data ?? [] });
}