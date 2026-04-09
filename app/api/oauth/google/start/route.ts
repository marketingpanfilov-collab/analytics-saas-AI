import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

function isUuid(v: string) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(v);
}

function safeReturnTo(input: string) {
  const v = (input || "").trim();
  return v.startsWith("/") ? v : "/app/accounts";
}

const SCOPE =
  "openid https://www.googleapis.com/auth/userinfo.email https://www.googleapis.com/auth/userinfo.profile https://www.googleapis.com/auth/adwords";

export async function GET(req: NextRequest) {
  const clientId = process.env.GOOGLE_CLIENT_ID;
  const redirectUri = process.env.GOOGLE_REDIRECT_URI;

  if (!clientId || !redirectUri) {
    return NextResponse.json(
      { success: false, error: "GOOGLE_CLIENT_ID or GOOGLE_REDIRECT_URI not set in environment" },
      { status: 500 }
    );
  }

  const projectId = req.nextUrl.searchParams.get("project_id") ?? "";
  const returnTo = safeReturnTo(req.nextUrl.searchParams.get("return_to") ?? "/app/accounts");

  if (!projectId.trim()) {
    return NextResponse.json(
      { success: false, error: "project_id is required" },
      { status: 400 }
    );
  }

  if (!isUuid(projectId)) {
    return NextResponse.json(
      { success: false, error: "project_id must be a valid UUID" },
      { status: 400 }
    );
  }

  const statePayload = {
    project_id: projectId,
    return_to: returnTo,
    nonce: crypto.randomUUID(),
    v: 1,
  };
  const state = Buffer.from(JSON.stringify(statePayload), "utf8").toString("base64");

  const params = new URLSearchParams({
    client_id: clientId,
    redirect_uri: redirectUri,
    response_type: "code",
    scope: SCOPE,
    state,
    access_type: "offline",
    prompt: "consent",
  });

  const url = `https://accounts.google.com/o/oauth2/v2/auth?${params.toString()}`;
  return NextResponse.redirect(url, { status: 302 });
}
