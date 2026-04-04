import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/app/lib/supabaseAdmin";
import { requireProjectAccessOrInternal } from "@/app/lib/auth/requireProjectAccessOrInternal";
import { billingAnalyticsReadGateFromAccess } from "@/app/lib/auth/requireBillingAccess";
import { buildDashboardFreshnessPayload } from "@/app/lib/dashboardFreshness";
import { createServerSupabase } from "@/app/lib/supabaseServer";

/**
 * GET /api/dashboard/freshness?project_id=...
 * Lightweight stale-check for auto-refresh interval (server-driven TTL).
 */
export async function GET(req: Request) {
  const url = new URL(req.url);
  const projectId = url.searchParams.get("project_id")?.trim();
  if (!projectId) {
    return NextResponse.json({ success: false, error: "project_id обязателен" }, { status: 400 });
  }

  const access = await requireProjectAccessOrInternal(req, projectId);
  if (!access.allowed) {
    return NextResponse.json(access.body, { status: access.status });
  }

  const billing = await billingAnalyticsReadGateFromAccess(access);
  if (!billing.ok) return billing.response;

  const admin = supabaseAdmin();
  let userId: string | null = null;
  let userEmail: string | null = null;
  if (access.source === "user") {
    const supabase = await createServerSupabase();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    userId = user?.id ?? null;
    userEmail = user?.email ?? null;
  }

  const freshness = await buildDashboardFreshnessPayload(admin, projectId, {
    userId,
    userEmail,
    accessSource: access.source === "internal" ? "internal" : "user",
  });

  return NextResponse.json({ success: true, freshness });
}
