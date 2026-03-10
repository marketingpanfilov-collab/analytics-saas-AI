import type { SupabaseClient } from "@supabase/supabase-js";

export type MetaIntegrationRow = {
  id: string;
  project_id: string;
  account_id: string | null;
  access_token: string | null;
  expires_at: string | null;
  token_source: string | null;
  created_at: string | null;
};

/**
 * Resolve Meta integration and token for a project.
 *
 * Primary: integrations + integrations_auth (shared platform-agnostic layer).
 * Fallback: integrations_meta (legacy Meta-specific storage).
 *
 * Returned .id is always the legacy integrations_meta.id when present, so existing
 * callers (disconnect, connections/save, meta_ad_accounts) keep working.
 */
export async function getMetaIntegrationForProject(
  admin: SupabaseClient,
  projectId: string
): Promise<MetaIntegrationRow | null> {
  // 1) Primary: canonical integration + shared auth
  const { data: integration, error: intErr } = await admin
    .from("integrations")
    .select("id, project_id")
    .eq("project_id", projectId)
    .eq("platform", "meta")
    .maybeSingle();

  if (!intErr && integration?.id) {
    const { data: auth, error: authErr } = await admin
      .from("integrations_auth")
      .select("access_token, token_expires_at, created_at")
      .eq("integration_id", integration.id)
      .maybeSingle();

    if (!authErr && auth?.access_token) {
      const { data: metaRow } = await admin
        .from("integrations_meta")
        .select("id")
        .eq("integrations_id", integration.id)
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle();

      const legacyId = (metaRow as { id?: string } | null)?.id ?? integration.id;
      return {
        id: legacyId,
        project_id: integration.project_id,
        account_id: "primary",
        access_token: auth.access_token,
        expires_at: auth.token_expires_at,
        token_source: "oauth_meta",
        created_at: auth.created_at,
      };
    }
  }

  // 2) Fallback: integrations_meta only (legacy)
  const preferred = await admin
    .from("integrations_meta")
    .select("id,project_id,account_id,access_token,expires_at,token_source,created_at")
    .eq("project_id", projectId)
    .eq("token_source", "oauth_meta")
    .in("account_id", ["primary", "default"])
    .order("created_at", { ascending: false })
    .limit(10);

  if (!preferred.error) {
    const list = (preferred.data ?? []) as MetaIntegrationRow[];
    const best =
      list.find((r) => r.account_id === "primary" && r.access_token) ||
      list.find((r) => r.account_id === "default" && r.access_token) ||
      list.find((r) => !!r.access_token) ||
      null;
    if (best) return best;
  }

  const fallback = await admin
    .from("integrations_meta")
    .select("id,project_id,account_id,access_token,expires_at,token_source,created_at")
    .eq("project_id", projectId)
    .order("created_at", { ascending: false })
    .limit(10);

  if (fallback.error) return null;
  const list = (fallback.data ?? []) as MetaIntegrationRow[];
  return list.find((r) => !!r.access_token) ?? null;
}

