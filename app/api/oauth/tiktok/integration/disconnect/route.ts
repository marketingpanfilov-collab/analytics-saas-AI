import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/app/lib/supabaseAdmin";

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

  if (!projectId) {
    return NextResponse.json({ success: false, error: "project_id required" }, { status: 400 });
  }

  const admin = supabaseAdmin();
  const { data: integration } = await admin
    .from("integrations")
    .select("id")
    .eq("project_id", projectId)
    .eq("platform", "tiktok")
    .maybeSingle();

  if (!integration?.id) {
    return NextResponse.json({ success: true, disconnected: true, message: "Already disconnected" });
  }

  const { data: adAccounts } = await admin
    .from("ad_accounts")
    .select("id")
    .eq("integration_id", integration.id);
  const adAccountIds = (adAccounts ?? []).map((r: { id: string }) => r.id);

  if (adAccountIds.length > 0) {
    await admin.from("ad_account_settings").delete().in("ad_account_id", adAccountIds);
  }

  await admin.from("integrations_auth").delete().eq("integration_id", integration.id);
  await admin.from("ad_accounts").delete().eq("integration_id", integration.id);

  return NextResponse.json({
    success: true,
    disconnected: true,
    message: "TikTok integration disconnected.",
  });
}
