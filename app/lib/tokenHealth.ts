import type { SupabaseClient } from "@supabase/supabase-js";
import { getValidGoogleAccessToken } from "@/app/lib/googleAdsAuth";
import { getValidTikTokAccessToken } from "@/app/lib/tiktokAdsAuth";

const EXPIRY_BUFFER_MS = 60 * 1000;

export type TokenHealthReasonCode =
  | "ok"
  | "not_connected"
  | "token_expired"
  | "refresh_failed"
  | "permissions_revoked"
  | "account_unavailable"
  | "token_missing"
  | "temporary_oauth_failure";

export type TokenHealthResult = {
  connected: boolean;
  oauth_valid: boolean;
  reason_code: TokenHealthReasonCode;
  temporary: boolean;
  last_recovery_attempt_at: string | null;
};

type IntegrationsAuthRow = {
  access_token: string | null;
  refresh_token: string | null;
  token_expires_at: string | null;
  updated_at?: string | null;
};

function isExpired(tokenExpiresAt: string | null): boolean {
  if (!tokenExpiresAt) return false;
  const ts = Date.parse(tokenExpiresAt);
  if (!Number.isFinite(ts)) return false;
  return ts <= Date.now() + EXPIRY_BUFFER_MS;
}

async function getIntegrationsAuth(
  admin: SupabaseClient,
  integrationId: string
): Promise<IntegrationsAuthRow | null> {
  const { data, error } = await admin
    .from("integrations_auth")
    .select("access_token, refresh_token, token_expires_at, updated_at")
    .eq("integration_id", integrationId)
    .maybeSingle();
  if (error || !data) return null;
  return data as IntegrationsAuthRow;
}

type DebugTokenResponse = {
  data?: { is_valid?: boolean };
};

async function fbDebugToken(userToken: string): Promise<DebugTokenResponse> {
  const appId = process.env.META_APP_ID;
  const appSecret = process.env.META_APP_SECRET;
  if (!appId || !appSecret) throw new Error("META_APP_ID / META_APP_SECRET missing");
  const appToken = `${appId}|${appSecret}`;
  const url =
    "https://graph.facebook.com/v19.0/debug_token?" +
    new URLSearchParams({ input_token: userToken, access_token: appToken }).toString();
  const r = await fetch(url, { method: "GET" });
  return (await r.json()) as DebugTokenResponse;
}

export async function getMetaTokenHealth(
  accessToken: string | null,
  expiresAt: string | null
): Promise<TokenHealthResult> {
  if (!accessToken) {
    return {
      connected: false,
      oauth_valid: false,
      reason_code: "token_missing",
      temporary: false,
      last_recovery_attempt_at: null,
    };
  }
  if (isExpired(expiresAt)) {
    return {
      connected: true,
      oauth_valid: false,
      reason_code: "token_expired",
      temporary: false,
      last_recovery_attempt_at: new Date().toISOString(),
    };
  }
  try {
    const dbg = await fbDebugToken(accessToken);
    const valid = !!dbg?.data?.is_valid;
    if (!valid) {
      return {
        connected: true,
        oauth_valid: false,
        reason_code: "permissions_revoked",
        temporary: false,
        last_recovery_attempt_at: new Date().toISOString(),
      };
    }
    return {
      connected: true,
      oauth_valid: true,
      reason_code: "ok",
      temporary: false,
      last_recovery_attempt_at: null,
    };
  } catch {
    return {
      connected: true,
      oauth_valid: false,
      reason_code: "temporary_oauth_failure",
      temporary: true,
      last_recovery_attempt_at: new Date().toISOString(),
    };
  }
}

export async function getGoogleTokenHealth(
  admin: SupabaseClient,
  integrationId: string
): Promise<TokenHealthResult> {
  const before = await getIntegrationsAuth(admin, integrationId);
  if (!before?.access_token && !before?.refresh_token) {
    return {
      connected: true,
      oauth_valid: false,
      reason_code: "token_missing",
      temporary: false,
      last_recovery_attempt_at: null,
    };
  }

  const wasExpired = isExpired(before?.token_expires_at ?? null);
  try {
    const token = await getValidGoogleAccessToken(admin, integrationId);
    if (token) {
      return {
        connected: true,
        oauth_valid: true,
        reason_code: "ok",
        temporary: false,
        last_recovery_attempt_at: wasExpired ? new Date().toISOString() : null,
      };
    }
    return {
      connected: true,
      oauth_valid: false,
      reason_code: before?.refresh_token ? "refresh_failed" : wasExpired ? "token_expired" : "token_missing",
      temporary: false,
      last_recovery_attempt_at: new Date().toISOString(),
    };
  } catch {
    return {
      connected: true,
      oauth_valid: false,
      reason_code: "temporary_oauth_failure",
      temporary: true,
      last_recovery_attempt_at: new Date().toISOString(),
    };
  }
}

export async function getTikTokTokenHealth(
  admin: SupabaseClient,
  integrationId: string
): Promise<TokenHealthResult> {
  const before = await getIntegrationsAuth(admin, integrationId);
  if (!before?.access_token && !before?.refresh_token) {
    return {
      connected: true,
      oauth_valid: false,
      reason_code: "token_missing",
      temporary: false,
      last_recovery_attempt_at: null,
    };
  }

  const wasExpired = isExpired(before?.token_expires_at ?? null);
  try {
    const token = await getValidTikTokAccessToken(admin, integrationId);
    if (token) {
      return {
        connected: true,
        oauth_valid: true,
        reason_code: "ok",
        temporary: false,
        last_recovery_attempt_at: wasExpired ? new Date().toISOString() : null,
      };
    }
    return {
      connected: true,
      oauth_valid: false,
      reason_code: before?.refresh_token ? "refresh_failed" : wasExpired ? "token_expired" : "token_missing",
      temporary: false,
      last_recovery_attempt_at: new Date().toISOString(),
    };
  } catch {
    return {
      connected: true,
      oauth_valid: false,
      reason_code: "temporary_oauth_failure",
      temporary: true,
      last_recovery_attempt_at: new Date().toISOString(),
    };
  }
}

