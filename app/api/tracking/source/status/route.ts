/**
 * GET /api/tracking/source/status?site_id=xxx
 *
 * Returns whether visit_source_events has received any events for this site.
 * Minimal query, always returns JSON, hardened for local dev stability.
 */
import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/app/lib/supabaseAdmin";

function safeJson(body: object, status = 200) {
  return NextResponse.json(body, { status });
}

export async function GET(req: Request) {
  try {
    const siteId = new URL(req.url).searchParams.get("site_id")?.trim();
    if (!siteId) {
      return safeJson({ success: false, error: "site_id required" }, 400);
    }

    const admin = supabaseAdmin();
    const { data, error } = await admin
      .from("visit_source_events")
      .select("created_at, landing_url, referrer, source_classification")
      .eq("site_id", siteId)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    if (error) {
      console.error("[TRACKING_STATUS_ERROR]", error);
      return safeJson({ success: false, status: "error", error: error.message }, 500);
    }

    const hasEvents = !!data;
    return safeJson({
      success: true,
      status: hasEvents ? "active" : "no_events",
      hasEvents,
      lastEventAt: data?.created_at ?? null,
      lastEvent: data
        ? {
            landing_url: data.landing_url ?? null,
            referrer: data.referrer ?? null,
            source_classification: data.source_classification ?? null,
          }
        : null,
    });
  } catch (e) {
    console.error("[TRACKING_STATUS_ERROR]", e);
    return safeJson({ success: false, status: "error", error: "Internal error" }, 500);
  }
}
