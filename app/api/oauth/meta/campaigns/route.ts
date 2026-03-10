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

  // получаем токен
  const { data: integration, error } = await admin
    .from("integrations_meta")
    .select("access_token")
    .eq("project_id", projectId)
    .single();

  if (error || !integration) {
    return NextResponse.json(
      { success: false, error: "Integration not found" },
      { status: 404 }
    );
  }

  const url =
    `https://graph.facebook.com/v19.0/${adAccountId}/campaigns?` +
    new URLSearchParams({
      fields: "id,name,status,objective",
      access_token: integration.access_token,
    }).toString();

  const campaigns = await fbGetJson(url);

  return NextResponse.json({
    success: true,
    ad_account_id: adAccountId,
    campaigns: campaigns.data ?? [],
  });
}