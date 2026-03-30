import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * When OAuth callback does not return a new refresh_token, keep the existing DB value
 * so we never wipe refresh with NULL on upsert.
 */
export function mergeRefreshTokenForUpsert(
  incomingRefresh: string | null | undefined,
  existingRefresh: string | null | undefined
): string | null {
  const inc = incomingRefresh != null ? String(incomingRefresh).trim() : "";
  if (inc !== "") return inc;
  const ex = existingRefresh != null ? String(existingRefresh).trim() : "";
  return ex !== "" ? ex : null;
}

export type UpsertIntegrationsAuthParams = {
  integration_id: string;
  access_token: string;
  /** If null/empty, existing non-empty refresh_token in DB is preserved. */
  refresh_token?: string | null;
  token_expires_at: string | null;
  scopes?: string | null;
  meta?: Record<string, unknown>;
  updated_at: string;
};

/**
 * Upsert integrations_auth with COALESCE semantics for refresh_token.
 */
export async function upsertIntegrationsAuth(
  admin: SupabaseClient,
  params: UpsertIntegrationsAuthParams
): Promise<{ error: { message: string } | null }> {
  const { data: existing, error: selErr } = await admin
    .from("integrations_auth")
    .select("refresh_token")
    .eq("integration_id", params.integration_id)
    .maybeSingle();

  if (selErr) {
    return { error: { message: selErr.message } };
  }

  const existingR = (existing as { refresh_token?: string | null } | null)?.refresh_token;
  const refreshToStore = mergeRefreshTokenForUpsert(params.refresh_token ?? null, existingR ?? null);

  const { error } = await admin.from("integrations_auth").upsert(
    {
      integration_id: params.integration_id,
      access_token: params.access_token,
      refresh_token: refreshToStore,
      token_expires_at: params.token_expires_at,
      scopes: params.scopes ?? null,
      meta: params.meta ?? {},
      updated_at: params.updated_at,
    },
    { onConflict: "integration_id" }
  );

  if (error) return { error: { message: error.message } };
  return { error: null };
}
