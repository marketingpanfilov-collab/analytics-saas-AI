import { NextResponse } from "next/server";
import { parsePricingPlanId } from "@/app/lib/auth/loginPurchaseUrl";
import { loadPaddleSubscriptionUpgradeContext } from "@/app/lib/billingPaddleSubscriptionContext";
import { createServerSupabase } from "@/app/lib/supabaseServer";
import { supabaseAdmin } from "@/app/lib/supabaseAdmin";
import type { BillingPeriod } from "@/app/lib/paddlePriceMap";
import { assertUpgradeAllowed } from "@/app/lib/paddleSubscriptionUpgradeOps";
import type { CurrentSubscriptionSlice } from "@/app/lib/subscriptionUpgradeEligibility";

export type UpgradeBody = {
  target_plan?: string;
  target_billing?: string;
  /** UUID v4: один ключ на попытку apply; повторы с тем же ключом идемпотентны. */
  idempotency_key?: string;
};

const UUID_V4_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export function parseApplyIdempotencyKey(body: UpgradeBody): { ok: true; key: string } | { ok: false; response: NextResponse } {
  const raw = String(body?.idempotency_key ?? "").trim();
  if (!UUID_V4_RE.test(raw)) {
    return {
      ok: false,
      response: NextResponse.json(
        { success: false, error: "Поле idempotency_key обязательно (UUID v4)." },
        { status: 400 }
      ),
    };
  }
  return { ok: true, key: raw.toLowerCase() };
}

export function parseUpgradeBody(body: UpgradeBody | null): {
  ok: true;
  targetPlan: NonNullable<ReturnType<typeof parsePricingPlanId>>;
  targetBilling: BillingPeriod;
} | { ok: false; response: NextResponse } {
  const tp = parsePricingPlanId(body?.target_plan ?? null);
  const rawB = String(body?.target_billing ?? "").toLowerCase();
  const targetBilling: BillingPeriod | null =
    rawB === "monthly" || rawB === "yearly" ? rawB : null;
  if (!tp || !targetBilling) {
    return {
      ok: false,
      response: NextResponse.json(
        { success: false, error: "target_plan и target_billing (monthly|yearly) обязательны." },
        { status: 400 }
      ),
    };
  }
  return { ok: true, targetPlan: tp, targetBilling };
}

export async function requirePaddleUpgradeActor(): Promise<
  | {
      ok: true;
      userId: string;
      email: string | null;
      ctx: NonNullable<Awaited<ReturnType<typeof loadPaddleSubscriptionUpgradeContext>>>;
      current: CurrentSubscriptionSlice;
    }
  | { ok: false; response: NextResponse }
> {
  const supabase = await createServerSupabase();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return { ok: false, response: NextResponse.json({ success: false, error: "Unauthorized" }, { status: 401 }) };
  }
  const admin = supabaseAdmin();
  const email = (user.email ?? "").trim().toLowerCase() || null;
  const ctx = await loadPaddleSubscriptionUpgradeContext(admin, user.id, email);
  if (!ctx) {
    return {
      ok: false,
      response: NextResponse.json(
        { success: false, error: "Нет активной Paddle-подписки для апгрейда." },
        { status: 400 }
      ),
    };
  }
  const current: CurrentSubscriptionSlice = { plan: ctx.plan, billing: ctx.billing };
  return { ok: true, userId: user.id, email, ctx, current };
}

const UPGRADE_DENY_REASONS: Record<string, string> = {
  unknown_current: "Не удалось определить текущий тариф подписки.",
  invalid_plan: "Некорректный тариф.",
  year_to_month_forbidden: "Переход с годовой оплаты на месячную недоступен.",
  no_change: "Уже выбран этот тариф и период.",
  same_tier_not_allowed: "Это изменение недоступно.",
  downgrade_forbidden: "Понижение тарифа недоступно.",
};

export function assertAllowedOrResponse(
  current: CurrentSubscriptionSlice,
  targetPlan: NonNullable<ReturnType<typeof parsePricingPlanId>>,
  targetBilling: BillingPeriod
): NextResponse | null {
  try {
    assertUpgradeAllowed(current, targetPlan, targetBilling);
    return null;
  } catch (e) {
    const code = e instanceof Error ? e.message : "transition_not_allowed";
    const human = UPGRADE_DENY_REASONS[code] ?? "Изменение подписки недоступно.";
    return NextResponse.json({ success: false, error: human, code }, { status: 403 });
  }
}
