import type { SupabaseClient } from "@supabase/supabase-js";
import { fetchWithRetry } from "@/app/lib/networkRetry";

const EXPIRY_BUFFER_MS = 60 * 1000;
const REFRESH_FETCH_RETRIES = 3;
const REFRESH_INITIAL_DELAY_MS = 500;

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
    scope?: string;
    access_token_info?: { access_token?: string; refresh_token?: string; expires_in?: number };
  };
  error?: string;
  error_description?: string;
  message?: string;
  /** TikTok Marketing API envelope: 0 = OK */
  code?: number;
};

export type TikTokAccessResolution =
  | { outcome: "valid"; access_token: string }
  | { outcome: "transient" }
  | { outcome: "permanent"; detail?: string };

function asRecord(v: unknown): Record<string, unknown> | null {
  if (v && typeof v === "object" && !Array.isArray(v)) return v as Record<string, unknown>;
  return null;
}

function strField(v: unknown): string | null {
  if (v == null) return null;
  const s = String(v).trim();
  return s !== "" ? s : null;
}

/** TikTok sometimes returns `data` as JSON string, or as array of objects. */
function normalizeTiktokEnvelopeData(root: Record<string, unknown>): Record<string, unknown> | null {
  const d = root.data;
  if (d == null) return null;
  if (typeof d === "string") {
    try {
      const p = JSON.parse(d) as unknown;
      if (Array.isArray(p) && p.length > 0) return asRecord(p[0]);
      return asRecord(p);
    } catch {
      return null;
    }
  }
  if (Array.isArray(d) && d.length > 0) {
    return asRecord(d[0]) ?? null;
  }
  return asRecord(d);
}

function formatTiktokScope(raw: unknown): string | null {
  if (raw == null) return null;
  if (Array.isArray(raw)) {
    const s = raw.map((x) => String(x)).join(",");
    return s.trim() !== "" ? s : null;
  }
  const s = String(raw).trim();
  return s !== "" ? s : null;
}

/** Last-resort: find refresh_token / refreshToken anywhere in JSON (bounded depth). */
function deepFindRefreshToken(node: unknown, depth: number, maxDepth: number): string | null {
  if (depth > maxDepth || node == null) return null;
  if (Array.isArray(node)) {
    for (const item of node) {
      const r = deepFindRefreshToken(item, depth + 1, maxDepth);
      if (r) return r;
    }
    return null;
  }
  if (typeof node !== "object") return null;
  const o = node as Record<string, unknown>;
  for (const k of ["refresh_token", "refreshToken"] as const) {
    const v = o[k];
    if (typeof v === "string" && v.trim() !== "") return v.trim();
  }
  for (const v of Object.values(o)) {
    const r = deepFindRefreshToken(v, depth + 1, maxDepth);
    if (r) return r;
  }
  return null;
}

const TIKTOK_OAUTH_ACCESS_TOKEN_URL = "https://business-api.tiktok.com/open_api/v1.3/oauth2/access_token/";
const TIKTOK_OAUTH_REFRESH_TOKEN_URL = "https://business-api.tiktok.com/open_api/v1.3/oauth2/refresh_token/";

/**
 * Parses TikTok Marketing API `POST .../oauth2/access_token/` JSON (auth_code or refresh_token grant).
 * Respects envelope `code !== 0` and reads tokens from `data` or top-level (and optional `access_token_info`).
 */
export function parseTikTokOAuthAccessTokenResult(
  payload: unknown,
  httpOk: boolean
): {
  ok: boolean;
  access_token: string | null;
  refresh_token: string | null;
  expires_in: number;
  scope: string | null;
  message: string | null;
  api_code?: number;
} {
  const root = asRecord(payload);
  if (!root) {
    return {
      ok: false,
      access_token: null,
      refresh_token: null,
      expires_in: 86400,
      scope: null,
      message: httpOk ? "invalid_response_body" : "http_error",
    };
  }

  const rawCode = root.code;
  const numericCode =
    typeof rawCode === "number" && Number.isFinite(rawCode)
      ? rawCode
      : typeof rawCode === "string" && rawCode.trim() !== "" && Number.isFinite(Number(rawCode))
        ? Number(rawCode)
        : null;
  if (numericCode !== null && numericCode !== 0) {
    return {
      ok: false,
      access_token: null,
      refresh_token: null,
      expires_in: 86400,
      scope: null,
      message:
        strField(root.message) ||
        strField(root.error_description) ||
        strField(root.error) ||
        `tiktok_code_${numericCode}`,
      api_code: numericCode,
    };
  }

  const data = normalizeTiktokEnvelopeData(root);
  const layer = data ?? root;
  const tokenInfo = asRecord(layer.access_token_info);

  const accessToken =
    strField(layer.access_token) ??
    strField(tokenInfo?.access_token) ??
    strField(root.access_token);

  let refreshToken =
    strField(layer.refresh_token) ??
    strField(tokenInfo?.refresh_token) ??
    strField(root.refresh_token);

  if (!refreshToken) {
    refreshToken = deepFindRefreshToken(root, 0, 8);
  }

  const expRaw = layer.expires_in ?? tokenInfo?.expires_in ?? root.expires_in;
  const expiresIn = Number(expRaw ?? 86400);

  const scope = formatTiktokScope(layer.scope ?? root.scope);

  if (!accessToken) {
    return {
      ok: false,
      access_token: null,
      refresh_token: refreshToken,
      expires_in: Number.isFinite(expiresIn) ? expiresIn : 86400,
      scope,
      message: strField(root.message) || "no_access_token",
    };
  }

  return {
    ok: true,
    access_token: accessToken,
    refresh_token: refreshToken,
    expires_in: Number.isFinite(expiresIn) ? expiresIn : 86400,
    scope,
    message: null,
  };
}

function normalizeTokenPayload(payload: TikTokTokenResponse): {
  access_token: string | null;
  refresh_token: string | null;
  expires_in: number;
} {
  const parsed = parseTikTokOAuthAccessTokenResult(payload as unknown, true);
  return {
    access_token: parsed.access_token,
    refresh_token: parsed.refresh_token,
    expires_in: parsed.expires_in,
  };
}

function isTransientHttpStatus(status: number): boolean {
  return status === 408 || status === 429 || (status >= 500 && status <= 599);
}

/** TikTok API `code !== 0` often indicates a logical error; some codes are retryable. */
function classifyTikTokRefreshFailure(res: Response, raw: TikTokTokenResponse): "transient" | "permanent" {
  const msg = String(raw.message || raw.error || raw.error_description || "").toLowerCase();
  const apiCode = raw.code;

  if (isTransientHttpStatus(res.status)) return "transient";

  if (typeof apiCode === "number" && apiCode !== 0) {
    if (msg.includes("rate") || msg.includes("limit") || msg.includes("throttle") || msg.includes("too many")) {
      return "transient";
    }
    // Typical OAuth / token invalidity on TikTok Marketing API
    if (apiCode >= 40000 && apiCode < 41000) return "permanent";
    if (apiCode >= 50000) return "transient";
    return "permanent";
  }

  if (msg.includes("invalid") && (msg.includes("refresh") || msg.includes("token") || msg.includes("grant"))) {
    return "permanent";
  }
  if (msg.includes("revoke") || (msg.includes("expired") && msg.includes("refresh"))) return "permanent";

  if (!res.ok && isTransientHttpStatus(res.status)) return "transient";
  if (!res.ok && res.status >= 400 && res.status < 500) return "permanent";

  return "transient";
}

export type ResolveTikTokAccessTokenOpts = {
  /** If true, skip cached non-expired access_token and refresh when refresh_token exists. */
  forceRefresh?: boolean;
};

/**
 * Resolves TikTok access token with refresh classification (transient vs permanent).
 */
export async function resolveTikTokAccessToken(
  admin: SupabaseClient,
  integrationId: string,
  opts?: ResolveTikTokAccessTokenOpts
): Promise<TikTokAccessResolution> {
  const appId = process.env.TIKTOK_APP_ID || process.env.TIKTOK_CLIENT_KEY;
  const clientSecret = process.env.TIKTOK_CLIENT_SECRET;

  if (!appId || !clientSecret) {
    return { outcome: "permanent", detail: "missing_client_config" };
  }

  const { data: auth, error: authErr } = await admin
    .from("integrations_auth")
    .select("access_token, refresh_token, token_expires_at")
    .eq("integration_id", integrationId)
    .maybeSingle();

  if (authErr || !auth) return { outcome: "permanent" };

  const row = auth as AuthRow;
  const accessToken = row.access_token?.trim() || null;
  const refreshToken = row.refresh_token?.trim() || null;
  const expiresAt = row.token_expires_at ? new Date(row.token_expires_at).getTime() : null;
  const isExpired = expiresAt != null && expiresAt <= Date.now() + EXPIRY_BUFFER_MS;
  const forceRefresh = opts?.forceRefresh === true;

  if (accessToken && !forceRefresh && !isExpired) {
    return { outcome: "valid", access_token: accessToken };
  }

  // TikTok support: some apps get long-term access token without refresh_token.
  // In this mode token can remain valid after token_expires_at from initial envelope.
  if (!refreshToken) {
    if (accessToken && !forceRefresh) return { outcome: "valid", access_token: accessToken };
    if (accessToken && forceRefresh) {
      return { outcome: "permanent", detail: "no_refresh_token_cannot_rotate" };
    }
    return { outcome: "permanent", detail: "no_refresh_token" };
  }

  let primaryRes: Response;
  try {
    primaryRes = await fetchWithRetry(
      TIKTOK_OAUTH_REFRESH_TOKEN_URL,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          app_id: appId,
          secret: clientSecret,
          refresh_token: refreshToken,
          grant_type: "refresh_token",
        }),
      },
      { retries: REFRESH_FETCH_RETRIES, initialDelayMs: REFRESH_INITIAL_DELAY_MS }
    );
  } catch {
    return { outcome: "transient" };
  }

  let primaryJson = (await primaryRes.json().catch(() => ({}))) as TikTokTokenResponse;

  // Legacy: some tenants only accept refresh on access_token URL.
  if (!primaryRes.ok || (typeof primaryJson.code === "number" && primaryJson.code !== 0)) {
    try {
      const fallbackRes = await fetchWithRetry(
        TIKTOK_OAUTH_ACCESS_TOKEN_URL,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            app_id: appId,
            secret: clientSecret,
            refresh_token: refreshToken,
            grant_type: "refresh_token",
          }),
        },
        { retries: 1, initialDelayMs: REFRESH_INITIAL_DELAY_MS }
      );
      const fallbackJson = (await fallbackRes.json().catch(() => ({}))) as TikTokTokenResponse;
      if (fallbackRes.ok && (!fallbackJson.code || fallbackJson.code === 0)) {
        primaryRes = fallbackRes;
        primaryJson = fallbackJson;
      }
    } catch {
      /* keep primaryRes for classify */
    }
  }

  const primaryNormalized = normalizeTokenPayload(primaryJson);

  if (primaryNormalized.access_token) {
    const newAccessToken = primaryNormalized.access_token;
    const expiresIn = primaryNormalized.expires_in;
    const tokenExpiresAt = new Date(Date.now() + expiresIn * 1000).toISOString();
    const newRefreshToken = primaryNormalized.refresh_token || refreshToken;

    await admin
      .from("integrations_auth")
      .update({
        access_token: newAccessToken,
        refresh_token: newRefreshToken,
        token_expires_at: tokenExpiresAt,
        updated_at: new Date().toISOString(),
      })
      .eq("integration_id", integrationId);

    return { outcome: "valid", access_token: newAccessToken };
  }

  const kind = classifyTikTokRefreshFailure(primaryRes, primaryJson);
  if (kind === "transient") return { outcome: "transient" };
  return {
    outcome: "permanent",
    detail: primaryJson.message || primaryJson.error || primaryJson.error_description || `http_${primaryRes.status}`,
  };
}

/** Result for API routes: distinguish hard auth failure vs retryable refresh/network issues. */
export type TikTokAccessTokenApiResult =
  | { ok: true; access_token: string }
  | { ok: false; kind: "transient"; detail?: string }
  | { ok: false; kind: "permanent"; detail?: string };

const TOKEN_RESOLVE_MAX_ATTEMPTS = 4;
const TOKEN_RESOLVE_BACKOFF_MS = 400;

/**
 * Resolves TikTok access with retries on transient failures (rate limits, TikTok 5xx, network).
 * Use this in HTTP handlers so transient issues return 503, not 401 (user should not "reconnect").
 */
export type GetTikTokAccessTokenForApiOpts = ResolveTikTokAccessTokenOpts;

export async function getTikTokAccessTokenForApi(
  admin: SupabaseClient,
  integrationId: string,
  opts?: GetTikTokAccessTokenForApiOpts
): Promise<TikTokAccessTokenApiResult> {
  for (let attempt = 1; attempt <= TOKEN_RESOLVE_MAX_ATTEMPTS; attempt++) {
    // forceRefresh only on first attempt; later attempts rely on updated DB row after refresh.
    const r = await resolveTikTokAccessToken(admin, integrationId, attempt === 1 ? opts : undefined);
    if (r.outcome === "valid") return { ok: true, access_token: r.access_token };
    if (r.outcome === "permanent") {
      return { ok: false, kind: "permanent", detail: r.detail };
    }
    if (attempt < TOKEN_RESOLVE_MAX_ATTEMPTS) {
      await new Promise((res) => setTimeout(res, TOKEN_RESOLVE_BACKOFF_MS * attempt));
    }
  }
  return { ok: false, kind: "transient" };
}

export async function getValidTikTokAccessToken(
  admin: SupabaseClient,
  integrationId: string
): Promise<{ access_token: string } | null> {
  const r = await getTikTokAccessTokenForApi(admin, integrationId);
  if (r.ok) return { access_token: r.access_token };
  return null;
}
