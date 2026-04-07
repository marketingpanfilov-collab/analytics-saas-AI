import { NextResponse } from "next/server";
import { parseBearerToken } from "@/app/lib/auth/parseBearerAuth";
import { getPaddleBillingApiSecret } from "@/app/lib/paddleBillingServer";
import { supabaseAdmin } from "@/app/lib/supabaseAdmin";

function authorizeCron(req: Request): boolean {
  const cronSecret = process.env.CRON_SECRET?.trim() ?? "";
  const internal = process.env.INTERNAL_SYNC_SECRET?.trim() ?? "";
  const bearer = parseBearerToken(req.headers.get("authorization"));
  if (cronSecret && bearer === cronSecret) return true;
  if (internal && bearer === internal) return true;
  const header = req.headers.get("x-internal-sync-secret")?.trim() ?? "";
  if (internal && header === internal) return true;
  return false;
}

/**
 * GET /api/cron/billing-reconcile
 * Vercel Cron: snapshot health for Paddle ↔ DB. Full REST reconcile when server API key is added.
 */
export async function GET(req: Request) {
  if (!authorizeCron(req)) {
    return NextResponse.json({ success: false, error: "Unauthorized" }, { status: 401 });
  }

  const admin = supabaseAdmin();
  const since = new Date(Date.now() - 24 * 3600_000).toISOString();

  const { count: subCount, error: subErr } = await admin
    .from("billing_subscriptions")
    .select("id", { count: "exact", head: true });

  const { count: eventCount, error: evErr } = await admin
    .from("billing_webhook_events")
    .select("id", { count: "exact", head: true })
    .gte("received_at", since);

  const paddleKey = Boolean(getPaddleBillingApiSecret());

  if (subErr || evErr) {
    return NextResponse.json(
      {
        success: false,
        error: subErr?.message ?? evErr?.message ?? "Count failed",
      },
      { status: 500 }
    );
  }

  return NextResponse.json({
    success: true,
    checked_at: new Date().toISOString(),
    billing_subscriptions_total: subCount ?? 0,
    billing_webhook_events_last_24h: eventCount ?? 0,
    paddle_server_api_configured: paddleKey,
    hint: paddleKey
      ? "Next: implement subscription list fetch vs DB diff and upsert missing rows."
      : "Set PADDLE_SERVER_API_KEY or PADDLE_API_KEY and extend this job to pull subscriptions from Paddle Billing API.",
  });
}
