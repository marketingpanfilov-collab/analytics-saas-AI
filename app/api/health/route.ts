// app/api/health/route.ts
import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/app/lib/supabaseAdmin";

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const projectId = searchParams.get("project_id");

  if (!projectId) {
    return NextResponse.json({ success: false, error: "project_id required" }, { status: 400 });
  }

  const admin = supabaseAdmin();

  // 1) Проверяем token Meta (как у тебя в connections/list)
  const { data: integration, error: intErr } = await admin
    .from("integrations_meta")
    .select("expires_at")
    .eq("project_id", projectId)
    .eq("account_id", "default")
    .single();

  const expiresAt = integration?.expires_at ? new Date(integration.expires_at).getTime() : null;
  const hasToken = !intErr && !!integration;
  const tokenValid = hasToken ? (expiresAt === null ? true : expiresAt > Date.now()) : false;

  // 2) Есть ли выбранные кабинеты (is_enabled=true)
  const { data: activeRows, error: actErr } = await admin
    .from("meta_ad_accounts")
    .select("ad_account_id")
    .eq("project_id", projectId)
    .eq("is_enabled", true);

  const activeCount = actErr ? 0 : (activeRows?.length ?? 0);

  // 3) Формируем score (простая честная логика)
  // - нет токена => 0
  // - токен есть, но нет выбранных => 30
  // - токен есть + выбранные => 70
  // - дальше можно докрутить по “свежести данных” (если есть таблица инсайтов)
  let score = 0;

  if (!tokenValid) {
    score = 0;
  } else if (activeCount === 0) {
    score = 30;
  } else {
    score = 70;
  }

  // 4) (опционально) если у тебя есть таблица с синком инсайтов — добавим до 30 баллов
  // ВАЖНО: замени "meta_insights" и поле "date" под свою таблицу/схему, если хочешь.
  /*
  try {
    const since = new Date(Date.now() - 7 * 24 * 3600 * 1000).toISOString().slice(0, 10);
    const { count } = await admin
      .from("meta_insights")
      .select("*", { count: "exact", head: true })
      .eq("project_id", projectId)
      .gte("date", since);

    if ((count ?? 0) > 0) score = Math.min(100, score + 30);
  } catch {}
  */

  score = Math.max(0, Math.min(100, score));

  return NextResponse.json({
    success: true,
    score,
    details: {
      token_valid: tokenValid,
      active_accounts: activeCount,
    },
  });
}