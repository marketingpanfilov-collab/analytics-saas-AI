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
  error?: string;
  error_description?: string;
  message?: string;
};

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
  if (primaryRes.ok && primaryJson.access_token) {
    tokenJson = primaryJson;
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
    if (fallbackRes.ok && fallbackJson.access_token) tokenJson = fallbackJson;
  }

  if (!tokenJson?.access_token) return null;

  const newAccessToken = tokenJson.access_token.trim();
  const expiresIn = Number(tokenJson.expires_in ?? 86400);
  const tokenExpiresAt = new Date(Date.now() + expiresIn * 1000).toISOString();
  const newRefreshToken = tokenJson.refresh_token?.trim() || refreshToken;

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
