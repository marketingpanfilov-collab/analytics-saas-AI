/**
 * GET /api/attribution-debugger
 * Params: project_id, days, page, page_size, search, filter_status, filter_source,
 *         view_mode=chains|orphans|all, orphan_type=orphan_visit|unmatched_registration|unmatched_purchase
 *
 * Returns attribution chains and/or orphan/unmatched events.
 */
import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/app/lib/supabaseAdmin";
import { buildAttributionChains, buildOrphanEvents } from "@/app/lib/attributionDebugger";

const DEFAULT_DAYS = 30;
const DEFAULT_PAGE = 1;
const DEFAULT_PAGE_SIZE = 20;
const ALLOWED_DAYS = [7, 30, 90];

function parseDays(v: string | null): number {
  if (v == null) return DEFAULT_DAYS;
  const n = parseInt(v, 10);
  if (!Number.isFinite(n) || n < 1) return DEFAULT_DAYS;
  if (ALLOWED_DAYS.includes(n)) return n;
  if (n <= 7) return 7;
  if (n <= 30) return 30;
  return 90;
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
    const filterStatus = searchParams.get("filter_status")?.trim() ?? null;
    const filterSource = searchParams.get("filter_source")?.trim() ?? null;
    const viewMode = (searchParams.get("view_mode")?.trim() ?? "chains") as "chains" | "orphans" | "all";
    const orphanType = searchParams.get("orphan_type")?.trim() ?? null;

    if (!projectId) {
      return NextResponse.json(
        { success: false, error: "project_id is required" },
        { status: 400 }
      );
    }

    const admin = supabaseAdmin();

    if (viewMode === "orphans") {
      const orphanResult = await buildOrphanEvents(admin, {
        project_id: projectId,
        days,
        page,
        page_size: pageSize,
        search: search || undefined,
        orphan_type: orphanType === "orphan_visit" || orphanType === "unmatched_registration" || orphanType === "unmatched_purchase" ? orphanType : undefined,
        filter_source: filterSource || undefined,
      });
      return NextResponse.json({
        success: true,
        view_mode: "orphans",
        chains: [],
        orphans: orphanResult.items,
        total: orphanResult.total,
        page: orphanResult.page,
        page_size: orphanResult.page_size,
      });
    }

    if (viewMode === "all") {
      const [chainResult, orphanResult] = await Promise.all([
        buildAttributionChains(admin, {
          project_id: projectId,
          days,
          page,
          page_size: pageSize,
          search: search || undefined,
          filter_status: filterStatus === "complete" || filterStatus === "partial" || filterStatus === "broken" ? filterStatus : undefined,
          filter_source: filterSource || undefined,
        }),
        buildOrphanEvents(admin, {
          project_id: projectId,
          days,
          page: 1,
          page_size: 50,
          search: search || undefined,
          orphan_type: orphanType === "orphan_visit" || orphanType === "unmatched_registration" || orphanType === "unmatched_purchase" ? orphanType : undefined,
          filter_source: filterSource || undefined,
        }),
      ]);
      return NextResponse.json({
        success: true,
        view_mode: "all",
        chains: chainResult.chains,
        orphans: orphanResult.items,
        total: chainResult.total,
        total_orphans: orphanResult.total,
        page: chainResult.page,
        page_size: chainResult.page_size,
      });
    }

    const result = await buildAttributionChains(admin, {
      project_id: projectId,
      days,
      page,
      page_size: pageSize,
      search: search || undefined,
      filter_status: filterStatus === "complete" || filterStatus === "partial" || filterStatus === "broken" ? filterStatus : undefined,
      filter_source: filterSource || undefined,
    });

    return NextResponse.json({
      success: true,
      view_mode: "chains",
      chains: result.chains,
      orphans: [],
      total: result.total,
      page: result.page,
      page_size: result.page_size,
    });
  } catch (e) {
    console.error("[ATTRIBUTION_DEBUGGER_ERROR]", e);
    return NextResponse.json(
      { success: false, error: "Internal error" },
      { status: 500 }
    );
  }
}
