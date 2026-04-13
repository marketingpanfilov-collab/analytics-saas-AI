/**
 * GET /api/tracking/source/status?site_id=xxx
 *
 * Returns whether visit_source_events has received any events for this site.
 * Requires authenticated user with access to the project (site_id = project_id).
 */
import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/app/lib/supabaseAdmin";
import { requireProjectAccessOrInternal } from "@/app/lib/auth/requireProjectAccessOrInternal";
import { billingAnalyticsReadGateFromAccess } from "@/app/lib/auth/requireBillingAccess";

function safeJson(body: object, status = 200) {
  return NextResponse.json(body, { status });
}

export async function GET(req: Request) {
  try {
    const siteId = new URL(req.url).searchParams.get("site_id")?.trim();
    if (!siteId) {
      return safeJson({ success: false, error: "site_id required" }, 400);
    }

    const access = await requireProjectAccessOrInternal(req, siteId);
    if (!access.allowed) {
      return safeJson(access.body, access.status);
    }

    const billing = await billingAnalyticsReadGateFromAccess(access);
    if (!billing.ok) return billing.response;

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
