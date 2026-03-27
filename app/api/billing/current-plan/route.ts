import { NextResponse } from "next/server";
import { createServerSupabase } from "@/app/lib/supabaseServer";
import { supabaseAdmin } from "@/app/lib/supabaseAdmin";

type PlanId = "starter" | "growth" | "agency" | "unknown";
type BillingPeriod = "monthly" | "yearly" | "unknown";

function detectPlan(priceId: string | null): { plan: PlanId; billing: BillingPeriod } {
  if (!priceId) return { plan: "unknown", billing: "unknown" };
  const id = priceId.trim();
  const m = {
    starterMonthly: process.env.NEXT_PUBLIC_PADDLE_PRICE_STARTER,
    starterYearly: process.env.NEXT_PUBLIC_PADDLE_PRICE_STARTER_YEARLY,
    growthMonthly: process.env.NEXT_PUBLIC_PADDLE_PRICE_GROWTH,
    growthYearly: process.env.NEXT_PUBLIC_PADDLE_PRICE_GROWTH_YEARLY,
    agencyMonthly: process.env.NEXT_PUBLIC_PADDLE_PRICE_AGENCY,
    agencyYearly: process.env.NEXT_PUBLIC_PADDLE_PRICE_AGENCY_YEARLY,
  };
  if (id === m.starterMonthly) return { plan: "starter", billing: "monthly" };
  if (id === m.starterYearly) return { plan: "starter", billing: "yearly" };
  if (id === m.growthMonthly) return { plan: "growth", billing: "monthly" };
  if (id === m.growthYearly) return { plan: "growth", billing: "yearly" };
  if (id === m.agencyMonthly) return { plan: "agency", billing: "monthly" };
  if (id === m.agencyYearly) return { plan: "agency", billing: "yearly" };
  return { plan: "unknown", billing: "unknown" };
}

const ACTIVE_STATUSES = new Set(["active", "trialing", "past_due"]);

export async function GET() {
  const supabase = await createServerSupabase();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ success: false, error: "Unauthorized" }, { status: 401 });
  }

  const admin = supabaseAdmin();
  const email = (user.email ?? "").trim().toLowerCase() || null;

  const customerIds = new Set<string>();

  const { data: byUser } = await admin
    .from("billing_customer_map")
    .select("provider_customer_id")
    .eq("provider", "paddle")
    .eq("user_id", user.id)
    .order("updated_at", { ascending: false })
    .limit(5);
  for (const r of byUser ?? []) {
    if (r.provider_customer_id) customerIds.add(String(r.provider_customer_id));
  }

  if (customerIds.size === 0 && email) {
    const { data: byEmail } = await admin
      .from("billing_customer_map")
      .select("provider_customer_id")
      .eq("provider", "paddle")
      .eq("email", email)
      .order("updated_at", { ascending: false })
      .limit(5);
    for (const r of byEmail ?? []) {
      if (r.provider_customer_id) customerIds.add(String(r.provider_customer_id));
    }
  }

  if (customerIds.size === 0) {
    return NextResponse.json({ success: true, subscription: null });
  }

  const ids = Array.from(customerIds);
  const { data: subs, error: subsErr } = await admin
    .from("billing_subscriptions")
    .select(
      "provider_subscription_id, provider_customer_id, provider_price_id, status, currency_code, current_period_start, current_period_end, canceled_at, last_event_type, last_event_at, updated_at"
    )
    .eq("provider", "paddle")
    .in("provider_customer_id", ids)
    .order("updated_at", { ascending: false })
    .limit(20);

  if (subsErr) {
    return NextResponse.json({ success: false, error: subsErr.message }, { status: 500 });
  }

  const list = (subs ?? []) as Array<{
    provider_subscription_id: string;
    provider_customer_id: string | null;
    provider_price_id: string | null;
    status: string | null;
    currency_code: string | null;
    current_period_start: string | null;
    current_period_end: string | null;
    canceled_at: string | null;
    last_event_type: string | null;
    last_event_at: string | null;
    updated_at: string | null;
  }>;

  if (!list.length) {
    return NextResponse.json({ success: true, subscription: null });
  }

  const activeFirst = [...list].sort((a, b) => {
    const aActive = ACTIVE_STATUSES.has(String(a.status ?? "").toLowerCase()) ? 1 : 0;
    const bActive = ACTIVE_STATUSES.has(String(b.status ?? "").toLowerCase()) ? 1 : 0;
    if (aActive !== bActive) return bActive - aActive;
    const aTs = Date.parse(String(a.current_period_end ?? a.updated_at ?? "")) || 0;
    const bTs = Date.parse(String(b.current_period_end ?? b.updated_at ?? "")) || 0;
    return bTs - aTs;
  });

  const top = activeFirst[0]!;
  const planMeta = detectPlan(top.provider_price_id ?? null);

  return NextResponse.json({
    success: true,
    subscription: {
      provider: "paddle",
      plan: planMeta.plan,
      billing_period: planMeta.billing,
      status: String(top.status ?? "unknown").toLowerCase(),
      provider_subscription_id: top.provider_subscription_id,
      current_period_start: top.current_period_start,
      current_period_end: top.current_period_end,
      canceled_at: top.canceled_at,
      currency_code: top.currency_code,
      last_event_type: top.last_event_type,
      last_event_at: top.last_event_at,
    },
  });
}

