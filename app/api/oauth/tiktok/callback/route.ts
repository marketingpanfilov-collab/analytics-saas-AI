import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/app/lib/supabaseAdmin";
import type { NextRequest } from "next/server";

type TikTokTokenResponse = {
  access_token?: string;
  refresh_token?: string;
  expires_in?: number;
  scope?: string;
  data?: {
    access_token?: string;
    refresh_token?: string;
    expires_in?: number;
    scope?: string;
  };
  message?: string;
  error?: string;
  error_description?: string;
};

function normalizeTokenPayload(payload: TikTokTokenResponse): {
  access_token: string | null;
  refresh_token: string | null;
  expires_in: number;
  scope: string | null;
} {
  const accessToken = payload.access_token ?? payload.data?.access_token ?? null;
  const refreshToken = payload.refresh_token ?? payload.data?.refresh_token ?? null;
  const expiresIn = Number(payload.expires_in ?? payload.data?.expires_in ?? 86400);
  const scope = payload.scope ?? payload.data?.scope ?? null;
  return {
    access_token: accessToken?.trim() || null,
    refresh_token: refreshToken?.trim() || null,
    expires_in: Number.isFinite(expiresIn) ? expiresIn : 86400,
    scope,
  };
}

function parseState(state: string | null): { project_id?: string; return_to?: string } | null {
  if (!state || !state.trim()) return null;
  try {
    const json = Buffer.from(state, "base64").toString("utf8");
    const parsed = JSON.parse(json);
    return typeof parsed === "object" && parsed !== null ? parsed : null;
  } catch {
    return null;
  }
}

function isUuid(v: string) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(v);
}

function safeReturnTo(v: string | null | undefined) {
  const s = String(v || "").trim();
  return s.startsWith("/") ? s : "/app/accounts";
}

export async function GET(req: NextRequest) {
  const { searchParams } = req.nextUrl;
  const code = searchParams.get("code") || searchParams.get("auth_code");
  const stateRaw = searchParams.get("state");
  const errorParam = searchParams.get("error") || searchParams.get("error_description");

  const appId = process.env.TIKTOK_APP_ID || process.env.TIKTOK_CLIENT_KEY;
  const clientSecret = process.env.TIKTOK_CLIENT_SECRET;
  const redirectUri = process.env.TIKTOK_REDIRECT_URI;

  if (!appId || !clientSecret || !redirectUri) {
    return NextResponse.json({ success: false, error: "TikTok OAuth env vars not set" }, { status: 500 });
  }

  const st = parseState(stateRaw);
  if (!st) return NextResponse.json({ success: false, error: "Invalid or missing OAuth state" }, { status: 400 });

  const projectIdRaw = st.project_id ?? "";
  if (!projectIdRaw.trim()) return NextResponse.json({ success: false, error: "project_id missing in OAuth state" }, { status: 400 });
  if (!isUuid(projectIdRaw)) return NextResponse.json({ success: false, error: "project_id in state is not a valid UUID" }, { status: 400 });

  const projectId = projectIdRaw;
  const returnTo = safeReturnTo(st.return_to);

  if (errorParam) {
    const back = new URL(returnTo, req.nextUrl.origin);
    back.searchParams.set("project_id", projectId);
    back.searchParams.set("connected", "tiktok_error");
    back.searchParams.set("reason", errorParam);
    return NextResponse.redirect(back, { status: 302 });
  }

  if (!code) {
    const back = new URL(returnTo, req.nextUrl.origin);
    back.searchParams.set("project_id", projectId);
    back.searchParams.set("connected", "tiktok_error");
    back.searchParams.set("reason", "no_code");
    return NextResponse.redirect(back, { status: 302 });
  }

  const admin = supabaseAdmin();

  const { data: proj } = await admin.from("projects").select("id").eq("id", projectId).maybeSingle();
  if (!proj) {
    const back = new URL(returnTo, req.nextUrl.origin);
    back.searchParams.set("connected", "tiktok_error");
    back.searchParams.set("reason", "project_not_found");
    return NextResponse.redirect(back, { status: 302 });
  }

  // Primary: TikTok Marketing API v1.3 exchange (auth_code).
  const primaryRes = await fetch("https://business-api.tiktok.com/open_api/v1.3/oauth2/access_token/", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      app_id: appId,
      secret: clientSecret,
      auth_code: code,
      grant_type: "auth_code",
    }),
  });
  let tokenJson = (await primaryRes.json().catch(() => ({}))) as TikTokTokenResponse;
  let normalized = normalizeTokenPayload(tokenJson);

  // Fallback: OAuth v2 exchange for apps configured with Login Kit style callback.
  if (!primaryRes.ok || !normalized.access_token) {
    const fallbackBody = new URLSearchParams({
      client_key: appId,
      client_secret: clientSecret,
      code,
      grant_type: "authorization_code",
      redirect_uri: redirectUri,
    });
    const fallbackRes = await fetch("https://open.tiktokapis.com/v2/oauth/token/", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: fallbackBody.toString(),
    });
    tokenJson = (await fallbackRes.json().catch(() => ({}))) as TikTokTokenResponse;
    normalized = normalizeTokenPayload(tokenJson);
    if (!fallbackRes.ok || !normalized.access_token) {
      const back = new URL(returnTo, req.nextUrl.origin);
      back.searchParams.set("connected", "tiktok_error");
      back.searchParams.set("reason", tokenJson.error_description || tokenJson.error || tokenJson.message || "token_exchange_failed");
      return NextResponse.redirect(back, { status: 302 });
    }
  }

  if (!normalized.access_token) {
    const back = new URL(returnTo, req.nextUrl.origin);
    back.searchParams.set("connected", "tiktok_error");
    back.searchParams.set("reason", tokenJson.error_description || tokenJson.error || tokenJson.message || "token_exchange_failed");
    return NextResponse.redirect(back, { status: 302 });
  }

  const accessToken = normalized.access_token;
  const refreshTokenFromTikTok = normalized.refresh_token;
  const expiresIn = normalized.expires_in;
  const tokenExpiresAt = new Date(Date.now() + expiresIn * 1000).toISOString();
  const scopes = normalized.scope;
  const nowIso = new Date().toISOString();

  const { data: canonicalInt, error: intUpsertErr } = await admin
    .from("integrations")
    .upsert(
      {
        project_id: projectId,
        platform: "tiktok",
        integration_type: "oauth",
        name: "TikTok Ads",
        status: "active",
        updated_at: nowIso,
      },
      { onConflict: "project_id,platform" }
    )
    .select("id")
    .single();

  if (intUpsertErr || !canonicalInt?.id) {
    const back = new URL(returnTo, req.nextUrl.origin);
    back.searchParams.set("connected", "tiktok_error");
    back.searchParams.set("reason", "integrations_upsert_failed");
    return NextResponse.redirect(back, { status: 302 });
  }

  let refreshTokenToStore = refreshTokenFromTikTok;
  if (!refreshTokenToStore) {
    const { data: existingAuth } = await admin
      .from("integrations_auth")
      .select("refresh_token")
      .eq("integration_id", canonicalInt.id)
      .maybeSingle();
    const existing = (existingAuth as { refresh_token?: string | null } | null)?.refresh_token;
    if (existing?.trim()) refreshTokenToStore = existing.trim();
  }

  const { error: authErr } = await admin
    .from("integrations_auth")
    .upsert(
      {
        integration_id: canonicalInt.id,
        access_token: accessToken,
        refresh_token: refreshTokenToStore,
        token_expires_at: tokenExpiresAt,
        scopes,
        meta: {
          expires_in: expiresIn,
          source: "tiktok_oauth_callback",
        },
        updated_at: nowIso,
      },
      { onConflict: "integration_id" }
    );

  if (authErr) {
    const back = new URL(returnTo, req.nextUrl.origin);
    back.searchParams.set("connected", "tiktok_error");
    back.searchParams.set("reason", "integrations_auth_upsert_failed");
    return NextResponse.redirect(back, { status: 302 });
  }

  const successUrl = new URL(returnTo, req.nextUrl.origin);
  successUrl.searchParams.set("connected", "tiktok");
  successUrl.searchParams.set("project_id", projectId);
  return NextResponse.redirect(successUrl, { status: 302 });
}
