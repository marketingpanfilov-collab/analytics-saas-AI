import { NextResponse } from "next/server";
import { runBillingApplyIdempotent } from "@/app/lib/billingApplyIdempotency";
import { getPaddlePriceId } from "@/app/lib/paddlePriceMap";
import { applySubscriptionUpgrade } from "@/app/lib/paddleSubscriptionUpgradeOps";
import {
  assertAllowedOrResponse,
  parseApplyIdempotencyKey,
  parseUpgradeBody,
  requirePaddleUpgradeActor,
  type UpgradeBody,
} from "@/app/api/billing/subscription-upgrade/shared";

export async function POST(req: Request) {
  let body: UpgradeBody;
  try {
    body = (await req.json()) as UpgradeBody;
  } catch {
    return NextResponse.json({ success: false, error: "Invalid JSON" }, { status: 400 });
  }

  const projectId = typeof body.project_id === "string" ? body.project_id.trim() || null : null;
  const primaryOrgId =
    typeof body.primary_org_id === "string" ? body.primary_org_id.trim() || null : null;
  const providerSubscriptionId =
    typeof body.provider_subscription_id === "string"
      ? body.provider_subscription_id.trim() || null
      : null;
  const actor = await requirePaddleUpgradeActor(projectId, primaryOrgId, providerSubscriptionId);
  if (!actor.ok) return actor.response;

  const parsed = parseUpgradeBody(body);
  if (!parsed.ok) return parsed.response;

  const idem = parseApplyIdempotencyKey(body);
  if (!idem.ok) return idem.response;

  const denied = assertAllowedOrResponse(actor.current, parsed.targetPlan, parsed.targetBilling);
  if (denied) return denied;

  const subId = actor.ctx.provider_subscription_id;
  const targetPriceId = getPaddlePriceId(parsed.targetPlan, parsed.targetBilling);
  if (!targetPriceId) {
    return NextResponse.json(
      { success: false, error: "Целевой price_id не настроен.", payment_failed: false },
      { status: 422 }
    );
  }

  console.info("[billing_upgrade] apply", {
    subscription_id: subId,
    target_plan: parsed.targetPlan,
    target_billing: parsed.targetBilling,
    idempotency_key: idem.key,
  });

  let out: { statusCode: number; body: Record<string, unknown> };
  try {
    out = await runBillingApplyIdempotent(
      {
        subscriptionId: subId,
        targetPriceId,
        clientIdempotencyKey: idem.key,
      },
      async () => {
        const r = await applySubscriptionUpgrade(subId, parsed.targetPlan, parsed.targetBilling, {
          paddleIdempotencyKey: idem.key,
        });
        if (!r.ok) {
          const payment_failed = r.nonPaymentFailure !== true;
          console.error("[billing_upgrade] apply_failed", {
            subscription_id: subId,
            payment_failed,
            non_payment_failure: Boolean(r.nonPaymentFailure),
            error: r.error.slice(0, 500),
          });
          return {
            statusCode: 422,
            body: {
              success: false,
              error: r.error,
              payment_failed,
            },
          };
        }
        console.info("[billing_upgrade] apply_ok", { subscription_id: subId });
        return {
          statusCode: 200,
          body: {
            success: true,
            subscription_id: subId,
            proration_billing_mode: "prorated_immediately",
          },
        };
      }
    );
  } catch (e) {
    console.error("[billing_upgrade] idempotency_store_error", e);
    return NextResponse.json(
      { success: false, error: "Временная ошибка фиксации запроса. Повторите через несколько секунд." },
      { status: 503 }
    );
  }

  return NextResponse.json(out.body, { status: out.statusCode });
}
