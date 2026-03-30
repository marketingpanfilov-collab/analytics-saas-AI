/**
 * CPR (факт) как на странице LTV: расход по кампаниям marketing_intent=retention
 * за период ÷ число покупок с campaign_intent=retention в conversion_events.
 */
import type { SupabaseClient } from "@supabase/supabase-js";

export async function computeLtvStyleRetentionCprActual(
  admin: SupabaseClient,
  projectId: string,
  start: string,
  end: string,
  canonicalSpendTotal: number
): Promise<{ retention_spend: number; retention_purchase_count: number; cpr_actual: number | null }> {
  const startDate = `${start}T00:00:00.000Z`;
  const endDate = `${end}T23:59:59.999Z`;

  const { data: retentionCampaigns } = await admin
    .from("campaigns")
    .select("id")
    .eq("project_id", projectId)
    .eq("marketing_intent", "retention");

  const campaignIds = [...new Set((retentionCampaigns ?? []).map((c: { id: string }) => c.id))];

  let retentionSpend: number;
  if (campaignIds.length > 0) {
    const { data: metrics } = await admin
      .from("daily_ad_metrics_campaign")
      .select("spend")
      .in("campaign_id", campaignIds)
      .gte("date", start)
      .lte("date", end);
    retentionSpend = Math.round((metrics ?? []).reduce((s, r) => s + Number((r as { spend?: number | null }).spend ?? 0), 0) * 10000) / 10000;
  } else {
    retentionSpend = 0;
  }

  if (Number.isFinite(canonicalSpendTotal) && canonicalSpendTotal >= 0 && retentionSpend > canonicalSpendTotal) {
    retentionSpend = canonicalSpendTotal;
  }

  const { count } = await admin
    .from("conversion_events")
    .select("id", { count: "exact", head: true })
    .eq("project_id", projectId)
    .eq("event_name", "purchase")
    .eq("campaign_intent", "retention")
    .gte("created_at", startDate)
    .lte("created_at", endDate);

  const retentionPurchaseCount = typeof count === "number" ? count : 0;

  const cpr_actual =
    Number.isFinite(retentionSpend) && retentionPurchaseCount > 0 ? retentionSpend / retentionPurchaseCount : null;

  return { retention_spend: retentionSpend, retention_purchase_count: retentionPurchaseCount, cpr_actual };
}
