/**
 * POST /api/tracking/conversion
 *
 * Ingest conversion events (registration, purchase) for first-party attribution.
 * Protected by project public ingest key (X-BoardIQ-Key) and rate limits (per IP, per project).
 */
import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/app/lib/supabaseAdmin";
import {
  getClientIp,
  getMinuteWindowStart,
  getDayWindowStart,
  parseIngestRateLimitError,
} from "@/app/lib/rateLimit";
import { detectTrafficSource } from "@/app/lib/trafficSourceDetection";

const INGEST_KEY_HEADER = "x-boardiq-key";
const ALLOWED_EVENT_NAMES = ["registration", "purchase"] as const;

function safeStr(v: unknown, maxLen = 2048): string | null {
  if (v == null || v === "") return null;
  const s = String(v).trim();
  return s.length > maxLen ? s.slice(0, maxLen) : s;
}

function safeNum(v: unknown): number | null {
  if (v == null || v === "") return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

function safeMetadata(v: unknown): Record<string, unknown> {
  if (v == null || typeof v !== "object" || Array.isArray(v)) return {};
  return v as Record<string, unknown>;
}

function isValidUuid(s: string | null): boolean {
  if (!s || s.length < 32) return false;
  const u =
    /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
  return u.test(s);
}

const corsHeaders = { "Access-Control-Allow-Origin": "*" };

export async function OPTIONS() {
  return new NextResponse(null, {
    status: 204,
    headers: {
      ...corsHeaders,
      "Access-Control-Allow-Methods": "POST, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type, X-BoardIQ-Key",
      "Access-Control-Max-Age": "86400",
    },
  });
}

export async function POST(req: Request) {
  try {
    const ingestKey = req.headers.get(INGEST_KEY_HEADER)?.trim();
    if (!ingestKey) {
      return NextResponse.json(
        { success: false, error: "Missing ingest key" },
        { status: 401, headers: corsHeaders }
      );
    }

    const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;

    const projectIdRaw = safeStr(body.project_id, 64);
    if (!projectIdRaw || !isValidUuid(projectIdRaw)) {
      return NextResponse.json(
        { success: false, error: "project_id required and must be a valid UUID" },
        { status: 400, headers: corsHeaders }
      );
    }

    const admin = supabaseAdmin();
    const { data: project, error: projectError } = await admin
      .from("projects")
      .select("id, public_ingest_key")
      .eq("id", projectIdRaw)
      .maybeSingle();

    if (projectError || !project) {
      return NextResponse.json(
        { success: false, error: "Invalid ingest key" },
        { status: 403, headers: corsHeaders }
      );
    }
    if (project.public_ingest_key !== ingestKey) {
      return NextResponse.json(
        { success: false, error: "Invalid ingest key" },
        { status: 403, headers: corsHeaders }
      );
    }

    const clientIp = getClientIp(req);
    const minuteStart = getMinuteWindowStart();
    const dayStart = getDayWindowStart();
    const { error: rateLimitError } = await admin.rpc("check_and_increment_ingest_rate", {
      p_project_id: projectIdRaw,
      p_ip: clientIp,
      p_minute_ts: minuteStart.toISOString(),
      p_day_ts: dayStart.toISOString(),
    });
    if (rateLimitError) {
      const limitResult = parseIngestRateLimitError(rateLimitError);
      if (limitResult && !limitResult.allowed) {
        return NextResponse.json(
          {
            success: false,
            error: "Rate limit exceeded",
            retry_after_seconds: limitResult.retryAfterSeconds,
          },
          {
            status: 429,
            headers: {
              ...corsHeaders,
              "Retry-After": String(limitResult.retryAfterSeconds),
            },
          }
        );
      }
      throw rateLimitError;
    }

    const eventNameRaw = safeStr(body.event_name, 64);
    if (!eventNameRaw || !ALLOWED_EVENT_NAMES.includes(eventNameRaw as (typeof ALLOWED_EVENT_NAMES)[number])) {
      return NextResponse.json(
        { success: false, error: "event_name must be one of: registration, purchase" },
        { status: 400, headers: corsHeaders }
      );
    }

    const visitorId = safeStr(body.visitor_id, 256);
    const sessionId = safeStr(body.session_id, 256);

    const eventTimeRaw = body.event_time;
    const eventTime =
      eventTimeRaw != null && typeof eventTimeRaw === "string"
        ? new Date(eventTimeRaw)
        : new Date();
    const eventTimeValid = Number.isFinite(eventTime.getTime())
      ? eventTime.toISOString()
      : new Date().toISOString();

    const source = safeStr(body.source, 64) ?? "pixel";
    const externalEventId = safeStr(body.external_event_id, 512);
    const userExternalId = safeStr(body.user_external_id, 512);
    const clickId = safeStr(body.click_id, 512);
    const fbp = safeStr(body.fbp, 512);
    const fbc = safeStr(body.fbc, 512);
    const utmSource = safeStr(body.utm_source, 256);
    const utmMedium = safeStr(body.utm_medium, 256);
    const utmCampaign = safeStr(body.utm_campaign, 256);
    const utmContent = safeStr(body.utm_content, 256);
    const utmTerm = safeStr(body.utm_term, 256);
    const value = safeNum(body.value);
    const currency = safeStr(body.currency, 16);
    const metadata = safeMetadata(body.metadata);
    let campaign_intent: string | null = safeStr(body.campaign_intent, 32) === "retention" ? "retention" : null;
    if (!campaign_intent && clickId) {
      const { data: clickRow } = await admin
        .from("redirect_click_events")
        .select("campaign_intent")
        .eq("project_id", projectIdRaw)
        .eq("bq_click_id", clickId)
        .limit(1)
        .maybeSingle();
      if (clickRow?.campaign_intent === "retention") campaign_intent = "retention";
    }

    const referrer = safeStr(body.referrer, 2048);
    const { traffic_source: trafficSource, traffic_platform: trafficPlatform } = detectTrafficSource({
      fbclid: null,
      gclid: null,
      ttclid: null,
      yclid: null,
      utm_source: utmSource,
      referrer,
    });

    const { error } = await admin.from("conversion_events").insert({
      project_id: projectIdRaw,
      source,
      event_name: eventNameRaw,
      event_time: eventTimeValid,
      external_event_id: externalEventId,
      user_external_id: userExternalId,
      visitor_id: visitorId,
      session_id: sessionId,
      click_id: clickId,
      fbp,
      fbc,
      utm_source: utmSource,
      utm_medium: utmMedium,
      utm_campaign: utmCampaign,
      utm_content: utmContent,
      utm_term: utmTerm,
      value,
      currency,
      metadata,
      traffic_source: trafficSource,
      traffic_platform: trafficPlatform,
      campaign_intent: campaign_intent ?? null,
    });

    if (error) {
      console.error("[TRACKING_CONVERSION_INSERT_ERROR]", error);
      return NextResponse.json(
        { success: false, error: error.message },
        { status: 500, headers: corsHeaders }
      );
    }

    return NextResponse.json(
      { success: true },
      { status: 201, headers: corsHeaders }
    );
  } catch (e) {
    console.error("[TRACKING_CONVERSION_ERROR]", e);
    return NextResponse.json(
      { success: false, error: "Internal error" },
      { status: 500, headers: corsHeaders }
    );
  }
}
