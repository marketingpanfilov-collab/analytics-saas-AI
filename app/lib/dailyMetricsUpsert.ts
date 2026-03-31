import type { SupabaseClient } from "@supabase/supabase-js";

type DailyMetricRow = {
  ad_account_id: string;
  campaign_id: string | null;
  date: string;
};

function uniq(values: string[]): string[] {
  return Array.from(new Set(values.filter((v) => v && v.length > 0)));
}

export function isMissingOnConflictConstraintError(err: unknown): boolean {
  const msg = String((err as { message?: string } | null)?.message ?? err ?? "").toLowerCase();
  return msg.includes("there is no unique or exclusion constraint matching the on conflict specification");
}

export async function upsertDailyMetricsAccountCompat(
  admin: SupabaseClient,
  rows: DailyMetricRow[]
): Promise<{ error: { message: string } | null; mode: "upsert" | "delete_insert" }> {
  if (!rows.length) return { error: null, mode: "upsert" };
  const { error: upErr } = await admin.from("daily_ad_metrics").upsert(rows, { onConflict: "ad_account_id,date" });
  if (!upErr) return { error: null, mode: "upsert" };
  if (!isMissingOnConflictConstraintError(upErr)) {
    return { error: { message: upErr.message ?? String(upErr) }, mode: "upsert" };
  }

  const accountIds = uniq(rows.map((r) => String(r.ad_account_id)));
  const dates = uniq(rows.map((r) => String(r.date)));
  const { error: delErr } = await admin
    .from("daily_ad_metrics")
    .delete()
    .in("ad_account_id", accountIds)
    .in("date", dates)
    .is("campaign_id", null);
  if (delErr) return { error: { message: delErr.message ?? String(delErr) }, mode: "delete_insert" };

  const { error: insErr } = await admin.from("daily_ad_metrics").insert(rows);
  if (insErr) return { error: { message: insErr.message ?? String(insErr) }, mode: "delete_insert" };
  return { error: null, mode: "delete_insert" };
}

export async function upsertDailyMetricsCampaignCompat(
  admin: SupabaseClient,
  rows: DailyMetricRow[]
): Promise<{ error: { message: string } | null; mode: "upsert" | "delete_insert" }> {
  if (!rows.length) return { error: null, mode: "upsert" };
  const { error: upErr } = await admin
    .from("daily_ad_metrics")
    .upsert(rows, { onConflict: "ad_account_id,campaign_id,date" });
  if (!upErr) return { error: null, mode: "upsert" };
  if (!isMissingOnConflictConstraintError(upErr)) {
    return { error: { message: upErr.message ?? String(upErr) }, mode: "upsert" };
  }

  const accountIds = uniq(rows.map((r) => String(r.ad_account_id)));
  const campaignIds = uniq(rows.map((r) => String(r.campaign_id ?? "")).filter(Boolean));
  const dates = uniq(rows.map((r) => String(r.date)));
  const { error: delErr } = await admin
    .from("daily_ad_metrics")
    .delete()
    .in("ad_account_id", accountIds)
    .in("campaign_id", campaignIds)
    .in("date", dates);
  if (delErr) return { error: { message: delErr.message ?? String(delErr) }, mode: "delete_insert" };

  const { error: insErr } = await admin.from("daily_ad_metrics").insert(rows);
  if (insErr) return { error: { message: insErr.message ?? String(insErr) }, mode: "delete_insert" };
  return { error: null, mode: "delete_insert" };
}
