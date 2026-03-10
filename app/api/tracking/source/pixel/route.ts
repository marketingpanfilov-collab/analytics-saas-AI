/**
 * GET /api/tracking/source/pixel
 *
 * Image beacon fallback for tracking events when fetch POST fails (Safari, incognito).
 * Accepts same fields as POST /api/tracking/source via query params.
 * Returns 1x1 transparent GIF.
 */
import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/app/lib/supabaseAdmin";
import { classifySource } from "@/app/lib/sourceClassification";

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

    if (!visitorId || !siteId) {
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

    const admin = supabaseAdmin();
    await admin.from("visit_source_events").insert({
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
      source_classification: sourceClassification,
      touch_type: touchType,
    });
  } catch (e) {
    console.error("[TRACKING_PIXEL_ERROR]", e);
  }

  return new NextResponse(GIF_1X1, {
    status: 200,
    headers: {
      "Content-Type": "image/gif",
      "Cache-Control": "no-store",
    },
  });
}
