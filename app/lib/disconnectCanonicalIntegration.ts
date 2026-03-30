import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * Deletes a canonical `integrations` row after clearing dependent rows.
 * Order: campaigns linked via `ad_accounts_id` (avoids NOT NULL + ON DELETE SET NULL
 * failures on some DBs), `ad_account_settings`, optional `integration_entities`, then
 * `integrations`. FK CASCADE removes `integrations_auth` and `ad_accounts` (and remaining
 * `daily_ad_metrics` for those accounts; campaign-level metrics CASCADE with campaigns).
 */
export async function deleteCanonicalIntegrationById(
  admin: SupabaseClient,
  integrationId: string,
  opts?: { integrationEntitiesPlatform?: "google" | "meta" | "tiktok" }
): Promise<{ error: { message: string } | null }> {
  const { data: adRows, error: adSelErr } = await admin
    .from("ad_accounts")
    .select("id")
    .eq("integration_id", integrationId);

  if (adSelErr) {
    return { error: { message: adSelErr.message } };
  }

  const adAccountIds = (adRows ?? []).map((r: { id: string }) => r.id);
  if (adAccountIds.length > 0) {
    const { error: campaignsErr } = await admin.from("campaigns").delete().in("ad_accounts_id", adAccountIds);
    if (campaignsErr) {
      return { error: { message: campaignsErr.message } };
    }

    const { error: settingsErr } = await admin.from("ad_account_settings").delete().in("ad_account_id", adAccountIds);
    if (settingsErr) {
      return { error: { message: settingsErr.message } };
    }
  }

  if (opts?.integrationEntitiesPlatform) {
    const { error: entErr } = await admin
      .from("integration_entities")
      .delete()
      .eq("integration_id", integrationId)
      .eq("platform", opts.integrationEntitiesPlatform);
    if (entErr) {
      return { error: { message: entErr.message } };
    }
  }

  const { error: intErr } = await admin.from("integrations").delete().eq("id", integrationId);
  if (intErr) {
    return { error: { message: intErr.message } };
  }

  return { error: null };
}
