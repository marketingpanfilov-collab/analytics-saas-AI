// app/api/oauth/meta/start/route.ts
import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

const COOKIE_PROJECT = "meta_oauth_project_id";
const COOKIE_RETURN = "meta_oauth_return_to";

function safeReturnTo(input: string) {
  const v = (input || "").trim();
  return v.startsWith("/") ? v : "/app/accounts";
}

export async function GET(req: NextRequest) {
  const appId = process.env.META_APP_ID;
  const redirectUri = process.env.META_REDIRECT_URI;

  if (!appId || !redirectUri) {
    return NextResponse.json(
      { success: false, error: "META_APP_ID или META_REDIRECT_URI не заданы в .env.local" },
      { status: 500 }
    );
  }

  const projectId = req.nextUrl.searchParams.get("project_id") || "";
  const returnTo = safeReturnTo(req.nextUrl.searchParams.get("return_to") || "/app/accounts");

  if (!projectId) {
    // вернём назад в UI с ошибкой
    const back = new URL("/app/accounts", req.nextUrl.origin);
    back.searchParams.set("connected", "meta_error");
    back.searchParams.set("reason", "project_id_missing");
    return NextResponse.redirect(back, { status: 302 });
  }

  // Минимально нужные для чтения рекламных данных
  const scope = "ads_read,business_management";

  // ✅ state передаем как base64(JSON), чтобы callback мог восстановить project_id/return_to.
  // Для обратной совместимости мы также сохраняем project_id/return_to в cookies.
  const statePayload = {
    project_id: projectId,
    return_to: returnTo,
    nonce: crypto.randomUUID(),
    v: 1,
  };
  const state = Buffer.from(JSON.stringify(statePayload), "utf8").toString("base64");

  const params = new URLSearchParams({
    client_id: appId,
    redirect_uri: redirectUri,
    response_type: "code",
    state,
    scope,
  });

  const url = `https://www.facebook.com/v19.0/dialog/oauth?${params.toString()}`;

  const res = NextResponse.redirect(url, { status: 302 });

  // сохраняем контекст старта, чтобы callback знал куда возвращать и какой project_id
  res.cookies.set(COOKIE_PROJECT, projectId, {
    httpOnly: true,
    sameSite: "lax",
    path: "/",
    maxAge: 60 * 10, // 10 минут
  });

  res.cookies.set(COOKIE_RETURN, returnTo, {
    httpOnly: true,
    sameSite: "lax",
    path: "/",
    maxAge: 60 * 10,
  });

  return res;
}