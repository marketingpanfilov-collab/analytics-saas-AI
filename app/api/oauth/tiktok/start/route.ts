import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { buildTikTokAdvertiserAuthUrl } from "@/app/lib/tiktokOAuthAuthorize";

function isUuid(v: string) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(v);
}

function safeReturnTo(input: string) {
  const v = (input || "").trim();
  return v.startsWith("/") ? v : "/app/accounts";
}

const SCOPES = [
  "user.info.basic",
  "advertiser.list",
  "report.insights",
];

export async function GET(req: NextRequest) {
  const appId = process.env.TIKTOK_APP_ID || process.env.TIKTOK_CLIENT_KEY;
  const redirectUri = process.env.TIKTOK_REDIRECT_URI;

  if (!appId || !redirectUri) {
    return NextResponse.json(
      { success: false, error: "TIKTOK_APP_ID/TIKTOK_CLIENT_KEY or TIKTOK_REDIRECT_URI not set in environment" },
      { status: 500 }
    );
  }

  const projectId = req.nextUrl.searchParams.get("project_id") ?? "";
  const returnTo = safeReturnTo(req.nextUrl.searchParams.get("return_to") ?? "/app/accounts");

  if (!projectId.trim()) {
    return NextResponse.json({ success: false, error: "project_id is required" }, { status: 400 });
  }
  if (!isUuid(projectId)) {
    return NextResponse.json({ success: false, error: "project_id must be a valid UUID" }, { status: 400 });
  }

  const forceReauth = req.nextUrl.searchParams.get("reauth") === "1";

  const statePayload = {
    project_id: projectId,
    return_to: returnTo,
    nonce: crypto.randomUUID(),
    issued_at_ms: Date.now(),
    v: 2,
  };
  const state = Buffer.from(JSON.stringify(statePayload), "utf8").toString("base64");

  const url = buildTikTokAdvertiserAuthUrl({
    appId: appId,
    redirectUri: redirectUri,
    state,
    scopes: SCOPES,
    forceReauth,
  });

  return NextResponse.redirect(url, { status: 302 });
}
