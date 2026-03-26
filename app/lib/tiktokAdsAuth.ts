import type { SupabaseClient } from "@supabase/supabase-js";

const EXPIRY_BUFFER_MS = 60 * 1000;

type AuthRow = {
  access_token: string | null;
  refresh_token: string | null;
  token_expires_at: string | null;
};

type TikTokTokenResponse = {
  access_token?: string;
  refresh_token?: string;
  expires_in?: number;
  data?: {
    access_token?: string;
    refresh_token?: string;
    expires_in?: number;
  };
  error?: string;
  error_description?: string;
  message?: string;
};

function normalizeTokenPayload(payload: TikTokTokenResponse): {
  access_token: string | null;
  refresh_token: string | null;
  expires_in: number;
} {
  const accessToken = payload.access_token ?? payload.data?.access_token ?? null;
  const refreshToken = payload.refresh_token ?? payload.data?.refresh_token ?? null;
  const expiresIn = Number(payload.expires_in ?? payload.data?.expires_in ?? 86400);
  return {
    access_token: accessToken?.trim() || null,
    refresh_token: refreshToken?.trim() || null,
    expires_in: Number.isFinite(expiresIn) ? expiresIn : 86400,
  };
}

export async function getValidTikTokAccessToken(
  admin: SupabaseClient,
  integrationId: string
): Promise<{ access_token: string } | null> {
  const appId = process.env.TIKTOK_APP_ID || process.env.TIKTOK_CLIENT_KEY;
  const clientSecret = process.env.TIKTOK_CLIENT_SECRET;

  if (!appId || !clientSecret) return null;

  const { data: auth, error: authErr } = await admin
    .from("integrations_auth")
    .select("access_token, refresh_token, token_expires_at")
    .eq("integration_id", integrationId)
    .maybeSingle();

  if (authErr || !auth) return null;

  const row = auth as AuthRow;
  const accessToken = row.access_token?.trim() || null;
  const refreshToken = row.refresh_token?.trim() || null;
  const expiresAt = row.token_expires_at ? new Date(row.token_expires_at).getTime() : null;
  const isExpired = expiresAt != null && expiresAt <= Date.now() + EXPIRY_BUFFER_MS;

  if (accessToken && !isExpired) {
    return { access_token: accessToken };
  }

  if (!refreshToken) return null;

  let tokenJson: TikTokTokenResponse | null = null;
  let normalized: { access_token: string | null; refresh_token: string | null; expires_in: number } | null = null;

  // Primary: Marketing API v1.3 refresh.
  const primaryRes = await fetch("https://business-api.tiktok.com/open_api/v1.3/oauth2/access_token/", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      app_id: appId,
      secret: clientSecret,
      refresh_token: refreshToken,
      grant_type: "refresh_token",
    }),
  });
  const primaryJson = (await primaryRes.json().catch(() => ({}))) as TikTokTokenResponse;
  const primaryNormalized = normalizeTokenPayload(primaryJson);
  if (primaryRes.ok && primaryNormalized.access_token) {
    tokenJson = primaryJson;
    normalized = primaryNormalized;
  } else {
    // Fallback: OAuth v2 refresh.
    const fallbackBody = new URLSearchParams({
      client_key: appId,
      client_secret: clientSecret,
      grant_type: "refresh_token",
      refresh_token: refreshToken,
    });
    const fallbackRes = await fetch("https://open.tiktokapis.com/v2/oauth/token/", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: fallbackBody.toString(),
    });
    const fallbackJson = (await fallbackRes.json().catch(() => ({}))) as TikTokTokenResponse;
    const fallbackNormalized = normalizeTokenPayload(fallbackJson);
    if (fallbackRes.ok && fallbackNormalized.access_token) {
      tokenJson = fallbackJson;
      normalized = fallbackNormalized;
    }
  }

  if (!normalized?.access_token) return null;

  const newAccessToken = normalized.access_token;
  const expiresIn = normalized.expires_in;
  const tokenExpiresAt = new Date(Date.now() + expiresIn * 1000).toISOString();
  const newRefreshToken = normalized.refresh_token || refreshToken;

  await admin
    .from("integrations_auth")
    .update({
      access_token: newAccessToken,
      refresh_token: newRefreshToken,
      token_expires_at: tokenExpiresAt,
      updated_at: new Date().toISOString(),
    })
    .eq("integration_id", integrationId);

  return { access_token: newAccessToken };
}
