/**
 * GET /api/attribution-journeys
 * Params: project_id, days, page, page_size, search, filter_source, filter_health,
 *        has_purchase, multi_channel_only, repeat_purchasers_only
 * Fetches chains (up to JOURNEY_CHAINS_LIMIT), builds journeys in memory, returns paginated journeys.
 */
import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/app/lib/supabaseAdmin";
import { buildAttributionChains } from "@/app/lib/attributionDebugger";
import { buildJourneysFromChains } from "@/app/lib/attributionJourney";

const DEFAULT_DAYS = 30;
const DEFAULT_PAGE = 1;
const DEFAULT_PAGE_SIZE = 20;
const JOURNEY_CHAINS_LIMIT = 400; // fetch this many chains to build journeys

function parseDays(v: string | null): number {
  if (v == null) return DEFAULT_DAYS;
  const n = parseInt(v, 10);
  return Number.isFinite(n) && n >= 1 && n <= 90 ? n : DEFAULT_DAYS;
}

function parsePage(v: string | null): number {
  if (v == null) return DEFAULT_PAGE;
  const n = parseInt(v, 10);
  return Number.isFinite(n) && n >= 1 ? n : DEFAULT_PAGE;
}

function parsePageSize(v: string | null): number {
  if (v == null) return DEFAULT_PAGE_SIZE;
  const n = parseInt(v, 10);
  return Number.isFinite(n) && n >= 1 && n <= 100 ? n : DEFAULT_PAGE_SIZE;
}

export async function GET(req: Request) {
  try {
    const { searchParams } = new URL(req.url);
    const projectId = searchParams.get("project_id")?.trim() ?? null;
    const days = parseDays(searchParams.get("days"));
    const page = parsePage(searchParams.get("page"));
    const pageSize = parsePageSize(searchParams.get("page_size"));
    const search = searchParams.get("search")?.trim() ?? null;
    const filterSource = searchParams.get("filter_source")?.trim() ?? null;
    const filterHealth = searchParams.get("filter_health")?.trim() ?? null;
    const hasPurchase = searchParams.get("has_purchase") === "1" || searchParams.get("has_purchase") === "true";
    const multiChannelOnly = searchParams.get("multi_channel_only") === "1" || searchParams.get("multi_channel_only") === "true";
    const repeatPurchasersOnly = searchParams.get("repeat_purchasers_only") === "1" || searchParams.get("repeat_purchasers_only") === "true";

    if (!projectId) {
      return NextResponse.json(
        { success: false, error: "project_id is required" },
        { status: 400 }
      );
    }

    const admin = supabaseAdmin();
    const chainResult = await buildAttributionChains(admin, {
      project_id: projectId,
      days,
      page: 1,
      page_size: JOURNEY_CHAINS_LIMIT,
      search: search || undefined,
      filter_source: filterSource || undefined,
    });

    let journeys = buildJourneysFromChains(chainResult.chains);

    if (filterHealth) {
      const health = filterHealth.toLowerCase();
      journeys = journeys.filter((j) => j.journey_health_label.toLowerCase() === health);
    }
    if (hasPurchase) journeys = journeys.filter((j) => j.summary.purchases_count >= 1);
    if (multiChannelOnly) {
      journeys = journeys.filter((j) => {
        const sources = new Set(
          j.touchpoints.filter((t) => t.type === "click" && t.source).map((t) => t.source!)
        );
        return sources.size > 1;
      });
    }
    if (repeatPurchasersOnly) journeys = journeys.filter((j) => j.summary.purchases_count > 1);

    const total = journeys.length;
    const start = (page - 1) * pageSize;
    const paginated = journeys.slice(start, start + pageSize);

    return NextResponse.json({
      success: true,
      journeys: paginated,
      total,
      page,
      page_size: pageSize,
    });
  } catch (e) {
    console.error("[ATTRIBUTION_JOURNEYS_ERROR]", e);
    return NextResponse.json(
      { success: false, error: e instanceof Error ? e.message : "Internal error" },
      { status: 500 }
    );
  }
}
