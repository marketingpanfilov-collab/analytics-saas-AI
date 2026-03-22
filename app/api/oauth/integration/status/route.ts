import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/app/lib/supabaseAdmin";
import { getMetaIntegrationForProject } from "@/app/lib/metaIntegration";
import { getValidGoogleAccessToken } from "@/app/lib/googleAdsAuth";

export type IntegrationStatusValue = "healthy" | "error" | "stale" | "disconnected" | "no_accounts" | "not_connected";

export type IntegrationStatusRow = {
  platform: string;
  connected: boolean;
  oauth_valid: boolean;
  enabled_accounts: number;
  status: IntegrationStatusValue;
  reason: string | null;
  /** Optional: Meta/Google integration id for UI (e.g. connections/save). */
  integration_id?: string | null;
  /** Last sync run: status (ok | error | running), started_at, error message. */
  last_sync_status?: string | null;
  last_sync_at?: string | null;
  last_sync_error?: string | null;
  /** Max date in daily_ad_metrics for this project+platform (data freshness). */
  data_max_date?: string | null;
};

const DATA_FRESHNESS_THRESHOLD_MINUTES = 20;

/** Fetch last sync run (by started_at) and max(date) for project+platform. Uses limit(1) to avoid maybeSingle() failures. */
async function getSyncAndFreshness(
  admin: ReturnType<typeof supabaseAdmin>,
  projectId: string,
  platform: string
): Promise<{
  last_sync_status: string | null;
  last_sync_at: string | null;
  last_sync_error: string | null;
  data_max_date: string | null;
}> {
  try {
    const [syncRes, metricsRes] = await Promise.all([
      admin
        .from("sync_runs")
        .select("status, started_at, error_message, error_text")
        .eq("project_id", projectId)
        .eq("platform", platform)
        .order("started_at", { ascending: false })
        .limit(1),
      admin
        .from("daily_ad_metrics")
        .select("date")
        .eq("project_id", projectId)
        .eq("platform", platform)
        .order("date", { ascending: false })
        .limit(1),
    ]);

    const run = (syncRes.data as { status?: string; started_at?: string; error_message?: string | null; error_text?: string | null }[] | null)?.[0] ?? null;
    const metricsRow = (metricsRes.data as { date?: string }[] | null)?.[0] ?? null;
    return {
      last_sync_status: run?.status ?? null,
      last_sync_at: run?.started_at ?? null,
      last_sync_error: run?.error_text ?? run?.error_message ?? null,
      data_max_date: metricsRow?.date ?? null,
    };
  } catch (e) {
    console.error("[INTEGRATION_STATUS_GET_SYNC_FRESHNESS]", { projectId, platform, error: e });
    return { last_sync_status: null, last_sync_at: null, last_sync_error: null, data_max_date: null };
  }
}

/** Compute status from OAuth + enabled_accounts + last_sync + data freshness. Never healthy if last_sync_status === 'error'. */
function resolveDataStatus(
  enabled_accounts: number,
  last_sync_status: string | null,
  last_sync_at: string | null,
  data_max_date: string | null
): { status: IntegrationStatusValue; reason: string | null } {
  const today = new Date().toISOString().slice(0, 10);
  const now = Date.now();
  const lastSyncMs = last_sync_at ? new Date(last_sync_at).getTime() : 0;
  const thresholdMs = DATA_FRESHNESS_THRESHOLD_MINUTES * 60 * 1000;
  const staleThreshold = lastSyncMs > 0 ? now - lastSyncMs > thresholdMs : true;

  if (enabled_accounts === 0) {
    return { status: "no_accounts", reason: null };
  }

  if (last_sync_status === "error") {
    return { status: "error", reason: "sync_failed" };
  }

  if (data_max_date == null || data_max_date < today) {
    if (staleThreshold) {
      return { status: "error", reason: "no_data_updates_today" };
    }
    return { status: "stale", reason: "data_behind" };
  }

  if (staleThreshold) {
    return { status: "stale", reason: "sync_old" };
  }

  return { status: "healthy", reason: null };
}

/**
 * Same resolver as Google sync: get integration row by project_id + platform.
 * Uses limit(1) + order (no maybeSingle) to handle multiple rows.
 */
async function getGoogleIntegrationForProject(
  admin: ReturnType<typeof supabaseAdmin>,
  projectId: string
): Promise<{ id: string } | null> {
  try {
    const { data: rows, error } = await admin
      .from("integrations")
      .select("id")
      .eq("project_id", projectId)
      .eq("platform", "google")
      .order("created_at", { ascending: false })
      .limit(1);

    if (error || !rows?.length) return null;
    return { id: (rows[0] as { id: string }).id };
  } catch (e) {
    console.error("[INTEGRATION_STATUS_GET_GOOGLE]", { projectId, error: e });
    return null;
  }
}

/**
 * Fallback: infer integration_id from existing data (daily_ad_metrics -> ad_accounts).
 * Used so we never show "not_connected" when sync has already written data.
 */
async function getIntegrationIdFromData(
  admin: ReturnType<typeof supabaseAdmin>,
  projectId: string,
  platform: string
): Promise<string | null> {
  try {
    const { data: metricsRows } = await admin
      .from("daily_ad_metrics")
      .select("ad_account_id")
      .eq("project_id", projectId)
      .eq("platform", platform)
      .limit(50);

    const adAccountIds = [...new Set((metricsRows ?? []).map((r: { ad_account_id: string }) => r.ad_account_id).filter(Boolean))];
    if (adAccountIds.length === 0) return null;

    const { data: adRows } = await admin
      .from("ad_accounts")
      .select("integration_id")
      .in("id", adAccountIds)
      .limit(1);

    const first = (adRows ?? [])[0] as { integration_id?: string | null } | undefined;
    return first?.integration_id ?? null;
  } catch (e) {
    console.error("[INTEGRATION_STATUS_GET_INTEGRATION_FROM_DATA]", { projectId, platform, error: e });
    return null;
  }
}

async function fbDebugToken(userToken: string): Promise<{ data?: { is_valid?: boolean; error?: { message?: string } }; error?: { message?: string } }> {
  const appId = process.env.META_APP_ID;
  const appSecret = process.env.META_APP_SECRET;
  if (!appId || !appSecret) throw new Error("META_APP_ID / META_APP_SECRET missing");
  const appToken = `${appId}|${appSecret}`;
  const url =
    "https://graph.facebook.com/v19.0/debug_token?" +
    new URLSearchParams({ input_token: userToken, access_token: appToken }).toString();
  const r = await fetch(url, { method: "GET" });
  return r.json();
}

/** Canonical integration id for counting ad_accounts. Uses limit(1), no maybeSingle. */
async function getCanonicalIntegrationId(
  admin: ReturnType<typeof supabaseAdmin>,
  projectId: string,
  platform: string
): Promise<string | null> {
  try {
    const { data: rows } = await admin
      .from("integrations")
      .select("id")
      .eq("project_id", projectId)
      .eq("platform", platform)
      .order("created_at", { ascending: false })
      .limit(1);

    const row = (rows ?? [])[0] as { id?: string } | undefined;
    return row?.id ?? null;
  } catch (e) {
    console.error("[INTEGRATION_STATUS_GET_CANONICAL_ID]", { projectId, platform, error: e });
    return null;
  }
}

async function countEnabledAccounts(
  admin: ReturnType<typeof supabaseAdmin>,
  projectId: string,
  canonicalIntegrationId: string
): Promise<number> {
  try {
    const { data: adRows } = await admin
      .from("ad_accounts")
      .select("id")
      .eq("integration_id", canonicalIntegrationId);
    const adIds = (adRows ?? []).map((r: { id: string }) => r.id);
    if (adIds.length === 0) return 0;
    const { data: setRows } = await admin
      .from("ad_account_settings")
      .select("ad_account_id")
      .eq("project_id", projectId)
      .eq("is_enabled", true)
      .in("ad_account_id", adIds);
    return (setRows ?? []).length;
  } catch (e) {
    console.error("[INTEGRATION_STATUS_COUNT_ACCOUNTS]", { projectId, error: e });
    return 0;
  }
}

function safePush(
  integrations: IntegrationStatusRow[],
  row: IntegrationStatusRow
): void {
  integrations.push({
    ...row,
    reason: row.reason ?? null,
  });
}

/**
 * GET /api/oauth/integration/status?project_id=...
 * Returns status for all platforms (meta, google, tiktok).
 * Uses same resolvers as sync routes. Never returns 500. Never shows not_connected when data exists.
 */
export async function GET(req: Request) {
  const projectIdRaw = (() => {
    try {
      const { searchParams } = new URL(req.url);
      return searchParams.get("project_id");
    } catch {
      return null;
    }
  })();
  const projectId = projectIdRaw?.trim() ?? "";

  if (!projectId) {
    return NextResponse.json({ success: false, error: "project_id required" }, { status: 400 });
  }

  let admin: ReturnType<typeof supabaseAdmin>;
  try {
    admin = supabaseAdmin();
  } catch (e) {
    console.error("[INTEGRATION_STATUS_SUPABASE_INIT]", { error: e });
    return NextResponse.json({
      success: true,
      integrations: [
        { platform: "meta", connected: false, oauth_valid: false, enabled_accounts: 0, status: "error" as const, reason: "internal_error", integration_id: null },
        { platform: "google", connected: false, oauth_valid: false, enabled_accounts: 0, status: "error" as const, reason: "internal_error", integration_id: null },
        { platform: "tiktok", connected: false, oauth_valid: false, enabled_accounts: 0, status: "not_connected" as const, reason: null, integration_id: null },
      ],
    });
  }

  const integrations: IntegrationStatusRow[] = [];
  const platforms = ["meta", "google", "tiktok"] as const;

  for (const platform of platforms) {
    try {
      if (platform === "meta") {
        let reason: string | null = null;
        let integration: Awaited<ReturnType<typeof getMetaIntegrationForProject>> = null;
        try {
          integration = await getMetaIntegrationForProject(admin, projectId);
        } catch (e) {
          console.error("[INTEGRATION_STATUS_META_RESOLVER]", { projectId, error: e });
        }
        const hasResolverIntegration = !!(integration?.id && integration?.access_token);
        let connected = hasResolverIntegration;
        let integrationId: string | null = integration?.id ?? null;
        let oauth_valid = false;

        if (!hasResolverIntegration) {
          const fallbackId = await getIntegrationIdFromData(admin, projectId, "meta");
          if (fallbackId) {
            connected = true;
            integrationId = fallbackId;
            oauth_valid = false;
            reason = "disconnected";
          }
        }

        if (!connected) {
          safePush(integrations, {
            platform: "meta",
            connected: false,
            oauth_valid: false,
            enabled_accounts: 0,
            status: "not_connected",
            reason: null,
            integration_id: null,
          });
          continue;
        }

        if (hasResolverIntegration && integration) {
          const expiresAtMs = integration.expires_at ? new Date(integration.expires_at).getTime() : 0;
          if (expiresAtMs > 0 && expiresAtMs <= Date.now()) {
            oauth_valid = false;
            reason = "disconnected";
          } else {
            try {
              const dbg = await fbDebugToken(integration.access_token!);
              oauth_valid = !!dbg?.data?.is_valid;
              reason = oauth_valid ? null : "disconnected";
            } catch (e) {
              oauth_valid = false;
              reason = "disconnected";
              console.error("[INTEGRATION_STATUS_META_DEBUG_TOKEN]", { projectId, error: e });
            }
          }
        }

        const canonicalId = await getCanonicalIntegrationId(admin, projectId, "meta");
        const enabled_accounts = canonicalId ? await countEnabledAccounts(admin, projectId, canonicalId) : 0;

        let status: IntegrationStatusValue = "not_connected";
        let last_sync_status: string | null = null;
        let last_sync_at: string | null = null;
        let last_sync_error: string | null = null;
        let data_max_date: string | null = null;

        if (!oauth_valid) {
          status = "disconnected";
        } else if (enabled_accounts === 0) {
          status = "no_accounts";
        } else {
          const syncAndFreshness = await getSyncAndFreshness(admin, projectId, "meta");
          last_sync_status = syncAndFreshness.last_sync_status;
          last_sync_at = syncAndFreshness.last_sync_at;
          last_sync_error = syncAndFreshness.last_sync_error;
          data_max_date = syncAndFreshness.data_max_date;
          const resolved = resolveDataStatus(
            enabled_accounts,
            last_sync_status,
            last_sync_at,
            data_max_date
          );
          status = resolved.status;
          reason = resolved.reason ?? reason;
        }

        safePush(integrations, {
          platform: "meta",
          connected: true,
          oauth_valid,
          enabled_accounts,
          status,
          reason,
          integration_id: integrationId,
          last_sync_status,
          last_sync_at,
          last_sync_error,
          data_max_date,
        });
        continue;
      }

      if (platform === "google") {
        let reason: string | null = null;
        const integration = await getGoogleIntegrationForProject(admin, projectId);
        let connected = !!integration?.id;
        let integrationId: string | null = integration?.id ?? null;
        let oauth_valid = false;

        if (!integration?.id) {
          const fallbackId = await getIntegrationIdFromData(admin, projectId, "google");
          if (fallbackId) {
            connected = true;
            integrationId = fallbackId;
            oauth_valid = false;
            reason = "disconnected";
          }
        }

        if (!connected) {
          safePush(integrations, {
            platform: "google",
            connected: false,
            oauth_valid: false,
            enabled_accounts: 0,
            status: "not_connected",
            reason: null,
            integration_id: null,
          });
          continue;
        }

        if (integrationId) {
          try {
            const token = await getValidGoogleAccessToken(admin, integrationId);
            oauth_valid = !!token;
            if (!oauth_valid) reason = "disconnected";
          } catch (e) {
            oauth_valid = false;
            reason = "disconnected";
            console.error("[INTEGRATION_STATUS_GOOGLE_TOKEN]", { projectId, error: e });
          }
        }

        const canonicalId = await getCanonicalIntegrationId(admin, projectId, "google");
        const enabled_accounts = canonicalId ? await countEnabledAccounts(admin, projectId, canonicalId) : 0;

        let status: IntegrationStatusValue = "not_connected";
        let last_sync_status: string | null = null;
        let last_sync_at: string | null = null;
        let last_sync_error: string | null = null;
        let data_max_date: string | null = null;

        if (!oauth_valid) {
          status = "disconnected";
        } else if (enabled_accounts === 0) {
          status = "no_accounts";
        } else {
          const syncAndFreshness = await getSyncAndFreshness(admin, projectId, "google");
          last_sync_status = syncAndFreshness.last_sync_status;
          last_sync_at = syncAndFreshness.last_sync_at;
          last_sync_error = syncAndFreshness.last_sync_error;
          data_max_date = syncAndFreshness.data_max_date;
          const resolved = resolveDataStatus(
            enabled_accounts,
            last_sync_status,
            last_sync_at,
            data_max_date
          );
          status = resolved.status;
          reason = resolved.reason ?? reason;
        }

        safePush(integrations, {
          platform: "google",
          connected: true,
          oauth_valid,
          enabled_accounts,
          status,
          reason,
          integration_id: integrationId,
          last_sync_status,
          last_sync_at,
          last_sync_error,
          data_max_date,
        });
        continue;
      }

      if (platform === "tiktok") {
        const { data: rows } = await admin
          .from("integrations")
          .select("id")
          .eq("project_id", projectId)
          .eq("platform", "tiktok")
          .order("created_at", { ascending: false })
          .limit(1);
        const row = (rows ?? [])[0] as { id?: string } | undefined;
        const connected = !!row?.id;
        safePush(integrations, {
          platform: "tiktok",
          connected,
          oauth_valid: false,
          enabled_accounts: 0,
          status: "not_connected",
          reason: null,
          integration_id: row?.id ?? null,
        });
      }
    } catch (e) {
      console.error("[INTEGRATION_STATUS_PLATFORM_ERROR]", { platform, projectId, error: e });
      safePush(integrations, {
        platform,
        connected: false,
        oauth_valid: false,
        enabled_accounts: 0,
        status: "error",
        reason: "internal_error",
        integration_id: null,
      });
    }
  }

  return NextResponse.json({
    success: true,
    integrations,
  });
}
