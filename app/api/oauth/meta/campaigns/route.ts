import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/app/lib/supabaseAdmin";
import { fetchMetaGraphGetJsonWithRetry } from "@/app/lib/metaGraphRetry";

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

  const graphResult = await fetchMetaGraphGetJsonWithRetry(url);
  if (!graphResult.ok) {
    const errPayload = graphResult.json as { error?: { message?: string; code?: number } };
    const code = errPayload?.error?.code;
    const status =
      graphResult.kind === "transient" ? 503 : code === 190 || code === 102 ? 401 : 400;
    return NextResponse.json(
      {
        success: false,
        error: errPayload?.error?.message ?? "Meta Graph request failed",
        retryable: graphResult.kind === "transient",
      },
      { status }
    );
  }

  const campaigns = graphResult.json as { data?: unknown[] };

  return NextResponse.json({
    success: true,
    ad_account_id: adAccountId,
    campaigns: campaigns.data ?? [],
  });
}