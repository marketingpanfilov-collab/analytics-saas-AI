import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/app/lib/supabaseAdmin";
import { getValidTikTokAccessToken } from "@/app/lib/tiktokAdsAuth";

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const projectId = searchParams.get("project_id");

  if (!projectId) {
    return NextResponse.json({ success: false, error: "project_id required" }, { status: 400 });
  }

  const admin = supabaseAdmin();

  const { data: intRows, error: intErr } = await admin
    .from("integrations")
    .select("id")
    .eq("project_id", projectId)
    .eq("platform", "tiktok")
    .order("created_at", { ascending: false })
    .limit(1);

  const integration = intRows?.[0] as { id: string } | undefined;
  if (intErr || !integration?.id) {
    return NextResponse.json({ success: true, valid: false, integration_id: null });
  }

  const token = await getValidTikTokAccessToken(admin, integration.id);
  return NextResponse.json({
    success: true,
    valid: !!token,
    integration_id: integration.id,
  });
}
