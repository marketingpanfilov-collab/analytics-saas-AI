import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/app/lib/supabaseAdmin";
import { randomUUID, createHash } from "crypto";
import { checkRedirectRateLimit } from "@/app/lib/redirectRateLimit";
import { detectTrafficSource } from "@/app/lib/trafficSourceDetection";

function getClientIp(req: NextRequest): string | null {
  return (
    req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ||
    req.headers.get("x-real-ip")?.trim() ||
    null
  );
}

function safeStr(v: unknown, max = 2048): string | null {
  if (v == null || v === "") return null;
  const s = String(v).trim();
  return s.length > max ? s.slice(0, max) : s;
}

function fingerprintHash(ip: string | null, userAgent: string | null): string {
  const input = `${ip ?? ""}${userAgent ?? ""}`;
  return createHash("sha256").update(input).digest("hex");
}

/**
 * GET /r/[token]
 * Public redirect: rate limit, resolve token, log click with bqcid, update link stats, redirect.
 * bqcid is generated here, stored in redirect_click_events.bq_click_id, passed in destination URL as bqcid; pixel sends it as click_id in conversion events.
 */
export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ token: string }> }
) {
  const ip = getClientIp(req);
  const { allowed } = checkRedirectRateLimit(ip);
  if (!allowed) {
    return NextResponse.json({ error: "Too many requests" }, { status: 429 });
  }

  const token = (await params).token?.trim();
  if (!token) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  const admin = supabaseAdmin();
  const { data: link, error: linkErr } = await admin
    .from("redirect_links")
    .select("id, project_id, destination_url, utm_source, utm_medium, utm_campaign, utm_content, utm_term, campaign_intent")
    .eq("token", token)
    .maybeSingle();

  if (linkErr || !link) {
    return NextResponse.json({ error: "Link not found" }, { status: 404 });
  }

  const bqcid = randomUUID();
  const requestUrl = req.url;
  const searchParams = req.nextUrl.searchParams;

  const utm_source = safeStr(searchParams.get("utm_source") ?? link.utm_source, 256);
  const utm_medium = safeStr(searchParams.get("utm_medium") ?? link.utm_medium, 256);
  const utm_campaign = safeStr(searchParams.get("utm_campaign") ?? link.utm_campaign, 256);
  const utm_content = safeStr(searchParams.get("utm_content") ?? link.utm_content, 256);
  const utm_term = safeStr(searchParams.get("utm_term") ?? link.utm_term, 256);
  const utm_id = safeStr(searchParams.get("utm_id"), 512);
  const campaignIntentParam = safeStr(searchParams.get("campaign_intent"), 32);
  const campaign_intent = campaignIntentParam === "retention" ? "retention" : (link.campaign_intent === "retention" ? "retention" : null);
  const fbclid = safeStr(searchParams.get("fbclid"), 512);
  const gclid = safeStr(searchParams.get("gclid"), 512);
  const ttclid = safeStr(searchParams.get("ttclid"), 512);
  const yclid = safeStr(searchParams.get("yclid"), 512);
  const referrer = safeStr(req.headers.get("referer"), 2048);
  const userAgent = safeStr(req.headers.get("user-agent"), 1024);
  const cookieHeader = req.headers.get("cookie") ?? "";
  let fbp: string | null = null;
  let fbc: string | null = null;
  const fbpMatch = cookieHeader.match(/_fbp=([^;]+)/);
  const fbcMatch = cookieHeader.match(/_fbc=([^;]+)/);
  if (fbpMatch) fbp = safeStr(decodeURIComponent(fbpMatch[1].trim()), 512);
  if (fbcMatch) fbc = safeStr(decodeURIComponent(fbcMatch[1].trim()), 512);

  const fingerprint = fingerprintHash(ip, userAgent);

  const { traffic_source: detectedSource, traffic_platform: detectedPlatform } = detectTrafficSource({
    fbclid,
    gclid,
    ttclid,
    yclid,
    utm_source: utm_source ?? null,
    referrer: referrer ?? null,
  });

  await admin.from("redirect_click_events").insert({
    project_id: link.project_id,
    redirect_link_id: link.id,
    bq_click_id: bqcid,
    destination_url: link.destination_url,
    full_url: requestUrl.length > 2048 ? requestUrl.slice(0, 2048) : requestUrl,
    utm_source,
    utm_medium,
    utm_campaign,
    utm_content,
    utm_term,
    utm_id,
    campaign_intent,
    fbclid,
    gclid,
    ttclid,
    yclid,
    referrer,
    user_agent: userAgent,
    ip,
    fbp,
    fbc,
    fingerprint_hash: fingerprint,
    traffic_source: detectedSource,
    traffic_platform: detectedPlatform,
  });

  await admin.rpc("increment_redirect_link_clicks", { p_link_id: link.id });

  const dest = new URL(link.destination_url);
  const addParam = (key: string, value: string | null) => {
    if (!value) return;
    if (!dest.searchParams.has(key)) dest.searchParams.set(key, value);
  };
  addParam("bqcid", bqcid);
  addParam("utm_source", utm_source);
  addParam("utm_medium", utm_medium);
  addParam("utm_campaign", utm_campaign);
  addParam("utm_content", utm_content);
  addParam("utm_term", utm_term);
  addParam("utm_id", utm_id);
  addParam("fbclid", fbclid);
  addParam("gclid", gclid);
  addParam("ttclid", ttclid);
  addParam("yclid", yclid);
  addParam("campaign_id", safeStr(searchParams.get("campaign_id"), 512));
  addParam("adset_id", safeStr(searchParams.get("adset_id"), 512));
  addParam("ad_id", safeStr(searchParams.get("ad_id"), 512));
  addParam("click_id", safeStr(searchParams.get("click_id"), 512));
  if (campaign_intent === "retention") addParam("campaign_intent", "retention");

  return NextResponse.redirect(dest.toString(), 302);
}
