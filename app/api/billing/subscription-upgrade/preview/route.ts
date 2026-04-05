import { NextResponse } from "next/server";
import {
  previewSubscriptionUpgrade,
  shapeUpgradePreviewForUi,
} from "@/app/lib/paddleSubscriptionUpgradeOps";
import {
  assertAllowedOrResponse,
  parseUpgradeBody,
  requirePaddleUpgradeActor,
  type UpgradeBody,
} from "@/app/api/billing/subscription-upgrade/shared";

export async function POST(req: Request) {
  const actor = await requirePaddleUpgradeActor();
  if (!actor.ok) return actor.response;

  let body: UpgradeBody;
  try {
    body = (await req.json()) as UpgradeBody;
  } catch {
    return NextResponse.json({ success: false, error: "Invalid JSON" }, { status: 400 });
  }

  const parsed = parseUpgradeBody(body);
  if (!parsed.ok) return parsed.response;

  const denied = assertAllowedOrResponse(actor.current, parsed.targetPlan, parsed.targetBilling);
  if (denied) return denied;

  const subId = actor.ctx.provider_subscription_id;
  console.info("[billing_upgrade] preview", {
    subscription_id: subId,
    target_plan: parsed.targetPlan,
    target_billing: parsed.targetBilling,
  });

  const r = await previewSubscriptionUpgrade(subId, parsed.targetPlan, parsed.targetBilling);
  if (!r.ok) {
    console.error("[billing_upgrade] preview_failed", {
      subscription_id: subId,
      error: r.error.slice(0, 500),
    });
    return NextResponse.json({ success: false, error: r.error }, { status: 422 });
  }

  const ui = shapeUpgradePreviewForUi(
    { plan: String(actor.current.plan), billing: actor.current.billing },
    { plan: parsed.targetPlan, billing: parsed.targetBilling },
    r.paddle
  );

  console.info("[billing_upgrade] preview_ok", { subscription_id: subId });
  return NextResponse.json({
    success: true,
    subscription_id: actor.ctx.provider_subscription_id,
    preview: ui,
    proration_billing_mode: "prorated_immediately",
  });
}
