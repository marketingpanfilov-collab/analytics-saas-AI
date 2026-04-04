import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/app/lib/supabaseAdmin";
import { syncMetaMarketingIntentFromAdsApi } from "@/app/lib/metaAdsMarketingIntentSync";
import { fetchMetaGraphGetJsonWithRetry } from "@/app/lib/metaGraphRetry";
import {
  requireProjectAccessOrInternal,
  isInternalSyncRequest,
} from "@/app/lib/auth/requireProjectAccessOrInternal";
import { billingHeavySyncGateBeforeProject } from "@/app/lib/auth/requireBillingAccess";

function isUuid(v: string) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(v);
}

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const projectId = searchParams.get("project_id");
  const adAccountId = searchParams.get("ad_account_id");

  if (!projectId || !adAccountId) {
    return NextResponse.json(
      { success: false, error: "project_id and ad_account_id required" },
      { status: 400 }
    );
  }

  if (!isUuid(projectId)) {
    return NextResponse.json({ success: false, error: "project_id must be a valid UUID" }, { status: 400 });
  }

  if (!isInternalSyncRequest(req)) {
    const billingPre = await billingHeavySyncGateBeforeProject(req);
    if (!billingPre.ok) return billingPre.response;
  }

  const access = await requireProjectAccessOrInternal(req, projectId, { allowInternalBypass: true });
  if (!access.allowed) {
    return NextResponse.json(access.body, { status: access.status });
  }

  const admin = supabaseAdmin();

  // 1) токен по проекту (prefer primary, fallback to any)
  let integration: { access_token: string; integrations_id?: string | null } | null = null;
  const { data: primaryRow } = await admin
    .from("integrations_meta")
    .select("access_token, integrations_id")
    .eq("project_id", projectId)
    .eq("account_id", "primary")
    .maybeSingle();
  if (primaryRow?.access_token) {
    integration = primaryRow;
  } else {
    const { data: anyRow } = await admin
      .from("integrations_meta")
      .select("access_token, integrations_id")
      .eq("project_id", projectId)
      .limit(1)
      .maybeSingle();
    integration = anyRow;
  }

  if (!integration?.access_token) {
    return NextResponse.json(
      { success: false, error: "Integration not found for project_id" },
      { status: 404 }
    );
  }

  // 1b) Canonical: resolve ad_accounts.id for dual-write (optional if integrations_id missing)
  let adAccountsId: string | null = null;
  if (integration.integrations_id) {
    const { data: adAcc } = await admin
      .from("ad_accounts")
      .select("id")
      .eq("integration_id", integration.integrations_id)
      .eq("external_account_id", adAccountId)
      .maybeSingle();
    adAccountsId = adAcc?.id ?? null;
  }

  function metaBudgetMajor(v: unknown): number | null {
    if (v == null || v === "") return null;
    const n = typeof v === "string" ? parseInt(v, 10) : Number(v);
    if (!Number.isFinite(n)) return null;
    return n / 100;
  }

  function metaTsIso(v: unknown): string | null {
    if (v == null || v === "") return null;
    const n = typeof v === "string" ? parseInt(v, 10) : Number(v);
    if (!Number.isFinite(n) || n <= 0) return null;
    return new Date(n * 1000).toISOString();
  }

  const budgetSyncedAt = new Date().toISOString();

  // 2) тянем кампании
  const url =
    `https://graph.facebook.com/v19.0/${adAccountId}/campaigns?` +
    new URLSearchParams({
      fields: "id,name,status,objective,daily_budget,lifetime_budget,start_time,stop_time",
      limit: "200",
      access_token: integration.access_token,
    }).toString();

  const graphResult = await fetchMetaGraphGetJsonWithRetry(url);
  if (!graphResult.ok) {
    const errPayload = graphResult.json as { error?: { message?: string; code?: number } };
    const msg = errPayload?.error?.message ?? "Meta Graph request failed";
    const code = errPayload?.error?.code;
    const status =
      graphResult.kind === "transient"
        ? 503
        : code === 190 || code === 102
          ? 401
          : 400;
    return NextResponse.json(
      {
        success: false,
        error: msg,
        retryable: graphResult.kind === "transient",
      },
      { status }
    );
  }
  const json = graphResult.json as { data?: unknown[] };
  const list = Array.isArray(json?.data) ? json.data : [];

  // 3) готовим rows под campaigns: ad_account_id = external (act_*), platform = meta
  const rows = list
    .map((c: any) => {
      const dailyM = metaBudgetMajor(c.daily_budget);
      const lifeM = metaBudgetMajor(c.lifetime_budget);
      let budget_type: "daily" | "lifetime" | null = null;
      if (lifeM != null && lifeM > 0) budget_type = "lifetime";
      else if (dailyM != null && dailyM > 0) budget_type = "daily";
      return {
        project_id: projectId,
        meta_campaign_id: String(c.id),
        name: c.name ?? null,
        status: c.status ?? null,
        objective: c.objective ?? null,
        ad_account_id: adAccountId,
        platform: "meta" as const,
        budget_type,
        daily_budget: dailyM,
        lifetime_budget: lifeM,
        campaign_start_time: metaTsIso(c.start_time),
        campaign_stop_time: metaTsIso(c.stop_time),
        budget_synced_at: budgetSyncedAt,
        ...(adAccountsId && { ad_accounts_id: adAccountsId }),
      };
    })
    .map((row: Record<string, unknown>) => {
      if (!row.ad_accounts_id) {
        console.warn("[META_CAMPAIGN_SYNC_NO_AD_ACCOUNTS_ID]", {
          campaignId: row.meta_campaign_id,
          platform: "meta",
          hint: "Row still upserted for budgets/name; link ad_accounts when integrations_id matches external act id.",
        });
      }
      return row;
    });

  // 4) UPSERT в campaigns (dual-write: legacy + canonical link)
  const { error: upErr } = await admin
    .from("campaigns")
    .upsert(rows, { onConflict: "project_id,meta_campaign_id" });

  if (upErr) {
    return NextResponse.json(
      { success: false, step: "supabase_upsert_campaigns", error: upErr },
      { status: 500 }
    );
  }

  let marketing_intent: Awaited<ReturnType<typeof syncMetaMarketingIntentFromAdsApi>> | null = null;
  try {
    marketing_intent = await syncMetaMarketingIntentFromAdsApi(integration.access_token, adAccountId, admin, projectId);
  } catch (e) {
    console.warn("[META_CAMPAIGN_SYNC_MARKETING_INTENT]", e);
  }

  return NextResponse.json({
    success: true,
    ad_account_id: adAccountId,
    saved: rows.length,
    marketing_intent,
  });
}