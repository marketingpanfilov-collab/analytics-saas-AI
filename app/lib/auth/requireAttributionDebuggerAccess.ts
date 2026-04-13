/**
 * Страница /app/attribution-debugger и связанные GET API — только Growth / Scale.
 */
import { NextResponse } from "next/server";
import {
  billingAnalyticsReadGateFromAccess,
  billingGateUnavailableResponse,
} from "@/app/lib/auth/requireBillingAccess";
import { requireProjectAccessOrInternal } from "@/app/lib/auth/requireProjectAccessOrInternal";
import { resolveBillingGateContext } from "@/app/lib/billingCurrentPlan";
import { createServerSupabase } from "@/app/lib/supabaseServer";
import { PLAN_RESTRICTED_ANALYTICS_MESSAGE } from "@/app/lib/planRestrictedCopy";
import { supabaseAdmin } from "@/app/lib/supabaseAdmin";

export type AttributionDebuggerAccessOk = { ok: true; admin: ReturnType<typeof supabaseAdmin> };
export type AttributionDebuggerAccessFail = { ok: false; response: NextResponse };

export async function requireAttributionDebuggerApiAccess(
  req: Request,
  projectId: string
): Promise<AttributionDebuggerAccessOk | AttributionDebuggerAccessFail> {
  const access = await requireProjectAccessOrInternal(req, projectId, { allowInternalBypass: false });
  if (!access.allowed) {
    return { ok: false, response: NextResponse.json(access.body, { status: access.status }) };
  }

  const billing = await billingAnalyticsReadGateFromAccess(access);
  if (!billing.ok) return { ok: false, response: billing.response };

  if (access.source === "user") {
    const gateAdmin = supabaseAdmin();
    const supabase = await createServerSupabase();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    const ctx = await resolveBillingGateContext(gateAdmin, access.userId, user?.email ?? null, {
      projectId,
    });
    if (!ctx.ok) return { ok: false, response: billingGateUnavailableResponse() };
    if (ctx.effective_plan !== "growth" && ctx.effective_plan !== "scale") {
      return {
        ok: false,
        response: NextResponse.json(
          {
            success: false,
            error: PLAN_RESTRICTED_ANALYTICS_MESSAGE,
            code: "ATTRIBUTION_DEBUGGER_PLAN_REQUIRED",
            effective_plan: ctx.effective_plan,
          },
          { status: 403 }
        ),
      };
    }
  }

  return { ok: true, admin: supabaseAdmin() };
}
