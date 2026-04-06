import { NextResponse } from "next/server";
import { isValidPricingPlanId } from "@/app/lib/auth/loginPurchaseUrl";
import { upsertMetaCheckoutCapiContext } from "@/app/lib/metaCheckoutCapiContext";
import { sendMetaInitiateCheckout } from "@/app/lib/metaCapi";
import { metaInitiateCheckoutEventId } from "@/app/lib/metaMarketingIds";
import { supabaseAdmin } from "@/app/lib/supabaseAdmin";

function clientIpFromRequest(req: Request): string | null {
  const xf = req.headers.get("x-forwarded-for");
  if (xf) {
    const first = xf.split(",")[0]?.trim();
    if (first) return first;
  }
  const real = req.headers.get("x-real-ip");
  if (real?.trim()) return real.trim();
  return null;
}

export async function POST(req: Request) {
  try {
    const body = (await req.json().catch(() => null)) as Record<string, unknown> | null;
    if (!body) {
      return NextResponse.json({ ok: false, error: "invalid_json" }, { status: 400 });
    }

    const checkoutAttemptId =
      typeof body.checkout_attempt_id === "string" ? body.checkout_attempt_id.trim() : "";
    const plan = typeof body.plan === "string" ? body.plan.trim() : "";
    const billingPeriod = typeof body.billing_period === "string" ? body.billing_period.trim() : "";
    const email = typeof body.email === "string" ? body.email.trim().toLowerCase() : "";
    const eventIdRaw = typeof body.event_id === "string" ? body.event_id.trim() : "";
    const eventSourceUrl = typeof body.event_source_url === "string" ? body.event_source_url.trim() : null;
    const fbp = typeof body.fbp === "string" ? body.fbp.trim() : null;
    const fbc = typeof body.fbc === "string" ? body.fbc.trim() : null;
    const bodyUa = typeof body.user_agent === "string" ? body.user_agent.trim() : "";
    const headerUa = req.headers.get("user-agent")?.trim() ?? "";
    const appUserIdRaw = typeof body.app_user_id === "string" ? body.app_user_id.trim() : "";
    const externalId = /^[0-9a-f-]{36}$/i.test(appUserIdRaw) ? appUserIdRaw : null;

    if (!checkoutAttemptId || !plan || !billingPeriod || !email) {
      return NextResponse.json({ ok: false, error: "missing_fields" }, { status: 400 });
    }

    const attemptOk =
      /^[0-9a-f-]{36}$/i.test(checkoutAttemptId) || /^ca-\d+-[a-f0-9]+$/i.test(checkoutAttemptId);
    if (!attemptOk) {
      return NextResponse.json({ ok: false, error: "invalid_checkout_attempt" }, { status: 400 });
    }
    if (!isValidPricingPlanId(plan)) {
      return NextResponse.json({ ok: false, error: "invalid_plan" }, { status: 400 });
    }
    if (billingPeriod !== "monthly" && billingPeriod !== "yearly") {
      return NextResponse.json({ ok: false, error: "invalid_billing" }, { status: 400 });
    }

    const expectedId = metaInitiateCheckoutEventId(checkoutAttemptId);
    if (!eventIdRaw || eventIdRaw !== expectedId) {
      return NextResponse.json({ ok: false, error: "invalid_event_id" }, { status: 400 });
    }

    const clientIp = clientIpFromRequest(req);
    const ua = bodyUa || headerUa || null;
    const appBase = process.env.NEXT_PUBLIC_APP_URL?.replace(/\/$/, "") ?? "";
    const eventSourceUrlResolved =
      (eventSourceUrl && eventSourceUrl.length > 0 ? eventSourceUrl : null) ||
      (appBase ? `${appBase}/` : null);

    await upsertMetaCheckoutCapiContext(supabaseAdmin(), {
      checkout_attempt_id: checkoutAttemptId,
      client_user_agent: ua,
      event_source_url: eventSourceUrlResolved,
      client_ip: clientIp,
      fbp: fbp || null,
      fbc: fbc || null,
    });

    await sendMetaInitiateCheckout({
      idempotencyKey: `initiate_checkout:${checkoutAttemptId}`,
      eventId: expectedId,
      eventTimeSeconds: Math.floor(Date.now() / 1000),
      eventSourceUrl: eventSourceUrlResolved,
      email,
      externalId,
      clientIp,
      userAgent: ua,
      fbp: fbp || null,
      fbc: fbc || null,
      country: null,
      customData: {
        plan,
        billing_period: billingPeriod,
        checkout_attempt_id: checkoutAttemptId,
        source: "paddle",
      },
    });

    return NextResponse.json({ ok: true });
  } catch (e) {
    console.error("[initiate-checkout]", e);
    return NextResponse.json({ ok: false, error: "server_error" }, { status: 500 });
  }
}
