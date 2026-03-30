import type { SupabaseClient } from "@supabase/supabase-js";
import { fetchWithRetry } from "@/app/lib/networkRetry";

const TOKEN_URL = "https://oauth2.googleapis.com/token";
const EXPIRY_BUFFER_MS = 60 * 1000; // consider expired 1 min before actual expiry

/** Retries for token endpoint (transient 5xx / network). */
const REFRESH_FETCH_RETRIES = 3;
const REFRESH_INITIAL_DELAY_MS = 400;

type AuthRow = {
  access_token: string | null;
  refresh_token: string | null;
  token_expires_at: string | null;
};

export type GoogleAccessResolution =
  | { outcome: "valid"; access_token: string }
  | { outcome: "transient" }
  | { outcome: "permanent"; oauthError?: string };

type GoogleTokenJson = {
  access_token?: string;
  expires_in?: number;
  error?: string;
  error_description?: string;
};

function isPermanentGoogleOAuthError(error: string | undefined): boolean {
  if (!error) return false;
  const e = error.toLowerCase();
  return (
    e === "invalid_grant" ||
    e === "invalid_client" ||
    e === "unauthorized_client" ||
    e === "unsupported_grant_type" ||
    e === "invalid_scope"
  );
}

function isTransientHttpStatus(status: number): boolean {
  return status === 408 || status === 429 || (status >= 500 && status <= 599);
}

export type ResolveGoogleAccessTokenOpts = {
  forceRefresh?: boolean;
};

/**
 * Resolves a valid access token: uses current if not expired, otherwise refresh.
 * Classifies refresh failures as transient (retry later / not "disconnected") vs permanent (revoked / bad credentials).
 */
export async function resolveGoogleAccessToken(
  admin: SupabaseClient,
  integrationId: string,
  opts?: ResolveGoogleAccessTokenOpts
): Promise<GoogleAccessResolution> {
  const clientId = process.env.GOOGLE_CLIENT_ID;
  const clientSecret = process.env.GOOGLE_CLIENT_SECRET;

  if (!clientId || !clientSecret) {
    return { outcome: "permanent", oauthError: "missing_client_config" };
  }

  const { data: auth, error: authErr } = await admin
    .from("integrations_auth")
    .select("access_token, refresh_token, token_expires_at")
    .eq("integration_id", integrationId)
    .maybeSingle();

  if (authErr || !auth) {
    return { outcome: "permanent" };
  }

  const row = auth as AuthRow;
  const accessToken = row.access_token?.trim() || null;
  const refreshToken = row.refresh_token?.trim() || null;
  const expiresAt = row.token_expires_at ? new Date(row.token_expires_at).getTime() : null;

  const now = Date.now();
  const isExpired = expiresAt != null && expiresAt <= now + EXPIRY_BUFFER_MS;

  if (accessToken && !isExpired && !opts?.forceRefresh) {
    return { outcome: "valid", access_token: accessToken };
  }

  if (!refreshToken) {
    return { outcome: "permanent", oauthError: "no_refresh_token" };
  }

  const body = new URLSearchParams({
    client_id: clientId,
    client_secret: clientSecret,
    refresh_token: refreshToken,
    grant_type: "refresh_token",
  });

  let tokenRes: Response;
  try {
    tokenRes = await fetchWithRetry(
      TOKEN_URL,
      {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: body.toString(),
      },
      { retries: REFRESH_FETCH_RETRIES, initialDelayMs: REFRESH_INITIAL_DELAY_MS }
    );
  } catch {
    return { outcome: "transient" };
  }

  const tokenJson = (await tokenRes.json().catch(() => ({}))) as GoogleTokenJson;

  if (tokenJson.access_token) {
    const newAccessToken = tokenJson.access_token;
    const expiresIn = tokenJson.expires_in ?? 3600;
    const tokenExpiresAt = new Date(Date.now() + expiresIn * 1000).toISOString();

    await admin
      .from("integrations_auth")
      .update({
        access_token: newAccessToken,
        token_expires_at: tokenExpiresAt,
        updated_at: new Date().toISOString(),
      })
      .eq("integration_id", integrationId);

    return { outcome: "valid", access_token: newAccessToken };
  }

  const oauthErr = tokenJson.error;
  if (isPermanentGoogleOAuthError(oauthErr)) {
    return { outcome: "permanent", oauthError: oauthErr };
  }

  if (!tokenRes.ok && isTransientHttpStatus(tokenRes.status)) {
    return { outcome: "transient" };
  }

  if (oauthErr) {
    return { outcome: "permanent", oauthError: oauthErr };
  }

  if (!tokenRes.ok && tokenRes.status >= 400 && tokenRes.status < 500) {
    return { outcome: "permanent", oauthError: `http_${tokenRes.status}` };
  }

  return { outcome: "transient" };
}

/** Result for API routes: hard auth failure vs retryable refresh/network issues. */
export type GoogleAccessTokenApiResult =
  | { ok: true; access_token: string }
  | { ok: false; kind: "transient"; oauthError?: string }
  | { ok: false; kind: "permanent"; oauthError?: string };

const TOKEN_RESOLVE_MAX_ATTEMPTS = 4;
const TOKEN_RESOLVE_BACKOFF_MS = 400;

export type GetGoogleAccessTokenForApiOpts = ResolveGoogleAccessTokenOpts;

/**
 * Resolves Google access with retries on transient failures (rate limits, 5xx, network).
 */
export async function getGoogleAccessTokenForApi(
  admin: SupabaseClient,
  integrationId: string,
  opts?: GetGoogleAccessTokenForApiOpts
): Promise<GoogleAccessTokenApiResult> {
  for (let attempt = 1; attempt <= TOKEN_RESOLVE_MAX_ATTEMPTS; attempt++) {
    const r = await resolveGoogleAccessToken(admin, integrationId, attempt === 1 ? opts : undefined);
    if (r.outcome === "valid") return { ok: true, access_token: r.access_token };
    if (r.outcome === "permanent") {
      return { ok: false, kind: "permanent", oauthError: r.oauthError };
    }
    if (attempt < TOKEN_RESOLVE_MAX_ATTEMPTS) {
      await new Promise((res) => setTimeout(res, TOKEN_RESOLVE_BACKOFF_MS * attempt));
    }
  }
  return { ok: false, kind: "transient" };
}

/**
 * Returns a valid Google Ads access token, or null on any failure (backwards compatible for sync routes).
 */
export async function getValidGoogleAccessToken(
  admin: SupabaseClient,
  integrationId: string
): Promise<{ access_token: string } | null> {
  const r = await getGoogleAccessTokenForApi(admin, integrationId);
  if (r.ok) return { access_token: r.access_token };
  return null;
}
