/**
 * Billing gates for user-initiated heavy actions (sync, refresh, heavy reports).
 * Internal cron/backfill bypasses via requireProjectAccessOrInternal source === "internal".
 */
import { NextResponse } from "next/server";
import { createServerSupabase } from "@/app/lib/supabaseServer";
import { supabaseAdmin } from "@/app/lib/supabaseAdmin";
import { resolveBillingGateContext } from "@/app/lib/billingCurrentPlan";
import {
  type AccessState,
  accessStateAllowsAnalyticsRead,
  accessStateAllowsHeavySync,
} from "@/app/lib/accessState";
import type { ProjectAccessCheckResult } from "@/app/lib/auth/requireProjectAccessOrInternal";

export type BillingGateResult =
  | { ok: true; access_state: AccessState }
  | { ok: false; response: NextResponse };

/**
 * POST sync / refresh / OAuth pull: require full paid window (active, trialing, canceled_until_end).
 */
export async function requireBillingHeavySyncForUser(
  access: Extract<ProjectAccessCheckResult, { allowed: true }>,
  userEmail: string | null | undefined
): Promise<BillingGateResult> {
  if (access.source === "internal") {
    return { ok: true, access_state: "active" };
  }
  const admin = supabaseAdmin();
  const ctx = await resolveBillingGateContext(admin, access.userId, userEmail ?? null);
  if (!accessStateAllowsHeavySync(ctx.access_state)) {
    return {
      ok: false,
      response: NextResponse.json(
        {
          success: false,
          error: "Действие недоступно при текущем статусе подписки",
          code: "BILLING_BLOCKED",
          access_state: ctx.access_state,
          effective_plan: ctx.effective_plan,
        },
        { status: 402 }
      ),
    };
  }
  return { ok: true, access_state: ctx.access_state };
}

/**
 * Heavy analytics GET routes: allow read for soft states; block no_subscription and refunded.
 */
export async function requireBillingAnalyticsReadForUser(
  access: Extract<ProjectAccessCheckResult, { allowed: true }>,
  userEmail: string | null | undefined
): Promise<BillingGateResult> {
  if (access.source === "internal") {
    return { ok: true, access_state: "active" };
  }
  const admin = supabaseAdmin();
  const ctx = await resolveBillingGateContext(admin, access.userId, userEmail ?? null);
  if (!accessStateAllowsAnalyticsRead(ctx.access_state)) {
    return {
      ok: false,
      response: NextResponse.json(
        {
          success: false,
          error: "Отчёт недоступен при текущем статусе подписки",
          code: "BILLING_BLOCKED",
          access_state: ctx.access_state,
          effective_plan: ctx.effective_plan,
        },
        { status: 402 }
      ),
    };
  }
  return { ok: true, access_state: ctx.access_state };
}

export async function billingHeavySyncGateFromAccess(
  access: Extract<ProjectAccessCheckResult, { allowed: true }>
): Promise<BillingGateResult> {
  if (access.source === "internal") return { ok: true, access_state: "active" };
  const supabase = await createServerSupabase();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  return requireBillingHeavySyncForUser(access, user?.email ?? null);
}

export async function billingAnalyticsReadGateFromAccess(
  access: Extract<ProjectAccessCheckResult, { allowed: true }>
): Promise<BillingGateResult> {
  if (access.source === "internal") return { ok: true, access_state: "active" };
  const supabase = await createServerSupabase();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  return requireBillingAnalyticsReadForUser(access, user?.email ?? null);
}

/**
 * User-session billing check before project membership (Execution Plan P0-LOG-01).
 * Do not call for internal sync: use `isInternalSyncRequest` at the callsite and skip this.
 */
export async function billingHeavySyncGateBeforeProject(
  req: Request
): Promise<
  | { ok: true; userId: string; email: string | null }
  | { ok: false; response: NextResponse }
> {
  const supabase = await createServerSupabase();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return {
      ok: false,
      response: NextResponse.json({ success: false, error: "Unauthorized" }, { status: 401 }),
    };
  }
  const synthetic: Extract<ProjectAccessCheckResult, { allowed: true }> = {
    allowed: true,
    source: "user",
    userId: user.id,
  };
  const billing = await requireBillingHeavySyncForUser(synthetic, user.email ?? null);
  if (!billing.ok) return { ok: false, response: billing.response };
  return { ok: true, userId: user.id, email: user.email ?? null };
}

/** Billing read eligibility before project check (GET list / metadata). Caller skips for internal cron without session. */
export async function billingAnalyticsReadGateBeforeProject(
  req: Request
): Promise<
  | { ok: true; userId: string; email: string | null }
  | { ok: false; response: NextResponse }
> {
  const supabase = await createServerSupabase();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return {
      ok: false,
      response: NextResponse.json({ success: false, error: "Unauthorized" }, { status: 401 }),
    };
  }
  const synthetic: Extract<ProjectAccessCheckResult, { allowed: true }> = {
    allowed: true,
    source: "user",
    userId: user.id,
  };
  const billing = await requireBillingAnalyticsReadForUser(synthetic, user.email ?? null);
  if (!billing.ok) return { ok: false, response: billing.response };
  return { ok: true, userId: user.id, email: user.email ?? null };
}
