import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/app/lib/supabaseAdmin";
import { getMetaIntegrationForProject } from "@/app/lib/metaIntegration";

async function fbDebugToken(userToken: string) {
  const appId = process.env.META_APP_ID;
  const appSecret = process.env.META_APP_SECRET;
  if (!appId || !appSecret) throw new Error("META_APP_ID / META_APP_SECRET missing");

  // app access token
  const appToken = `${appId}|${appSecret}`;

  const url =
    "https://graph.facebook.com/v19.0/debug_token?" +
    new URLSearchParams({
      input_token: userToken,
      access_token: appToken,
    }).toString();

  const r = await fetch(url, { method: "GET" });
  const j = await r.json();
  return j;
}

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const projectId = searchParams.get("project_id");

  if (!projectId) {
    return NextResponse.json({ success: false, error: "project_id required" }, { status: 400 });
  }

  const admin = supabaseAdmin();

  const integration = await getMetaIntegrationForProject(admin, projectId);

  if (!integration?.id || !integration?.access_token) {
    return NextResponse.json({
      success: true,
      integration_id: null,
      status: "not_connected", // нет токена в БД
      has_valid_integration: false,
    });
  }

  // быстрый чек expires_at (не основной, но полезен)
  const expiresAtMs = integration.expires_at ? new Date(integration.expires_at).getTime() : null;
  if (expiresAtMs !== null && expiresAtMs <= Date.now()) {
    return NextResponse.json({
      success: true,
      integration_id: integration.id,
      status: "expired",
      has_valid_integration: false,
    });
  }

  try {
    const dbg = await fbDebugToken(integration.access_token);

    // ожидаемый формат: { data: { is_valid: boolean, ... } }
    const isValid = !!dbg?.data?.is_valid;

    if (!isValid) {
      return NextResponse.json({
        success: true,
        integration_id: integration.id,
        status: "invalid", // разорвали/отозвали/невалидный
        has_valid_integration: false,
        reason: dbg?.data?.error?.message ?? dbg?.error?.message ?? "token_invalid",
      });
    }

    return NextResponse.json({
      success: true,
      integration_id: integration.id,
      status: "ok",
      has_valid_integration: true,
    });
  } catch (e: any) {
    // если graph недоступен/ошибка — считаем как error
    return NextResponse.json({
      success: true,
      integration_id: integration.id,
      status: "error",
      has_valid_integration: false,
      reason: e?.message ?? String(e),
    });
  }
}