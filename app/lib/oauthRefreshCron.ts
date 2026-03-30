import type { SupabaseClient } from "@supabase/supabase-js";
import { getGoogleAccessTokenForApi } from "@/app/lib/googleAdsAuth";
import { getTikTokAccessTokenForApi } from "@/app/lib/tiktokAdsAuth";

const REFRESH_WITHIN_MS = 35 * 60 * 1000; // refresh access tokens expiring within 35 minutes

export type OAuthRefreshSweepResult = {
  attempted: number;
  ok: number;
  transient: number;
  permanent: number;
  refreshedProjectIds: string[];
};

/**
 * Proactively refreshes Google/TikTok access tokens that are expired or close to expiry.
 * Best-effort; failures are logged and do not throw.
 */
export async function runOAuthTokenRefreshSweep(
  admin: SupabaseClient,
  opts?: { maxIntegrations?: number }
): Promise<OAuthRefreshSweepResult> {
  const max = Math.min(120, Math.max(1, opts?.maxIntegrations ?? 60));
  const cutoff = Date.now() + REFRESH_WITHIN_MS;
  const refreshedProjectIds = new Set<string>();

  const { data: authRows, error: authErr } = await admin
    .from("integrations_auth")
    .select("integration_id, refresh_token, token_expires_at")
    .not("refresh_token", "is", null)
    .limit(500);

  if (authErr || !authRows?.length) {
    return { attempted: 0, ok: 0, transient: 0, permanent: 0, refreshedProjectIds: [] };
  }

  const ids = [...new Set(authRows.map((r: { integration_id: string }) => String(r.integration_id)))];
  const { data: intRows } = await admin.from("integrations").select("id, platform, project_id").in("id", ids);

  const platformById = new Map<string, string>();
  const projectIdByIntegrationId = new Map<string, string>();
  for (const r of intRows ?? []) {
    const row = r as { id?: string; platform?: string; project_id?: string };
    if (row.id && row.platform) platformById.set(row.id, row.platform);
    if (row.id && row.project_id) projectIdByIntegrationId.set(row.id, String(row.project_id));
  }

  let attempted = 0;
  let ok = 0;
  let transient = 0;
  let permanent = 0;

  for (const row of authRows as {
    integration_id: string;
    refresh_token: string | null;
    token_expires_at: string | null;
  }[]) {
    if (attempted >= max) break;

    const platform = platformById.get(row.integration_id);
    if (platform !== "google" && platform !== "tiktok") continue;

    const exp = row.token_expires_at ? Date.parse(row.token_expires_at) : 0;
    if (Number.isFinite(exp) && exp > cutoff) continue;

    attempted += 1;
    try {
      if (platform === "google") {
        const gr = await getGoogleAccessTokenForApi(admin, row.integration_id);
        if (gr.ok) {
          ok += 1;
          const pid = projectIdByIntegrationId.get(row.integration_id);
          if (pid) refreshedProjectIds.add(pid);
        } else if (gr.kind === "transient") transient += 1;
        else permanent += 1;
      } else {
        const tr = await getTikTokAccessTokenForApi(admin, row.integration_id);
        if (tr.ok) {
          ok += 1;
          const pid = projectIdByIntegrationId.get(row.integration_id);
          if (pid) refreshedProjectIds.add(pid);
        } else if (tr.kind === "transient") transient += 1;
        else permanent += 1;
      }
    } catch {
      transient += 1;
    }
  }

  if (attempted > 0) {
    console.log("[OAUTH_REFRESH_SWEEP]", {
      attempted,
      ok,
      transient,
      permanent,
      projects_touched: refreshedProjectIds.size,
    });
  }

  return {
    attempted,
    ok,
    transient,
    permanent,
    refreshedProjectIds: Array.from(refreshedProjectIds),
  };
}
