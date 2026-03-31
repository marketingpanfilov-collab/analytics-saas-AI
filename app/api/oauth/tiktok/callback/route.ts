import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/app/lib/supabaseAdmin";
import type { NextRequest } from "next/server";
import { mergeRefreshTokenForUpsert, upsertIntegrationsAuth } from "@/app/lib/integrationsAuthUpsert";
import { parseTikTokOAuthAccessTokenResult, summarizeTikTokTokenResponse } from "@/app/lib/tiktokAdsAuth";

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

  // TikTok Marketing API v1.3: use OAuth-style grant + redirect_uri matching the authorize URL
  // (see /api/oauth/tiktok/start — same TIKTOK_REDIRECT_URI). Some tenants omit refresh_token without this.
  const primaryRes = await fetch("https://business-api.tiktok.com/open_api/v1.3/oauth2/access_token/", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      app_id: appId,
      secret: clientSecret,
      auth_code: code,
      grant_type: "authorization_code",
      redirect_uri: redirectUri,
    }),
  });
  const tokenJson: unknown = await primaryRes.json().catch(() => ({}));
  const parsed = parseTikTokOAuthAccessTokenResult(tokenJson, primaryRes.ok);

  if (!parsed.ok || !parsed.access_token) {
    const back = new URL(returnTo, req.nextUrl.origin);
    back.searchParams.set("connected", "tiktok_error");
    back.searchParams.set(
      "reason",
      parsed.message || (typeof tokenJson === "object" && tokenJson && "message" in tokenJson
        ? String((tokenJson as { message?: string }).message)
        : "token_exchange_failed")
    );
    return NextResponse.redirect(back, { status: 302 });
  }

  const accessToken = parsed.access_token;
  const refreshTokenFromTikTok = parsed.refresh_token;
  const expiresIn = parsed.expires_in;
  const tokenExpiresAt = new Date(Date.now() + expiresIn * 1000).toISOString();
  const scopes = parsed.scope;
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

  const { data: existingAuth } = await admin
    .from("integrations_auth")
    .select("refresh_token")
    .eq("integration_id", canonicalInt.id)
    .maybeSingle();
  const existingRt = (existingAuth as { refresh_token?: string | null } | null)?.refresh_token ?? null;
  const mergedRefreshPreview = mergeRefreshTokenForUpsert(refreshTokenFromTikTok, existingRt);
  if (!mergedRefreshPreview) {
    console.warn("[TIKTOK_OAUTH_NO_REFRESH_TOKEN_AFTER_EXCHANGE]", {
      projectId,
      integration_id: canonicalInt.id,
      hint:
        "TikTok often omits refresh_token on re-consent if the app was not revoked; access ~24h. After full disconnect there is no old refresh to keep — revoke the app in TikTok Ads developer settings and authorize again to obtain a new refresh_token, or ensure token exchange includes redirect_uri matching authorize URL.",
    });
  }

  const debugEnvelope =
    process.env.NODE_ENV === "development" || process.env.TIKTOK_DEBUG_TOKEN_ENVELOPE === "1";

  const { error: authErr } = await upsertIntegrationsAuth(admin, {
    integration_id: canonicalInt.id,
    access_token: accessToken,
    refresh_token: refreshTokenFromTikTok,
    token_expires_at: tokenExpiresAt,
    scopes: scopes != null ? String(scopes) : null,
    meta: {
      expires_in: expiresIn,
      source: "tiktok_oauth_callback",
      ...(!mergedRefreshPreview ? { missing_refresh_token: true } : {}),
      ...(debugEnvelope ? { tiktok_token_envelope: summarizeTikTokTokenResponse(tokenJson) } : {}),
    },
    updated_at: nowIso,
  });

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
