/**
 * GET /api/tracking/activity?project_id=xxx
 *
 * Returns last visit, last registration, last purchase and recent events for the Pixel activity panel.
 */
import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/app/lib/supabaseAdmin";

export async function GET(req: Request) {
  try {
    const projectId = new URL(req.url).searchParams.get("project_id")?.trim();
    if (!projectId) {
      return NextResponse.json({ success: false, error: "project_id required" }, { status: 400 });
    }

    const admin = supabaseAdmin();

    const [visitRes, lastRegRes, lastPurchaseRes, recentVisitsRes, recentConvsRes] = await Promise.all([
      admin
        .from("visit_source_events")
        .select("created_at, visitor_id, landing_url, utm_source, source_classification")
        .eq("site_id", projectId)
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle(),
      admin
        .from("conversion_events")
        .select("event_time, created_at, visitor_id, user_external_id, utm_source, metadata")
        .eq("project_id", projectId)
        .eq("event_name", "registration")
        .order("event_time", { ascending: false })
        .limit(1)
        .maybeSingle(),
      admin
        .from("conversion_events")
        .select("event_time, created_at, visitor_id, user_external_id, value, currency, utm_source, external_event_id")
        .eq("project_id", projectId)
        .eq("event_name", "purchase")
        .order("event_time", { ascending: false })
        .limit(1)
        .maybeSingle(),
      admin
        .from("visit_source_events")
        .select("created_at, visitor_id, utm_source")
        .eq("site_id", projectId)
        .order("created_at", { ascending: false })
        .limit(10),
      admin
        .from("conversion_events")
        .select("event_time, created_at, event_name, visitor_id, utm_source, value")
        .eq("project_id", projectId)
        .order("event_time", { ascending: false })
        .limit(10),
    ]);

    const lastVisit = visitRes.data
      ? {
          at: visitRes.data.created_at,
          visitor_id: visitRes.data.visitor_id ?? null,
          utm_source: visitRes.data.utm_source ?? null,
        }
      : null;

    const lastRegistration = lastRegRes.data
      ? {
          at: lastRegRes.data.event_time ?? lastRegRes.data.created_at,
          visitor_id: lastRegRes.data.visitor_id ?? null,
          user_external_id: lastRegRes.data.user_external_id ?? null,
        }
      : null;

    const lastPurchase = lastPurchaseRes.data
      ? {
          at: lastPurchaseRes.data.event_time ?? lastPurchaseRes.data.created_at,
          visitor_id: lastPurchaseRes.data.visitor_id ?? null,
          value: lastPurchaseRes.data.value ?? null,
          currency: lastPurchaseRes.data.currency ?? null,
        }
      : null;

    const visitRows = recentVisitsRes.data ?? [];
    const convRows = recentConvsRes.data ?? [];
    const visitEvents = visitRows.map((r) => ({
      time: r.created_at,
      event_type: "visit" as const,
      visitor_id: r.visitor_id ?? null,
      utm_source: r.utm_source ?? null,
      value: null as number | null,
    }));
    const convEvents = convRows.map((r) => ({
      time: r.event_time ?? r.created_at,
      event_type: r.event_name as "registration" | "purchase",
      visitor_id: r.visitor_id ?? null,
      utm_source: r.utm_source ?? null,
      value: r.value != null ? Number(r.value) : null,
    }));
    const recentEvents = [...visitEvents, ...convEvents]
      .sort((a, b) => new Date(b.time).getTime() - new Date(a.time).getTime())
      .slice(0, 10);

    return NextResponse.json({
      success: true,
      lastVisit,
      lastRegistration,
      lastPurchase,
      recentEvents,
    });
  } catch (e) {
    console.error("[TRACKING_ACTIVITY_ERROR]", e);
    return NextResponse.json({ success: false, error: "Internal error" }, { status: 500 });
  }
}
