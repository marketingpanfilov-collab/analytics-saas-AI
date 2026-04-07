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
  let body: UpgradeBody;
  try {
    body = (await req.json()) as UpgradeBody;
  } catch {
    return NextResponse.json({ success: false, error: "Invalid JSON" }, { status: 400 });
  }

  const projectId = typeof body.project_id === "string" ? body.project_id.trim() || null : null;
  const primaryOrgId =
    typeof body.primary_org_id === "string" ? body.primary_org_id.trim() || null : null;
  const actor = await requirePaddleUpgradeActor(projectId, primaryOrgId);
  if (!actor.ok) return actor.response;

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
