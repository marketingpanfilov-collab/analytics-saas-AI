import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/app/lib/supabaseAdmin";
import { getValidTikTokAccessToken } from "@/app/lib/tiktokAdsAuth";

function isUuid(v: string) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(v);
}

type TikTokAdvertiser = {
  advertiser_id?: string | number;
  advertiser_name?: string;
  name?: string;
};

type TikTokAdvertiserResponse = {
  data?: {
    list?: TikTokAdvertiser[];
  };
  message?: string;
  code?: number;
};

async function fetchAdvertisers(
  appId: string,
  secret: string,
  accessToken: string
): Promise<{ ok: boolean; payload: TikTokAdvertiserResponse; status: number }> {
  const query = new URLSearchParams({
    app_id: appId,
    secret,
  });
  const url = `https://business-api.tiktok.com/open_api/v1.3/oauth2/advertiser/get/?${query.toString()}`;
  const res = await fetch(url, {
    method: "GET",
    headers: {
      "Access-Token": accessToken,
      "Content-Type": "application/json",
    },
  });
  const payload = (await res.json().catch(() => ({}))) as TikTokAdvertiserResponse;
  if (res.ok && Number(payload.code ?? 0) === 0) return { ok: true, payload, status: res.status };
  // Do not mask real API validation/auth errors with fallback responses.
  // Fallback is only for transport-level issues (5xx / gateway), not 4xx business errors.
  if (res.status < 500) return { ok: false, payload, status: res.status };

  // Fallback for apps configured with header-based access token.
  const fallbackQuery = new URLSearchParams({
    ...Object.fromEntries(query.entries()),
    access_token: accessToken,
  });
  const fallback = await fetch(`https://business-api.tiktok.com/open_api/v1.3/oauth2/advertiser/get/?${fallbackQuery.toString()}`, {
    method: "GET",
    headers: {
      "Content-Type": "application/json",
    },
  });
  const fallbackPayload = (await fallback.json().catch(() => ({}))) as TikTokAdvertiserResponse;
  return {
    ok: fallback.ok && Number(fallbackPayload.code ?? 0) === 0,
    payload: fallbackPayload,
    status: fallback.status,
  };
}

type TikTokAdvertiserResponseLegacy = {
  data?: {
    list?: TikTokAdvertiser[];
  };
  message?: string;
  code?: number;
};

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

  if (!projectId || !isUuid(projectId)) {
    return NextResponse.json(
      { success: false, error: "project_id is required and must be a valid UUID" },
      { status: 400 }
    );
  }

  const admin = supabaseAdmin();
  const appId = process.env.TIKTOK_APP_ID || process.env.TIKTOK_CLIENT_KEY;
  const secret = process.env.TIKTOK_CLIENT_SECRET;
  if (!appId || !secret) {
    return NextResponse.json(
      {
        success: false,
        error: "TIKTOK_APP_ID/TIKTOK_CLIENT_KEY or TIKTOK_CLIENT_SECRET not set",
        debug: {
          has_tiktok_app_id: Boolean(process.env.TIKTOK_APP_ID),
          has_tiktok_client_key: Boolean(process.env.TIKTOK_CLIENT_KEY),
          has_tiktok_client_secret: Boolean(process.env.TIKTOK_CLIENT_SECRET),
        },
      },
      { status: 500 }
    );
  }
  const { data: proj } = await admin
    .from("projects")
    .select("id, owner_id")
    .eq("id", projectId)
    .maybeSingle();
  if (!proj) return NextResponse.json({ success: false, error: "Project not found" }, { status: 404 });

  const { data: integration } = await admin
    .from("integrations")
    .select("id")
    .eq("project_id", projectId)
    .eq("platform", "tiktok")
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (!integration?.id) {
    return NextResponse.json({ success: false, error: "TikTok integration not found; connect OAuth first" }, { status: 404 });
  }

  const token = await getValidTikTokAccessToken(admin, integration.id);
  if (!token) {
    return NextResponse.json({ success: false, error: "TikTok auth token not found or expired; reconnect TikTok OAuth" }, { status: 401 });
  }

  const listResult = await fetchAdvertisers(appId, secret, token.access_token);
  const listJson = listResult.payload as TikTokAdvertiserResponseLegacy;
  if (!listResult.ok) {
    return NextResponse.json(
      {
        success: false,
        error: listJson.message || `TikTok advertiser list error: ${listResult.status}`,
        tiktok_code: listJson.code ?? null,
        debug: {
          app_id_len: String(appId).trim().length,
          app_id_is_numeric: /^\d+$/.test(String(appId).trim()),
        },
      },
      { status: listResult.status >= 400 ? listResult.status : 500 }
    );
  }

  const advertisers = (listJson.data?.list ?? [])
    .map((row) => {
      const externalId = String(row.advertiser_id ?? "").trim();
      if (!externalId) return null;
      return {
        externalId,
        name: row.advertiser_name?.trim() || row.name?.trim() || externalId,
      };
    })
    .filter((x): x is { externalId: string; name: string } => !!x);

  if (!proj.owner_id) {
    return NextResponse.json({ success: false, error: "Project has no owner_id; required for ad_accounts" }, { status: 500 });
  }

  const adAccountRows = advertisers.map((a) => ({
    owner_id: proj.owner_id,
    integration_id: integration.id,
    project_id: projectId,
    provider: "tiktok" as const,
    external_account_id: a.externalId,
    account_name: a.name,
  }));

  if (adAccountRows.length > 0) {
    const { error: adErr } = await admin
      .from("ad_accounts")
      .upsert(adAccountRows, { onConflict: "integration_id,external_account_id" });
    if (adErr) return NextResponse.json({ success: false, error: adErr.message ?? "ad_accounts upsert failed" }, { status: 500 });

    const { data: insertedAccounts } = await admin
      .from("ad_accounts")
      .select("id")
      .eq("integration_id", integration.id);
    const settingsRows = (insertedAccounts ?? []).map(({ id }: { id: string }) => ({
      ad_account_id: id,
      project_id: projectId,
      is_enabled: false,
      selected_for_reporting: false,
      sync_enabled: false,
      updated_at: new Date().toISOString(),
    }));
    if (settingsRows.length > 0) {
      await admin.from("ad_account_settings").upsert(settingsRows, { onConflict: "ad_account_id" });
    }
  }

  return NextResponse.json({
    success: true,
    discovered: advertisers.length,
    advertiser_ids: advertisers.map((a) => a.externalId),
  });
}
