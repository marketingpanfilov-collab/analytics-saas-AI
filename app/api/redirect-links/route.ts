import { NextResponse } from "next/server";
import { createServerSupabase } from "@/app/lib/supabaseServer";
import { supabaseAdmin } from "@/app/lib/supabaseAdmin";
import { requireProjectAccess } from "@/app/lib/auth/requireProjectAccess";
import {
  billingAnalyticsReadGateBeforeProject,
  billingHeavySyncGateBeforeProject,
} from "@/app/lib/auth/requireBillingAccess";
import { randomBytes } from "crypto";

const TRACKING_DOMAIN = process.env.TRACKING_DOMAIN || process.env.NEXT_PUBLIC_TRACKING_DOMAIN || "";

function generateToken(): string {
  return randomBytes(8).toString("base64url");
}

function safeStr(v: unknown, max = 2048): string | null {
  if (v == null || v === "") return null;
  const s = String(v).trim();
  return s.length > max ? s.slice(0, max) : s;
}

function isValidUrl(s: string): boolean {
  try {
    const u = new URL(s);
    return u.protocol === "http:" || u.protocol === "https:";
  } catch {
    return false;
  }
}

function getRedirectUrl(token: string): string {
  const base = TRACKING_DOMAIN.replace(/\/$/, "");
  return base ? `${base}/r/${token}` : `/r/${token}`;
}

/**
 * GET /api/redirect-links?project_id=xxx
 * Returns saved links with clicks_count and last_click_at from redirect_links.
 */
export async function GET(req: Request) {
  const url = new URL(req.url);
  const projectId = url.searchParams.get("project_id")?.trim();
  if (!projectId) {
    return NextResponse.json({ success: false, error: "project_id required" }, { status: 400 });
  }

  const supabase = await createServerSupabase();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ success: false, error: "Unauthorized" }, { status: 401 });
  }

  const billingRead = await billingAnalyticsReadGateBeforeProject(req);
  if (!billingRead.ok) return billingRead.response;

  const access = await requireProjectAccess(user.id, projectId);
  if (!access) {
    return NextResponse.json({ success: false, error: "Project access denied" }, { status: 403 });
  }

  const admin = supabaseAdmin();
  const { data: links, error: linksErr } = await admin
    .from("redirect_links")
    .select("id, token, destination_url, utm_source, utm_medium, utm_campaign, utm_content, utm_term, campaign_intent, created_at, clicks_count, last_click_at")
    .eq("project_id", projectId)
    .order("created_at", { ascending: false })
    .limit(50);

  if (linksErr) {
    return NextResponse.json({ success: false, error: linksErr.message }, { status: 500 });
  }

  const items = (links ?? []).map((r: {
    id: string;
    token: string;
    destination_url: string;
    utm_source: string | null;
    utm_medium: string | null;
    utm_campaign: string | null;
    utm_content: string | null;
    utm_term: string | null;
    campaign_intent: string | null;
    created_at: string;
    clicks_count: number | null;
    last_click_at: string | null;
  }) => ({
    id: r.id,
    token: r.token,
    destination_url: r.destination_url,
    utm_source: r.utm_source ?? null,
    utm_medium: r.utm_medium ?? null,
    utm_campaign: r.utm_campaign ?? null,
    utm_content: r.utm_content ?? null,
    utm_term: r.utm_term ?? null,
    campaign_intent: r.campaign_intent ?? null,
    created_at: r.created_at,
    clicks_count: r.clicks_count ?? 0,
    last_click_at: r.last_click_at ?? null,
    redirect_url: getRedirectUrl(r.token),
  }));

  return NextResponse.json({ success: true, items });
}

/**
 * POST /api/redirect-links
 * Body: { project_id, destination_url, utm_source?, utm_medium?, utm_campaign?, utm_content?, utm_term? }
 * Creates a redirect link. redirect_url uses TRACKING_DOMAIN.
 */
export async function POST(req: Request) {
  const body = await req.json().catch(() => null);
  const projectId = safeStr(body?.project_id, 64);
  const destinationUrl = safeStr(body?.destination_url, 2048);

  if (!projectId || !destinationUrl) {
    return NextResponse.json(
      { success: false, error: "project_id and destination_url are required" },
      { status: 400 }
    );
  }
  if (!isValidUrl(destinationUrl)) {
    return NextResponse.json(
      { success: false, error: "Invalid destination URL" },
      { status: 400 }
    );
  }

  const supabase = await createServerSupabase();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ success: false, error: "Unauthorized" }, { status: 401 });
  }

  const billingPre = await billingHeavySyncGateBeforeProject(req);
  if (!billingPre.ok) return billingPre.response;

  const access = await requireProjectAccess(user.id, projectId);
  if (!access) {
    return NextResponse.json({ success: false, error: "Project access denied" }, { status: 403 });
  }

  let token = generateToken();
  const admin = supabaseAdmin();
  for (let i = 0; i < 5; i++) {
    const { data: existing } = await admin.from("redirect_links").select("id").eq("token", token).maybeSingle();
    if (!existing) break;
    token = generateToken();
  }

  const utm_source = safeStr(body?.utm_source, 256);
  const utm_medium = safeStr(body?.utm_medium, 256);
  const utm_campaign = safeStr(body?.utm_campaign, 256);
  const utm_content = safeStr(body?.utm_content, 256);
  const utm_term = safeStr(body?.utm_term, 256);
  const campaign_intentRaw = safeStr(body?.campaign_intent, 32);
  const campaign_intent = campaign_intentRaw === "retention" ? "retention" : null;

  const { data: inserted, error } = await admin
    .from("redirect_links")
    .insert({
      project_id: projectId,
      token,
      destination_url: destinationUrl,
      utm_source,
      utm_medium,
      utm_campaign,
      utm_content,
      utm_term,
      campaign_intent,
    })
    .select("id, token, destination_url, created_at")
    .single();

  if (error) {
    return NextResponse.json({ success: false, error: error.message }, { status: 500 });
  }

  const redirectUrl = getRedirectUrl(inserted.token);

  return NextResponse.json({
    success: true,
    id: inserted.id,
    token: inserted.token,
    destination_url: inserted.destination_url,
    redirect_url: redirectUrl,
    created_at: inserted.created_at,
  });
}
