import type { SupabaseClient } from "@supabase/supabase-js";

const TOKEN_URL = "https://oauth2.googleapis.com/token";
const EXPIRY_BUFFER_MS = 60 * 1000; // consider expired 1 min before actual expiry

type AuthRow = {
  access_token: string | null;
  refresh_token: string | null;
  token_expires_at: string | null;
};

/**
 * Returns a valid Google Ads access token for the given integration:
 * - uses current access_token if still valid (with 1 min buffer);
 * - otherwise refreshes using refresh_token and updates DB, then returns new access_token;
 * - returns null if no token, no refresh_token, or refresh failed.
 */
export async function getValidGoogleAccessToken(
  admin: SupabaseClient,
  integrationId: string
): Promise<{ access_token: string } | null> {
  const clientId = process.env.GOOGLE_CLIENT_ID;
  const clientSecret = process.env.GOOGLE_CLIENT_SECRET;

  if (!clientId || !clientSecret) {
    return null;
  }

  const { data: auth, error: authErr } = await admin
    .from("integrations_auth")
    .select("access_token, refresh_token, token_expires_at")
    .eq("integration_id", integrationId)
    .maybeSingle();

  if (authErr || !auth) {
    return null;
  }

  const row = auth as AuthRow;
  const accessToken = row.access_token?.trim() || null;
  const refreshToken = row.refresh_token?.trim() || null;
  const expiresAt = row.token_expires_at ? new Date(row.token_expires_at).getTime() : null;

  const now = Date.now();
  const isExpired = expiresAt != null && expiresAt <= now + EXPIRY_BUFFER_MS;

  if (accessToken && !isExpired) {
    return { access_token: accessToken };
  }

  if (!refreshToken) {
    return null;
  }

  const body = new URLSearchParams({
    client_id: clientId,
    client_secret: clientSecret,
    refresh_token: refreshToken,
    grant_type: "refresh_token",
  });

  const tokenRes = await fetch(TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: body.toString(),
  });

  const tokenJson = (await tokenRes.json().catch(() => ({}))) as {
    access_token?: string;
    expires_in?: number;
    error?: string;
    error_description?: string;
  };

  if (!tokenRes.ok || !tokenJson.access_token) {
    return null;
  }

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

  return { access_token: newAccessToken };
}
