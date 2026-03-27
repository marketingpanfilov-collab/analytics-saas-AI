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
import { checkRateLimit, getRequestIp } from "@/app/lib/security/rateLimit";
import { logTrackingTelemetry } from "@/app/lib/trackingTelemetry";

const INGEST_KEY_HEADER = "x-boardiq-key";

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
      "Access-Control-Allow-Headers": "Content-Type, X-BoardIQ-Key",
      "Access-Control-Max-Age": "86400",
    },
  });
}

export async function POST(req: Request) {
  try {
    const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
    const visitorId = safeStr(body.visitor_id, 64);
    const siteId = safeStr(body.site_id, 64);
    const ingestKey = req.headers.get(INGEST_KEY_HEADER)?.trim() ?? "";

    if (!visitorId || !siteId) {
      return NextResponse.json(
        { success: false, error: "visitor_id and site_id required" },
        { status: 400, headers: { "Access-Control-Allow-Origin": "*" } }
      );
    }

    if (!ingestKey) {
      return NextResponse.json(
        { success: false, error: "Missing ingest key" },
        { status: 401, headers: { "Access-Control-Allow-Origin": "*" } }
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
    const { data: project, error: projectError } = await admin
      .from("projects")
      .select("id, public_ingest_key")
      .eq("id", siteId)
      .maybeSingle();
    if (projectError || !project || project.public_ingest_key !== ingestKey) {
      return NextResponse.json(
        { success: false, error: "Invalid ingest key" },
        { status: 403, headers: { "Access-Control-Allow-Origin": "*" } }
      );
    }

    const ip = getRequestIp(req);
    const rate = await checkRateLimit(`tracking_source_post:${siteId}:${ip}`, 120, 60_000);
    if (!rate.ok) {
      return NextResponse.json(
        { success: false, error: "Rate limit exceeded", retry_after_seconds: rate.retryAfterSec },
        {
          status: 429,
          headers: {
            "Access-Control-Allow-Origin": "*",
            "Retry-After": String(rate.retryAfterSec),
          },
        }
      );
    }

    const { error } = await admin.from("visit_source_events").upsert({
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
    }, { onConflict: "site_id,visit_id", ignoreDuplicates: true });

    if (error) {
      console.error("[TRACKING_SOURCE_INSERT_ERROR]", error);
      await logTrackingTelemetry({
        endpoint: "/api/tracking/source",
        reason_code: "insert_failed",
        site_id: siteId,
        message: error.message,
        payload: { has_visit_id: !!visitId, touch_type: touchType },
      });
      return NextResponse.json(
        { success: false, error: error.message },
        { status: 500, headers: { "Access-Control-Allow-Origin": "*" } }
      );
    }

    return NextResponse.json(
      { success: true, duplicate: !!visitIdParam },
      { status: 201, headers: { "Access-Control-Allow-Origin": "*" } }
    );
  } catch (e) {
    console.error("[TRACKING_SOURCE_ERROR]", e);
    await logTrackingTelemetry({
      endpoint: "/api/tracking/source",
      reason_code: "fatal_error",
      message: e instanceof Error ? e.message : String(e),
    });
    return NextResponse.json(
      { success: false, error: "Internal error" },
      { status: 500, headers: { "Access-Control-Allow-Origin": "*" } }
    );
  }
}
