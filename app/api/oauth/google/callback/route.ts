import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/app/lib/supabaseAdmin";
import type { NextRequest } from "next/server";
import { upsertIntegrationsAuth } from "@/app/lib/integrationsAuthUpsert";

type GoogleTokenResponse = {
  access_token?: string;
  refresh_token?: string;
  expires_in?: number;
  scope?: string;
  token_type?: string;
  error?: string;
  error_description?: string;
};

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

/**
 * GET /api/oauth/google/callback
 * Exchanges code for tokens, upserts integrations + integrations_auth (shared layer only).
 */
export async function GET(req: NextRequest) {
  const { searchParams } = req.nextUrl;
  const code = searchParams.get("code");
  const stateRaw = searchParams.get("state");
  const errorParam = searchParams.get("error");

  const clientId = process.env.GOOGLE_CLIENT_ID;
  const clientSecret = process.env.GOOGLE_CLIENT_SECRET;
  const redirectUri = process.env.GOOGLE_REDIRECT_URI;

  if (!clientId || !clientSecret || !redirectUri) {
    return NextResponse.json(
      { success: false, error: "Google OAuth env vars not set" },
      { status: 500 }
    );
  }

  const st = parseState(stateRaw);
  if (!st) {
    return NextResponse.json(
      { success: false, error: "Invalid or missing OAuth state" },
      { status: 400 }
    );
  }

  const projectIdRaw = st.project_id ?? "";
  if (!projectIdRaw.trim()) {
    return NextResponse.json(
      { success: false, error: "project_id missing in OAuth state" },
      { status: 400 }
    );
  }

  if (!isUuid(projectIdRaw)) {
    return NextResponse.json(
      { success: false, error: "project_id in state is not a valid UUID" },
      { status: 400 }
    );
  }

  const projectId = projectIdRaw;
  const returnTo = safeReturnTo(st.return_to);

  if (errorParam) {
    const back = new URL(returnTo, req.nextUrl.origin);
    back.searchParams.set("project_id", projectId);
    back.searchParams.set("connected", "google_error");
    back.searchParams.set("reason", errorParam);
    return NextResponse.redirect(back, { status: 302 });
  }

  if (!code) {
    const back = new URL(returnTo, req.nextUrl.origin);
    back.searchParams.set("project_id", projectId);
    back.searchParams.set("connected", "google_error");
    back.searchParams.set("reason", "no_code");
    return NextResponse.redirect(back, { status: 302 });
  }

  const admin = supabaseAdmin();

  const { data: proj } = await admin
    .from("projects")
    .select("id")
    .eq("id", projectId)
    .maybeSingle();

  if (!proj) {
    const back = new URL(returnTo, req.nextUrl.origin);
    back.searchParams.set("connected", "google_error");
    back.searchParams.set("reason", "project_not_found");
    return NextResponse.redirect(back, { status: 302 });
  }

  const tokenUrl = "https://oauth2.googleapis.com/token";
  const body = new URLSearchParams({
    code,
    client_id: clientId,
    client_secret: clientSecret,
    redirect_uri: redirectUri,
    grant_type: "authorization_code",
  });

  const tokenRes = await fetch(tokenUrl, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: body.toString(),
  });

  const tokenJson = (await tokenRes.json().catch(() => ({}))) as GoogleTokenResponse;

  if (!tokenRes.ok || !tokenJson.access_token) {
    const back = new URL(returnTo, req.nextUrl.origin);
    back.searchParams.set("connected", "google_error");
    back.searchParams.set("reason", tokenJson.error_description || tokenJson.error || "token_exchange_failed");
    return NextResponse.redirect(back, { status: 302 });
  }

  const accessToken = tokenJson.access_token;
  const refreshTokenFromGoogle = tokenJson.refresh_token?.trim() || null;
  const expiresIn = tokenJson.expires_in ?? null;
  const tokenExpiresAt =
    expiresIn != null ? new Date(Date.now() + expiresIn * 1000).toISOString() : null;
  const scopes = tokenJson.scope ?? null;

  const nowIso = new Date().toISOString();

  const { data: canonicalInt, error: intUpsertErr } = await admin
    .from("integrations")
    .upsert(
      {
        project_id: projectId,
        platform: "google",
        integration_type: "oauth",
        name: "Google Ads",
        status: "active",
        updated_at: nowIso,
      },
      { onConflict: "project_id,platform" }
    )
    .select("id")
    .single();

  if (intUpsertErr || !canonicalInt?.id) {
    const back = new URL(returnTo, req.nextUrl.origin);
    back.searchParams.set("connected", "google_error");
    back.searchParams.set("reason", "integrations_upsert_failed");
    return NextResponse.redirect(back, { status: 302 });
  }

  const { error: authErr } = await upsertIntegrationsAuth(admin, {
    integration_id: canonicalInt.id,
    access_token: accessToken,
    refresh_token: refreshTokenFromGoogle,
    token_expires_at: tokenExpiresAt,
    scopes,
    meta: {
      token_type: tokenJson.token_type ?? null,
      expires_in: expiresIn,
      source: "google_oauth_callback",
    },
    updated_at: nowIso,
  });

  if (authErr) {
    const back = new URL(returnTo, req.nextUrl.origin);
    back.searchParams.set("connected", "google_error");
    back.searchParams.set("reason", "integrations_auth_upsert_failed");
    return NextResponse.redirect(back, { status: 302 });
  }

  const successUrl = new URL(returnTo, req.nextUrl.origin);
  successUrl.searchParams.set("connected", "google");
  return NextResponse.redirect(successUrl, { status: 302 });
}
