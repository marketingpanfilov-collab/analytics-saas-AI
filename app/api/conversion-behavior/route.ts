import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/app/lib/supabaseAdmin";
import { requireProjectAccessOrInternal } from "@/app/lib/auth/requireProjectAccessOrInternal";
import { billingAnalyticsReadGateFromAccess } from "@/app/lib/auth/requireBillingAccess";

type Bucket = { label: string; percent: number };
const ATTRIBUTION_SOURCE_WHITELIST = new Set([
  "meta",
  "google",
  "tiktok",
  "yandex",
  "direct",
  "organic_search",
  "referral",
]);

function clampDays(raw: string | null): number {
  const n = Number(raw ?? 30);
  if (!Number.isFinite(n) || n <= 0) return 30;
  return Math.max(1, Math.min(365, Math.round(n)));
}

function labelForHours(h: number): string {
  if (h <= 1) return "0–1 час";
  if (h <= 6) return "1–6 часов";
  if (h <= 24) return "6–24 часа";
  if (h <= 24 * 3) return "1–3 дня";
  if (h <= 24 * 7) return "3–7 дней";
  return "7+ дней";
}

function labelForTouches(n: number): string {
  if (n <= 1) return "1 касание";
  if (n === 2) return "2 касания";
  if (n === 3) return "3 касания";
  if (n === 4) return "4 касания";
  return "5+ касаний";
}

function toBuckets(counts: Map<string, number>): Bucket[] {
  const total = [...counts.values()].reduce((s, v) => s + v, 0);
  if (total <= 0) return [];
  return [...counts.entries()].map(([label, value]) => ({
    label,
    percent: Math.round((value / total) * 100),
  }));
}

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const projectId = (searchParams.get("project_id") ?? "").trim();
  const days = clampDays(searchParams.get("days"));
  const start = (searchParams.get("start") ?? "").trim();
  const end = (searchParams.get("end") ?? "").trim();
  const sourcesRaw = (searchParams.get("sources") ?? "").trim();
  const accountIdsRaw = (searchParams.get("account_ids") ?? "").trim();
  const sources = sourcesRaw
    ? sourcesRaw
        .split(",")
        .map((s) => s.trim().toLowerCase())
        .filter((s) => s.length > 0 && ATTRIBUTION_SOURCE_WHITELIST.has(s))
    : [];
  const accountIds = accountIdsRaw
    ? accountIdsRaw
        .split(",")
        .map((s) => s.trim())
        .filter(Boolean)
    : [];
  if (!projectId) {
    return NextResponse.json({ success: false, error: "project_id required" }, { status: 400 });
  }

  const access = await requireProjectAccessOrInternal(req, projectId);
  if (!access.allowed) return NextResponse.json(access.body, { status: access.status });

  const billing = await billingAnalyticsReadGateFromAccess(access);
  if (!billing.ok) return billing.response;

  const hasRange = /^\d{4}-\d{2}-\d{2}$/.test(start) && /^\d{4}-\d{2}-\d{2}$/.test(end) && start <= end;
  const since = hasRange ? `${start}T00:00:00.000Z` : new Date(Date.now() - days * 86400000).toISOString();
  const until = hasRange ? `${end}T23:59:59.999Z` : new Date().toISOString();
  const admin = supabaseAdmin();

  const applySourceFilter = <T extends { in: Function }>(q: T): T =>
    sources.length > 0 ? (q.in("traffic_source", sources) as T) : q;

  const purchasesByEventTime = applySourceFilter(
    admin
      .from("conversion_events")
      .select("id, visitor_id, click_id, event_time, created_at, traffic_source")
      .eq("project_id", projectId)
      .eq("event_name", "purchase")
      .gte("event_time", since)
      .lte("event_time", until)
      .order("event_time", { ascending: true })
      .limit(5000)
  );
  const purchasesByCreatedFallback = applySourceFilter(
    admin
      .from("conversion_events")
      .select("id, visitor_id, click_id, event_time, created_at, traffic_source")
      .eq("project_id", projectId)
      .eq("event_name", "purchase")
      .is("event_time", null)
      .gte("created_at", since)
      .lte("created_at", until)
      .order("created_at", { ascending: true })
      .limit(5000)
  );
  const [{ data: purchasesTimed }, { data: purchasesFallback }] = await Promise.all([
    purchasesByEventTime,
    purchasesByCreatedFallback,
  ]);

  const byId = new Map<string, {
    id: string;
    visitor_id: string | null;
    click_id: string | null;
    event_time: string | null;
    created_at: string;
  }>();
  for (const row of (purchasesTimed ?? []) as any[]) byId.set(row.id, row);
  for (const row of (purchasesFallback ?? []) as any[]) byId.set(row.id, row);

  let purchaseRows = Array.from(byId.values());

  if (accountIds.length > 0) {
    const { data: campaignRows } = await admin
      .from("campaigns")
      .select("id, external_campaign_id, meta_campaign_id")
      .eq("project_id", projectId)
      .in("ad_accounts_id", accountIds);
    const allowedCampaignKeys = new Set<string>();
    for (const c of (campaignRows ?? []) as { id: string; external_campaign_id: string | null; meta_campaign_id: string | null }[]) {
      if (c.id) allowedCampaignKeys.add(String(c.id).trim());
      if (c.external_campaign_id) allowedCampaignKeys.add(String(c.external_campaign_id).trim());
      if (c.meta_campaign_id) allowedCampaignKeys.add(String(c.meta_campaign_id).trim());
    }
    if (allowedCampaignKeys.size > 0) {
      const clickIds = Array.from(new Set(purchaseRows.map((p) => p.click_id?.trim()).filter((v): v is string => Boolean(v))));
      const allowedClickIds = new Set<string>();
      const batchSize = 300;
      for (let i = 0; i < clickIds.length; i += batchSize) {
        const batch = clickIds.slice(i, i + batchSize);
        const { data: clickRows } = await admin
          .from("redirect_click_events")
          .select("bq_click_id, platform_campaign_id")
          .eq("project_id", projectId)
          .in("bq_click_id", batch);
        for (const row of (clickRows ?? []) as { bq_click_id: string; platform_campaign_id: string | null }[]) {
          const campaignKey = row.platform_campaign_id ? String(row.platform_campaign_id).trim() : "";
          if (campaignKey && allowedCampaignKeys.has(campaignKey)) allowedClickIds.add(String(row.bq_click_id));
        }
      }
      if (allowedClickIds.size > 0) {
        purchaseRows = purchaseRows.filter((p) => {
          const cid = p.click_id?.trim();
          // Keep unattributed/direct purchases (no click_id) to avoid empty-state regressions.
          if (!cid) return true;
          return allowedClickIds.has(cid);
        });
      }
    }
  }
  if (!purchaseRows.length) {
    return NextResponse.json({
      success: true,
      project_id: projectId,
      days,
      time: [],
      touch: [],
      diagnostics: {
        purchases: 0,
        source_filter_applied: sources.length > 0,
        account_filter_supported: true,
      },
    });
  }

  const timeCounts = new Map<string, number>();
  const touchCounts = new Map<string, number>();
  let processed = 0;

  for (const p of purchaseRows) {
    const purchaseTs = (p.event_time ?? p.created_at) as string;
    const visitorId = (p.visitor_id ?? "").trim();
    if (!visitorId) continue;
    const { data: visits } = await admin
      .from("visit_source_events")
      .select("created_at")
      .eq("site_id", projectId)
      .eq("visitor_id", visitorId)
      .lt("created_at", purchaseTs)
      .order("created_at", { ascending: true })
      .limit(200);
    const vRows = (visits ?? []) as { created_at: string }[];
    if (!vRows.length) continue;
    const firstMs = Date.parse(vRows[0].created_at);
    const purchaseMs = Date.parse(purchaseTs);
    if (!Number.isFinite(firstMs) || !Number.isFinite(purchaseMs) || purchaseMs < firstMs) continue;
    const hours = Math.max(0, (purchaseMs - firstMs) / 3600000);
    const timeLabel = labelForHours(hours);
    const touchLabel = labelForTouches(vRows.length);
    timeCounts.set(timeLabel, (timeCounts.get(timeLabel) ?? 0) + 1);
    touchCounts.set(touchLabel, (touchCounts.get(touchLabel) ?? 0) + 1);
    processed += 1;
  }

  return NextResponse.json({
    success: true,
    project_id: projectId,
    days,
    time: toBuckets(timeCounts),
    touch: toBuckets(touchCounts),
    diagnostics: {
      purchases: purchaseRows.length,
      processed,
      with_paths: processed,
      missing_paths: Math.max(0, purchaseRows.length - processed),
      source_filter_applied: sources.length > 0,
      account_filter_supported: true,
    },
  });
}
