import { NextResponse } from "next/server";
import { billingLog } from "@/app/lib/billing/billingObservability";
import { getOrganizationBillingDeleteBlockReason } from "@/app/lib/billing/organizationDeleteGuard";
import { requireSystemRole } from "@/app/lib/auth/requireSystemRole";
import { supabaseAdmin } from "@/app/lib/supabaseAdmin";
import { checkRateLimit, getRequestIp } from "@/app/lib/security/rateLimit";

const UUID_RE = /^[0-9a-f-]{36}$/i;

/**
 * POST /api/internal-admin/organizations/delete
 * body: { organization_id: string }
 * Удаление организации только без активного биллинга (подписка / entitlement / post-checkout).
 */
export async function POST(req: Request) {
  const auth = await requireSystemRole(["service_admin"]);
  if (!auth.ok) return NextResponse.json({ success: false, error: auth.error }, { status: auth.status });

  const ip = getRequestIp(req);
  const rl = await checkRateLimit(`internal:org-delete:${auth.userId}:${ip}`, 10, 60_000);
  if (!rl.ok) {
    return NextResponse.json(
      { success: false, error: `Rate limit exceeded. Retry in ${rl.retryAfterSec}s` },
      { status: 429 }
    );
  }

  const body = (await req.json().catch(() => null)) as { organization_id?: string } | null;
  const organizationId = String(body?.organization_id ?? "").trim();
  if (!UUID_RE.test(organizationId)) {
    return NextResponse.json({ success: false, error: "invalid organization_id" }, { status: 400 });
  }

  const admin = supabaseAdmin();
  const block = await getOrganizationBillingDeleteBlockReason(admin, organizationId);
  if (block) {
    billingLog("warn", "org_delete", "ORG_DELETE_BLOCKED_BILLING", {
      organization_id: organizationId,
      actor_user_id: auth.userId,
    });
    return NextResponse.json({ success: false, error: block }, { status: 409 });
  }

  const { error } = await admin.from("organizations").delete().eq("id", organizationId);
  if (error) {
    billingLog("error", "org_delete", "ORG_DELETE_FAILED", {
      organization_id: organizationId,
      message: error.message,
    });
    return NextResponse.json({ success: false, error: error.message }, { status: 500 });
  }

  billingLog("info", "org_delete", "ORG_DELETED", {
    organization_id: organizationId,
    actor_user_id: auth.userId,
  });
  return NextResponse.json({ success: true });
}
