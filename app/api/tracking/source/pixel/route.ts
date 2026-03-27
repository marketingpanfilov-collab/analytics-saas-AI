/**
 * GET /api/tracking/source/pixel
 *
 * Image beacon fallback for tracking events when fetch POST fails (Safari, incognito).
 * Accepts same fields as POST /api/tracking/source via query params.
 * click_id = bqcid from URL; visit_id = bqvid (pixel generates or we generate).
 */
import { NextResponse } from "next/server";
import { randomUUID } from "crypto";
import { supabaseAdmin } from "@/app/lib/supabaseAdmin";
import { classifySource } from "@/app/lib/sourceClassification";
import { detectTrafficSource } from "@/app/lib/trafficSourceDetection";
import { checkRateLimit, getRequestIp } from "@/app/lib/security/rateLimit";
import { logTrackingTelemetry } from "@/app/lib/trackingTelemetry";

const GIF_1X1 = Buffer.from(
  "R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7",
  "base64"
);

function safeStr(v: unknown, maxLen = 2048): string | null {
  if (v == null || v === "") return null;
  const s = String(v).trim();
  return s.length > maxLen ? s.slice(0, maxLen) : s;
}

export async function GET(req: Request) {
  try {
    const params = new URL(req.url).searchParams;

    const visitorId = safeStr(params.get("visitor_id"), 64);
    const siteId = safeStr(params.get("site_id"), 64);
    const ingestKey = safeStr(params.get("ingest_key"), 256);

    if (!visitorId || !siteId || !ingestKey) {
      return new NextResponse(GIF_1X1, {
        status: 200,
        headers: {
          "Content-Type": "image/gif",
          "Cache-Control": "no-store",
        },
      });
    }

    const landingUrl = safeStr(params.get("landing_url"), 2048);
    const referrer = safeStr(params.get("referrer"), 2048);
    const utmSource = safeStr(params.get("utm_source"), 256);
    const utmMedium = safeStr(params.get("utm_medium"), 256);
    const utmCampaign = safeStr(params.get("utm_campaign"), 256);
    const utmContent = safeStr(params.get("utm_content"), 256);
    const utmTerm = safeStr(params.get("utm_term"), 256);
    const gclid = safeStr(params.get("gclid"), 256);
    const fbclid = safeStr(params.get("fbclid"), 256);
    const yclid = safeStr(params.get("yclid"), 256);
    const ttclid = safeStr(params.get("ttclid"), 256);
    const sessionId = safeStr(params.get("session_id"), 256);
    const fbp = safeStr(params.get("fbp"), 512);
    const fbc = safeStr(params.get("fbc"), 512);
    const clickId = safeStr(params.get("click_id"), 512);
    const visitIdParam = safeStr(params.get("visit_id"), 256);
    const visitId = visitIdParam || randomUUID();
    const touchType = (safeStr(params.get("touch_type"), 16) ?? "last") === "first" ? "first" : "last";

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
      await logTrackingTelemetry({
        endpoint: "/api/tracking/source/pixel",
        reason_code: "invalid_ingest_key",
        site_id: siteId,
      });
      return new NextResponse(GIF_1X1, {
        status: 200,
        headers: {
          "Content-Type": "image/gif",
          "Cache-Control": "no-store",
        },
      });
    }

    const ip = getRequestIp(req);
    const rate = await checkRateLimit(`tracking_source_pixel:${siteId}:${ip}`, 180, 60_000);
    if (!rate.ok) {
      await logTrackingTelemetry({
        endpoint: "/api/tracking/source/pixel",
        reason_code: "rate_limited",
        site_id: siteId,
        severity: "warn",
        payload: { retry_after_seconds: rate.retryAfterSec },
      });
      return new NextResponse(GIF_1X1, {
        status: 200,
        headers: {
          "Content-Type": "image/gif",
          "Cache-Control": "no-store",
        },
      });
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
    }, { onConflict: "site_id,visit_id", ignoreDuplicates: true });
    if (error) {
      await logTrackingTelemetry({
        endpoint: "/api/tracking/source/pixel",
        reason_code: "insert_failed",
        site_id: siteId,
        message: error.message,
        payload: { has_visit_id: !!visitIdParam, touch_type: touchType },
      });
    }
  } catch (e) {
    console.error("[TRACKING_PIXEL_ERROR]", e);
    await logTrackingTelemetry({
      endpoint: "/api/tracking/source/pixel",
      reason_code: "fatal_error",
      message: e instanceof Error ? e.message : String(e),
    });
  }

  return new NextResponse(GIF_1X1, {
    status: 200,
    headers: {
      "Content-Type": "image/gif",
      "Cache-Control": "no-store",
    },
  });
}
