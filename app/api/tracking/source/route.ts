/**
 * POST /api/tracking/source
 *
 * First-party source tracking: receives visit/source attribution data from partner sites.
 * CORS enabled for cross-origin tracker requests.
 */
import { NextResponse } from "next/server";
import { randomUUID } from "crypto";
import { supabaseAdmin } from "@/app/lib/supabaseAdmin";
import { classifySource } from "@/app/lib/sourceClassification";
import { detectTrafficSource } from "@/app/lib/trafficSourceDetection";

function safeStr(v: unknown, maxLen = 2048): string | null {
  if (v == null || v === "") return null;
  const s = String(v).trim();
  return s.length > maxLen ? s.slice(0, maxLen) : s;
}

export async function OPTIONS() {
  return new NextResponse(null, {
    status: 204,
    headers: {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "POST, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type",
      "Access-Control-Max-Age": "86400",
    },
  });
}

export async function POST(req: Request) {
  try {
    const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
    const visitorId = safeStr(body.visitor_id, 64);
    const siteId = safeStr(body.site_id, 64);

    if (!visitorId || !siteId) {
      return NextResponse.json(
        { success: false, error: "visitor_id and site_id required" },
        { status: 400, headers: { "Access-Control-Allow-Origin": "*" } }
      );
    }

    const landingUrl = safeStr(body.landing_url, 2048);
    const referrer = safeStr(body.referrer, 2048);
    const utmSource = safeStr(body.utm_source, 256);
    const utmMedium = safeStr(body.utm_medium, 256);
    const utmCampaign = safeStr(body.utm_campaign, 256);
    const utmContent = safeStr(body.utm_content, 256);
    const utmTerm = safeStr(body.utm_term, 256);
    const gclid = safeStr(body.gclid, 256);
    const fbclid = safeStr(body.fbclid, 256);
    const yclid = safeStr(body.yclid, 256);
    const ttclid = safeStr(body.ttclid, 256);
    const touchType = (safeStr(body.touch_type, 16) ?? "last") === "first" ? "first" : "last";
    const sessionId = safeStr(body.session_id, 256);
    const fbp = safeStr(body.fbp, 512);
    const fbc = safeStr(body.fbc, 512);
    const clickId = safeStr(body.click_id, 512);
    const visitIdParam = safeStr(body.visit_id, 256);
    const visitId = visitIdParam || randomUUID();
    const campaignIntentRaw = safeStr(body.campaign_intent, 32);
    const campaign_intent = campaignIntentRaw === "retention" ? "retention" : null;

    const sourceClassification = classifySource({
      referrer,
      utm_source: utmSource,
      utm_medium: utmMedium,
      utm_campaign: utmCampaign,
      gclid,
      fbclid,
      yclid,
      ttclid,
    });

    const { traffic_source: trafficSource, traffic_platform: trafficPlatform } = detectTrafficSource({
      fbclid,
      gclid,
      ttclid,
      yclid,
      utm_source: utmSource,
      referrer,
    });

    const admin = supabaseAdmin();
    const { error } = await admin.from("visit_source_events").insert({
      visitor_id: visitorId,
      site_id: siteId,
      landing_url: landingUrl,
      referrer,
      utm_source: utmSource,
      utm_medium: utmMedium,
      utm_campaign: utmCampaign,
      utm_content: utmContent,
      utm_term: utmTerm,
      gclid,
      fbclid,
      yclid,
      ttclid,
      session_id: sessionId,
      fbp,
      fbc,
      click_id: clickId,
      visit_id: visitId,
      source_classification: sourceClassification,
      touch_type: touchType,
      traffic_source: trafficSource,
      traffic_platform: trafficPlatform,
      campaign_intent: campaign_intent ?? null,
    });

    if (error) {
      console.error("[TRACKING_SOURCE_INSERT_ERROR]", error);
      return NextResponse.json(
        { success: false, error: error.message },
        { status: 500, headers: { "Access-Control-Allow-Origin": "*" } }
      );
    }

    return NextResponse.json(
      { success: true },
      { status: 201, headers: { "Access-Control-Allow-Origin": "*" } }
    );
  } catch (e) {
    console.error("[TRACKING_SOURCE_ERROR]", e);
    return NextResponse.json(
      { success: false, error: "Internal error" },
      { status: 500, headers: { "Access-Control-Allow-Origin": "*" } }
    );
  }
}
